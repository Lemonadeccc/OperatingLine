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
    transition_result_content_sha256s: tuple[str, ...] = ()
    transition_results: tuple[dict[str, object], ...] = ()


_REGISTERED_CONTROLLERS: set["MenuControlHistoryController"] = set()


class MenuControlHistoryController:
    """Track adjacent native history stages without mutating Blender data."""

    def __init__(self, authority_gate: HmacRebindAuthorityGate | None = None) -> None:
        if authority_gate is not None and not isinstance(
            authority_gate, HmacRebindAuthorityGate
        ):
            raise TypeError("Menu-control history authority gate is invalid")
        self._authority_gate = authority_gate
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
        marker["checkpointContentSha256"] = _canonical_sha256(
            cls._checkpoint_identity_from_marker(marker)
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
        terminal = marker.get("terminalResult")
        terminal_hash = _require_sha256(marker.get("terminalResultContentSha256"), "terminal result")
        if not isinstance(terminal, dict) or _canonical_sha256(terminal) != terminal_hash:
            raise RuntimeError("Menu-control history terminal outbox is invalid")
        terminal_evidence = terminal.get("terminalEvidence")
        expected_terminal_status = (
            "succeeded" if marker["checkpointKind"] == "success" else "failed_checkpointed"
        )
        if (
            terminal.get("proofId") != marker["proofId"]
            or terminal.get("replayId") != marker["replayId"]
            or terminal.get("status") != expected_terminal_status
            or not isinstance(terminal_evidence, Mapping)
            or terminal_evidence.get("checkpointId") != marker["checkpointId"]
            or terminal_evidence.get("undoLockId") != marker["undoLockId"]
        ):
            raise RuntimeError("Menu-control history terminal outbox identity is invalid")
        checkpoint_hash = _require_sha256(
            marker.get("checkpointContentSha256"), "checkpoint content"
        )
        if checkpoint_hash != _canonical_sha256(cls._checkpoint_identity_from_marker(marker)):
            raise RuntimeError("Menu-control history checkpoint content hash is invalid")
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
            if (
                not isinstance(from_cursor, int)
                or isinstance(from_cursor, bool)
                or not isinstance(to_cursor, int)
                or isinstance(to_cursor, bool)
                or from_cursor not in range(9)
                or to_cursor not in range(9)
                or to_cursor != expected_to_cursor
                or to_cursor - from_cursor != (-1 if direction == "undo" else 1)
                or direction not in {"undo", "redo"}
                or result.get("checkpointId") != marker["checkpointId"]
                or result.get("undoLockId") != marker["undoLockId"]
                or result.get("stage") != STAGE_LABELS[to_cursor]
                or result.get("status")
                != ("restored" if to_cursor == 0 else "history_locked")
                or result.get("sceneFingerprintSha256") != fingerprints[to_cursor]
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

    def register(self) -> None:
        if self._registered:
            return
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
        if (
            result.get("proofId") != entry.proof_id
            or result.get("replayId") != entry.replay_id
            or result.get("status") != expected_status
            or not isinstance(terminal, Mapping)
            or terminal.get("checkpointId") != entry.checkpoint_id
            or terminal.get("undoLockId") != entry.undo_lock_id
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
        if entry is None or entry.cursor is None:
            self._lock_recovery("native history has no rebound exact cursor")
            return
        self._handling = True
        try:
            expected_cursor = entry.cursor + (-1 if direction == "undo" else 1)
            if expected_cursor not in range(9):
                self._lock_recovery(f"native {direction} crossed the proven history boundary")
                return
            owner = self._owner_scene(entry)
            if owner is None or getattr(bpy.context, "scene", None) is not owner:
                self._lock_recovery("history owner is not the current Scene")
                return
            live = _live_scene_fingerprint(owner)
            if live != entry.stage_fingerprints[expected_cursor]:
                self._lock_recovery(f"native {direction} did not move exactly one stage")
                return
            transition = {
                "transitionId": str(uuid.uuid4()),
                "checkpointId": entry.checkpoint_id,
                "undoLockId": entry.undo_lock_id,
                "direction": direction,
                "fromCursor": entry.cursor,
                "toCursor": expected_cursor,
                "stage": STAGE_LABELS[expected_cursor],
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
            if live == marker["stageFingerprints"][0]:
                cursor = 0
            elif live != marker["stageFingerprints"][1]:
                self._lock_recovery("failure marker matches neither baseline nor checkpoint")
                raise ValueError("Menu-control orphan failure marker live stage is invalid")
        elif not isinstance(cursor, int) or live != marker["stageFingerprints"][cursor]:
            self._lock_recovery("orphan marker does not match the live Scene")
            raise ValueError("Menu-control orphan marker live stage is invalid")
        entry = MenuControlHistoryEntry(
            checkpoint_id=str(marker["checkpointId"]), previous_checkpoint_id=None,
            undo_lock_id=str(marker["undoLockId"]), proof_id=str(marker["proofId"]), replay_id=str(marker["replayId"]),
            target_id=str(marker["targetId"]), owner_scene_uid=int(scene.session_uid), checkpoint_kind=str(marker["checkpointKind"]),
            stage_fingerprints=tuple(str(value) for value in marker["stageFingerprints"]), cursor=cursor, armed_at=_utc_now(),
            terminal_result_content_sha256=str(marker["terminalResultContentSha256"]), terminal_result=deepcopy(marker["terminalResult"]),
            transition_result_content_sha256s=tuple(str(value) for value in marker["transitionResultContentSha256s"]),
            transition_results=tuple(deepcopy(item) for item in marker["transitionResults"]),
        )
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

    def has_transition_outbox(self) -> bool:
        return bool(self._current and self._current.transition_results) or bool(self._orphan_marker and self._orphan_marker.get("transitionResults"))

    def confirm_restored(self) -> bool:
        entry = self._current
        owner = None if entry is None else self._owner_scene(entry)
        if (
            entry is None
            or owner is None
            or getattr(bpy.context, "scene", None) is not owner
            or _live_scene_fingerprint(owner) != entry.stage_fingerprints[0]
        ):
            self._lock_recovery("explicit restore did not prove the baseline")
            return False
        updated = replace(entry, cursor=0)
        self._write_marker(owner, updated)
        self._current = updated
        self._entries[-1] = updated
        self._locked = False
        self._status = "restored"
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
