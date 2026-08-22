"""Fail-closed nine-stage native history for the UV Sphere menu proof.

The Scene marker is durable evidence only.  Loading or copying a ``.blend``
never revives an adapter instance or lease; explicit rebind is required before
an orphan marker may track native Undo/Redo again.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import math
import struct
from typing import Any, Callable
import uuid

import bpy
from bpy.app.handlers import persistent

from .menu_control_proof import (
    EXECUTOR_ID,
    EXPECTED_ARGUMENTS,
    EXPECTED_TOPOLOGY,
    HISTORY_DEPTH,
    OPERATION_IDS,
    compute_scene_fingerprint_sha256,
    expected_arguments_payload,
)


MENU_CONTROL_HISTORY_MARKER_KEY = "_operating_line_menu_control_history_v1"
_MARKER_FORMAT_VERSION = "1.0.0"
STAGE_LABELS = (
    "baseline",
    "sphere_created",
    "location_x",
    "location_y",
    "location_z",
    "scale_x",
    "scale_y",
    "scale_z",
    "renamed_final",
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
        entries = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("Canonical protocol object keys must be strings")
            entries.append((key.encode("utf-8", errors="strict"), item))
        entries.sort(key=lambda entry: entry[0])
        parts = [b"o" + str(len(entries)).encode("ascii") + b":"]
        for key_bytes, item in entries:
            encoded_key = b"s" + str(len(key_bytes)).encode("ascii") + b":" + key_bytes
            parts.append(_length_delimited(encoded_key))
            parts.append(_length_delimited(_canonical_protocol_bytes(item, ancestors)))
        return b"".join(parts)
    finally:
        ancestors.remove(identity)


def _canonical_sha256(value: Mapping[str, object]) -> str:
    return hashlib.sha256(_canonical_protocol_bytes(dict(value), set())).hexdigest()


def _require_uuid(value: object, label: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError(f"Menu-control history {label} must be a UUID") from error


def _require_sha256(value: object, label: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise ValueError(f"Menu-control history {label} must be a lowercase SHA-256")
    return value


class HmacRebindAuthorityGate:
    """Process-local, expiring, one-time authority for persisted marker rebinds."""

    def __init__(
        self,
        secret: bytes,
        *,
        session_id: str,
        document_incarnation_id: str,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        if not isinstance(secret, bytes) or len(secret) < 32:
            raise ValueError("Menu-control rebind authority secret must be at least 32 bytes")
        self._secret = bytes(secret)
        self.session_id = _require_uuid(session_id, "authority sessionId")
        self.document_incarnation_id = _require_uuid(
            document_incarnation_id, "authority documentIncarnationId"
        )
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._consumed_authority_ids: set[str] = set()

    def _mac(self, body: Mapping[str, object]) -> str:
        return hmac.new(
            self._secret,
            _canonical_protocol_bytes(dict(body), set()),
            hashlib.sha256,
        ).hexdigest()

    def issue(
        self,
        marker: Mapping[str, object],
        *,
        scene_session_uid: int,
        instance_id: str,
        lease_id: str,
        ttl_seconds: int = 60,
    ) -> dict[str, object]:
        if not isinstance(ttl_seconds, int) or isinstance(ttl_seconds, bool) or not 1 <= ttl_seconds <= 300:
            raise ValueError("Menu-control rebind authority TTL must be 1..300 seconds")
        issued = self._now().astimezone(timezone.utc)
        body = {
            "formatVersion": "1.0.0",
            "kind": "menu_control_history_rebind_authority",
            "authorityId": str(uuid.uuid4()),
            "expectedMarkerContentSha256": marker.get("markerContentSha256"),
            "checkpointId": marker.get("checkpointId"),
            "undoLockId": marker.get("undoLockId"),
            "proofId": marker.get("proofId"),
            "replayId": marker.get("replayId"),
            "targetId": marker.get("targetId"),
            "sessionId": self.session_id,
            "instanceId": _require_uuid(instance_id, "authority instanceId"),
            "leaseId": _require_uuid(lease_id, "authority leaseId"),
            "documentIncarnationId": self.document_incarnation_id,
            "documentSessionUid": int(scene_session_uid),
            "issuedAt": issued.isoformat().replace("+00:00", "Z"),
            "expiresAt": (issued + timedelta(seconds=ttl_seconds)).isoformat().replace(
                "+00:00", "Z"
            ),
        }
        return {**body, "authorityMacSha256": self._mac(body)}

    def verify(self, authority: Mapping[str, object]) -> str:
        expected_keys = {
            "formatVersion", "kind", "authorityId", "expectedMarkerContentSha256",
            "checkpointId", "undoLockId", "proofId", "replayId", "targetId",
            "sessionId", "instanceId", "leaseId", "documentIncarnationId",
            "documentSessionUid", "issuedAt", "expiresAt", "authorityMacSha256",
        }
        if not isinstance(authority, Mapping) or set(authority) != expected_keys:
            raise ValueError("Menu-control rebind authority shape is invalid")
        body = dict(authority)
        claimed_mac = _require_sha256(body.pop("authorityMacSha256", None), "authority MAC")
        if not hmac.compare_digest(claimed_mac, self._mac(body)):
            raise ValueError("Menu-control rebind authority MAC is invalid")
        authority_id = _require_uuid(authority.get("authorityId"), "authorityId")
        for field in ("instanceId", "leaseId"):
            _require_uuid(authority.get(field), f"authority {field}")
        if (
            authority.get("formatVersion") != "1.0.0"
            or authority.get("kind") != "menu_control_history_rebind_authority"
            or authority.get("sessionId") != self.session_id
            or authority.get("documentIncarnationId") != self.document_incarnation_id
        ):
            raise ValueError("Menu-control rebind authority session is invalid")
        try:
            issued = datetime.fromisoformat(str(authority["issuedAt"]).replace("Z", "+00:00"))
            expires = datetime.fromisoformat(str(authority["expiresAt"]).replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("Menu-control rebind authority time is invalid") from error
        now = self._now().astimezone(timezone.utc)
        if issued.tzinfo is None or expires.tzinfo is None or issued > now or now >= expires or expires - issued > timedelta(seconds=300):
            raise ValueError("Menu-control rebind authority is expired or not yet valid")
        if authority_id in self._consumed_authority_ids:
            raise ValueError("Menu-control rebind authority was already consumed")
        return authority_id

    def consume(self, authority_id: str) -> None:
        self._consumed_authority_ids.add(_require_uuid(authority_id, "authorityId"))


def _live_scene_fingerprint(scene: Any) -> str:
    from .menu_control_proof import _scene_snapshot

    if getattr(bpy.context, "scene", None) is not scene:
        raise RuntimeError("Menu-control history fingerprint target is not the context Scene")
    return compute_scene_fingerprint_sha256(_scene_snapshot())


def _stage_snapshot_values(cursor: int) -> tuple[str | None, list[float] | None, list[float] | None]:
    location = EXPECTED_ARGUMENTS["location"]
    values = (
        (None, None, None),
        ("Sphere", [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]),
        ("Sphere", [1.25, 0.0, 0.0], [1.0, 1.0, 1.0]),
        ("Sphere", [1.25, -2.0, 0.0], [1.0, 1.0, 1.0]),
        ("Sphere", list(location), [1.0, 1.0, 1.0]),
        ("Sphere", list(location), [1.5, 1.0, 1.0]),
        ("Sphere", list(location), [1.5, 1.5, 1.0]),
        ("Sphere", list(location), [1.5, 1.5, 1.5]),
        (EXPECTED_ARGUMENTS["objectName"], list(location), [1.5, 1.5, 1.5]),
    )
    return values[cursor]


def validate_driver_history_result(evidence: Mapping[str, object]) -> tuple[str, ...]:
    """Validate all 17 driver snapshots and return cursor 0..8 fingerprints."""

    expected_claims = {
        "ok": True,
        "proofFormatVersion": "1.0.0",
        "executorId": EXECUTOR_ID,
        "targetProfile": "factory_layout_three_object_ui_scale_2",
        "executionBoundary": "blender_window_event_simulate",
        "transport": "event_simulate",
        "evidenceClass": "blender_event_simulation",
        "osHidInput": False,
        "managedActionResult": "not_executed",
        "managedIdentityVerified": False,
        "managedActionExecuted": False,
        "managedReceiptCreated": False,
        "authorization": "accepted_replay_next_step",
        "eventSimulateCount": 146,
        "menuControlExecutionVerified": True,
        "strongCurrentStateVerified": True,
        "nativeUndoCheckpointRequired": True,
    }
    if any(evidence.get(key) != value for key, value in expected_claims.items()):
        raise ValueError("Menu-control history requires successful fixed-driver evidence")
    if evidence.get("operationIds") != list(OPERATION_IDS):
        raise ValueError("Menu-control history operation IDs are invalid")
    accepted_action = evidence.get("acceptedAction")
    if not isinstance(accepted_action, Mapping) or accepted_action != {
        "name": "blender.mesh.create_uv_sphere",
        "arguments": expected_arguments_payload(),
    }:
        raise ValueError("Menu-control history accepted arguments are invalid")
    if evidence.get("nativeUndoDepth") != HISTORY_DEPTH:
        raise ValueError("Menu-control history requires native Undo depth 8")
    if evidence.get("strongObservationKind") != "uv_sphere_menu_controls_ready":
        raise ValueError("Menu-control history strong observation is invalid")
    if evidence.get("nativeUndoCheckpointVerified") is not True:
        raise ValueError("Menu-control history native checkpoint is unverified")
    if evidence.get("hostVersion") not in {"4.5.3", "5.1.1"}:
        raise ValueError("Menu-control history host version is invalid")
    ui_scale = evidence.get("uiScale")
    if isinstance(ui_scale, bool) or not isinstance(ui_scale, (int, float)) or not math.isclose(float(ui_scale), 2.0, rel_tol=0.0, abs_tol=1e-6):
        raise ValueError("Menu-control history UI scale is invalid")
    source_operator = evidence.get("sourceOperator")
    if source_operator != {
        "id": "MESH_OT_primitive_uv_sphere_add", "segments": 32,
        "ringCount": 16, "radius": 1.0, "location": [0.0, 0.0, 0.0],
    }:
        raise ValueError("Menu-control history source operator is invalid")
    final_state = evidence.get("finalState")
    if (
        not isinstance(final_state, Mapping)
        or final_state.get("objectName") != EXPECTED_ARGUMENTS["objectName"]
        or final_state.get("objectType") != "MESH"
        or final_state.get("location") != list(EXPECTED_ARGUMENTS["location"])
        or final_state.get("scale") != [EXPECTED_ARGUMENTS["radius"]] * 3
        or final_state.get("meshTopology") != EXPECTED_TOPOLOGY
    ):
        raise ValueError("Menu-control history final state is invalid")
    _require_sha256(final_state.get("meshSha256"), "final mesh")
    _require_sha256(evidence.get("eventSequenceSha256"), "event sequence")
    summaries = evidence.get("operationSummaries")
    if not isinstance(summaries, Sequence) or isinstance(summaries, (str, bytes)):
        raise ValueError("Menu-control history operation summaries are missing")
    paths = (
        ["Layout"], ["Layout", "Add"], ["Layout", "Add", "Mesh"],
        ["Layout", "Add", "Mesh", "UV Sphere"],
        ["Sidebar", "Item", "Transform", "Location"],
        ["Sidebar", "Item", "Transform", "Scale"],
        ["Properties", "Object", "Name"],
    )
    parameters = (
        {}, {}, {}, {"radius": 1.0},
        {"value": list(EXPECTED_ARGUMENTS["location"])},
        {"value": [EXPECTED_ARGUMENTS["radius"]] * 3},
        {"value": EXPECTED_ARGUMENTS["objectName"]},
    )
    expected_summaries = [
        {
            "operationId": operation_id,
            "status": "precondition_verified" if index == 0 else "control_executed",
            "path": paths[index],
            "parameters": parameters[index],
        }
        for index, operation_id in enumerate(OPERATION_IDS)
    ]
    if list(summaries) != expected_summaries:
        raise ValueError("Menu-control history requires seven ordered logical summaries")
    snapshots = evidence.get("historySnapshots")
    if not isinstance(snapshots, Sequence) or isinstance(snapshots, (str, bytes)) or len(snapshots) != 17:
        raise ValueError("Menu-control history requires exactly 17 stage snapshots")
    if not all(isinstance(snapshot, Mapping) for snapshot in snapshots):
        raise ValueError("Menu-control history stage snapshots are invalid")
    expected_labels = (
        "final", "undo-1", "undo-2", "undo-3", "undo-4", "undo-5",
        "undo-6", "undo-7", "undo-8", "redo-1", "redo-2", "redo-3",
        "redo-4", "redo-5", "redo-6", "redo-7", "redo-8",
    )
    if tuple(snapshot.get("label") for snapshot in snapshots) != expected_labels:
        raise ValueError("Menu-control history stage order is invalid")

    stage_fingerprints: list[str] = []
    for cursor in range(HISTORY_DEPTH + 1):
        primary_index = HISTORY_DEPTH - cursor if cursor < HISTORY_DEPTH else 0
        primary = snapshots[primary_index]
        fingerprint = _require_sha256(
            primary.get("sceneFingerprintSha256"), f"cursor {cursor} fingerprint"
        )
        scene_snapshot = primary.get("sceneSnapshot")
        if not isinstance(scene_snapshot, dict) or compute_scene_fingerprint_sha256(scene_snapshot) != fingerprint:
            raise ValueError(f"Menu-control history cursor {cursor} full snapshot is invalid")
        name, location, scale = _stage_snapshot_values(cursor)
        expected_objects = ["Camera", "Cube", "Light"] if cursor == 0 else sorted(
            ["Camera", "Cube", "Light", str(name)]
        )
        if (
            primary.get("proofObjectName") != name
            or primary.get("proofObjectLocation") != location
            or primary.get("proofObjectScale") != scale
            or primary.get("proofMeshTopology") != (None if cursor == 0 else EXPECTED_TOPOLOGY)
            or primary.get("objectNames") != expected_objects
            or (cursor == 0 and primary.get("activeObject") != "Cube")
        ):
            raise ValueError(f"Menu-control history cursor {cursor} snapshot is invalid")
        if cursor > 0:
            redo = snapshots[HISTORY_DEPTH + cursor]
            if redo.get("sceneFingerprintSha256") != fingerprint:
                raise ValueError(f"Menu-control history cursor {cursor} replacement is invalid")
            for field in (
                "objectNames", "activeObject", "proofObjectName", "proofObjectLocation",
                "proofObjectScale", "proofMeshTopology", "sceneSnapshot",
            ):
                if redo.get(field) != primary.get(field):
                    raise ValueError(f"Menu-control history cursor {cursor} snapshots disagree")
        stage_fingerprints.append(fingerprint)

    if evidence.get("baselineSceneFingerprintSha256") != stage_fingerprints[0]:
        raise ValueError("Menu-control history baseline fingerprint is invalid")
    if evidence.get("finalSceneFingerprintSha256") != stage_fingerprints[8]:
        raise ValueError("Menu-control history final fingerprint is invalid")
    if evidence.get("restoredSceneFingerprintSha256") != stage_fingerprints[0]:
        raise ValueError("Menu-control history restored fingerprint is invalid")
    if evidence.get("reappliedSceneFingerprintSha256") != stage_fingerprints[8]:
        raise ValueError("Menu-control history reapplied fingerprint is invalid")
    baseline_snapshot = evidence.get("baselineSceneSnapshot")
    final_snapshot = evidence.get("finalSceneSnapshot")
    if (
        not isinstance(baseline_snapshot, dict)
        or not isinstance(final_snapshot, dict)
        or compute_scene_fingerprint_sha256(baseline_snapshot) != stage_fingerprints[0]
        or compute_scene_fingerprint_sha256(final_snapshot) != stage_fingerprints[8]
    ):
        raise ValueError("Menu-control history full scene snapshots are invalid")
    if len(set(stage_fingerprints)) != 9:
        raise ValueError("Menu-control history requires nine distinct stage fingerprints")
    return tuple(stage_fingerprints)


@dataclass(frozen=True, slots=True)
class MenuControlHistoryEntry:
    checkpoint_id: str
    previous_checkpoint_id: str | None
    undo_lock_id: str
    proof_id: str
    replay_id: str
    target_id: str
    owner_scene_uid: int
    checkpoint_kind: str
    stage_fingerprints: tuple[str, ...]
    cursor: int | None
    armed_at: str
    terminal_result_content_sha256: str
    terminal_result: dict[str, object]
    acknowledged_terminal_result_content_sha256: str | None = None
    transition_result_content_sha256s: tuple[str, ...] = ()
    transition_results: tuple[dict[str, object], ...] = ()


_REGISTERED_CONTROLLERS: set["MenuControlHistoryController"] = set()


class MenuControlHistoryController:
    """Track adjacent native history stages without mutating Blender data."""

    def __init__(
        self,
        authority_gate: HmacRebindAuthorityGate | None = None,
        *,
        transition_result_callback: Callable[[dict[str, object]], None]
        | None = None,
    ) -> None:
        if authority_gate is not None and not isinstance(
            authority_gate, HmacRebindAuthorityGate
        ):
            raise TypeError("Menu-control history authority gate is invalid")
        if transition_result_callback is not None and not callable(
            transition_result_callback
        ):
            raise TypeError("Menu-control transition result callback is invalid")
        self._authority_gate = authority_gate
        self._transition_result_callback = transition_result_callback
        self._entries: list[MenuControlHistoryEntry] = []
        self._transitions: list[dict[str, object]] = []
        self._current: MenuControlHistoryEntry | None = None
        self._orphan_marker: dict[str, object] | None = None
        self._registered = False
        self._locked = False
        self._status = "idle"
        self._handling = False
        self.error = ""

    @property
    def registered(self) -> bool:
        return self._registered

    @property
    def mutation_locked(self) -> bool:
        return self._locked

    @property
    def cursor(self) -> int | None:
        return None if self._current is None else self._current.cursor

    @property
    def status(self) -> str:
        return self._status

    @staticmethod
    def _marker_identity(marker: Mapping[str, object]) -> dict[str, object]:
        return {
            key: deepcopy(value)
            for key, value in marker.items()
            if key not in {"markerContentSha256", "terminalResult", "transitionResults"}
        }

    @staticmethod
    def _checkpoint_identity_from_marker(marker: Mapping[str, object]) -> dict[str, object]:
        return {
            "formatVersion": marker.get("formatVersion"),
            "executorId": marker.get("executorId"),
            "checkpointId": marker.get("checkpointId"),
            "undoLockId": marker.get("undoLockId"),
            "proofId": marker.get("proofId"),
            "replayId": marker.get("replayId"),
            "targetId": marker.get("targetId"),
            "checkpointKind": marker.get("checkpointKind"),
            "stageFingerprints": deepcopy(marker.get("stageFingerprints")),
            "terminalResultContentSha256": marker.get("terminalResultContentSha256"),
        }

    @staticmethod
    def _terminal_marker_identity_from_marker(
        marker: Mapping[str, object],
    ) -> dict[str, object]:
        fingerprints = marker.get("stageFingerprints")
        checkpoint_kind = marker.get("checkpointKind")
        if not isinstance(fingerprints, Sequence) or len(fingerprints) != 9:
            raise ValueError("Menu-control terminal marker stage fingerprints are invalid")
        locked_index = 8 if checkpoint_kind == "success" else 1
        return {
            "formatVersion": marker.get("formatVersion"),
            "executorId": marker.get("executorId"),
            "checkpointId": marker.get("checkpointId"),
            "undoLockId": marker.get("undoLockId"),
            "proofId": marker.get("proofId"),
            "replayId": marker.get("replayId"),
            "targetId": marker.get("targetId"),
            "checkpointKind": checkpoint_kind,
            "baselineSceneFingerprintSha256": fingerprints[0],
            "lockedSceneFingerprintSha256": fingerprints[locked_index],
            "terminalResultContentSha256": marker.get(
                "terminalResultContentSha256"
            ),
        }

    @classmethod
    def _marker_payload(cls, entry: MenuControlHistoryEntry) -> dict[str, object]:
        marker: dict[str, object] = {
            "formatVersion": _MARKER_FORMAT_VERSION,
            "executorId": EXECUTOR_ID,
            "checkpointId": entry.checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "checkpointKind": entry.checkpoint_kind,
            "stageFingerprints": list(entry.stage_fingerprints),
            "cursor": entry.cursor,
            "terminalResultContentSha256": entry.terminal_result_content_sha256,
            "transitionResultContentSha256s": list(entry.transition_result_content_sha256s),
            "terminalResult": deepcopy(entry.terminal_result),
            "transitionResults": deepcopy(list(entry.transition_results)),
        }
        if entry.acknowledged_terminal_result_content_sha256 is not None:
            marker["acknowledgedTerminalResultContentSha256"] = (
                entry.acknowledged_terminal_result_content_sha256
            )
        marker["checkpointContentSha256"] = _canonical_sha256(
            cls._checkpoint_identity_from_marker(marker)
        )
        marker["terminalMarkerContentSha256"] = _canonical_sha256(
            cls._terminal_marker_identity_from_marker(marker)
        )
        marker["markerContentSha256"] = _canonical_sha256(cls._marker_identity(marker))
        return marker

    @classmethod
    def _read_marker(cls, scene: Any) -> dict[str, object] | None:
        raw = scene.get(MENU_CONTROL_HISTORY_MARKER_KEY)
        if raw is None:
            return None
        if not isinstance(raw, str) or not raw:
            raise RuntimeError("Menu-control history marker is invalid")
        try:
            marker = json.loads(raw)
        except (TypeError, ValueError) as error:
            raise RuntimeError("Menu-control history marker is invalid") from error
        if not isinstance(marker, dict) or marker.get("formatVersion") != _MARKER_FORMAT_VERSION or marker.get("executorId") != EXECUTOR_ID:
            raise RuntimeError("Menu-control history marker is unsupported")
        for field in ("checkpointId", "undoLockId", "proofId", "replayId"):
            _require_uuid(marker.get(field), f"marker {field}")
        if marker.get("checkpointKind") not in {"success", "failure"}:
            raise RuntimeError("Menu-control history checkpoint kind is invalid")
        if not isinstance(marker.get("targetId"), str) or not marker["targetId"]:
            raise RuntimeError("Menu-control history target is invalid")
        fingerprints = marker.get("stageFingerprints")
        cursor = marker.get("cursor")
        if not isinstance(fingerprints, list) or len(fingerprints) != 9:
            raise RuntimeError("Menu-control history stage fingerprints are invalid")
        for value in fingerprints:
            _require_sha256(value, "marker stage fingerprint")
        if marker.get("checkpointKind") == "success" and len(set(fingerprints)) != 9:
            raise RuntimeError("Menu-control history success stages are not distinct")
        if cursor is not None and (not isinstance(cursor, int) or isinstance(cursor, bool) or cursor not in range(9)):
            raise RuntimeError("Menu-control history cursor is invalid")
        if marker.get("checkpointKind") == "failure" and cursor not in {None, 0}:
            raise RuntimeError("Menu-control failure history cursor is invalid")
        terminal = marker.get("terminalResult")
        terminal_hash = _require_sha256(marker.get("terminalResultContentSha256"), "terminal result")
        if not isinstance(terminal, dict) or _canonical_sha256(terminal) != terminal_hash:
            raise RuntimeError("Menu-control history terminal outbox is invalid")
        acknowledged_terminal_hash = marker.get(
            "acknowledgedTerminalResultContentSha256"
        )
        if (
            acknowledged_terminal_hash is not None
            and _require_sha256(
                acknowledged_terminal_hash, "acknowledged terminal result"
            )
            != terminal_hash
        ):
            raise RuntimeError(
                "Menu-control history terminal acknowledgement identity is invalid"
            )
        terminal_evidence = terminal.get("terminalEvidence")
        expected_terminal_status = (
            "succeeded" if marker["checkpointKind"] == "success" else "failed_checkpointed"
        )
        terminal_checkpoint = (
            terminal_evidence.get("nativeUndoCheckpoint")
            if expected_terminal_status == "succeeded"
            and isinstance(terminal_evidence, Mapping)
            else terminal_evidence.get("checkpoint")
            if isinstance(terminal_evidence, Mapping)
            else None
        )
        if (
            terminal.get("proofId") != marker["proofId"]
            or terminal.get("replayId") != marker["replayId"]
            or terminal.get("status") != expected_terminal_status
            or not isinstance(terminal_evidence, Mapping)
            or not isinstance(terminal_checkpoint, Mapping)
            or terminal_checkpoint.get("checkpointId") != marker["checkpointId"]
            or terminal_checkpoint.get("undoLockId") != marker["undoLockId"]
        ):
            raise RuntimeError("Menu-control history terminal outbox identity is invalid")
        if marker["checkpointKind"] == "success":
            reported_baseline = terminal_checkpoint.get(
                "baselineSceneFingerprintSha256"
            )
            reported_locked = terminal_checkpoint.get("finalSceneFingerprintSha256")
        else:
            reported_baseline = terminal_checkpoint.get(
                "baselineSceneFingerprintSha256"
            )
            reported_locked = terminal_checkpoint.get("currentSceneFingerprintSha256")
        if (
            reported_baseline is not None
            and reported_baseline != fingerprints[0]
            or reported_locked is not None
            and reported_locked
            != fingerprints[8 if marker["checkpointKind"] == "success" else 1]
        ):
            raise RuntimeError("Menu-control history terminal Scene identity is invalid")
        checkpoint_hash = _require_sha256(
            marker.get("checkpointContentSha256"), "checkpoint content"
        )
        if checkpoint_hash != _canonical_sha256(cls._checkpoint_identity_from_marker(marker)):
            raise RuntimeError("Menu-control history checkpoint content hash is invalid")
        terminal_marker_hash = marker.get("terminalMarkerContentSha256")
        if terminal_marker_hash is not None and _require_sha256(
            terminal_marker_hash, "terminal marker content"
        ) != _canonical_sha256(cls._terminal_marker_identity_from_marker(marker)):
            raise RuntimeError("Menu-control history terminal marker content hash is invalid")
        results = marker.get("transitionResults")
        result_hashes = marker.get("transitionResultContentSha256s")
        if (
            not isinstance(results, list)
            or not isinstance(result_hashes, list)
            or len(results) != len(result_hashes)
            or len(results) > 32
            or any(not isinstance(result, dict) for result in results)
            or any(_require_sha256(digest, "transition result") != _canonical_sha256(result) for digest, result in zip(result_hashes, results))
        ):
            raise RuntimeError("Menu-control history transition outbox is invalid")
        expected_to_cursor = cursor
        for result in reversed(results):
            from_cursor = result.get("fromCursor")
            to_cursor = result.get("toCursor")
            direction = result.get("direction")
            failure_boundary = marker["checkpointKind"] == "failure" and (
                direction == "undo"
                and from_cursor is None
                and to_cursor == 0
                or direction == "redo"
                and from_cursor == 0
                and to_cursor is None
            )
            ordinary_boundary = (
                marker["checkpointKind"] == "success"
                and isinstance(from_cursor, int)
                and not isinstance(from_cursor, bool)
                and isinstance(to_cursor, int)
                and not isinstance(to_cursor, bool)
                and from_cursor in range(9)
                and to_cursor in range(9)
                and direction in {"undo", "redo"}
                and to_cursor - from_cursor
                == (-1 if direction == "undo" else 1)
            )
            fingerprint_cursor = 1 if to_cursor is None else to_cursor
            expected_stage = (
                "failure_checkpoint"
                if to_cursor is None
                else STAGE_LABELS[to_cursor]
            )
            if (
                not (failure_boundary or ordinary_boundary)
                or to_cursor != expected_to_cursor
                or result.get("checkpointId") != marker["checkpointId"]
                or result.get("undoLockId") != marker["undoLockId"]
                or result.get("stage") != expected_stage
                or result.get("status")
                != ("restored" if to_cursor == 0 else "history_locked")
                or result.get("sceneFingerprintSha256")
                != fingerprints[fingerprint_cursor]
            ):
                raise RuntimeError("Menu-control history transition order is invalid")
            expected_to_cursor = from_cursor
        marker_hash = _require_sha256(marker.get("markerContentSha256"), "marker content")
        if marker_hash != _canonical_sha256(cls._marker_identity(marker)):
            raise RuntimeError("Menu-control history marker content hash is invalid")
        return marker

    def _write_marker(self, scene: Any, entry: MenuControlHistoryEntry) -> None:
        marker = self._marker_payload(entry)
        serialized = json.dumps(marker, ensure_ascii=True, allow_nan=False, separators=(",", ":"), sort_keys=True)
        if self._read_marker({MENU_CONTROL_HISTORY_MARKER_KEY: serialized}) != marker:
            raise RuntimeError("Menu-control history marker candidate is invalid")
        missing = object()
        previous = scene.get(MENU_CONTROL_HISTORY_MARKER_KEY, missing)
        try:
            scene[MENU_CONTROL_HISTORY_MARKER_KEY] = serialized
            if self._read_marker(scene) != marker:
                raise RuntimeError("Menu-control history marker did not round-trip")
        except Exception:
            if previous is missing:
                scene.pop(MENU_CONTROL_HISTORY_MARKER_KEY, None)
            else:
                scene[MENU_CONTROL_HISTORY_MARKER_KEY] = previous
            raise

    @staticmethod
    def _require_context_scene(scene: Any) -> None:
        if getattr(bpy.context, "scene", None) is not scene or not any(
            candidate is scene for candidate in bpy.data.scenes
        ):
            raise ValueError("Menu-control history requires the current registered Scene")

    def register(
        self,
        transition_result_callback: Callable[[dict[str, object]], None]
        | None = None,
    ) -> None:
        if transition_result_callback is not None:
            if not callable(transition_result_callback):
                raise TypeError("Menu-control transition result callback is invalid")
            self._transition_result_callback = transition_result_callback
        if self._registered:
            return
        if self._status == "retired":
            self._status = "idle"
            self.error = ""
        for handlers, callback in (
            (bpy.app.handlers.undo_post, _menu_control_undo_post),
            (bpy.app.handlers.redo_post, _menu_control_redo_post),
            (bpy.app.handlers.load_post, _menu_control_load_post),
        ):
            if callback not in handlers:
                handlers.append(callback)
        self._registered = True
        _REGISTERED_CONTROLLERS.add(self)
        self._discover_marker()

    def unregister(self) -> bool:
        if (
            self._locked
            or self._status == "recovery_required"
            or self._orphan_marker is not None
            or self.has_transition_outbox()
        ):
            return False
        if self._registered:
            for handlers, callback in (
                (bpy.app.handlers.undo_post, _menu_control_undo_post),
                (bpy.app.handlers.redo_post, _menu_control_redo_post),
                (bpy.app.handlers.load_post, _menu_control_load_post),
            ):
                if callback in handlers and len(_REGISTERED_CONTROLLERS) <= 1:
                    handlers.remove(callback)
        _REGISTERED_CONTROLLERS.discard(self)
        self._registered = False
        return True

    def retire(self, *, keep_handlers: bool = False) -> None:
        """Detach one controller without mutating a persisted Scene marker."""

        _REGISTERED_CONTROLLERS.discard(self)
        if self._registered and not keep_handlers and not _REGISTERED_CONTROLLERS:
            for handlers, callback in (
                (bpy.app.handlers.undo_post, _menu_control_undo_post),
                (bpy.app.handlers.redo_post, _menu_control_redo_post),
                (bpy.app.handlers.load_post, _menu_control_load_post),
            ):
                if callback in handlers:
                    handlers.remove(callback)
        self._registered = False
        self._current = None
        self._orphan_marker = None
        self._locked = False
        self._status = "retired"

    def _discover_marker(self) -> None:
        found = []
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
            self._lock_recovery("persisted markers are invalid or ambiguous")
        elif found:
            self._orphan_marker = found[0]
            self._lock_recovery("persisted marker requires explicit rebind")

    def _owner_scene(self, entry: MenuControlHistoryEntry) -> Any | None:
        return next((scene for scene in bpy.data.scenes if int(scene.session_uid) == entry.owner_scene_uid), None)

    def _lock_recovery(self, message: str) -> None:
        self._locked = True
        self._status = "recovery_required"
        self.error = f"Menu-control native history failed closed: {message}"

    @staticmethod
    def _build_terminal_result(
        builder: Any,
        checkpoint: Mapping[str, object],
        entry: MenuControlHistoryEntry,
        expected_status: str,
    ) -> dict[str, object]:
        if not callable(builder):
            raise TypeError("Menu-control terminal result builder must be callable")
        result = dict(builder(deepcopy(dict(checkpoint))))
        terminal = result.get("terminalEvidence")
        terminal_checkpoint = (
            terminal.get("nativeUndoCheckpoint")
            if expected_status == "succeeded" and isinstance(terminal, Mapping)
            else terminal.get("checkpoint")
            if isinstance(terminal, Mapping)
            else None
        )
        if (
            result.get("proofId") != entry.proof_id
            or result.get("replayId") != entry.replay_id
            or result.get("status") != expected_status
            or not isinstance(terminal, Mapping)
            or not isinstance(terminal_checkpoint, Mapping)
            or terminal_checkpoint.get("checkpointId") != entry.checkpoint_id
            or terminal_checkpoint.get("undoLockId") != entry.undo_lock_id
        ):
            raise ValueError("Menu-control terminal result identity is invalid")
        return result

    @staticmethod
    def _builder_checkpoint(entry: MenuControlHistoryEntry) -> dict[str, object]:
        return {
            "checkpointId": entry.checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "checkpointKind": entry.checkpoint_kind,
            "cursor": entry.cursor,
            "stageFingerprints": list(entry.stage_fingerprints),
            "committedAt": entry.armed_at,
        }

    def arm(
        self,
        scene: Any,
        evidence: Mapping[str, object],
        *,
        proof_id: str,
        replay_id: str,
        target_id: str,
        terminal_result_builder: Any,
    ) -> dict[str, object]:
        if not self._registered:
            raise RuntimeError("Menu-control history is not registered")
        if self._locked:
            raise RuntimeError("Menu-control history mutation lock is already held")
        self._require_context_scene(scene)
        fingerprints = validate_driver_history_result(evidence)
        if _live_scene_fingerprint(scene) != fingerprints[8]:
            raise ValueError("Menu-control history can arm only at the exact final stage")
        proof_id = _require_uuid(proof_id, "proofId")
        replay_id = _require_uuid(replay_id, "replayId")
        if not isinstance(target_id, str) or not target_id:
            raise ValueError("Menu-control history targetId must not be empty")
        entry = MenuControlHistoryEntry(
            checkpoint_id=str(uuid.uuid4()),
            previous_checkpoint_id=None if not self._entries else self._entries[-1].checkpoint_id,
            undo_lock_id=str(uuid.uuid4()),
            proof_id=proof_id,
            replay_id=replay_id,
            target_id=target_id,
            owner_scene_uid=int(scene.session_uid),
            checkpoint_kind="success",
            stage_fingerprints=fingerprints,
            cursor=8,
            armed_at=_utc_now(),
            terminal_result_content_sha256="0" * 64,
            terminal_result={},
        )
        terminal = self._build_terminal_result(
            terminal_result_builder,
            self._builder_checkpoint(entry),
            entry,
            "succeeded",
        )
        entry = replace(
            entry,
            terminal_result_content_sha256=_canonical_sha256(terminal),
            terminal_result=terminal,
        )
        self._write_marker(scene, entry)
        self._entries.append(entry)
        self._current = entry
        self._orphan_marker = None
        self._locked = True
        self._status = "armed_locked"
        self.error = ""
        return self.current_checkpoint() or {}

    def arm_failed(
        self,
        scene: Any,
        evidence: Mapping[str, object],
        *,
        proof_id: str,
        replay_id: str,
        target_id: str,
        terminal_result_builder: Any,
    ) -> dict[str, object]:
        if not self._registered or self._locked:
            raise RuntimeError("Menu-control failure history cannot arm")
        self._require_context_scene(scene)
        if evidence.get("ok") is not False or evidence.get("executorId") != EXECUTOR_ID or evidence.get("mutationStarted") is not True or evidence.get("requiresUndoRecovery") is not True or evidence.get("failureStatus") != "failed_checkpointed":
            raise ValueError("Menu-control failure checkpoint evidence is invalid")
        baseline = _require_sha256(evidence.get("baselineSceneFingerprintSha256"), "failure baseline")
        current = _require_sha256(evidence.get("currentSceneFingerprintSha256"), "failure current")
        baseline_snapshot = evidence.get("baselineSceneSnapshot")
        current_snapshot = evidence.get("currentSceneSnapshot")
        if (
            not isinstance(baseline_snapshot, dict)
            or not isinstance(current_snapshot, dict)
            or compute_scene_fingerprint_sha256(baseline_snapshot) != baseline
            or compute_scene_fingerprint_sha256(current_snapshot) != current
        ):
            raise ValueError("Menu-control failure scene snapshot hash is invalid")
        if not isinstance(target_id, str) or not target_id:
            raise ValueError("Menu-control failure history targetId must not be empty")
        if baseline == current or _live_scene_fingerprint(scene) != current:
            raise ValueError("Menu-control failure checkpoint live state is invalid")
        entry = MenuControlHistoryEntry(
            checkpoint_id=str(uuid.uuid4()), previous_checkpoint_id=None if not self._entries else self._entries[-1].checkpoint_id,
            undo_lock_id=str(uuid.uuid4()), proof_id=_require_uuid(proof_id, "proofId"), replay_id=_require_uuid(replay_id, "replayId"),
            target_id=target_id, owner_scene_uid=int(scene.session_uid), checkpoint_kind="failure",
            stage_fingerprints=(baseline, current, current, current, current, current, current, current, current), cursor=None,
            armed_at=_utc_now(), terminal_result_content_sha256="0" * 64, terminal_result={},
        )
        terminal = self._build_terminal_result(
            terminal_result_builder,
            self._builder_checkpoint(entry),
            entry,
            "failed_checkpointed",
        )
        entry = replace(
            entry,
            terminal_result_content_sha256=_canonical_sha256(terminal),
            terminal_result=terminal,
        )
        try:
            self._write_marker(scene, entry)
        except Exception as error:
            self._lock_recovery(f"failure checkpoint could not persist: {error}")
            raise
        self._entries.append(entry)
        self._current = entry
        self._locked = True
        self._status = "failed_checkpointed"
        return self.current_checkpoint() or {}

    def sync(self, direction: str) -> None:
        if self._handling:
            return
        if direction not in {"undo", "redo"}:
            raise ValueError("Menu-control history direction is invalid")
        entry = self._current
        if entry is None and self._orphan_marker is None:
            return
        if entry is None:
            self._lock_recovery("native history has no rebound exact cursor")
            return
        self._handling = True
        try:
            if entry.checkpoint_kind == "failure" and entry.cursor is None:
                expected_cursor = 0 if direction == "undo" else -1
            elif (
                entry.checkpoint_kind == "failure"
                and entry.cursor == 0
                and direction == "redo"
            ):
                expected_cursor = None
            else:
                expected_cursor = entry.cursor + (
                    -1 if direction == "undo" else 1
                )
            if expected_cursor == -1 or (
                expected_cursor is not None and expected_cursor not in range(9)
            ):
                self._lock_recovery(f"native {direction} crossed the proven history boundary")
                return
            owner = self._owner_scene(entry)
            if owner is None or getattr(bpy.context, "scene", None) is not owner:
                self._lock_recovery("history owner is not the current Scene")
                return
            live = _live_scene_fingerprint(owner)
            fingerprint_cursor = 1 if expected_cursor is None else expected_cursor
            if live != entry.stage_fingerprints[fingerprint_cursor]:
                self._lock_recovery(f"native {direction} did not move exactly one stage")
                return
            transition = {
                "transitionId": str(uuid.uuid4()),
                "checkpointId": entry.checkpoint_id,
                "undoLockId": entry.undo_lock_id,
                "direction": direction,
                "fromCursor": entry.cursor,
                "toCursor": expected_cursor,
                "stage": (
                    "failure_checkpoint"
                    if expected_cursor is None
                    else STAGE_LABELS[expected_cursor]
                ),
                "status": "restored" if expected_cursor == 0 else "history_locked",
                "sceneFingerprintSha256": live,
                "occurredAt": _utc_now(),
            }
            transition_hash = _canonical_sha256(transition)
            if len(entry.transition_results) >= 32:
                self._lock_recovery("transition outbox limit reached")
                return
            updated = replace(
                entry,
                cursor=expected_cursor,
                transition_result_content_sha256s=(*entry.transition_result_content_sha256s, transition_hash),
                transition_results=(*entry.transition_results, transition),
            )
            self._write_marker(owner, updated)
            self._current = updated
            self._entries[-1] = updated
            self._transitions.append(transition)
            self._locked = expected_cursor != 0
            self._status = "restored" if expected_cursor == 0 else "history_locked"
            self.error = ""
            if self._transition_result_callback is not None:
                self._transition_result_callback(deepcopy(transition))
        except Exception as error:
            self._lock_recovery(str(error))
        finally:
            self._handling = False

    def loaded_file(self) -> None:
        self._current = None
        self._orphan_marker = None
        self._locked = False
        self._status = "idle"
        self.error = ""
        self._discover_marker()

    def rebind_orphan(
        self,
        scene: Any,
        authority: Mapping[str, object],
    ) -> dict[str, object]:
        self._require_context_scene(scene)
        marker = self._read_marker(scene)
        if marker is None or marker is not self._orphan_marker and marker != self._orphan_marker:
            raise ValueError("Menu-control orphan marker is unavailable")
        if self._authority_gate is None:
            raise RuntimeError("Menu-control rebind requires a trusted authority gate")
        authority_id = self._authority_gate.verify(authority)
        bindings = {
            "expectedMarkerContentSha256": marker["markerContentSha256"],
            "checkpointId": marker["checkpointId"],
            "undoLockId": marker["undoLockId"],
            "proofId": marker["proofId"],
            "replayId": marker["replayId"],
            "targetId": marker["targetId"],
            "documentSessionUid": int(scene.session_uid),
        }
        if any(authority.get(field) != value for field, value in bindings.items()):
            raise ValueError("Menu-control rebind authority binding is invalid")
        cursor = marker.get("cursor")
        live = _live_scene_fingerprint(scene)
        if marker["checkpointKind"] == "failure" and cursor is None:
            if live != marker["stageFingerprints"][1]:
                self._lock_recovery(
                    "failure marker has no durable native transition to the live stage"
                )
                raise ValueError(
                    "Menu-control orphan failure marker lacks a durable transition"
                )
        elif not isinstance(cursor, int) or live != marker["stageFingerprints"][cursor]:
            self._lock_recovery("orphan marker does not match the live Scene")
            raise ValueError("Menu-control orphan marker live stage is invalid")
        entry = MenuControlHistoryEntry(
            checkpoint_id=str(marker["checkpointId"]), previous_checkpoint_id=None,
            undo_lock_id=str(marker["undoLockId"]), proof_id=str(marker["proofId"]), replay_id=str(marker["replayId"]),
            target_id=str(marker["targetId"]), owner_scene_uid=int(scene.session_uid), checkpoint_kind=str(marker["checkpointKind"]),
            stage_fingerprints=tuple(str(value) for value in marker["stageFingerprints"]), cursor=cursor, armed_at=_utc_now(),
            terminal_result_content_sha256=str(marker["terminalResultContentSha256"]), terminal_result=deepcopy(marker["terminalResult"]),
            acknowledged_terminal_result_content_sha256=marker.get(
                "acknowledgedTerminalResultContentSha256"
            ),
            transition_result_content_sha256s=tuple(str(value) for value in marker["transitionResultContentSha256s"]),
            transition_results=tuple(deepcopy(item) for item in marker["transitionResults"]),
        )
        self._write_marker(scene, entry)
        self._current = entry
        self._entries.append(entry)
        self._orphan_marker = None
        self._locked = cursor != 0
        self._status = "rebound_locked" if self._locked else "rebound_restored"
        self.error = ""
        self._authority_gate.consume(authority_id)
        return {
            **self.current_checkpoint(),
            "instanceId": authority["instanceId"],
            "leaseId": authority["leaseId"],
            "documentIncarnationId": authority["documentIncarnationId"],
            "authorityId": authority["authorityId"],
        }

    def acknowledge_transition_results(self, content_sha256s: Sequence[str]) -> None:
        if isinstance(content_sha256s, (str, bytes)) or not content_sha256s or self._current is None:
            return
        hashes = tuple(content_sha256s)
        entry = self._current
        if hashes != entry.transition_result_content_sha256s[: len(hashes)]:
            return
        owner = self._owner_scene(entry)
        if owner is None:
            self._lock_recovery("outbox acknowledgement owner Scene is unavailable")
            return
        updated = replace(entry, transition_result_content_sha256s=entry.transition_result_content_sha256s[len(hashes):], transition_results=entry.transition_results[len(hashes):])
        try:
            self._write_marker(owner, updated)
        except Exception as error:
            self._lock_recovery(f"outbox acknowledgement could not persist: {error}")
            return
        self._current = updated
        self._entries[-1] = updated

    def pending_transition_results(self) -> list[dict[str, object]]:
        """Return the exact durable, unacknowledged transition outbox."""

        if self._current is not None:
            return deepcopy(list(self._current.transition_results))
        if self._orphan_marker is not None:
            results = self._orphan_marker.get("transitionResults")
            if isinstance(results, list):
                return deepcopy(results)
        return []

    def current_marker_commitments(
        self, scene: Any
    ) -> dict[str, object]:
        """Bind the active checkpoint marker to the exact current Scene."""

        self._require_context_scene(scene)
        entry = self._current
        if entry is None or self._owner_scene(entry) is not scene:
            raise RuntimeError("Menu-control transition checkpoint is not active")
        marker = self._read_marker(scene)
        if marker is None or marker != self._marker_payload(entry):
            raise RuntimeError("Menu-control transition marker changed")
        fingerprint_cursor = (
            1
            if entry.checkpoint_kind == "failure" and entry.cursor is None
            else entry.cursor
        )
        if fingerprint_cursor is None:
            raise RuntimeError("Menu-control transition cursor is unavailable")
        live = _live_scene_fingerprint(scene)
        if live != entry.stage_fingerprints[fingerprint_cursor]:
            raise RuntimeError("Menu-control transition live Scene changed")
        return {
            "checkpointId": entry.checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "checkpointKind": entry.checkpoint_kind,
            "stageFingerprints": list(entry.stage_fingerprints),
            "cursor": entry.cursor,
            "terminalResultContentSha256": (
                entry.terminal_result_content_sha256
            ),
            "markerContentSha256": marker["markerContentSha256"],
            "terminalMarkerContentSha256": marker[
                "terminalMarkerContentSha256"
            ],
            "currentSceneFingerprintSha256": live,
        }

    def reconcile_transition_outbox(
        self,
        scene: Any,
        delivery: Mapping[str, object],
    ) -> dict[str, object]:
        """Build a read-only ACK for an exact persisted transition suffix."""

        if delivery.get("kind") != "native_history_transition_reconcile":
            raise ValueError("Menu-control transition reconciliation is unsupported")
        recovery_id = _require_uuid(
            delivery.get("recoveryId"), "transition recoveryId"
        )
        commitments = self.current_marker_commitments(scene)
        boundary = delivery.get("history")
        if not isinstance(boundary, Mapping):
            raise ValueError(
                "Menu-control transition reconciliation history is unavailable"
            )
        locked_index = 8 if commitments["checkpointKind"] == "success" else 1
        for field in (
            "checkpointId",
            "undoLockId",
            "terminalResultContentSha256",
        ):
            if boundary.get(field) != commitments[field]:
                raise ValueError(
                    "Menu-control transition reconciliation identity changed"
                )
        if (
            boundary.get("checkpointKind") != commitments["checkpointKind"]
            or boundary.get("baselineSceneFingerprintSha256")
            != commitments["stageFingerprints"][0]
            or boundary.get("lockedSceneFingerprintSha256")
            != commitments["stageFingerprints"][locked_index]
            or boundary.get("terminalMarkerContentSha256")
            != commitments["terminalMarkerContentSha256"]
            or delivery.get("expectedMarkerContentSha256")
            != commitments["terminalMarkerContentSha256"]
        ):
            raise ValueError(
                "Menu-control transition reconciliation marker changed"
            )
        entry = self._current
        if entry is None:
            raise ValueError(
                "Menu-control transition reconciliation outbox is unavailable"
            )
        cursor = entry.cursor
        status = "restored" if cursor == 0 else "history_locked"
        delivery_identity = {
            key: deepcopy(value)
            for key, value in entry.terminal_result.items()
            if key
            not in {
                "status",
                "managedActionResult",
                "managedIdentityVerified",
                "managedReceiptCreated",
                "requiresUndoToUnlock",
                "terminalEvidence",
                "error",
                "occurredAt",
            }
        }
        return {
            **delivery_identity,
            "kind": "native_history_transition_reconcile",
            "recoveryId": recovery_id,
            "history": {
                "checkpointId": commitments["checkpointId"],
                "undoLockId": commitments["undoLockId"],
                "checkpointKind": commitments["checkpointKind"],
                "stageFingerprints": commitments["stageFingerprints"],
                "terminalResultContentSha256": commitments[
                    "terminalResultContentSha256"
                ],
                "terminalMarkerContentSha256": commitments[
                    "terminalMarkerContentSha256"
                ],
            },
            "serverAcceptedCursor": delivery.get("serverAcceptedCursor"),
            "serverAcceptedStatus": delivery.get("serverAcceptedStatus"),
            "transitions": deepcopy(list(entry.transition_results)),
            "transitionContentSha256s": list(
                entry.transition_result_content_sha256s
            ),
            "terminalResultContentSha256": commitments[
                "terminalResultContentSha256"
            ],
            "expectedMarkerContentSha256": commitments[
                "terminalMarkerContentSha256"
            ],
            "currentCursor": cursor,
            "currentStatus": status,
            "currentSceneFingerprintSha256": commitments[
                "currentSceneFingerprintSha256"
            ],
            "occurredAt": _utc_now(),
        }

    @staticmethod
    def _terminal_receipt_chain_heads(result: Mapping[str, object]) -> list[str]:
        terminal = result.get("terminalEvidence")
        if not isinstance(terminal, Mapping):
            raise ValueError("Menu-control terminal outbox evidence is unavailable")
        if terminal.get("kind") == "succeeded_locked":
            receipts = terminal.get("operationReceipts")
        elif terminal.get("kind") == "failed_checkpointed":
            receipts = terminal.get("receiptPrefix")
        else:
            raise ValueError(
                "Menu-control terminal reconciliation requires a locked checkpoint"
            )
        if not isinstance(receipts, Sequence) or isinstance(receipts, (str, bytes)):
            raise ValueError("Menu-control terminal outbox receipt chain is invalid")
        heads: list[str] = []
        for receipt in receipts:
            if not isinstance(receipt, Mapping):
                raise ValueError("Menu-control terminal outbox receipt is invalid")
            heads.append(_require_sha256(receipt.get("contentSha256"), "terminal receipt"))
        return heads

    def build_terminal_reconciliation_ack(
        self,
        scene: Any,
        delivery: Mapping[str, object],
    ) -> dict[str, object]:
        """Prove a persisted locked terminal without replaying native input."""

        self._require_context_scene(scene)
        entry = self._current
        if entry is None or not self._locked:
            raise RuntimeError("Menu-control terminal outbox is not locked and active")
        owner = self._owner_scene(entry)
        if owner is not scene:
            raise RuntimeError("Menu-control terminal outbox belongs to another Scene")
        marker = self._read_marker(scene)
        if marker is None or marker != self._marker_payload(entry):
            raise RuntimeError("Menu-control terminal marker changed before reconciliation")
        if delivery.get("kind") != "native_terminal_reconcile":
            raise ValueError("Menu-control terminal reconciliation challenge is invalid")
        result = deepcopy(entry.terminal_result)
        if _canonical_sha256(result) != entry.terminal_result_content_sha256:
            raise RuntimeError("Menu-control terminal result hash changed")
        immutable_result_fields = {
            key: value
            for key, value in result.items()
            if key
            not in {
                "status",
                "managedActionResult",
                "managedIdentityVerified",
                "managedReceiptCreated",
                "requiresUndoToUnlock",
                "terminalEvidence",
                "error",
                "occurredAt",
            }
        }
        if any(delivery.get(key) != value for key, value in immutable_result_fields.items()):
            raise ValueError("Menu-control reconciliation changed immutable delivery identity")
        terminal_heads = self._terminal_receipt_chain_heads(result)
        acknowledged_heads = delivery.get("acknowledgedProgressReceiptChainHeads")
        if (
            not isinstance(acknowledged_heads, Sequence)
            or isinstance(acknowledged_heads, (str, bytes))
            or list(acknowledged_heads) != terminal_heads[: len(acknowledged_heads)]
        ):
            raise ValueError(
                "Menu-control reconciliation receipt prefix differs from the terminal outbox"
            )
        terminal = result["terminalEvidence"]
        if result.get("status") == "succeeded":
            expected_live = terminal["nativeUndoCheckpoint"][
                "finalSceneFingerprintSha256"
            ]
            if entry.checkpoint_kind != "success" or entry.cursor != 8:
                raise RuntimeError("Menu-control success checkpoint is not at its locked stage")
        elif result.get("status") == "failed_checkpointed":
            expected_live = terminal["checkpoint"]["currentSceneFingerprintSha256"]
            if entry.checkpoint_kind != "failure" or entry.cursor is not None:
                raise RuntimeError("Menu-control failure checkpoint state changed")
        else:
            raise ValueError("Menu-control terminal outbox is not reconcilable")
        current_fingerprint = _live_scene_fingerprint(scene)
        if current_fingerprint != expected_live:
            raise RuntimeError("Menu-control terminal live Scene no longer matches its checkpoint")
        occurred_at = _utc_now()
        if datetime.fromisoformat(occurred_at.replace("Z", "+00:00")) < datetime.fromisoformat(
            str(delivery.get("recoveryRequestedAt")).replace("Z", "+00:00")
        ):
            raise RuntimeError("Menu-control reconciliation local clock predates its challenge")
        return {
            "kind": "native_terminal_reconcile",
            "recoveryId": _require_uuid(delivery.get("recoveryId"), "recoveryId"),
            "result": result,
            "terminalResultContentSha256": entry.terminal_result_content_sha256,
            "expectedMarkerContentSha256": marker["terminalMarkerContentSha256"],
            "currentSceneFingerprintSha256": current_fingerprint,
            "occurredAt": occurred_at,
        }

    def acknowledge_terminal_result(
        self,
        result_content_sha256: str,
    ) -> bool:
        entry = self._current
        if entry is None:
            return False
        digest = _require_sha256(result_content_sha256, "terminal acknowledgement")
        if digest != entry.terminal_result_content_sha256:
            return False
        owner = self._owner_scene(entry)
        if owner is None or getattr(bpy.context, "scene", None) is not owner:
            self._lock_recovery("terminal acknowledgement owner Scene is unavailable")
            return False
        if entry.acknowledged_terminal_result_content_sha256 is not None:
            return True
        updated = replace(
            entry,
            acknowledged_terminal_result_content_sha256=digest,
        )
        try:
            self._write_marker(owner, updated)
        except Exception as error:
            self._lock_recovery(f"terminal acknowledgement could not persist: {error}")
            return False
        self._current = updated
        self._entries[-1] = updated
        return True

    def pending_terminal_result(self) -> dict[str, object] | None:
        entry = self._current
        if (
            entry is None
            or entry.acknowledged_terminal_result_content_sha256 is not None
        ):
            return None
        return deepcopy(entry.terminal_result)

    def has_transition_outbox(self) -> bool:
        return bool(self._current and self._current.transition_results) or bool(self._orphan_marker and self._orphan_marker.get("transitionResults"))

    def confirm_restored(self) -> bool:
        entry = self._current
        owner = None if entry is None else self._owner_scene(entry)
        if (
            entry is None
            or owner is None
            or getattr(bpy.context, "scene", None) is not owner
            or entry.cursor != 0
            or _live_scene_fingerprint(owner) != entry.stage_fingerprints[0]
        ):
            self._lock_recovery("explicit restore did not prove the baseline")
            return False
        self._locked = False
        self._status = "restored"
        self.error = ""
        return True

    def supersede_restored(
        self,
        scene: Any,
        *,
        invalidate_redo: Callable[[], bool],
    ) -> bool:
        """Retire an acknowledged baseline marker behind a native Redo barrier."""

        if not self._registered:
            raise RuntimeError("Menu-control history is not registered")
        if not callable(invalidate_redo):
            raise TypeError("Menu-control native Redo invalidator must be callable")
        self._require_context_scene(scene)
        entry = self._current
        if entry is None:
            if self._read_marker(scene) is None:
                return False
            raise RuntimeError("Menu-control history marker requires explicit recovery")
        owner = self._owner_scene(entry)
        if (
            owner is not scene
            or entry.cursor != 0
            or self._locked
            or entry.transition_results
            or entry.acknowledged_terminal_result_content_sha256
            != entry.terminal_result_content_sha256
            or _live_scene_fingerprint(scene) != entry.stage_fingerprints[0]
        ):
            raise RuntimeError(
                "Menu-control history is not an acknowledged restored baseline"
            )
        marker = self._read_marker(scene)
        if marker is None or marker != self._marker_payload(entry):
            raise RuntimeError("Menu-control restored marker changed before supersession")
        serialized = scene.get(MENU_CONTROL_HISTORY_MARKER_KEY)
        invalidation_error: Exception | None = None
        try:
            scene.pop(MENU_CONTROL_HISTORY_MARKER_KEY, None)
            if self._read_marker(scene) is not None:
                raise RuntimeError("Menu-control restored marker was not removed")
            if invalidate_redo() is not True:
                raise RuntimeError("Menu-control native Redo was not invalidated")
            if self._read_marker(scene) is not None:
                raise RuntimeError(
                    "Menu-control restored marker changed during Redo invalidation"
                )
            if _live_scene_fingerprint(scene) != entry.stage_fingerprints[0]:
                raise RuntimeError(
                    "Menu-control baseline changed during Redo invalidation"
                )
        except Exception as error:
            invalidation_error = error
        if invalidation_error is not None:
            try:
                if serialized is not None:
                    scene[MENU_CONTROL_HISTORY_MARKER_KEY] = serialized
                if self._read_marker(scene) != marker:
                    raise RuntimeError(
                        "Menu-control restored marker rollback did not round-trip"
                    )
            except Exception as rollback_error:
                self._lock_recovery(
                    "native Redo invalidation failed and marker rollback failed"
                )
                raise RuntimeError(
                    "Menu-control restored marker rollback failed"
                ) from rollback_error
            raise RuntimeError(
                "Menu-control native Redo invalidation failed"
            ) from invalidation_error
        self._current = None
        self._orphan_marker = None
        self._locked = False
        self._status = "superseded"
        self.error = ""
        return True

    def abandon(self) -> bool:
        if self._current is None and self._orphan_marker is None:
            return False
        self._current = None
        self._lock_recovery("history ownership was abandoned; explicit rebind is required")
        return True

    def current_checkpoint(self) -> dict[str, object] | None:
        entry = self._current
        if entry is None:
            return None
        checkpoint = {
            "formatVersion": _MARKER_FORMAT_VERSION,
            "executorId": EXECUTOR_ID,
            "checkpointId": entry.checkpoint_id,
            "previousCheckpointId": entry.previous_checkpoint_id,
            "undoLockId": entry.undo_lock_id,
            "proofId": entry.proof_id,
            "replayId": entry.replay_id,
            "targetId": entry.target_id,
            "checkpointKind": entry.checkpoint_kind,
            "cursor": entry.cursor,
            "stage": None if entry.cursor is None else STAGE_LABELS[entry.cursor],
            "stageFingerprints": list(entry.stage_fingerprints),
            "mutationLocked": self._locked,
            "terminalResultContentSha256": entry.terminal_result_content_sha256,
            "acknowledgedTerminalResultContentSha256": (
                entry.acknowledged_terminal_result_content_sha256
            ),
            "transitionResultContentSha256s": list(entry.transition_result_content_sha256s),
            "committedAt": entry.armed_at,
        }
        checkpoint["checkpointContentSha256"] = _canonical_sha256(
            {
                "formatVersion": checkpoint["formatVersion"],
                "executorId": checkpoint["executorId"],
                "checkpointId": checkpoint["checkpointId"],
                "undoLockId": checkpoint["undoLockId"],
                "proofId": checkpoint["proofId"],
                "replayId": checkpoint["replayId"],
                "targetId": checkpoint["targetId"],
                "checkpointKind": checkpoint["checkpointKind"],
                "stageFingerprints": checkpoint["stageFingerprints"],
                "terminalResultContentSha256": checkpoint[
                    "terminalResultContentSha256"
                ],
            }
        )
        return checkpoint


@persistent
def _menu_control_undo_post(_unused: Any) -> None:
    for controller in tuple(_REGISTERED_CONTROLLERS):
        controller.sync("undo")


@persistent
def _menu_control_redo_post(_unused: Any) -> None:
    for controller in tuple(_REGISTERED_CONTROLLERS):
        controller.sync("redo")


@persistent
def _menu_control_load_post(_unused: Any) -> None:
    for controller in tuple(_REGISTERED_CONTROLLERS):
        controller.loaded_file()
