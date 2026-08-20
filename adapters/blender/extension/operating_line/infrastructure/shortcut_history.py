"""Fail-closed Blender native history for the bounded shortcut proof.

The Scene marker durably binds the native-history identity and exact terminal
result outbox. It is excluded from scene fingerprints and is never treated as
evidence that Blender restored a state. Only a freshly recomputed target-scene
fingerprint may release or re-acquire the mutation lock.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import hashlib
import json
import math
import struct
from typing import Any
import uuid

import bpy
from bpy.app.handlers import persistent

from .shortcut_proof import (
    EXECUTOR_ID,
    OPERATION_IDS,
    build_subdivision_surface_scene_fingerprint_snapshot,
    compute_shortcut_scene_fingerprint_sha256,
    verify_operation_receipt_chain,
)


SHORTCUT_HISTORY_MARKER_KEY = "_operating_line_shortcut_proof_history_v1"
_MARKER_FORMAT_VERSION = "1.0.0"
_RESULT_IDENTITY_FIELDS = (
    "formatVersion", "requestId", "replayId", "proofId", "deliveryId",
    "target", "targetProfile", "proposalId", "plan", "executionId", "leafId",
    "interactionCatalogVersion", "interactionCatalogContentSha256",
    "shortcutTrackContentSha256", "bindingContentSha256", "binding",
    "executorId", "executionBoundary", "authorization", "transport",
    "operationIds", "expectedState", "requestedAt", "dispatchedAt",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _length_delimited(value: bytes) -> bytes:
    return str(len(value)).encode("ascii") + b":" + value


def _canonical_protocol_bytes(value: object, ancestors: set[int]) -> bytes:
    if value is None:
        return b"n"
    if value is False:
        return b"f"
    if value is True:
        return b"t"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Canonical protocol numbers must be finite")
        return b"d" + struct.pack(">d", 0.0 if number == 0 else number).hex().encode(
            "ascii"
        )
    if isinstance(value, str):
        encoded = value.encode("utf-8", errors="strict")
        return b"s" + str(len(encoded)).encode("ascii") + b":" + encoded
    if not isinstance(value, (list, dict)):
        raise ValueError("Value is not a canonical protocol JSON value")
    identity = id(value)
    if identity in ancestors:
        raise ValueError("Canonical protocol JSON values must not contain cycles")
    ancestors.add(identity)
    try:
        if isinstance(value, list):
            items = b"".join(
                _length_delimited(_canonical_protocol_bytes(item, ancestors))
                for item in value
            )
            return b"a" + str(len(value)).encode("ascii") + b":" + items
        entries: list[tuple[bytes, object]] = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("Canonical protocol object keys must be strings")
            entries.append((key.encode("utf-8", errors="strict"), item))
        entries.sort(key=lambda entry: entry[0])
        parts = [b"o" + str(len(entries)).encode("ascii") + b":"]
        for key_bytes, item in entries:
            encoded_key = (
                b"s" + str(len(key_bytes)).encode("ascii") + b":" + key_bytes
            )
            parts.append(_length_delimited(encoded_key))
            parts.append(
                _length_delimited(_canonical_protocol_bytes(item, ancestors))
            )
        return b"".join(parts)
    finally:
        ancestors.remove(identity)


def _canonical_sha256(value: Mapping[str, object]) -> str:
    return hashlib.sha256(_canonical_protocol_bytes(dict(value), set())).hexdigest()


def _require_uuid(value: object, label: str) -> str:
    try:
        parsed = uuid.UUID(str(value))
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError(f"Shortcut history {label} must be a UUID") from error
    return str(parsed)


def _require_sha256(value: object, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"Shortcut history {label} must be a lowercase SHA-256")
    return value


@dataclass(frozen=True, slots=True)
class ShortcutHistoryEntry:
    """Immutable proof boundary retained for later native Undo/Redo events."""

    checkpoint_id: str
    previous_checkpoint_id: str | None
    undo_lock_id: str
    proof_id: str
    replay_id: str
    target_id: str
    target_object_name: str
    owner_scene_uid: int
    checkpoint_kind: str
    baseline_scene_fingerprint_sha256: str
    final_scene_fingerprint_sha256: str
    receipt_chain_root_sha256: str | None
    receipt_chain_head_sha256: str | None
    last_completed_operation_id: str | None
    strong_observation_content_sha256: str | None
    viewport_level: int | None
    current_modifier_count: int
    armed_at: str
    terminal_result_content_sha256: str | None
    terminal_result: dict[str, object] | None
    transition_result_content_sha256s: tuple[str, ...] = ()
    transition_results: tuple[dict[str, object], ...] = ()
    acknowledged_result_content_sha256: str | None = None
    acknowledged_result_status: str | None = None
    acknowledged_result: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class ShortcutHistoryTransition:
    """Append-only journal transition emitted after a native history event."""

    transition_id: str
    checkpoint_id: str | None
    undo_lock_id: str | None
    direction: str
    status: str
    scene_fingerprint_sha256: str | None
    occurred_at: str
    error: str | None = None


TransitionCallback = Callable[[ShortcutHistoryTransition], None]
TransitionResultBuilder = Callable[[ShortcutHistoryTransition], Mapping[str, object]]
TransitionResultCallback = Callable[[dict[str, object]], None]
FingerprintReader = Callable[[], Mapping[str, object]]
TerminalResultBuilder = Callable[[dict[str, object]], Mapping[str, object]]


class ShortcutHistoryController:
    """Track one native shortcut boundary without mutating Blender data to recover."""

    def __init__(self, fingerprint_reader: FingerprintReader | None = None) -> None:
        self._fingerprint_reader = (
            build_subdivision_surface_scene_fingerprint_snapshot
            if fingerprint_reader is None
            else fingerprint_reader
        )
        self._entries: list[ShortcutHistoryEntry] = []
        self._transitions: list[ShortcutHistoryTransition] = []
        self._current: ShortcutHistoryEntry | None = None
        self._registered = False
        self._handling = False
        self._locked = False
        self._status = "idle"
        self._orphan_marker: dict[str, object] | None = None
        self._restored_callback: TransitionCallback | None = None
        self._reapplied_callback: TransitionCallback | None = None
        self._restored_result_builder: TransitionResultBuilder | None = None
        self._reapplied_result_builder: TransitionResultBuilder | None = None
        self._transition_result_callback: TransitionResultCallback | None = None
        self._recovery_ack_prefixes: dict[str, tuple[str, ...]] = {}
        self.error = ""

    @property
    def registered(self) -> bool:
        return self._registered

    @property
    def mutation_locked(self) -> bool:
        return self._locked

    @property
    def journal_size(self) -> int:
        return len(self._entries) + len(self._transitions)

    @staticmethod
    def _marker_identity_payload(entry: ShortcutHistoryEntry) -> dict[str, object]:
        if entry.terminal_result_content_sha256 is None:
            raise RuntimeError("Shortcut history terminal outbox is unavailable")
        return {
            "formatVersion": _MARKER_FORMAT_VERSION,
            "executorId": EXECUTOR_ID,
            "checkpointId": entry.checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "targetObjectName": entry.target_object_name,
            "checkpointKind": entry.checkpoint_kind,
            "baselineSceneFingerprintSha256": (
                entry.baseline_scene_fingerprint_sha256
            ),
            "finalSceneFingerprintSha256": entry.final_scene_fingerprint_sha256,
            "terminalResultContentSha256": entry.terminal_result_content_sha256,
        }

    @classmethod
    def _marker_payload(cls, entry: ShortcutHistoryEntry) -> dict[str, object]:
        if entry.terminal_result is None:
            raise RuntimeError("Shortcut history terminal outbox is unavailable")
        return {
            **cls._marker_identity_payload(entry),
            "terminalResult": deepcopy(entry.terminal_result),
            "transitionResultContentSha256s": list(
                entry.transition_result_content_sha256s
            ),
            "transitionResults": deepcopy(list(entry.transition_results)),
            "acknowledgedResultContentSha256": (
                entry.acknowledged_result_content_sha256
            ),
            "acknowledgedResultStatus": entry.acknowledged_result_status,
            "acknowledgedResult": deepcopy(entry.acknowledged_result),
        }

    @staticmethod
    def _marker_identity(marker: Mapping[str, object]) -> dict[str, object]:
        outbox_fields = {
            "terminalResult",
            "transitionResultContentSha256s",
            "transitionResults",
            "acknowledgedResultContentSha256",
            "acknowledgedResultStatus",
            "acknowledgedResult",
        }
        return {
            key: deepcopy(value)
            for key, value in marker.items()
            if key not in outbox_fields
        }

    @staticmethod
    def _validate_transition_result_identity(
        marker: Mapping[str, object],
        terminal_result: Mapping[str, object],
        result: Mapping[str, object],
        label: str,
    ) -> None:
        status = result.get("status")
        if status not in {"restored", "reapplied_locked"}:
            raise RuntimeError(f"Shortcut proof history {label} status is invalid")
        for field in _RESULT_IDENTITY_FIELDS:
            if result.get(field) != terminal_result.get(field):
                raise RuntimeError(
                    f"Shortcut proof history {label} identity is invalid"
                )
        terminal = result.get("terminalEvidence")
        expected_fingerprint = (
            marker["baselineSceneFingerprintSha256"]
            if status == "restored"
            else marker["finalSceneFingerprintSha256"]
        )
        if (
            not isinstance(terminal, Mapping)
            or terminal.get("sourceCheckpointId") != marker["checkpointId"]
            or terminal.get("undoLockId") != marker["undoLockId"]
            or terminal.get("baselineSceneFingerprintSha256")
            != marker["baselineSceneFingerprintSha256"]
            or terminal.get("lockedSceneFingerprintSha256")
            != marker["finalSceneFingerprintSha256"]
            or terminal.get("currentSceneFingerprintSha256")
            != expected_fingerprint
        ):
            raise RuntimeError(
                f"Shortcut proof history {label} checkpoint is invalid"
            )

    @staticmethod
    def _read_marker(scene: Any) -> dict[str, object] | None:
        value = scene.get(SHORTCUT_HISTORY_MARKER_KEY)
        if value is None:
            return None
        if not isinstance(value, str) or not value:
            raise RuntimeError("Shortcut proof history marker is invalid")
        try:
            marker = json.loads(value)
        except (TypeError, ValueError) as error:
            raise RuntimeError("Shortcut proof history marker is invalid") from error
        if (
            not isinstance(marker, dict)
            or marker.get("formatVersion") != _MARKER_FORMAT_VERSION
            or marker.get("executorId") != EXECUTOR_ID
            or marker.get("checkpointKind") not in {"success", "failure"}
        ):
            raise RuntimeError("Shortcut proof history marker is unsupported")
        for field in ("checkpointId", "undoLockId", "proofId", "replayId"):
            _require_uuid(marker.get(field), f"marker {field}")
        for field in (
            "baselineSceneFingerprintSha256",
            "finalSceneFingerprintSha256",
            "terminalResultContentSha256",
        ):
            _require_sha256(marker.get(field), f"marker {field}")
        if not isinstance(marker.get("targetId"), str) or not marker["targetId"]:
            raise RuntimeError("Shortcut proof history marker target is invalid")
        if (
            not isinstance(marker.get("targetObjectName"), str)
            or not marker["targetObjectName"]
        ):
            raise RuntimeError("Shortcut proof history marker object is invalid")
        terminal_result = marker.get("terminalResult")
        if (
            not isinstance(terminal_result, dict)
            or _canonical_sha256(terminal_result)
            != marker["terminalResultContentSha256"]
        ):
            raise RuntimeError("Shortcut proof history terminal outbox is invalid")
        transition_results = marker.get("transitionResults", [])
        transition_hashes = marker.get("transitionResultContentSha256s", [])
        acknowledged_hash = marker.get("acknowledgedResultContentSha256")
        acknowledged_status = marker.get("acknowledgedResultStatus")
        acknowledged_result = marker.get("acknowledgedResult")
        if (
            not isinstance(transition_results, list)
            or not isinstance(transition_hashes, list)
            or len(transition_results) != len(transition_hashes)
            or len(transition_results) > 32
            or not all(isinstance(result, dict) for result in transition_results)
            or any(
                _require_sha256(value, "marker transition result")
                != _canonical_sha256(result)
                for value, result in zip(transition_hashes, transition_results)
            )
        ):
            raise RuntimeError("Shortcut proof history transition outbox is invalid")
        previous_status = acknowledged_status or terminal_result.get("status")
        for result in transition_results:
            status = result.get("status")
            ShortcutHistoryController._validate_transition_result_identity(
                marker, terminal_result, result, "transition"
            )
            expected_transition_status = (
                "restored"
                if previous_status in {
                    "succeeded", "failed_checkpointed", "reapplied_locked"
                }
                else "reapplied_locked"
            )
            if status != expected_transition_status:
                raise RuntimeError("Shortcut proof history transition order is invalid")
            previous_status = status
        marker.setdefault("transitionResults", [])
        marker.setdefault("transitionResultContentSha256s", [])
        if acknowledged_hash is not None:
            _require_sha256(acknowledged_hash, "acknowledged transition result")
        if acknowledged_status not in {
            None, "succeeded", "failed_checkpointed", "restored", "reapplied_locked"
        }:
            raise RuntimeError("Shortcut proof history acknowledged status is invalid")
        if (acknowledged_hash is None) != (acknowledged_status is None):
            raise RuntimeError("Shortcut proof history acknowledged result is invalid")
        if (acknowledged_hash is None) != (acknowledged_result is None):
            raise RuntimeError("Shortcut proof history acknowledged result body is invalid")
        if acknowledged_result is not None:
            if (
                not isinstance(acknowledged_result, dict)
                or _canonical_sha256(acknowledged_result) != acknowledged_hash
                or acknowledged_result.get("status") != acknowledged_status
            ):
                raise RuntimeError("Shortcut proof history acknowledged result hash is invalid")
            for field in _RESULT_IDENTITY_FIELDS:
                if acknowledged_result.get(field) != terminal_result.get(field):
                    raise RuntimeError(
                        "Shortcut proof history acknowledged result identity is invalid"
                    )
            if acknowledged_status in {"restored", "reapplied_locked"}:
                ShortcutHistoryController._validate_transition_result_identity(
                    marker,
                    terminal_result,
                    acknowledged_result,
                    "acknowledged result",
                )
        marker.setdefault("acknowledgedResultContentSha256", None)
        marker.setdefault("acknowledgedResultStatus", None)
        marker.setdefault("acknowledgedResult", None)
        return marker

    @staticmethod
    def _remove_markers() -> None:
        for scene in bpy.data.scenes:
            if SHORTCUT_HISTORY_MARKER_KEY in scene:
                del scene[SHORTCUT_HISTORY_MARKER_KEY]

    def _write_marker(self, scene: Any, entry: ShortcutHistoryEntry) -> None:
        marker = self._marker_payload(entry)
        scene[SHORTCUT_HISTORY_MARKER_KEY] = json.dumps(
            marker,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        if self._read_marker(scene) != marker:
            if SHORTCUT_HISTORY_MARKER_KEY in scene:
                del scene[SHORTCUT_HISTORY_MARKER_KEY]
            raise RuntimeError("Shortcut proof history marker did not round-trip")

    def _discover_persisted_marker(self) -> None:
        found: list[dict[str, object]] = []
        invalid = False
        for scene in bpy.data.scenes:
            try:
                marker = self._read_marker(scene)
            except (RuntimeError, ValueError):
                invalid = True
                continue
            if marker is not None:
                found.append(marker)
        if invalid or len(found) > 1:
            self._lock_indeterminate(
                "Persisted shortcut proof history markers are invalid or ambiguous"
            )
        elif found:
            self._orphan_marker = found[0]
            self._lock_indeterminate(
                "A persisted shortcut proof mutation requires explicit native Undo verification"
            )

    def register(
        self,
        restored_callback: TransitionCallback | None = None,
        reapplied_callback: TransitionCallback | None = None,
        restored_result_builder: TransitionResultBuilder | None = None,
        reapplied_result_builder: TransitionResultBuilder | None = None,
        transition_result_callback: TransitionResultCallback | None = None,
    ) -> None:
        self._restored_callback = restored_callback
        self._reapplied_callback = reapplied_callback
        self._restored_result_builder = restored_result_builder
        self._reapplied_result_builder = reapplied_result_builder
        self._transition_result_callback = transition_result_callback
        if self._registered:
            return
        for handlers, callback in (
            (bpy.app.handlers.undo_post, _shortcut_undo_post),
            (bpy.app.handlers.redo_post, _shortcut_redo_post),
            (bpy.app.handlers.load_post, _shortcut_load_post),
        ):
            if callback not in handlers:
                handlers.append(callback)
        self._registered = True
        current = self._current
        owner = None if current is None else self._owner_scene(current)
        if (
            current is None
            or owner is None
            or self._read_marker(owner) != self._marker_payload(current)
        ):
            self._discover_persisted_marker()

    def unregister(self) -> None:
        if self._registered:
            for handlers, callback in (
                (bpy.app.handlers.undo_post, _shortcut_undo_post),
                (bpy.app.handlers.redo_post, _shortcut_redo_post),
                (bpy.app.handlers.load_post, _shortcut_load_post),
            ):
                if callback in handlers:
                    handlers.remove(callback)
        if not self._locked and not self.has_transition_outbox():
            self._remove_markers()
            self._current = None
            self._orphan_marker = None
            self._status = "idle"
            self.error = ""
        self._restored_callback = None
        self._reapplied_callback = None
        self._restored_result_builder = None
        self._reapplied_result_builder = None
        self._transition_result_callback = None
        self._registered = False

    def _validate_success_evidence(
        self,
        evidence: Mapping[str, object],
    ) -> tuple[str, str, str, int, str]:
        expected_claims = {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "evidenceClass": "blender_event_simulation",
            "osHidInput": False,
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "ok": True,
            "mutationStarted": True,
            "lastCompletedOperation": OPERATION_IDS[-1],
            "requiresUndoToUnlock": True,
            "operationReceiptChainVerified": True,
        }
        if any(evidence.get(key) != value for key, value in expected_claims.items()):
            raise ValueError("Shortcut history requires successful fixed-executor evidence")

        receipts = evidence.get("operationReceipts")
        if (
            not isinstance(receipts, Sequence)
            or isinstance(receipts, (str, bytes))
            or len(receipts) != len(OPERATION_IDS)
            or not all(isinstance(receipt, Mapping) for receipt in receipts)
            or not verify_operation_receipt_chain(receipts)
        ):
            raise ValueError("Shortcut history receipt chain is invalid")
        root_sha256 = _require_sha256(
            receipts[0].get("contentSha256"), "receipt chain root"
        )
        head_sha256 = _require_sha256(
            receipts[-1].get("contentSha256"), "receipt chain head"
        )

        baseline = evidence.get("baselineSceneSnapshot")
        final = evidence.get("finalSceneSnapshot")
        if not isinstance(baseline, Mapping) or not isinstance(final, Mapping):
            raise ValueError("Shortcut history scene snapshots are missing")
        baseline_sha256 = compute_shortcut_scene_fingerprint_sha256(baseline)
        final_sha256 = compute_shortcut_scene_fingerprint_sha256(final)
        if (
            baseline_sha256
            != evidence.get("baselineSceneFingerprintSha256")
            or final_sha256 != evidence.get("finalSceneFingerprintSha256")
            or baseline_sha256 == final_sha256
        ):
            raise ValueError("Shortcut history scene fingerprints are invalid")

        target_level = evidence.get("targetLevel")
        observation = evidence.get("observation")
        preflight = evidence.get("preflight")
        if (
            target_level not in {1, 2, 3}
            or isinstance(target_level, bool)
            or not isinstance(observation, Mapping)
            or observation.get("kind") != "subdivision_surface_shortcut_ready"
            or observation.get("satisfied") is not True
            or observation.get("viewportLevel") != target_level
            or observation.get("modifierCount") != 1
            or observation.get("subsurfModifierCount") != 1
            or not isinstance(observation.get("observedAt"), str)
            or not observation.get("observedAt")
            or not isinstance(preflight, Mapping)
            or preflight.get("satisfied") is not True
            or preflight.get("modifierCount") != 0
            or preflight.get("mode") != "OBJECT"
        ):
            raise ValueError("Shortcut history strong observation is invalid")

        baseline_modifiers = baseline.get("modifiers")
        final_modifiers = final.get("modifiers")
        baseline_target = baseline.get("target")
        final_target = final.get("target")
        if (
            baseline_modifiers != []
            or not isinstance(final_modifiers, list)
            or len(final_modifiers) != 1
            or not isinstance(final_modifiers[0], Mapping)
            or final_modifiers[0].get("type") != "SUBSURF"
            or final_modifiers[0].get("levels") != target_level
            or not isinstance(baseline_target, Mapping)
            or not isinstance(final_target, Mapping)
            or baseline_target != final_target
            or baseline_target.get("objectName") != preflight.get("objectName")
        ):
            raise ValueError("Shortcut history target scene boundary is invalid")

        native_history = evidence.get("nativeHistory")
        if not isinstance(native_history, Mapping):
            raise ValueError("Shortcut history native Undo evidence is missing")
        undo_observation = native_history.get("undoObservation")
        redo_observation = native_history.get("redoObservation")
        undo_body = dict(undo_observation) if isinstance(undo_observation, Mapping) else {}
        redo_body = dict(redo_observation) if isinstance(redo_observation, Mapping) else {}
        undo_hash = undo_body.pop("contentSha256", None)
        redo_hash = redo_body.pop("contentSha256", None)
        if (
            native_history.get("availability") != "verified"
            or native_history.get("boundary") != "single_native_undo_redo"
            or not isinstance(undo_observation, Mapping)
            or undo_observation.get("satisfied") is not True
            or undo_observation.get("sceneFingerprintSha256") != baseline_sha256
            or undo_hash != _canonical_sha256(undo_body)
            or not isinstance(redo_observation, Mapping)
            or redo_observation.get("satisfied") is not True
            or redo_observation.get("sceneFingerprintSha256") != final_sha256
            or redo_hash != _canonical_sha256(redo_body)
        ):
            raise ValueError("Shortcut history native Undo/Redo boundary is invalid")

        current_sha256 = compute_shortcut_scene_fingerprint_sha256(
            self._fingerprint_reader()
        )
        if current_sha256 != final_sha256:
            raise ValueError("Shortcut history can only arm at the proven final state")
        return (
            baseline_sha256,
            final_sha256,
            str(baseline_target["objectName"]),
            int(target_level),
            _canonical_sha256(dict(observation)),
        )

    def arm(
        self,
        scene: Any,
        evidence: Mapping[str, object],
        *,
        proof_id: str | None = None,
        replay_id: str | None = None,
        target_id: str | None = None,
        strong_observation_content_sha256: str | None = None,
        terminal_result_builder: TerminalResultBuilder,
    ) -> dict[str, object]:
        if not self._registered:
            raise RuntimeError("Shortcut history is not registered")
        if self._locked:
            raise RuntimeError("Shortcut proof mutation lock is already held")
        (
            baseline_sha256,
            final_sha256,
            target_object_name,
            viewport_level,
            derived_observation_sha256,
        ) = self._validate_success_evidence(evidence)
        proof_id = _require_uuid(proof_id or uuid.uuid4(), "proofId")
        replay_id = _require_uuid(replay_id or uuid.uuid4(), "replayId")
        if target_id is None:
            target_id = target_object_name
        if not isinstance(target_id, str) or not target_id:
            raise ValueError("Shortcut history targetId must not be empty")
        observation_sha256 = _require_sha256(
            strong_observation_content_sha256 or derived_observation_sha256,
            "strong observation content",
        )
        receipts = evidence["operationReceipts"]
        assert isinstance(receipts, Sequence)
        previous_checkpoint_id = (
            None if not self._entries else self._entries[-1].checkpoint_id
        )
        entry = ShortcutHistoryEntry(
            checkpoint_id=str(uuid.uuid4()),
            previous_checkpoint_id=previous_checkpoint_id,
            undo_lock_id=str(uuid.uuid4()),
            proof_id=proof_id,
            replay_id=replay_id,
            target_id=target_id,
            target_object_name=target_object_name,
            owner_scene_uid=int(scene.session_uid),
            checkpoint_kind="success",
            baseline_scene_fingerprint_sha256=baseline_sha256,
            final_scene_fingerprint_sha256=final_sha256,
            receipt_chain_root_sha256=str(receipts[0]["contentSha256"]),
            receipt_chain_head_sha256=str(receipts[-1]["contentSha256"]),
            last_completed_operation_id=OPERATION_IDS[-1],
            strong_observation_content_sha256=observation_sha256,
            viewport_level=viewport_level,
            current_modifier_count=1,
            armed_at=_utc_now(),
            terminal_result_content_sha256=None,
            terminal_result=None,
        )
        checkpoint = self._success_checkpoint(entry, verify_live=False)
        terminal_result = dict(terminal_result_builder(deepcopy(checkpoint)))
        terminal_result_sha256 = _canonical_sha256(terminal_result)
        entry = replace(
            entry,
            terminal_result_content_sha256=terminal_result_sha256,
            terminal_result=deepcopy(terminal_result),
        )
        self._write_marker(scene, entry)
        self._entries.append(entry)
        self._current = entry
        self._orphan_marker = None
        self._locked = True
        self._status = "armed_locked"
        self.error = ""
        return checkpoint

    def arm_failed(
        self,
        scene: Any,
        evidence: Mapping[str, object],
        *,
        proof_id: str,
        replay_id: str,
        target_id: str,
        terminal_result_builder: TerminalResultBuilder,
    ) -> dict[str, object]:
        """Retain a failed mutated boundary until native Undo proves baseline."""

        if not self._registered:
            raise RuntimeError("Shortcut history is not registered")
        if self._locked:
            raise RuntimeError("Shortcut proof mutation lock is already held")
        expected_claims = {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "evidenceClass": "blender_event_simulation",
            "osHidInput": False,
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "ok": False,
            "failureStatus": "failed_checkpointed",
            "mutationStarted": True,
            "requiresUndoRecovery": True,
            "operationReceiptPrefixVerified": True,
        }
        if any(evidence.get(key) != value for key, value in expected_claims.items()):
            raise ValueError("Shortcut failure history requires exact mutated failure evidence")

        receipts = evidence.get("operationReceipts")
        if (
            not isinstance(receipts, Sequence)
            or isinstance(receipts, (str, bytes))
            or len(receipts) > len(OPERATION_IDS)
            or not all(isinstance(receipt, Mapping) for receipt in receipts)
            or not verify_operation_receipt_chain(receipts)
        ):
            raise ValueError("Shortcut failure history receipt prefix is invalid")
        chain_complete = len(receipts) == len(OPERATION_IDS)
        if (
            evidence.get("operationReceiptChainComplete") is not chain_complete
            or evidence.get("operationReceiptChainVerified") is not chain_complete
        ):
            raise ValueError("Shortcut failure history receipt completion is invalid")
        last_completed_operation_id = (
            None if not receipts else str(receipts[-1].get("operationId"))
        )
        if evidence.get("lastCompletedOperation") != last_completed_operation_id:
            raise ValueError("Shortcut failure history last completed operation is invalid")

        baseline = evidence.get("baselineSceneSnapshot")
        current = evidence.get("currentSceneSnapshot")
        if not isinstance(baseline, Mapping) or not isinstance(current, Mapping):
            raise ValueError("Shortcut failure history scene snapshots are missing")
        baseline_sha256 = compute_shortcut_scene_fingerprint_sha256(baseline)
        current_sha256 = compute_shortcut_scene_fingerprint_sha256(current)
        if (
            baseline_sha256 != evidence.get("baselineSceneFingerprintSha256")
            or current_sha256 != evidence.get("currentSceneFingerprintSha256")
            or baseline_sha256 == current_sha256
        ):
            raise ValueError("Shortcut failure history scene fingerprints are invalid")
        live_sha256 = compute_shortcut_scene_fingerprint_sha256(
            self._fingerprint_reader()
        )
        if live_sha256 != current_sha256:
            raise ValueError("Shortcut failure history can only arm at the proven current state")

        baseline_target = baseline.get("target")
        current_target = current.get("target")
        baseline_modifiers = baseline.get("modifiers")
        current_modifiers = current.get("modifiers")
        if (
            not isinstance(baseline_target, Mapping)
            or not isinstance(current_target, Mapping)
            or baseline_target != current_target
            or not isinstance(baseline_target.get("objectName"), str)
            or not baseline_target["objectName"]
            or baseline_modifiers != []
            or not isinstance(current_modifiers, list)
        ):
            raise ValueError("Shortcut failure history target scene boundary is invalid")

        proof_id = _require_uuid(proof_id, "proofId")
        replay_id = _require_uuid(replay_id, "replayId")
        if not isinstance(target_id, str) or not target_id:
            raise ValueError("Shortcut failure history targetId must not be empty")
        previous_checkpoint_id = (
            None if not self._entries else self._entries[-1].checkpoint_id
        )
        entry = ShortcutHistoryEntry(
            checkpoint_id=str(uuid.uuid4()),
            previous_checkpoint_id=previous_checkpoint_id,
            undo_lock_id=str(uuid.uuid4()),
            proof_id=proof_id,
            replay_id=replay_id,
            target_id=target_id,
            target_object_name=str(baseline_target["objectName"]),
            owner_scene_uid=int(scene.session_uid),
            checkpoint_kind="failure",
            baseline_scene_fingerprint_sha256=baseline_sha256,
            final_scene_fingerprint_sha256=current_sha256,
            receipt_chain_root_sha256=(
                None if not receipts else str(receipts[0]["contentSha256"])
            ),
            receipt_chain_head_sha256=(
                None if not receipts else str(receipts[-1]["contentSha256"])
            ),
            last_completed_operation_id=last_completed_operation_id,
            strong_observation_content_sha256=None,
            viewport_level=None,
            current_modifier_count=len(current_modifiers),
            armed_at=_utc_now(),
            terminal_result_content_sha256=None,
            terminal_result=None,
        )
        checkpoint = self._failure_checkpoint(entry, verify_live=False)
        terminal_result = dict(terminal_result_builder(deepcopy(checkpoint)))
        entry = replace(
            entry,
            terminal_result_content_sha256=_canonical_sha256(terminal_result),
            terminal_result=deepcopy(terminal_result),
        )
        try:
            self._write_marker(scene, entry)
        except Exception as error:
            self._lock_indeterminate(
                f"Failure checkpoint could not arm: {error}", "checkpoint"
            )
            raise
        self._entries.append(entry)
        self._current = entry
        self._orphan_marker = None
        self._locked = True
        self._status = "failed_checkpointed"
        self.error = ""
        return checkpoint

    def _owner_scene(self, entry: ShortcutHistoryEntry) -> Any | None:
        return next(
            (
                scene
                for scene in bpy.data.scenes
                if int(scene.session_uid) == entry.owner_scene_uid
            ),
            None,
        )

    def _append_transition(
        self,
        *,
        direction: str,
        status: str,
        scene_fingerprint_sha256: str | None,
        error: str | None = None,
    ) -> ShortcutHistoryTransition:
        current = self._current
        transition = ShortcutHistoryTransition(
            transition_id=str(uuid.uuid4()),
            checkpoint_id=None if current is None else current.checkpoint_id,
            undo_lock_id=None if current is None else current.undo_lock_id,
            direction=direction,
            status=status,
            scene_fingerprint_sha256=scene_fingerprint_sha256,
            occurred_at=_utc_now(),
            error=error,
        )
        self._transitions.append(transition)
        return transition

    def _new_transition(
        self,
        *,
        direction: str,
        status: str,
        scene_fingerprint_sha256: str | None,
        error: str | None = None,
    ) -> ShortcutHistoryTransition:
        current = self._current
        return ShortcutHistoryTransition(
            transition_id=str(uuid.uuid4()),
            checkpoint_id=None if current is None else current.checkpoint_id,
            undo_lock_id=None if current is None else current.undo_lock_id,
            direction=direction,
            status=status,
            scene_fingerprint_sha256=scene_fingerprint_sha256,
            occurred_at=_utc_now(),
            error=error,
        )

    def _lock_indeterminate(self, message: str, direction: str = "load") -> None:
        self._locked = True
        self._status = "indeterminate_locked"
        self.error = f"Shortcut proof native history failed closed: {message}"
        self._append_transition(
            direction=direction,
            status=self._status,
            scene_fingerprint_sha256=None,
            error=self.error,
        )
        print(f"OperatingLine {self.error}")

    def lock_indeterminate(self, message: str) -> None:
        """Conservatively retain the mutation lock after checkpoint uncertainty."""

        self._lock_indeterminate(message, "checkpoint")

    def _entry_from_terminal_marker(
        self,
        scene: Any,
        marker: Mapping[str, object],
        terminal_result: Mapping[str, object],
    ) -> ShortcutHistoryEntry:
        terminal = terminal_result.get("terminalEvidence")
        if not isinstance(terminal, Mapping):
            raise ValueError("Shortcut history terminal evidence is unavailable")
        attestation = terminal.get("attestation")
        checkpoint = (
            attestation.get("nativeUndoCheckpoint")
            if isinstance(attestation, Mapping)
            else terminal.get("checkpoint")
        )
        if not isinstance(checkpoint, Mapping):
            raise ValueError("Shortcut history checkpoint evidence is unavailable")
        receipts = (
            attestation.get("operationReceipts")
            if isinstance(attestation, Mapping)
            else terminal.get("receiptPrefix")
        )
        if not isinstance(receipts, Sequence) or isinstance(receipts, (str, bytes)):
            raise ValueError("Shortcut history receipt evidence is unavailable")
        strong = attestation.get("strongObservation") if isinstance(attestation, Mapping) else None
        return ShortcutHistoryEntry(
            checkpoint_id=str(marker["checkpointId"]),
            previous_checkpoint_id=(
                str(checkpoint["previousCheckpointId"])
                if checkpoint.get("previousCheckpointId") is not None
                else None
            ),
            undo_lock_id=str(marker["undoLockId"]),
            proof_id=str(marker["proofId"]),
            replay_id=str(marker["replayId"]),
            target_id=str(marker["targetId"]),
            target_object_name=str(marker["targetObjectName"]),
            owner_scene_uid=int(scene.session_uid),
            checkpoint_kind=str(marker["checkpointKind"]),
            baseline_scene_fingerprint_sha256=str(marker["baselineSceneFingerprintSha256"]),
            final_scene_fingerprint_sha256=str(marker["finalSceneFingerprintSha256"]),
            receipt_chain_root_sha256=(
                None if not receipts else str(receipts[0].get("contentSha256"))
            ),
            receipt_chain_head_sha256=(
                None if not receipts else str(receipts[-1].get("contentSha256"))
            ),
            last_completed_operation_id=(
                str(receipts[-1].get("operationId")) if receipts else None
            ),
            strong_observation_content_sha256=(
                str(strong.get("contentSha256")) if isinstance(strong, Mapping) else None
            ),
            viewport_level=(
                int(strong.get("viewportLevel")) if isinstance(strong, Mapping) else None
            ),
            current_modifier_count=(
                int(strong.get("modifierCount"))
                if isinstance(strong, Mapping)
                else int(checkpoint.get("currentState", {}).get("modifierCount", 0))
            ),
            armed_at=str(checkpoint.get("committedAt") or _utc_now()),
            terminal_result_content_sha256=str(marker["terminalResultContentSha256"]),
            terminal_result=deepcopy(dict(terminal_result)),
            transition_result_content_sha256s=tuple(
                str(value)
                for value in marker.get("transitionResultContentSha256s", [])
            ),
            transition_results=tuple(
                deepcopy(dict(value))
                for value in marker.get("transitionResults", [])
                if isinstance(value, Mapping)
            ),
            acknowledged_result_content_sha256=(
                str(marker["acknowledgedResultContentSha256"])
                if marker.get("acknowledgedResultContentSha256") is not None
                else None
            ),
            acknowledged_result_status=(
                str(marker["acknowledgedResultStatus"])
                if marker.get("acknowledgedResultStatus") is not None
                else None
            ),
            acknowledged_result=(
                deepcopy(dict(marker["acknowledgedResult"]))
                if isinstance(marker.get("acknowledgedResult"), Mapping)
                else None
            ),
        )

    def has_transition_outbox(self) -> bool:
        marker = self._orphan_marker
        if self._current is not None:
            marker = self._marker_payload(self._current)
        return bool(marker and marker.get("transitionResults"))

    def acknowledge_transition_results(self, content_sha256s: Sequence[str]) -> None:
        """Clear only an exactly acknowledged durable outbox prefix."""

        if isinstance(content_sha256s, (str, bytes)) or not content_sha256s:
            return
        entry = self._current
        if entry is None:
            return
        hashes = tuple(content_sha256s)
        if (
            len(hashes) == 1
            and hashes[0] == entry.terminal_result_content_sha256
            and not entry.transition_result_content_sha256s
        ):
            terminal_status = (
                str(entry.terminal_result.get("status"))
                if entry.terminal_result is not None
                else None
            )
            owner = self._owner_scene(entry)
            if owner is None:
                self._lock_indeterminate(
                    "terminal acknowledgement owner Scene is unavailable"
                )
                return
            updated = replace(
                entry,
                acknowledged_result_content_sha256=hashes[0],
                acknowledged_result_status=terminal_status,
                acknowledged_result=deepcopy(entry.terminal_result),
            )
            try:
                self._write_marker(owner, updated)
            except Exception as error:
                self._lock_indeterminate(
                    f"terminal acknowledgement could not persist: {error}"
                )
                return
            self._current = updated
            if self._entries and self._entries[-1].checkpoint_id == updated.checkpoint_id:
                self._entries[-1] = updated
            return
        if hashes != entry.transition_result_content_sha256s[: len(hashes)]:
            return
        owner = self._owner_scene(entry)
        if owner is None:
            self._lock_indeterminate("transition acknowledgement owner Scene is unavailable")
            return
        updated = replace(
            entry,
            transition_result_content_sha256s=(
                entry.transition_result_content_sha256s[len(hashes) :]
            ),
            transition_results=entry.transition_results[len(hashes) :],
            acknowledged_result_content_sha256=hashes[-1],
            acknowledged_result_status=str(
                entry.transition_results[len(hashes) - 1].get("status")
            ),
            acknowledged_result=deepcopy(
                entry.transition_results[len(hashes) - 1]
            ),
        )
        try:
            self._write_marker(owner, updated)
        except Exception as error:
            self._lock_indeterminate(
                f"transition acknowledgement could not persist: {error}"
            )
            return
        self._current = updated
        if self._entries and self._entries[-1].checkpoint_id == updated.checkpoint_id:
            self._entries[-1] = updated

    def acknowledge_transition_recovery(self, recovery_id: str) -> None:
        hashes = self._recovery_ack_prefixes.pop(recovery_id, None)
        if hashes:
            self.acknowledge_transition_results(hashes)

    def _persist_transition_result(
        self,
        entry: ShortcutHistoryEntry,
        transition: ShortcutHistoryTransition,
        builder: TransitionResultBuilder | None,
    ) -> tuple[ShortcutHistoryEntry, dict[str, object] | None]:
        if builder is None:
            return entry, None
        if len(entry.transition_results) >= 32:
            raise RuntimeError("Shortcut history transition outbox limit reached")
        result = dict(builder(transition))
        if result.get("status") != transition.status:
            raise RuntimeError("Shortcut history transition result status is invalid")
        result_sha256 = _canonical_sha256(result)
        updated = replace(
            entry,
            transition_result_content_sha256s=(
                *entry.transition_result_content_sha256s,
                result_sha256,
            ),
            transition_results=(*entry.transition_results, deepcopy(result)),
        )
        owner = self._owner_scene(entry)
        if owner is None:
            raise RuntimeError("owner Scene is unavailable")
        self._write_marker(owner, updated)
        return updated, result

    def _recovery_marker(
        self,
        scene: Any,
        unavailable_message: str,
    ) -> tuple[dict[str, object], bool]:
        """Return an exact persisted marker and whether it belongs to `_current`."""

        marker = self._read_marker(scene)
        if marker is None:
            raise ValueError(unavailable_message)
        current = self._current
        if current is not None:
            if (
                int(scene.session_uid) != current.owner_scene_uid
                or marker != self._marker_payload(current)
            ):
                raise ValueError(unavailable_message)
            return marker, True
        if self._orphan_marker is None or marker != self._orphan_marker:
            raise ValueError(unavailable_message)
        return marker, False

    def rebind_orphan(
        self,
        scene: Any,
        delivery: Mapping[str, object],
    ) -> dict[str, object]:
        """Acknowledge or reconstruct the boundary for an exact persisted marker.

        Rebinding is association recovery, never restoration evidence.  It requires
        the persisted marker, supplied checkpoint identity, and live locked scene
        fingerprint to agree exactly. A matching live boundary is only acknowledged;
        an orphan is reconstructed, and both paths deliberately leave the lock held.
        """

        if not self._registered:
            raise RuntimeError("Shortcut history is not registered")
        if (
            delivery.get("formatVersion") != _MARKER_FORMAT_VERSION
            or delivery.get("kind") != "native_history_rebind"
            or delivery.get("expectedStatus")
            not in {"succeeded", "failed_checkpointed", "restored", "reapplied_locked"}
            or not isinstance(delivery.get("recoveryRequestedAt"), str)
            or not delivery.get("recoveryRequestedAt")
        ):
            raise ValueError("Shortcut history recovery delivery is unsupported")
        marker, live_current = self._recovery_marker(
            scene, "Shortcut history marker identity is unavailable"
        )
        history = delivery.get("history")
        binding = delivery.get("binding")
        if not isinstance(history, Mapping) or not isinstance(binding, Mapping):
            raise ValueError("Shortcut history recovery delivery is incomplete")
        if set(history) != {
            "checkpointId",
            "undoLockId",
            "checkpointKind",
            "baselineSceneFingerprintSha256",
            "lockedSceneFingerprintSha256",
            "terminalResultContentSha256",
        }:
            raise ValueError("Shortcut history recovery identity is invalid")
        for field in ("requestId", "replayId", "proofId", "deliveryId", "recoveryId"):
            _require_uuid(delivery.get(field), f"recovery {field}")
        binding_sha256 = _require_sha256(
            delivery.get("bindingContentSha256"), "recovery binding content"
        )
        integrity = binding.get("integrity")
        if (
            not isinstance(integrity, Mapping)
            or integrity.get("contentSha256") != binding_sha256
        ):
            raise ValueError("Shortcut history recovery binding hash does not match")
        target = delivery.get("target")
        if not isinstance(target, Mapping) or target.get("adapterId") != "blender":
            raise ValueError("Shortcut history recovery target is invalid")
        checkpoint_kind = str(marker["checkpointKind"])
        exact_identity = {
            "checkpointId": marker["checkpointId"],
            "undoLockId": marker["undoLockId"],
            "checkpointKind": checkpoint_kind,
            "baselineSceneFingerprintSha256": marker[
                "baselineSceneFingerprintSha256"
            ],
            "lockedSceneFingerprintSha256": marker["finalSceneFingerprintSha256"],
            "terminalResultContentSha256": marker[
                "terminalResultContentSha256"
            ],
        }
        if any(history.get(key) != value for key, value in exact_identity.items()):
            raise ValueError(
                "Shortcut history recovery checkpoint identity does not match marker"
            )
        if (
            delivery.get("proofId") != marker["proofId"]
            or delivery.get("replayId") != marker["replayId"]
            or binding.get("proofId") != marker["proofId"]
            or binding.get("requestId") != delivery.get("requestId")
            or binding.get("replayId") != marker["replayId"]
        ):
            raise ValueError(
                "Shortcut history recovery delivery identity does not match marker"
            )
        accepted_action = binding.get("acceptedAction")
        arguments = (
            accepted_action.get("arguments")
            if isinstance(accepted_action, Mapping)
            else None
        )
        if (
            not isinstance(arguments, Mapping)
            or arguments.get("targetId") != marker["targetId"]
        ):
            raise ValueError(
                "Shortcut history recovery target identity does not match marker"
            )
        marker_content_sha256 = _canonical_sha256(self._marker_identity(marker))
        if delivery.get("expectedMarkerContentSha256") != marker_content_sha256:
            raise ValueError("Shortcut history recovery marker content hash does not match")
        expected_result_sha256 = _require_sha256(
            delivery.get("expectedResultContentSha256"),
            "recovery expected result content",
        )
        proven_result_hashes = {
            str(marker["terminalResultContentSha256"]),
            *(
                [str(marker["acknowledgedResultContentSha256"])]
                if marker.get("acknowledgedResultContentSha256") is not None
                else []
            ),
            *(str(value) for value in marker["transitionResultContentSha256s"]),
        }
        if expected_result_sha256 not in proven_result_hashes:
            raise ValueError("Shortcut history recovery expected result is unknown")
        expected_status = str(delivery["expectedStatus"])
        expected_result_status = (
            str(marker["terminalResult"].get("status"))
            if expected_result_sha256 == marker["terminalResultContentSha256"]
            else marker.get("acknowledgedResultStatus")
            if expected_result_sha256 == marker.get("acknowledgedResultContentSha256")
            else next(
                str(result.get("status"))
                for result_hash, result in zip(
                    marker["transitionResultContentSha256s"],
                    marker["transitionResults"],
                )
                if result_hash == expected_result_sha256
            )
        )
        if expected_result_status != expected_status:
            raise ValueError("Shortcut history recovery expected status is inconsistent")
        baseline_sha256 = str(marker["baselineSceneFingerprintSha256"])
        locked_sha256 = str(marker["finalSceneFingerprintSha256"])
        expected_sha256 = (
            baseline_sha256 if expected_status == "restored" else locked_sha256
        )
        expected_locked = expected_status != "restored"
        live_sha256 = compute_shortcut_scene_fingerprint_sha256(
            self._fingerprint_reader()
        )
        if live_sha256 != expected_sha256:
            raise ValueError(
                "Shortcut history recovery live state does not match expected fingerprint"
            )
        terminal_result = marker["terminalResult"]
        if not isinstance(terminal_result, dict):
            raise ValueError("Shortcut history recovery terminal outbox is unavailable")
        terminal = terminal_result.get("terminalEvidence")
        if not isinstance(terminal, Mapping):
            raise ValueError("Shortcut history recovery terminal evidence is unavailable")
        attestation = terminal.get("attestation")
        checkpoint = (
            attestation.get("nativeUndoCheckpoint")
            if isinstance(attestation, Mapping)
            else terminal.get("checkpoint")
        )
        if not isinstance(checkpoint, Mapping):
            raise ValueError("Shortcut history recovery checkpoint evidence is unavailable")
        if (
            terminal_result.get("proofId") != marker["proofId"]
            or terminal_result.get("replayId") != marker["replayId"]
            or terminal_result.get("deliveryId") != delivery.get("deliveryId")
            or terminal_result.get("requestId") != delivery.get("requestId")
            or terminal_result.get("target") != delivery.get("target")
            or terminal_result.get("bindingContentSha256") != binding_sha256
            or checkpoint.get("checkpointId") != marker["checkpointId"]
            or checkpoint.get("undoLockId") != marker["undoLockId"]
            or _canonical_sha256(terminal_result)
            != history["terminalResultContentSha256"]
        ):
            raise ValueError("Shortcut history recovery terminal identity does not match marker")
        if not live_current:
            entry = self._entry_from_terminal_marker(scene, marker, terminal_result)
            self._entries.append(entry)
            self._current = entry
            self._orphan_marker = None
            self._locked = expected_locked
            self._status = expected_status
            self.error = ""
            self._append_transition(
                direction="rebind",
                status=self._status,
                scene_fingerprint_sha256=live_sha256,
            )
        return {
            "kind": "native_history_rebind",
            "formatVersion": delivery.get("formatVersion"),
            "requestId": delivery.get("requestId"),
            "replayId": delivery.get("replayId"),
            "proofId": delivery.get("proofId"),
            "deliveryId": delivery.get("deliveryId"),
            "target": dict(delivery.get("target", {})),
            "bindingContentSha256": delivery.get("bindingContentSha256"),
            "recoveryId": delivery.get("recoveryId"),
            "history": dict(history),
            "expectedMarkerContentSha256": marker_content_sha256,
            "currentSceneFingerprintSha256": live_sha256,
            "mutationLocked": expected_locked,
            "status": expected_status,
            "occurredAt": _utc_now(),
        }

    def reconcile_transition_outbox(
        self,
        scene: Any,
        delivery: Mapping[str, object],
    ) -> dict[str, object]:
        """Return the exact ordered Undo/Redo outbox without invoking the driver."""

        if delivery.get("kind") != "native_history_rebind":
            raise ValueError("Shortcut transition reconciliation delivery is unsupported")
        _require_uuid(delivery.get("recoveryId"), "transition recoveryId")
        marker, live_current = self._recovery_marker(
            scene, "Shortcut transition reconciliation marker is unavailable"
        )
        results = marker.get("transitionResults")
        hashes = marker.get("transitionResultContentSha256s")
        if not isinstance(results, list) or not 1 <= len(results) <= 32:
            raise ValueError("Shortcut transition reconciliation outbox is unavailable")
        if not isinstance(hashes, list) or len(hashes) != len(results):
            raise ValueError("Shortcut transition reconciliation hashes are unavailable")
        marker_sha256 = _canonical_sha256(self._marker_identity(marker))
        if delivery.get("expectedMarkerContentSha256") != marker_sha256:
            raise ValueError("Shortcut transition reconciliation marker hash does not match")
        expected_result_sha256 = _require_sha256(
            delivery.get("expectedResultContentSha256"),
            "transition expected result content",
        )
        proven_result_hashes = {
            str(marker["terminalResultContentSha256"]),
            *(
                [str(marker["acknowledgedResultContentSha256"])]
                if marker.get("acknowledgedResultContentSha256") is not None
                else []
            ),
            *(str(value) for value in hashes),
        }
        if expected_result_sha256 not in proven_result_hashes:
            raise ValueError("Shortcut transition reconciliation expected result is unknown")
        pending_hashes = [str(value) for value in hashes]
        if expected_result_sha256 in pending_hashes:
            suffix_start = pending_hashes.index(expected_result_sha256) + 1
        else:
            suffix_start = 0
        recovery_id = str(delivery["recoveryId"])
        self._recovery_ack_prefixes[recovery_id] = tuple(pending_hashes)
        suffix = results[suffix_start:]
        if not suffix:
            return self.rebind_orphan(scene, delivery)
        live_sha256 = compute_shortcut_scene_fingerprint_sha256(
            self._fingerprint_reader()
        )
        expected_status = suffix[-1].get("status")
        expected_sha256 = (
            marker["baselineSceneFingerprintSha256"]
            if expected_status == "restored"
            else marker["finalSceneFingerprintSha256"]
        )
        if live_sha256 != expected_sha256:
            raise ValueError("Shortcut transition reconciliation live state is invalid")
        if not live_current:
            terminal_result = marker.get("terminalResult")
            if not isinstance(terminal_result, Mapping):
                raise ValueError(
                    "Shortcut transition reconciliation terminal result is unavailable"
                )
            entry = self._entry_from_terminal_marker(scene, marker, terminal_result)
            self._entries.append(entry)
            self._current = entry
            self._orphan_marker = None
            self._locked = expected_status != "restored"
            self._status = str(expected_status)
            self.error = ""
        return {
            "kind": "native_history_transition_reconcile",
            "recoveryId": recovery_id,
            "expectedResultContentSha256": expected_result_sha256,
            "results": deepcopy(suffix),
            "expectedMarkerContentSha256": marker_sha256,
            "currentSceneFingerprintSha256": live_sha256,
            "occurredAt": _utc_now(),
        }

    def current_transition_checkpoint(self) -> dict[str, object] | None:
        entry = self._current
        if entry is None:
            return None
        return (
            self._failure_checkpoint(entry, verify_live=False)
            if entry.checkpoint_kind == "failure"
            else self._success_checkpoint(entry, verify_live=False)
        )

    def reconcile_terminal_outbox(
        self,
        scene: Any,
        delivery: Mapping[str, object],
    ) -> dict[str, object]:
        """Return the exact durable terminal result without replaying Blender input."""

        if not self._registered:
            raise RuntimeError("Shortcut history is not registered")
        if (
            delivery.get("formatVersion") != _MARKER_FORMAT_VERSION
            or delivery.get("kind") != "native_terminal_reconcile"
            or not isinstance(delivery.get("recoveryRequestedAt"), str)
            or not delivery.get("recoveryRequestedAt")
        ):
            raise ValueError("Shortcut terminal reconciliation delivery is unsupported")
        _require_uuid(delivery.get("recoveryId"), "terminal recoveryId")
        marker, live_current = self._recovery_marker(
            scene, "Shortcut terminal reconciliation marker is unavailable"
        )
        terminal_result = marker.get("terminalResult")
        if not isinstance(terminal_result, dict):
            raise ValueError("Shortcut terminal reconciliation outbox is unavailable")
        if any(
            terminal_result.get(field) != delivery.get(field)
            for field in _RESULT_IDENTITY_FIELDS
        ):
            raise ValueError("Shortcut terminal reconciliation delivery identity does not match outbox")
        if (
            terminal_result.get("proofId") != marker["proofId"]
            or terminal_result.get("replayId") != marker["replayId"]
            or _canonical_sha256(terminal_result)
            != marker["terminalResultContentSha256"]
        ):
            raise ValueError("Shortcut terminal reconciliation outbox hash is invalid")
        terminal = terminal_result.get("terminalEvidence")
        attestation = terminal.get("attestation") if isinstance(terminal, Mapping) else None
        receipts = (
            attestation.get("operationReceipts")
            if isinstance(attestation, Mapping)
            else terminal.get("receiptPrefix") if isinstance(terminal, Mapping) else None
        )
        if not isinstance(receipts, Sequence) or isinstance(receipts, (str, bytes)):
            raise ValueError("Shortcut terminal reconciliation receipts are unavailable")
        acknowledged = delivery.get("acknowledgedProgressReceiptChainHeads")
        expected_heads = [str(receipt.get("contentSha256")) for receipt in receipts]
        if (
            not isinstance(acknowledged, Sequence)
            or isinstance(acknowledged, (str, bytes))
            or list(acknowledged) != expected_heads[: len(acknowledged)]
        ):
            raise ValueError("Shortcut terminal reconciliation progress prefix is invalid")
        live_sha256 = compute_shortcut_scene_fingerprint_sha256(self._fingerprint_reader())
        if live_sha256 != marker["finalSceneFingerprintSha256"]:
            raise ValueError("Shortcut terminal reconciliation live state is not locked")
        marker_sha256 = _canonical_sha256(self._marker_identity(marker))
        if not live_current:
            entry = self._entry_from_terminal_marker(scene, marker, terminal_result)
            self._entries.append(entry)
            self._current = entry
            self._orphan_marker = None
            self._locked = True
            self._status = "reconciled_locked"
            self.error = ""
            self._append_transition(
                direction="reconcile",
                status=self._status,
                scene_fingerprint_sha256=live_sha256,
            )
        return {
            "kind": "native_terminal_reconcile",
            "recoveryId": delivery.get("recoveryId"),
            "result": deepcopy(terminal_result),
            "expectedMarkerContentSha256": marker_sha256,
            "currentSceneFingerprintSha256": live_sha256,
            "occurredAt": _utc_now(),
        }

    def sync(self, direction: str) -> None:
        if not self._registered or self._handling:
            return
        if direction not in {"undo", "redo"}:
            raise ValueError("Shortcut history direction must be undo or redo")
        if self._current is None:
            if self._orphan_marker is not None:
                self._lock_indeterminate(
                    "Persisted history cannot be matched to an in-memory checkpoint",
                    direction,
                )
            return
        self._handling = True
        try:
            entry = self._current
            if self._owner_scene(entry) is None:
                self._lock_indeterminate("owner Scene is unavailable", direction)
                return
            fingerprint = compute_shortcut_scene_fingerprint_sha256(
                self._fingerprint_reader()
            )
            if direction == "undo" and fingerprint == entry.baseline_scene_fingerprint_sha256:
                transition = self._new_transition(
                    direction=direction,
                    status="restored",
                    scene_fingerprint_sha256=fingerprint,
                )
                entry, result = self._persist_transition_result(
                    entry, transition, self._restored_result_builder
                )
                self._current = entry
                if self._entries and self._entries[-1].checkpoint_id == entry.checkpoint_id:
                    self._entries[-1] = entry
                self._transitions.append(transition)
                self._locked = False
                self._status = "restored"
                self.error = ""
                if self._restored_callback is not None:
                    self._restored_callback(transition)
                if result is not None and self._transition_result_callback is not None:
                    self._transition_result_callback(deepcopy(result))
                return
            if direction == "redo" and fingerprint == entry.final_scene_fingerprint_sha256:
                owner = self._owner_scene(entry)
                if owner is None:
                    self._lock_indeterminate("owner Scene is unavailable", direction)
                    return
                # Blender may restore the scene state from before ``arm`` and
                # therefore drop the marker. Reattach it only after final-state
                # fingerprint verification; it remains association metadata,
                # never restoration evidence.
                transition = self._new_transition(
                    direction=direction,
                    status="reapplied_locked",
                    scene_fingerprint_sha256=fingerprint,
                )
                entry, result = self._persist_transition_result(
                    entry, transition, self._reapplied_result_builder
                )
                self._current = entry
                if self._entries and self._entries[-1].checkpoint_id == entry.checkpoint_id:
                    self._entries[-1] = entry
                self._transitions.append(transition)
                self._locked = True
                self._status = "reapplied_locked"
                self.error = (
                    "Shortcut proof failure checkpoint was reapplied; this is a "
                    "mutation lock, not success proof"
                    if entry.checkpoint_kind == "failure"
                    else ""
                )
                if self._reapplied_callback is not None:
                    self._reapplied_callback(transition)
                if result is not None and self._transition_result_callback is not None:
                    self._transition_result_callback(deepcopy(result))
                return
            self._lock_indeterminate(
                f"native {direction} produced neither its required proven boundary",
                direction,
            )
        except Exception as error:
            self._lock_indeterminate(str(error), direction)
        finally:
            self._handling = False

    def loaded_file(self) -> None:
        if not self._registered:
            return
        was_locked = self._locked
        self._current = None
        self._orphan_marker = None
        found_marker = False
        for scene in bpy.data.scenes:
            try:
                marker = self._read_marker(scene)
            except (RuntimeError, ValueError):
                self._lock_indeterminate("Loaded file contains an invalid marker")
                return
            if marker is not None:
                if found_marker:
                    self._lock_indeterminate("Loaded file contains ambiguous markers")
                    return
                found_marker = True
                self._orphan_marker = marker
        if was_locked or found_marker:
            self._lock_indeterminate(
                "File load invalidated the in-memory shortcut proof checkpoint"
            )
        else:
            self._locked = False
            self._status = "idle"
            self.error = ""

    def current_attestation(self) -> dict[str, object] | None:
        entry = self._current
        if entry is None:
            if self._locked:
                raise RuntimeError(
                    self.error
                    or "Shortcut proof history is locked without a current checkpoint"
                )
            return None
        if not self._locked:
            return None
        if self._status == "indeterminate_locked":
            raise RuntimeError(
                self.error or "Shortcut proof history checkpoint is indeterminate"
            )
        if entry.checkpoint_kind == "failure":
            return self._failure_checkpoint(entry)
        return self._success_checkpoint(entry)

    def _success_checkpoint(
        self,
        entry: ShortcutHistoryEntry,
        *,
        verify_live: bool = True,
    ) -> dict[str, object]:
        owner = self._owner_scene(entry)
        if owner is None:
            raise RuntimeError("Shortcut proof history owner Scene is unavailable")
        if verify_live:
            if self._read_marker(owner) != self._marker_payload(entry):
                raise RuntimeError("Shortcut proof history marker is out of sync")
            current_fingerprint = compute_shortcut_scene_fingerprint_sha256(
                self._fingerprint_reader()
            )
            if current_fingerprint != entry.final_scene_fingerprint_sha256:
                raise RuntimeError(
                    "Shortcut proof history checkpoint no longer matches the final state"
                )
        return {
            "formatVersion": _MARKER_FORMAT_VERSION,
            "evidenceClass": (
                "companion_reported_shortcut_proof_native_undo_checkpoint"
            ),
            "checkpointId": entry.checkpoint_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "previousCheckpointId": entry.previous_checkpoint_id,
            "operation": "shortcut_proof",
            "undoLockId": entry.undo_lock_id,
            "targetId": entry.target_id,
            "marker": {
                "key": SHORTCUT_HISTORY_MARKER_KEY,
                "matched": True,
            },
            "journal": {
                "entryPresent": True,
                "baselineSnapshotPresent": True,
                "finalSnapshotPresent": True,
                "undoRedoRoundTripVerified": True,
                "mutationLeaseHeld": True,
            },
            "baselineState": {
                "targetId": entry.target_id,
                "modifierCount": 0,
                "activeObjectMode": "OBJECT",
                "selectedObjectCount": 1,
            },
            "finalState": {
                "targetId": entry.target_id,
                "modifierType": "SUBSURF",
                "modifierCount": 1,
                "viewportLevel": entry.viewport_level,
            },
            "baselineSceneFingerprintSha256": (
                entry.baseline_scene_fingerprint_sha256
            ),
            "finalSceneFingerprintSha256": entry.final_scene_fingerprint_sha256,
            "receiptChainRootSha256": entry.receipt_chain_root_sha256,
            "receiptChainHeadSha256": entry.receipt_chain_head_sha256,
            "strongObservationContentSha256": (
                entry.strong_observation_content_sha256
            ),
            "committedAt": entry.armed_at,
        }

    def _failure_checkpoint(
        self,
        entry: ShortcutHistoryEntry,
        *,
        verify_live: bool = True,
    ) -> dict[str, object]:
        if entry.checkpoint_kind != "failure":
            raise RuntimeError("Shortcut history entry is not a failure checkpoint")
        owner = self._owner_scene(entry)
        if owner is None:
            raise RuntimeError("Shortcut failure history owner Scene is unavailable")
        if verify_live:
            if self._read_marker(owner) != self._marker_payload(entry):
                raise RuntimeError("Shortcut failure history marker is out of sync")
            current_fingerprint = compute_shortcut_scene_fingerprint_sha256(
                self._fingerprint_reader()
            )
            if current_fingerprint != entry.final_scene_fingerprint_sha256:
                raise RuntimeError(
                    "Shortcut failure history checkpoint no longer matches the current state"
                )
        return {
            "formatVersion": _MARKER_FORMAT_VERSION,
            "evidenceClass": "companion_reported_shortcut_proof_failure_checkpoint",
            "checkpointId": entry.checkpoint_id,
            "previousCheckpointId": entry.previous_checkpoint_id,
            "operation": "shortcut_proof_failure",
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "marker": {"key": SHORTCUT_HISTORY_MARKER_KEY, "matched": True},
            "journal": {
                "entryPresent": True,
                "baselineSnapshotPresent": True,
                "currentSnapshotPresent": True,
                "mutationLeaseHeld": True,
            },
            "baselineState": {
                "targetId": entry.target_id,
                "sceneFingerprintSha256": entry.baseline_scene_fingerprint_sha256,
                "modifierCount": 0,
            },
            "currentState": {
                "targetId": entry.target_id,
                "sceneFingerprintSha256": entry.final_scene_fingerprint_sha256,
                "modifierCount": entry.current_modifier_count,
            },
            "receiptPrefixRootSha256": entry.receipt_chain_root_sha256,
            "receiptPrefixHeadSha256": entry.receipt_chain_head_sha256,
            "lastCompletedOperationId": entry.last_completed_operation_id,
            "committedAt": entry.armed_at,
        }


_CONTROLLER = ShortcutHistoryController()


@persistent
def _shortcut_undo_post(_unused: Any) -> None:
    _CONTROLLER.sync("undo")


@persistent
def _shortcut_redo_post(_unused: Any) -> None:
    _CONTROLLER.sync("redo")


@persistent
def _shortcut_load_post(_unused: Any) -> None:
    _CONTROLLER.loaded_file()


def register_shortcut_history(
    restored_callback: TransitionCallback | None = None,
    reapplied_callback: TransitionCallback | None = None,
    restored_result_builder: TransitionResultBuilder | None = None,
    reapplied_result_builder: TransitionResultBuilder | None = None,
    transition_result_callback: TransitionResultCallback | None = None,
) -> None:
    _CONTROLLER.register(
        restored_callback,
        reapplied_callback,
        restored_result_builder,
        reapplied_result_builder,
        transition_result_callback,
    )


def unregister_shortcut_history() -> None:
    _CONTROLLER.unregister()


def arm_shortcut_history(
    scene: Any,
    evidence: Mapping[str, object],
    *,
    proof_id: str | None = None,
    replay_id: str | None = None,
    target_id: str | None = None,
    strong_observation_content_sha256: str | None = None,
    terminal_result_builder: TerminalResultBuilder,
) -> dict[str, object]:
    return _CONTROLLER.arm(
        scene,
        evidence,
        proof_id=proof_id,
        replay_id=replay_id,
        target_id=target_id,
        strong_observation_content_sha256=strong_observation_content_sha256,
        terminal_result_builder=terminal_result_builder,
    )


def arm_failed_shortcut_history(
    scene: Any,
    evidence: Mapping[str, object],
    *,
    proof_id: str,
    replay_id: str,
    target_id: str,
    terminal_result_builder: TerminalResultBuilder,
) -> dict[str, object]:
    return _CONTROLLER.arm_failed(
        scene,
        evidence,
        proof_id=proof_id,
        replay_id=replay_id,
        target_id=target_id,
        terminal_result_builder=terminal_result_builder,
    )


def lock_shortcut_history_indeterminate(message: str) -> None:
    _CONTROLLER.lock_indeterminate(message)


def rebind_shortcut_history(
    scene: Any,
    delivery: Mapping[str, object],
) -> dict[str, object]:
    return _CONTROLLER.rebind_orphan(scene, delivery)


def reconcile_shortcut_terminal_outbox(
    scene: Any,
    delivery: Mapping[str, object],
) -> dict[str, object]:
    return _CONTROLLER.reconcile_terminal_outbox(scene, delivery)


def reconcile_shortcut_transition_outbox(
    scene: Any,
    delivery: Mapping[str, object],
) -> dict[str, object]:
    return _CONTROLLER.reconcile_transition_outbox(scene, delivery)


def shortcut_history_has_transition_outbox() -> bool:
    return _CONTROLLER.has_transition_outbox()


def acknowledge_shortcut_transition_results(
    content_sha256s: Sequence[str],
) -> None:
    _CONTROLLER.acknowledge_transition_results(content_sha256s)


def acknowledge_shortcut_transition_recovery(recovery_id: str) -> None:
    _CONTROLLER.acknowledge_transition_recovery(recovery_id)


def shortcut_history_transition_checkpoint() -> dict[str, object] | None:
    return _CONTROLLER.current_transition_checkpoint()


def shortcut_history_current_attestation() -> dict[str, object] | None:
    return _CONTROLLER.current_attestation()


def shortcut_history_mutation_locked() -> bool:
    return _CONTROLLER.mutation_locked


def shortcut_history_error() -> str:
    return _CONTROLLER.error


__all__ = (
    "SHORTCUT_HISTORY_MARKER_KEY",
    "ShortcutHistoryController",
    "ShortcutHistoryEntry",
    "ShortcutHistoryTransition",
    "arm_failed_shortcut_history",
    "arm_shortcut_history",
    "acknowledge_shortcut_transition_results",
    "acknowledge_shortcut_transition_recovery",
    "lock_shortcut_history_indeterminate",
    "rebind_shortcut_history",
    "reconcile_shortcut_terminal_outbox",
    "reconcile_shortcut_transition_outbox",
    "register_shortcut_history",
    "shortcut_history_current_attestation",
    "shortcut_history_error",
    "shortcut_history_has_transition_outbox",
    "shortcut_history_mutation_locked",
    "shortcut_history_transition_checkpoint",
    "unregister_shortcut_history",
)
