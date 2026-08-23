"""Independent v2 native-history lock for the Edit Subdivide shortcut proof."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json
from typing import Any
import uuid

import bpy
from bpy.app.handlers import persistent

from .edit_subdivide_shortcut_proof import (
    EXECUTOR_ID,
    NATIVE_MUTATION_KIND,
    NATIVE_REDO_DEPTH,
    NATIVE_UNDO_DEPTH,
    OPERATION_IDS,
    build_edit_subdivide_scene_snapshot,
    compute_edit_subdivide_scene_fingerprint_sha256,
    verify_operation_receipt_chain,
)
from .shortcut_proof import _canonical_sha256

EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY = "_operating_line_shortcut_proof_history_v2"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True, slots=True)
class EditSubdivideHistoryTransition:
    transition_id: str
    checkpoint_id: str | None
    undo_lock_id: str | None
    direction: str
    status: str
    scene_fingerprint_sha256: str | None
    occurred_at: str
    error: str | None = None


@dataclass(frozen=True, slots=True)
class _Entry:
    checkpoint_id: str
    previous_checkpoint_id: str | None
    undo_lock_id: str
    proof_id: str
    replay_id: str
    target_id: str
    owner_scene_uid: int
    object_pointer: int
    mesh_pointer: int
    checkpoint_kind: str
    baseline_sha256: str
    final_sha256: str
    baseline_state: dict[str, object]
    final_state: dict[str, object]
    receipt_root: str | None
    receipt_head: str | None
    last_operation_id: str | None
    strong_observation_sha256: str | None
    committed_at: str
    terminal_result: dict[str, object] | None = None
    transition_results: tuple[dict[str, object], ...] = ()


class EditSubdivideShortcutHistoryController:
    """Hold a v2 lock until native Undo proves the four-step baseline."""

    def __init__(self) -> None:
        self._registered = False
        self._locked = False
        self._handling = False
        self._entries: list[_Entry] = []
        self._current: _Entry | None = None
        self._orphan_marker: dict[str, object] | None = None
        self._undo_progress = 0
        self._redo_progress = 0
        self._restored_builder: (
            Callable[[EditSubdivideHistoryTransition], Mapping[str, object]] | None
        ) = None
        self._reapplied_builder: (
            Callable[[EditSubdivideHistoryTransition], Mapping[str, object]] | None
        ) = None
        self._result_callback: Callable[[dict[str, object]], None] | None = None
        self.error = ""

    @property
    def registered(self) -> bool:
        return self._registered

    @property
    def mutation_locked(self) -> bool:
        return self._locked

    @staticmethod
    def _state(
        snapshot: Mapping[str, object],
        target_id: str,
        *,
        final: bool,
        cuts: int | None = None,
        smooth: float | None = None,
    ) -> dict[str, object]:
        target = snapshot["target"]
        assert isinstance(target, Mapping)
        state: dict[str, object] = {
            "targetId": target_id,
            "objectName": target["objectName"],
            "objectPointer": target["objectPointer"],
            "meshPointer": target["meshPointer"],
            "meshUsers": target["meshUsers"],
            "meshDatablockCount": target["meshDatablockCount"],
            "modifierCount": snapshot["modifierCount"],
            "shapeKeyCount": snapshot["shapeKeyCount"],
            "activeObjectMode": snapshot["activeObjectMode"],
            "selectedObjectCount": snapshot["selectedObjectCount"],
            "topologySha256": snapshot["topologySha256"],
            "geometrySha256": snapshot["geometrySha256"],
        }
        if final:
            state.update({"cuts": cuts, "smooth": smooth})
        return state

    @staticmethod
    def _failure_state(
        snapshot: Mapping[str, object], target_id: str, fingerprint: str
    ) -> dict[str, object]:
        target = snapshot["target"]
        assert isinstance(target, Mapping)
        return {
            "targetId": target_id,
            "sceneFingerprintSha256": fingerprint,
            "objectName": target["objectName"],
            "objectPointer": target["objectPointer"],
            "meshPointer": target["meshPointer"],
            "meshUsers": target["meshUsers"],
            "meshDatablockCount": target["meshDatablockCount"],
            "modifierCount": snapshot["modifierCount"],
            "shapeKeyCount": snapshot["shapeKeyCount"],
            "topologySha256": snapshot["topologySha256"],
            "geometrySha256": snapshot["geometrySha256"],
        }

    @staticmethod
    def _marker_identity_payload(entry: _Entry) -> dict[str, object]:
        if entry.terminal_result is None:
            raise RuntimeError("Edit Subdivide history terminal outbox is unavailable")
        return {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "markerKey": EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY,
            "nativeMutationKind": NATIVE_MUTATION_KIND,
            "nativeUndoDepth": NATIVE_UNDO_DEPTH,
            "nativeRedoDepth": NATIVE_REDO_DEPTH,
            "checkpointId": entry.checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "targetObjectName": "Cube",
            "checkpointKind": entry.checkpoint_kind,
            "baselineSceneFingerprintSha256": entry.baseline_sha256,
            "finalSceneFingerprintSha256": entry.final_sha256,
            "terminalResultContentSha256": _canonical_sha256(entry.terminal_result),
        }

    @classmethod
    def _marker_payload(cls, entry: _Entry) -> dict[str, object]:
        if entry.terminal_result is None:
            raise RuntimeError("Edit Subdivide history terminal outbox is unavailable")
        return {
            **cls._marker_identity_payload(entry),
            "objectPointer": entry.object_pointer,
            "meshPointer": entry.mesh_pointer,
            "terminalResult": deepcopy(entry.terminal_result),
            "transitionResultContentSha256s": [
                _canonical_sha256(result) for result in entry.transition_results
            ],
            "transitionResults": deepcopy(list(entry.transition_results)),
        }

    @staticmethod
    def _marker_identity(marker: Mapping[str, object]) -> dict[str, object]:
        keys = (
            "formatVersion",
            "executorId",
            "markerKey",
            "nativeMutationKind",
            "nativeUndoDepth",
            "nativeRedoDepth",
            "checkpointId",
            "undoLockId",
            "proofId",
            "replayId",
            "targetId",
            "targetObjectName",
            "checkpointKind",
            "baselineSceneFingerprintSha256",
            "finalSceneFingerprintSha256",
            "terminalResultContentSha256",
        )
        return {key: marker[key] for key in keys}

    @classmethod
    def _read_marker(cls, scene: Any) -> dict[str, object] | None:
        raw = scene.get(EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY)
        if raw is None:
            return None
        if not isinstance(raw, str):
            raise RuntimeError("Edit Subdivide history v2 marker is invalid")
        marker = json.loads(raw)
        if (
            not isinstance(marker, dict)
            or marker.get("executorId") != EXECUTOR_ID
            or marker.get("markerKey") != EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY
            or marker.get("nativeMutationKind") != NATIVE_MUTATION_KIND
            or marker.get("nativeUndoDepth") != 4
            or marker.get("nativeRedoDepth") != 4
        ):
            raise RuntimeError("Edit Subdivide history v2 marker is unsupported")
        terminal = marker.get("terminalResult")
        if not isinstance(terminal, dict) or _canonical_sha256(terminal) != marker.get(
            "terminalResultContentSha256"
        ):
            raise RuntimeError("Edit Subdivide history terminal outbox is invalid")
        transition_results = marker.get("transitionResults", [])
        transition_hashes = marker.get("transitionResultContentSha256s", [])
        if (
            not isinstance(transition_results, list)
            or not isinstance(transition_hashes, list)
            or len(transition_results) != len(transition_hashes)
            or len(transition_results) > 32
            or any(
                not isinstance(result, dict)
                or _canonical_sha256(result) != content_sha256
                for result, content_sha256 in zip(transition_results, transition_hashes)
            )
        ):
            raise RuntimeError("Edit Subdivide history transition outbox is invalid")
        marker.setdefault("transitionResults", [])
        marker.setdefault("transitionResultContentSha256s", [])
        return marker

    def _write_marker(self, scene: Any, entry: _Entry) -> None:
        marker = self._marker_payload(entry)
        scene[EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY] = json.dumps(
            marker,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        if self._read_marker(scene) != marker:
            raise RuntimeError("Edit Subdivide history marker did not round-trip")

    def register(
        self,
        *,
        restored_result_builder: (
            Callable[[EditSubdivideHistoryTransition], Mapping[str, object]] | None
        ) = None,
        reapplied_result_builder: (
            Callable[[EditSubdivideHistoryTransition], Mapping[str, object]] | None
        ) = None,
        transition_result_callback: Callable[[dict[str, object]], None] | None = None,
    ) -> None:
        self._restored_builder = restored_result_builder
        self._reapplied_builder = reapplied_result_builder
        self._result_callback = transition_result_callback
        if self._registered:
            return
        for handlers, callback in (
            (bpy.app.handlers.undo_post, _edit_subdivide_undo_post),
            (bpy.app.handlers.redo_post, _edit_subdivide_redo_post),
            (bpy.app.handlers.load_post, _edit_subdivide_load_post),
        ):
            if callback not in handlers:
                handlers.append(callback)
        self._registered = True
        # Deliberately inspect only the v2 key; v1 and v2 loaders cannot consume
        # each other's persisted authority.
        markers = [
            self._read_marker(scene)
            for scene in bpy.data.scenes
            if scene.get(EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY) is not None
        ]
        if len(markers) > 1:
            self._locked = True
            self.error = "Persisted Edit Subdivide v2 history markers are ambiguous"
        elif markers:
            self._orphan_marker = markers[0]
            self._locked = True
            self.error = "A persisted Edit Subdivide v2 mutation requires recovery"

    def unregister(self) -> None:
        for handlers, callback in (
            (bpy.app.handlers.undo_post, _edit_subdivide_undo_post),
            (bpy.app.handlers.redo_post, _edit_subdivide_redo_post),
            (bpy.app.handlers.load_post, _edit_subdivide_load_post),
        ):
            if callback in handlers:
                handlers.remove(callback)
        self._registered = False

    def _owner(self, entry: _Entry) -> Any | None:
        return next(
            (
                scene
                for scene in bpy.data.scenes
                if int(scene.session_uid) == entry.owner_scene_uid
            ),
            None,
        )

    def _checkpoint(self, entry: _Entry) -> dict[str, object]:
        common = {
            "formatVersion": "1.0.0",
            "checkpointId": entry.checkpoint_id,
            "previousCheckpointId": entry.previous_checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "executorId": EXECUTOR_ID,
            "nativeMutationKind": NATIVE_MUTATION_KIND,
            "nativeUndoDepth": 4,
            "nativeRedoDepth": 4,
            "marker": {
                "key": EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY,
                "matched": True,
            },
            "committedAt": entry.committed_at,
        }
        if entry.checkpoint_kind == "failure":
            return {
                **common,
                "evidenceClass": "companion_reported_shortcut_proof_failure_checkpoint",
                "operation": "shortcut_proof_failure",
                "journal": {
                    "entryPresent": True,
                    "baselineSnapshotPresent": True,
                    "currentSnapshotPresent": True,
                    "mutationLeaseHeld": True,
                },
                "baselineState": entry.baseline_state,
                "currentState": entry.final_state,
                "receiptPrefixRootSha256": entry.receipt_root,
                "receiptPrefixHeadSha256": entry.receipt_head,
                "lastCompletedOperationId": entry.last_operation_id,
            }
        return {
            **common,
            "evidenceClass": "companion_reported_shortcut_proof_native_undo_checkpoint",
            "operation": "shortcut_proof",
            "journal": {
                "entryPresent": True,
                "baselineSnapshotPresent": True,
                "finalSnapshotPresent": True,
                "undoRedoRoundTripVerified": True,
                "mutationLeaseHeld": True,
            },
            "baselineState": entry.baseline_state,
            "finalState": entry.final_state,
            "baselineSceneFingerprintSha256": entry.baseline_sha256,
            "finalSceneFingerprintSha256": entry.final_sha256,
            "receiptChainRootSha256": entry.receipt_root,
            "receiptChainHeadSha256": entry.receipt_head,
            "strongObservationContentSha256": entry.strong_observation_sha256,
        }

    def _arm_entry(
        self,
        scene: Any,
        entry: _Entry,
        terminal_result_builder: Callable[[dict[str, object]], Mapping[str, object]],
    ) -> dict[str, object]:
        checkpoint = self._checkpoint(entry)
        terminal = dict(terminal_result_builder(deepcopy(checkpoint)))
        entry = replace(entry, terminal_result=deepcopy(terminal))
        self._write_marker(scene, entry)
        self._entries.append(entry)
        self._current = entry
        self._locked = True
        self._undo_progress = 0
        self._redo_progress = 0
        self.error = ""
        return checkpoint

    def arm(
        self,
        scene: Any,
        evidence: Mapping[str, object],
        *,
        proof_id: str,
        replay_id: str,
        target_id: str,
        strong_observation_content_sha256: str,
        terminal_result_builder: Callable[[dict[str, object]], Mapping[str, object]],
    ) -> dict[str, object]:
        if not self._registered or self._locked:
            raise RuntimeError(
                "Edit Subdivide history is unavailable or already locked"
            )
        receipts = evidence.get("operationReceipts")
        baseline = evidence.get("baselineSceneSnapshot")
        final = evidence.get("finalSceneSnapshot")
        observation = evidence.get("observation")
        if (
            not isinstance(receipts, list)
            or len(receipts) != 9
            or not verify_operation_receipt_chain(receipts)
            or not isinstance(baseline, Mapping)
            or not isinstance(final, Mapping)
            or not isinstance(observation, Mapping)
        ):
            raise ValueError("Edit Subdivide success evidence is incomplete")
        baseline_sha = compute_edit_subdivide_scene_fingerprint_sha256(baseline)
        final_sha = compute_edit_subdivide_scene_fingerprint_sha256(final)
        if baseline_sha != evidence.get(
            "baselineSceneFingerprintSha256"
        ) or final_sha != evidence.get("finalSceneFingerprintSha256"):
            raise ValueError("Edit Subdivide success fingerprints are invalid")
        if (
            compute_edit_subdivide_scene_fingerprint_sha256(
                build_edit_subdivide_scene_snapshot()
            )
            != final_sha
        ):
            raise ValueError("Edit Subdivide checkpoint does not match live state")
        previous = None if not self._entries else self._entries[-1].checkpoint_id
        baseline_target = baseline["target"]
        final_target = final["target"]
        assert isinstance(baseline_target, Mapping) and isinstance(
            final_target, Mapping
        )
        if (
            baseline_target["objectPointer"] != final_target["objectPointer"]
            or baseline_target["meshPointer"] != final_target["meshPointer"]
            or baseline_target["meshDatablockCount"] != 1
            or final_target["meshDatablockCount"] != 1
        ):
            raise ValueError(
                "Edit Subdivide success must preserve exact object, mesh, and datablock identity"
            )
        entry = _Entry(
            str(uuid.uuid4()),
            previous,
            str(uuid.uuid4()),
            str(uuid.UUID(proof_id)),
            str(uuid.UUID(replay_id)),
            target_id,
            int(scene.session_uid),
            int(baseline_target["objectPointer"]),
            int(baseline_target["meshPointer"]),
            "success",
            baseline_sha,
            final_sha,
            self._state(baseline, target_id, final=False),
            self._state(
                final,
                target_id,
                final=True,
                cuts=int(observation["cuts"]),
                smooth=float(observation["smooth"]),
            ),
            str(receipts[0]["contentSha256"]),
            str(receipts[-1]["contentSha256"]),
            OPERATION_IDS[-1],
            strong_observation_content_sha256,
            _now(),
        )
        return self._arm_entry(scene, entry, terminal_result_builder)

    def arm_failed(
        self,
        scene: Any,
        evidence: Mapping[str, object],
        *,
        proof_id: str,
        replay_id: str,
        target_id: str,
        terminal_result_builder: Callable[[dict[str, object]], Mapping[str, object]],
    ) -> dict[str, object]:
        if not self._registered or self._locked:
            raise RuntimeError(
                "Edit Subdivide history is unavailable or already locked"
            )
        receipts = evidence.get("operationReceipts")
        baseline = evidence.get("baselineSceneSnapshot")
        current = evidence.get("currentSceneSnapshot")
        if (
            not isinstance(receipts, list)
            or not verify_operation_receipt_chain(receipts)
            or not isinstance(baseline, Mapping)
            or not isinstance(current, Mapping)
        ):
            raise ValueError("Edit Subdivide failure evidence is incomplete")
        baseline_sha = compute_edit_subdivide_scene_fingerprint_sha256(baseline)
        current_sha = compute_edit_subdivide_scene_fingerprint_sha256(current)
        if baseline_sha == current_sha or current_sha != evidence.get(
            "currentSceneFingerprintSha256"
        ):
            raise ValueError("Edit Subdivide failure boundary is invalid")
        previous = None if not self._entries else self._entries[-1].checkpoint_id
        baseline_target = baseline["target"]
        current_target = current["target"]
        assert isinstance(baseline_target, Mapping) and isinstance(
            current_target, Mapping
        )
        if (
            baseline_target["objectPointer"] != current_target["objectPointer"]
            or baseline_target["meshPointer"] != current_target["meshPointer"]
            or baseline_target["meshDatablockCount"] != 1
            or current_target["meshDatablockCount"] != 1
        ):
            raise ValueError(
                "Edit Subdivide failure must preserve exact object, mesh, and datablock identity"
            )
        entry = _Entry(
            str(uuid.uuid4()),
            previous,
            str(uuid.uuid4()),
            str(uuid.UUID(proof_id)),
            str(uuid.UUID(replay_id)),
            target_id,
            int(scene.session_uid),
            int(baseline_target["objectPointer"]),
            int(baseline_target["meshPointer"]),
            "failure",
            baseline_sha,
            current_sha,
            self._failure_state(baseline, target_id, baseline_sha),
            self._failure_state(current, target_id, current_sha),
            None if not receipts else str(receipts[0]["contentSha256"]),
            None if not receipts else str(receipts[-1]["contentSha256"]),
            None if not receipts else str(receipts[-1]["operationId"]),
            None,
            _now(),
        )
        return self._arm_entry(scene, entry, terminal_result_builder)

    def sync(self, direction: str) -> None:
        if not self._registered or self._handling or self._current is None:
            return
        self._handling = True
        try:
            entry = self._current
            fingerprint = compute_edit_subdivide_scene_fingerprint_sha256(
                build_edit_subdivide_scene_snapshot()
            )
            expected = (
                entry.baseline_sha256 if direction == "undo" else entry.final_sha256
            )
            if fingerprint != expected:
                if direction == "undo":
                    self._undo_progress += 1
                    remaining = NATIVE_UNDO_DEPTH - self._undo_progress
                else:
                    self._redo_progress += 1
                    remaining = NATIVE_REDO_DEPTH - self._redo_progress
                self._locked = True
                if remaining > 0:
                    self.error = ""
                    return
                self.error = f"Edit Subdivide native {direction} exhausted its 4-step boundary without proof"
                return
            status = "restored" if direction == "undo" else "reapplied_locked"
            transition = EditSubdivideHistoryTransition(
                str(uuid.uuid4()),
                entry.checkpoint_id,
                entry.undo_lock_id,
                direction,
                status,
                fingerprint,
                _now(),
            )
            self._locked = direction == "redo"
            if direction == "undo":
                self._undo_progress = NATIVE_UNDO_DEPTH
                self._redo_progress = 0
            else:
                self._redo_progress = NATIVE_REDO_DEPTH
                self._undo_progress = 0
            builder = (
                self._restored_builder
                if direction == "undo"
                else self._reapplied_builder
            )
            result = None if builder is None else dict(builder(transition))
            if result is not None:
                entry = replace(
                    entry,
                    transition_results=entry.transition_results + (deepcopy(result),),
                )
                self._current = entry
                if (
                    self._entries
                    and self._entries[-1].checkpoint_id == entry.checkpoint_id
                ):
                    self._entries[-1] = entry
            owner = self._owner(entry)
            if owner is None:
                raise RuntimeError(
                    "Edit Subdivide transition owner Scene is unavailable"
                )
            self._write_marker(owner, entry)
            if result is not None and self._result_callback is not None:
                self._result_callback(deepcopy(result))
            self.error = ""
        except Exception as error:
            self._locked = True
            self.error = str(error)
        finally:
            self._handling = False

    def loaded_file(self) -> None:
        if self._registered and any(
            scene.get(EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY) is not None
            for scene in bpy.data.scenes
        ):
            self._current = None
            markers = [
                self._read_marker(scene)
                for scene in bpy.data.scenes
                if scene.get(EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY) is not None
            ]
            self._orphan_marker = markers[0] if len(markers) == 1 else None
            self._locked = True
            self.error = "Loaded file invalidated Edit Subdivide in-memory history"

    def current_checkpoint(self) -> dict[str, object] | None:
        return None if self._current is None else self._checkpoint(self._current)

    def lock_indeterminate(self, message: str) -> None:
        self._locked = True
        self.error = message

    @staticmethod
    def _entry_from_marker(scene: Any, marker: Mapping[str, object]) -> _Entry:
        terminal = marker["terminalResult"]
        assert isinstance(terminal, Mapping)
        evidence = terminal.get("terminalEvidence")
        if not isinstance(evidence, Mapping):
            raise RuntimeError("Edit Subdivide persisted terminal evidence is invalid")
        if evidence.get("kind") == "succeeded_locked":
            attestation = evidence.get("attestation")
            if not isinstance(attestation, Mapping):
                raise RuntimeError("Edit Subdivide persisted attestation is invalid")
            checkpoint = attestation.get("nativeUndoCheckpoint")
            strong_sha = (
                checkpoint.get("strongObservationContentSha256")
                if isinstance(checkpoint, Mapping)
                else None
            )
        elif evidence.get("kind") == "failed_checkpointed":
            checkpoint = evidence.get("checkpoint")
            strong_sha = None
        else:
            raise RuntimeError(
                "Edit Subdivide marker does not contain a locked terminal result"
            )
        if not isinstance(checkpoint, Mapping):
            raise RuntimeError("Edit Subdivide persisted checkpoint is invalid")
        final_key = (
            "currentState" if marker["checkpointKind"] == "failure" else "finalState"
        )
        return _Entry(
            str(marker["checkpointId"]),
            checkpoint.get("previousCheckpointId"),
            str(marker["undoLockId"]),
            str(marker["proofId"]),
            str(marker["replayId"]),
            str(marker["targetId"]),
            int(scene.session_uid),
            int(marker["objectPointer"]),
            int(marker["meshPointer"]),
            str(marker["checkpointKind"]),
            str(marker["baselineSceneFingerprintSha256"]),
            str(marker["finalSceneFingerprintSha256"]),
            deepcopy(dict(checkpoint["baselineState"])),
            deepcopy(dict(checkpoint[final_key])),
            checkpoint.get(
                "receiptPrefixRootSha256", checkpoint.get("receiptChainRootSha256")
            ),
            checkpoint.get(
                "receiptPrefixHeadSha256", checkpoint.get("receiptChainHeadSha256")
            ),
            checkpoint.get("lastCompletedOperationId", OPERATION_IDS[-1]),
            None if strong_sha is None else str(strong_sha),
            str(checkpoint["committedAt"]),
            deepcopy(dict(terminal)),
            tuple(deepcopy(marker.get("transitionResults", []))),
        )

    def rebind_orphan(
        self, scene: Any, delivery: Mapping[str, object]
    ) -> dict[str, object]:
        marker = self._read_marker(scene)
        if (
            marker is None
            or self._orphan_marker is None
            or marker != self._orphan_marker
        ):
            raise RuntimeError("Edit Subdivide persisted v2 marker is unavailable")
        history = delivery.get("history")
        if not isinstance(history, Mapping):
            raise ValueError("Edit Subdivide recovery history identity is invalid")
        identity = self._marker_identity(marker)
        if (
            delivery.get("executorId") != EXECUTOR_ID
            or delivery.get("expectedMarkerContentSha256")
            != _canonical_sha256(identity)
            or delivery.get("expectedResultContentSha256")
            != marker["terminalResultContentSha256"]
            or history.get("checkpointId") != marker["checkpointId"]
            or history.get("undoLockId") != marker["undoLockId"]
            or history.get("checkpointKind") != marker["checkpointKind"]
            or history.get("baselineSceneFingerprintSha256")
            != marker["baselineSceneFingerprintSha256"]
            or history.get("lockedSceneFingerprintSha256")
            != marker["finalSceneFingerprintSha256"]
            or history.get("terminalResultContentSha256")
            != marker["terminalResultContentSha256"]
        ):
            raise ValueError(
                "Edit Subdivide recovery authority does not match the v2 marker"
            )
        current_snapshot = build_edit_subdivide_scene_snapshot()
        current_target = current_snapshot.get("target")
        if (
            not isinstance(current_target, Mapping)
            or current_target.get("objectPointer") != marker["objectPointer"]
            or current_target.get("meshPointer") != marker["meshPointer"]
            or current_target.get("meshDatablockCount") != 1
        ):
            raise RuntimeError(
                "Edit Subdivide recovery target identity no longer matches its v2 marker"
            )
        fingerprint = compute_edit_subdivide_scene_fingerprint_sha256(current_snapshot)
        status = delivery.get("expectedStatus")
        expected_fingerprint = (
            marker["baselineSceneFingerprintSha256"]
            if status == "restored"
            else marker["finalSceneFingerprintSha256"]
        )
        if fingerprint != expected_fingerprint:
            raise RuntimeError(
                "Edit Subdivide recovery does not match the expected native boundary"
            )
        entry = self._entry_from_marker(scene, marker)
        self._current = entry
        self._entries.append(entry)
        self._orphan_marker = None
        self._locked = status != "restored"
        self.error = ""
        return {
            "kind": "native_history_rebind",
            "formatVersion": "1.0.0",
            "requestId": delivery["requestId"],
            "replayId": delivery["replayId"],
            "proofId": delivery["proofId"],
            "deliveryId": delivery["deliveryId"],
            "target": deepcopy(delivery["target"]),
            "bindingContentSha256": delivery["bindingContentSha256"],
            "recoveryId": delivery["recoveryId"],
            "history": deepcopy(dict(history)),
            "status": status,
            "expectedMarkerContentSha256": delivery["expectedMarkerContentSha256"],
            "currentSceneFingerprintSha256": fingerprint,
            "mutationLocked": self._locked,
            "occurredAt": _now(),
        }

    def reconcile_terminal_outbox(
        self, scene: Any, delivery: Mapping[str, object]
    ) -> dict[str, object]:
        marker = self._read_marker(scene)
        if marker is None:
            raise RuntimeError("Edit Subdivide terminal v2 marker is unavailable")
        identity_sha = _canonical_sha256(self._marker_identity(marker))
        current_snapshot = build_edit_subdivide_scene_snapshot()
        current_target = current_snapshot.get("target")
        if (
            not isinstance(current_target, Mapping)
            or current_target.get("objectPointer") != marker["objectPointer"]
            or current_target.get("meshPointer") != marker["meshPointer"]
            or current_target.get("meshDatablockCount") != 1
        ):
            raise RuntimeError(
                "Edit Subdivide terminal target identity no longer matches its v2 marker"
            )
        fingerprint = compute_edit_subdivide_scene_fingerprint_sha256(current_snapshot)
        if fingerprint != marker["finalSceneFingerprintSha256"]:
            raise RuntimeError(
                "Edit Subdivide terminal reconciliation is not at the locked boundary"
            )
        return {
            "kind": "native_terminal_reconcile",
            "recoveryId": delivery["recoveryId"],
            "result": deepcopy(marker["terminalResult"]),
            "expectedMarkerContentSha256": identity_sha,
            "currentSceneFingerprintSha256": fingerprint,
            "occurredAt": _now(),
        }

    def acknowledge_transition_results(self, content_sha256s: list[str]) -> None:
        entry = self._current
        if entry is None or not content_sha256s:
            return
        acknowledged = set(content_sha256s)
        remaining = tuple(
            result
            for result in entry.transition_results
            if _canonical_sha256(result) not in acknowledged
        )
        if len(remaining) == len(entry.transition_results):
            return
        entry = replace(entry, transition_results=remaining)
        owner = self._owner(entry)
        if owner is None:
            self.lock_indeterminate(
                "Edit Subdivide transition acknowledgement lost its owner Scene"
            )
            return
        self._write_marker(owner, entry)
        self._current = entry
        if self._entries and self._entries[-1].checkpoint_id == entry.checkpoint_id:
            self._entries[-1] = entry


_CONTROLLER = EditSubdivideShortcutHistoryController()


@persistent
def _edit_subdivide_undo_post(_unused: Any) -> None:
    _CONTROLLER.sync("undo")


@persistent
def _edit_subdivide_redo_post(_unused: Any) -> None:
    _CONTROLLER.sync("redo")


@persistent
def _edit_subdivide_load_post(_unused: Any) -> None:
    _CONTROLLER.loaded_file()


def register_edit_subdivide_shortcut_history(**kwargs: Any) -> None:
    _CONTROLLER.register(**kwargs)


def unregister_edit_subdivide_shortcut_history() -> None:
    _CONTROLLER.unregister()


def arm_edit_subdivide_shortcut_history(
    scene: Any, evidence: Mapping[str, object], **kwargs: Any
) -> dict[str, object]:
    return _CONTROLLER.arm(scene, evidence, **kwargs)


def arm_failed_edit_subdivide_shortcut_history(
    scene: Any, evidence: Mapping[str, object], **kwargs: Any
) -> dict[str, object]:
    return _CONTROLLER.arm_failed(scene, evidence, **kwargs)


def edit_subdivide_shortcut_history_mutation_locked() -> bool:
    return _CONTROLLER.mutation_locked


def edit_subdivide_shortcut_history_current_checkpoint() -> dict[str, object] | None:
    return _CONTROLLER.current_checkpoint()


def lock_edit_subdivide_shortcut_history_indeterminate(message: str) -> None:
    _CONTROLLER.lock_indeterminate(message)


def rebind_edit_subdivide_shortcut_history(
    scene: Any, delivery: Mapping[str, object]
) -> dict[str, object]:
    return _CONTROLLER.rebind_orphan(scene, delivery)


def reconcile_edit_subdivide_shortcut_terminal_outbox(
    scene: Any, delivery: Mapping[str, object]
) -> dict[str, object]:
    return _CONTROLLER.reconcile_terminal_outbox(scene, delivery)


def acknowledge_edit_subdivide_shortcut_transition_results(
    content_sha256s: list[str],
) -> None:
    _CONTROLLER.acknowledge_transition_results(content_sha256s)


__all__ = (
    "EDIT_SUBDIVIDE_SHORTCUT_HISTORY_MARKER_KEY",
    "EditSubdivideHistoryTransition",
    "EditSubdivideShortcutHistoryController",
    "register_edit_subdivide_shortcut_history",
    "unregister_edit_subdivide_shortcut_history",
    "arm_edit_subdivide_shortcut_history",
    "arm_failed_edit_subdivide_shortcut_history",
    "edit_subdivide_shortcut_history_mutation_locked",
    "edit_subdivide_shortcut_history_current_checkpoint",
    "lock_edit_subdivide_shortcut_history_indeterminate",
    "rebind_edit_subdivide_shortcut_history",
    "reconcile_edit_subdivide_shortcut_terminal_outbox",
    "acknowledge_edit_subdivide_shortcut_transition_results",
)
