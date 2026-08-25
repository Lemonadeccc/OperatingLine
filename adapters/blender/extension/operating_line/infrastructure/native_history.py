"""Synchronize Blender native Undo/Redo with the in-memory guide session."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
from typing import Any
import uuid

import bpy
from bpy.app.handlers import persistent

from ..application import DemoSession, SessionSnapshot
from ..application.session import ArtifactIdentity
from .snowman_actions.common import (
    ensure_receipts_intact,
    rebind_receipts_after_native_restore,
)


NATIVE_HISTORY_MARKER_KEY = "_operating_line_native_history_v1"
NATIVE_HISTORY_RECOVERY_KEY = "_operating_line_native_history_recovery_v1"
POKE_COMPOUND_HISTORY_MARKER_KEY = "_operating_line_poke_compound_history_v1"
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_ARTIFACT_CACHE_BYTES = 256 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class NativeHistoryCheckpoint:
    """One session snapshot paired with Blender's matching Scene marker."""

    checkpoint_id: str | None
    previous_id: str | None
    operation: str
    snapshot: SessionSnapshot
    artifacts: tuple[ArtifactIdentity, ...]
    committed_at: str | None = None
    alternate_snapshots: tuple[SessionSnapshot, ...] = ()


@dataclass(frozen=True, slots=True)
class NativeHistoryRestore:
    """A completed host-history transition for UI and companion reporting."""

    direction: str
    source_operation: str
    target_operation: str
    before: SessionSnapshot
    after: SessionSnapshot


@dataclass(frozen=True, slots=True)
class NativeUndoRestorationWitness:
    """One-shot in-process proof that the guarded native Undo fully restored."""

    direction: str
    source_checkpoint_id: str | None
    restored_checkpoint_id: str | None
    recovery_token_sha256: str
    restored_at: str
    recovery_probe_satisfied: bool


@dataclass(frozen=True, slots=True)
class NativeUndoRecoveryGuard:
    """Hashed identity of the exact guarded checkpoint that Undo must restore."""

    expected_restored_checkpoint_id: str | None
    recovery_token_sha256: str


class NativeUndoRequiredError(RuntimeError):
    """A native commit recovery that only a proven Blender Undo may release."""


@dataclass(frozen=True, slots=True)
class NativeHistoryRecovery:
    """A narrowly validated replacement snapshot produced by trusted replay."""

    snapshot: SessionSnapshot
    recovery_probe: Callable[[], bool]


@dataclass(frozen=True, slots=True)
class PokeCompoundHistoryState:
    """Protocol-compatible persisted current state plus the host-only leaf journal."""

    compound_id: str
    replay_id: str
    compound_content_sha256: str
    plan_content_sha256: str
    target_adapter_id: str
    target_instance_id: str
    action_catalog_version: str
    interaction_catalog_version: str
    recipe_kind: str
    lock_token_sha256: str
    blender_process_identity_sha256: str
    blender_session_uid: str
    document_fingerprint_sha256: str
    native_history_marker_sha256: str
    object_identity_sha256: str
    mesh_identity_sha256: str
    object_pointer_sha256: str
    mesh_pointer_sha256: str
    mesh_datablock_sha256: str
    topology_sha256: str
    selection_sha256: str
    history_head_sha256: str
    state_sha256: str
    integrity_sha256: str
    marker_integrity_sha256: str
    recorded_object_baseline_json: str
    recorded_object_baseline_sha256: str
    status: str
    lifecycle_state: str
    mode: str
    history_lock: str = "held"
    history_continuity: str = "same_live_session"
    native_history_loss_recorded: bool = False
    in_progress_leaf_id: str | None = None
    permitted_history_transitions: tuple[str, ...] = ()
    leaf_intents: tuple[str, ...] = ()
    leaf_receipts: tuple[str, ...] = ()
    native_history_operation_count: int = 0
    checkpoint_sha256: str | None = None
    consumed_decision_keys: tuple[str, ...] = ()
    decision_consumption_sha256s: tuple[str, ...] = ()


class PokeCompoundHistoryLock:
    """Fail-closed durable lock for Forward/Back/Redo Poke recipes.

    The Scene marker survives an orchestrator/controller rebuild while the same Blender process,
    document, session uid, pointers, and native history head remain live. File load, process loss,
    or a missing marker is never repaired from a snapshot.
    """

    _TERMINAL_BY_RECIPE = {
        "forward": "forward_applied_locked",
        "back": "restored_locked",
        "redo": "reapplied_locked",
    }

    _PERMITTED_BY_STATUS = {
        "intent_recorded": (),
        "recovery_required": (),
        "forward_applied_locked": ("back", "unlock_final"),
        "restored_locked": ("redo", "abandon_baseline"),
        "reapplied_locked": ("back", "unlock_final"),
        "history_conflict": (),
        "history_lost": ("abandon_baseline",),
        "quarantined": (),
        "unlocked_final": (),
        "abandoned_baseline": (),
    }

    @staticmethod
    def _canonical(value: object) -> bytes:
        if value is None:
            return b"n"
        if value is False:
            return b"f"
        if value is True:
            return b"t"
        if isinstance(value, str):
            encoded = value.encode("utf-8")
            return f"s{len(encoded)}:".encode() + encoded
        if isinstance(value, (int, float)):
            return b"d" + struct.pack(">d", float(value)).hex().encode("ascii")
        if isinstance(value, (list, tuple)):
            encoded_items = [PokeCompoundHistoryLock._canonical(item) for item in value]
            return f"a{len(encoded_items)}:".encode() + b"".join(
                f"{len(item)}:".encode() + item for item in encoded_items
            )
        if isinstance(value, Mapping):
            entries = sorted(value.items(), key=lambda item: item[0].encode("utf-8"))
            output = [f"o{len(entries)}:".encode()]
            for key, item_value in entries:
                encoded_key = PokeCompoundHistoryLock._canonical(str(key))
                encoded_value = PokeCompoundHistoryLock._canonical(item_value)
                output.extend(
                    (
                        f"{len(encoded_key)}:".encode(),
                        encoded_key,
                        f"{len(encoded_value)}:".encode(),
                        encoded_value,
                    )
                )
            return b"".join(output)
        raise TypeError("Poke compound marker contains a non-JSON value")

    @staticmethod
    def _domain_hash(domain: str, payload: object) -> str:
        return hashlib.sha256(
            PokeCompoundHistoryLock._canonical({"domain": domain, "payload": payload})
        ).hexdigest()

    @staticmethod
    def current_state(state: PokeCompoundHistoryState) -> dict[str, object]:
        return {
            "compoundId": state.compound_id,
            "replayId": state.replay_id,
            "compoundContentSha256": state.compound_content_sha256,
            "historyLockTokenSha256": state.lock_token_sha256,
            "blenderProcessIdentitySha256": state.blender_process_identity_sha256,
            "blenderSessionUid": state.blender_session_uid,
            "documentFingerprintSha256": state.document_fingerprint_sha256,
            "nativeHistoryMarkerSha256": state.native_history_marker_sha256,
            "historyHeadSha256": state.history_head_sha256,
            "objectIdentitySha256": state.object_identity_sha256,
            "meshIdentitySha256": state.mesh_identity_sha256,
            "objectPointerSha256": state.object_pointer_sha256,
            "meshPointerSha256": state.mesh_pointer_sha256,
            "meshDatablockSha256": state.mesh_datablock_sha256,
            "topologySha256": state.topology_sha256,
            "selectionSha256": state.selection_sha256,
            "stateSha256": state.state_sha256,
            "integritySha256": state.integrity_sha256,
            "status": state.status,
            "lifecycleState": state.lifecycle_state,
            "mode": state.mode,
            "historyLock": state.history_lock,
            "historyContinuity": state.history_continuity,
            "nativeHistoryLossRecorded": state.native_history_loss_recorded,
            "inProgressLeafId": state.in_progress_leaf_id,
            "permittedHistoryTransitions": list(state.permitted_history_transitions),
        }

    @classmethod
    def seal(cls, state: PokeCompoundHistoryState) -> PokeCompoundHistoryState:
        payload = cls.current_state(state)
        payload.pop("integritySha256")
        current_sealed = replace(
            state,
            integrity_sha256=cls._domain_hash(
                "operatingline.procedure-compound.current-state.v1", payload
            ),
        )
        marker_candidate = replace(current_sealed, marker_integrity_sha256="0" * 64)
        return replace(
            current_sealed,
            marker_integrity_sha256=hashlib.sha256(
                cls._encode(marker_candidate).encode("utf-8")
            ).hexdigest(),
        )

    @classmethod
    def _replace(cls, state: PokeCompoundHistoryState, **changes: object) -> PokeCompoundHistoryState:
        return cls.seal(replace(state, **changes))

    @classmethod
    def _validate_state(cls, state: PokeCompoundHistoryState) -> None:
        sealed = cls.seal(state)
        if state.integrity_sha256 != sealed.integrity_sha256:
            raise RuntimeError("Poke compound current-state integrity is invalid")
        if state.marker_integrity_sha256 != sealed.marker_integrity_sha256:
            raise RuntimeError("Poke compound full-marker integrity is invalid")
        try:
            baseline = json.loads(state.recorded_object_baseline_json)
        except json.JSONDecodeError as error:
            raise RuntimeError("Poke compound recorded baseline is invalid") from error
        if (
            not isinstance(baseline, dict)
            or cls._domain_hash(
                "operatingline.procedure-compound.recorded-object-baseline.v1",
                baseline,
            )
            != state.recorded_object_baseline_sha256
        ):
            raise RuntimeError("Poke compound recorded baseline integrity is invalid")
        hashes = (
            *state.leaf_intents,
            *state.leaf_receipts,
            *state.consumed_decision_keys,
            *state.decision_consumption_sha256s,
        )
        if any(
            len(value) != 64
            or any(character not in "0123456789abcdef" for character in value)
            for value in hashes
        ):
            raise RuntimeError("Poke compound journal contains an invalid evidence hash")
        if len(state.consumed_decision_keys) != len(state.decision_consumption_sha256s):
            raise RuntimeError("Poke compound decision-consumption journal is incomplete")
        if len(state.leaf_receipts) >= 2 and state.checkpoint_sha256 is None:
            raise RuntimeError("Poke compound middle receipt requires a native checkpoint")
        if state.status == cls._TERMINAL_BY_RECIPE.get(state.recipe_kind) and (
            len(state.leaf_intents) != 3
            or len(state.leaf_receipts) != 3
            or state.checkpoint_sha256 is None
        ):
            raise RuntimeError("Poke compound terminal proof journal is incomplete")
        if state.permitted_history_transitions != cls._PERMITTED_BY_STATUS.get(state.status, ()):
            raise RuntimeError("Poke compound permitted transitions do not match status")

    @staticmethod
    def _consume_decision(
        state: PokeCompoundHistoryState,
        evidence: Mapping[str, object],
        expected_kind: str,
        expected_transition: str,
    ) -> PokeCompoundHistoryState:
        if frozenset(evidence) != {"receipt", "binding", "consumption"}:
            raise RuntimeError("Poke compound transition decision is invalid")
        receipt = evidence.get("receipt")
        binding = evidence.get("binding")
        consumption_event = evidence.get("consumption")
        if not all(isinstance(value, Mapping) for value in (receipt, binding, consumption_event)):
            raise RuntimeError("Poke compound transition decision evidence is invalid")
        assert isinstance(receipt, Mapping)
        assert isinstance(binding, Mapping)
        assert isinstance(consumption_event, Mapping)
        transition = "forward" if expected_kind == "BlenderExecutionDecisionReceipt" else receipt.get("transition")
        if receipt.get("kind") != expected_kind or transition != expected_transition:
            raise RuntimeError("Poke compound transition decision kind is invalid")
        common_receipt_keys = {
            "formatVersion",
            "decisionId",
            "nonce",
            "issuedAt",
            "expiresAt",
            "kind",
        }
        forward_receipt_keys = common_receipt_keys | {
            "acceptedContentSha256",
            "acceptedContentKind",
            "replayId",
            "target",
            "blenderSessionId",
            "documentFingerprintSha256",
            "actionCatalogVersion",
            "interactionCatalogVersion",
        }
        history_receipt_keys = common_receipt_keys | {
            "compoundId",
            "replayId",
            "target",
            "blenderProcessIdentitySha256",
            "blenderSessionUid",
            "documentFingerprintSha256",
            "compoundContentSha256",
            "historyLockTokenSha256",
            "currentStateSha256",
            "expectedHistoryHeadSha256",
            "transition",
            "expectedStatus",
            "terminalObservationSha256",
            "nativeHistoryLossRecorded",
            "actionCatalogVersion",
            "interactionCatalogVersion",
        }
        if (
            receipt.get("formatVersion") != "1.0.0"
            or frozenset(receipt)
            != (
                forward_receipt_keys
                if expected_kind == "BlenderExecutionDecisionReceipt"
                else history_receipt_keys
            )
            or frozenset(consumption_event)
            != {
                "formatVersion",
                "eventId",
                "sequence",
                "kind",
                "credentialId",
                "singleUseKeySha256",
                "operationId",
                "bindingSha256",
                "consumedAt",
            }
            or consumption_event.get("formatVersion") != "1.0.0"
        ):
            raise RuntimeError("Poke compound decision evidence shape is invalid")
        try:
            uuid.UUID(str(receipt["decisionId"]))
            uuid.UUID(str(consumption_event["eventId"]))
            uuid.UUID(str(consumption_event["operationId"]))
        except (KeyError, ValueError) as error:
            raise RuntimeError("Poke compound decision identity is invalid") from error
        nonce = receipt.get("nonce")
        if not isinstance(nonce, str) or not 16 <= len(nonce) <= 128:
            raise RuntimeError("Poke compound decision nonce is invalid")
        if expected_kind == "BlenderExecutionDecisionReceipt":
            expected_binding = {
                "acceptedContentSha256": state.plan_content_sha256,
                "acceptedContentKind": "plan",
                "replayId": state.replay_id,
                "adapterId": state.target_adapter_id,
                "instanceId": state.target_instance_id,
                "blenderSessionId": state.blender_session_uid,
                "documentFingerprintSha256": state.document_fingerprint_sha256,
                "actionCatalogVersion": state.action_catalog_version,
                "interactionCatalogVersion": state.interaction_catalog_version,
            }
            receipt_matches = all(
                receipt.get(key) == value for key, value in {
                    "acceptedContentSha256": state.plan_content_sha256,
                    "acceptedContentKind": "plan",
                    "replayId": state.replay_id,
                    "blenderSessionId": state.blender_session_uid,
                    "documentFingerprintSha256": state.document_fingerprint_sha256,
                    "actionCatalogVersion": state.action_catalog_version,
                    "interactionCatalogVersion": state.interaction_catalog_version,
                }.items()
            ) and receipt.get("target") == {
                "adapterId": state.target_adapter_id,
                "instanceId": state.target_instance_id,
            }
            expected_consumption_kind = "blender_decision_consumed"
        else:
            expected_binding = {
                "compoundId": state.compound_id,
                "replayId": state.replay_id,
                "adapterId": state.target_adapter_id,
                "instanceId": state.target_instance_id,
                "blenderProcessIdentitySha256": state.blender_process_identity_sha256,
                "blenderSessionUid": state.blender_session_uid,
                "documentFingerprintSha256": state.document_fingerprint_sha256,
                "compoundContentSha256": state.compound_content_sha256,
                "historyLockTokenSha256": state.lock_token_sha256,
                "currentStateSha256": state.integrity_sha256,
                "expectedHistoryHeadSha256": state.history_head_sha256,
                "transition": expected_transition,
                "expectedStatus": state.status,
                "terminalObservationSha256": receipt.get("terminalObservationSha256"),
                "nativeHistoryLossRecorded": state.native_history_loss_recorded,
                "actionCatalogVersion": state.action_catalog_version,
                "interactionCatalogVersion": state.interaction_catalog_version,
            }
            receipt_matches = all(
                receipt.get(key) == value
                for key, value in {
                    "compoundId": state.compound_id,
                    "replayId": state.replay_id,
                    "blenderProcessIdentitySha256": state.blender_process_identity_sha256,
                    "blenderSessionUid": state.blender_session_uid,
                    "documentFingerprintSha256": state.document_fingerprint_sha256,
                    "compoundContentSha256": state.compound_content_sha256,
                    "historyLockTokenSha256": state.lock_token_sha256,
                    "currentStateSha256": state.integrity_sha256,
                    "expectedHistoryHeadSha256": state.history_head_sha256,
                    "expectedStatus": state.status,
                    "nativeHistoryLossRecorded": state.native_history_loss_recorded,
                    "actionCatalogVersion": state.action_catalog_version,
                    "interactionCatalogVersion": state.interaction_catalog_version,
                }.items()
            ) and receipt.get("target") == {
                "adapterId": state.target_adapter_id,
                "instanceId": state.target_instance_id,
            }
            expected_consumption_kind = "blender_history_transition_consumed"
        if not receipt_matches or dict(binding) != expected_binding:
            raise RuntimeError("Poke compound decision binding does not match current state")
        try:
            issued_at = datetime.fromisoformat(str(receipt["issuedAt"]).replace("Z", "+00:00"))
            expires_at = datetime.fromisoformat(str(receipt["expiresAt"]).replace("Z", "+00:00"))
            consumed_at = datetime.fromisoformat(
                str(consumption_event["consumedAt"]).replace("Z", "+00:00")
            )
        except (KeyError, ValueError) as error:
            raise RuntimeError("Poke compound decision time evidence is invalid") from error
        if not issued_at <= consumed_at < expires_at:
            raise RuntimeError("Poke compound decision was consumed outside its validity window")
        if expires_at - issued_at > timedelta(minutes=15):
            raise RuntimeError("Poke compound decision validity exceeds fifteen minutes")
        key = hashlib.sha256(
            PokeCompoundHistoryLock._canonical({"nonce": receipt.get("nonce")})
        ).hexdigest()
        binding_sha256 = hashlib.sha256(
            PokeCompoundHistoryLock._canonical(
                {
                    "decisionSha256": hashlib.sha256(
                        PokeCompoundHistoryLock._canonical(receipt)
                    ).hexdigest(),
                    "binding": binding,
                }
            )
        ).hexdigest()
        if (
            consumption_event.get("kind") != expected_consumption_kind
            or consumption_event.get("credentialId") != receipt.get("decisionId")
            or consumption_event.get("singleUseKeySha256") != key
            or consumption_event.get("bindingSha256") != binding_sha256
        ):
            raise RuntimeError("Poke compound trusted consumption event is invalid")
        consumption = hashlib.sha256(
            PokeCompoundHistoryLock._canonical(consumption_event)
        ).hexdigest()
        if key in state.consumed_decision_keys:
            raise RuntimeError("Poke compound transition decision was already consumed")
        return PokeCompoundHistoryLock._replace(
            state,
            consumed_decision_keys=(*state.consumed_decision_keys, key),
            decision_consumption_sha256s=(
                *state.decision_consumption_sha256s,
                consumption,
            ),
        )

    @staticmethod
    def _encode(state: PokeCompoundHistoryState) -> str:
        return json.dumps(
            {
                "compoundId": state.compound_id,
                "replayId": state.replay_id,
                "compoundContentSha256": state.compound_content_sha256,
                "planContentSha256": state.plan_content_sha256,
                "targetAdapterId": state.target_adapter_id,
                "targetInstanceId": state.target_instance_id,
                "actionCatalogVersion": state.action_catalog_version,
                "interactionCatalogVersion": state.interaction_catalog_version,
                "recipeKind": state.recipe_kind,
                "lockTokenSha256": state.lock_token_sha256,
                "blenderProcessIdentitySha256": state.blender_process_identity_sha256,
                "blenderSessionUid": state.blender_session_uid,
                "documentFingerprintSha256": state.document_fingerprint_sha256,
                "nativeHistoryMarkerSha256": state.native_history_marker_sha256,
                "objectIdentitySha256": state.object_identity_sha256,
                "meshIdentitySha256": state.mesh_identity_sha256,
                "objectPointerSha256": state.object_pointer_sha256,
                "meshPointerSha256": state.mesh_pointer_sha256,
                "meshDatablockSha256": state.mesh_datablock_sha256,
                "topologySha256": state.topology_sha256,
                "selectionSha256": state.selection_sha256,
                "historyHeadSha256": state.history_head_sha256,
                "stateSha256": state.state_sha256,
                "integritySha256": state.integrity_sha256,
                "markerIntegritySha256": state.marker_integrity_sha256,
                "recordedObjectBaselineJson": state.recorded_object_baseline_json,
                "recordedObjectBaselineSha256": state.recorded_object_baseline_sha256,
                "status": state.status,
                "lifecycleState": state.lifecycle_state,
                "mode": state.mode,
                "historyLock": state.history_lock,
                "historyContinuity": state.history_continuity,
                "nativeHistoryLossRecorded": state.native_history_loss_recorded,
                "inProgressLeafId": state.in_progress_leaf_id,
                "permittedHistoryTransitions": list(state.permitted_history_transitions),
                "leafIntents": list(state.leaf_intents),
                "leafReceipts": list(state.leaf_receipts),
                "nativeHistoryOperationCount": state.native_history_operation_count,
                "checkpointSha256": state.checkpoint_sha256,
                "consumedDecisionKeys": list(state.consumed_decision_keys),
                "decisionConsumptionSha256s": list(state.decision_consumption_sha256s),
            },
            separators=(",", ":"),
            sort_keys=True,
        )

    @staticmethod
    def _decode(value: object) -> PokeCompoundHistoryState:
        if not isinstance(value, str) or not value:
            raise RuntimeError("Poke compound native history marker is missing")
        payload = json.loads(value)
        if not isinstance(payload, dict):
            raise RuntimeError("Poke compound native history marker is invalid")
        try:
            state = PokeCompoundHistoryState(
                compound_id=str(payload["compoundId"]),
                replay_id=str(payload["replayId"]),
                compound_content_sha256=str(payload["compoundContentSha256"]),
                plan_content_sha256=str(payload["planContentSha256"]),
                target_adapter_id=str(payload["targetAdapterId"]),
                target_instance_id=str(payload["targetInstanceId"]),
                action_catalog_version=str(payload["actionCatalogVersion"]),
                interaction_catalog_version=str(payload["interactionCatalogVersion"]),
                recipe_kind=str(payload["recipeKind"]),
                lock_token_sha256=str(payload["lockTokenSha256"]),
                blender_process_identity_sha256=str(
                    payload["blenderProcessIdentitySha256"]
                ),
                blender_session_uid=str(payload["blenderSessionUid"]),
                document_fingerprint_sha256=str(
                    payload["documentFingerprintSha256"]
                ),
                native_history_marker_sha256=str(payload["nativeHistoryMarkerSha256"]),
                object_identity_sha256=str(payload["objectIdentitySha256"]),
                mesh_identity_sha256=str(payload["meshIdentitySha256"]),
                object_pointer_sha256=str(payload["objectPointerSha256"]),
                mesh_pointer_sha256=str(payload["meshPointerSha256"]),
                mesh_datablock_sha256=str(payload["meshDatablockSha256"]),
                topology_sha256=str(payload["topologySha256"]),
                selection_sha256=str(payload["selectionSha256"]),
                history_head_sha256=str(payload["historyHeadSha256"]),
                state_sha256=str(payload["stateSha256"]),
                integrity_sha256=str(payload["integritySha256"]),
                marker_integrity_sha256=str(payload["markerIntegritySha256"]),
                recorded_object_baseline_json=str(payload["recordedObjectBaselineJson"]),
                recorded_object_baseline_sha256=str(payload["recordedObjectBaselineSha256"]),
                status=str(payload["status"]),
                lifecycle_state=str(payload["lifecycleState"]),
                mode=str(payload["mode"]),
                history_lock=str(payload["historyLock"]),
                history_continuity=str(payload["historyContinuity"]),
                native_history_loss_recorded=bool(payload["nativeHistoryLossRecorded"]),
                in_progress_leaf_id=(
                    None if payload["inProgressLeafId"] is None else str(payload["inProgressLeafId"])
                ),
                permitted_history_transitions=tuple(
                    str(item) for item in payload["permittedHistoryTransitions"]
                ),
                leaf_intents=tuple(str(item) for item in payload["leafIntents"]),
                leaf_receipts=tuple(str(item) for item in payload["leafReceipts"]),
                native_history_operation_count=int(
                    payload["nativeHistoryOperationCount"]
                ),
                checkpoint_sha256=(
                    None if payload["checkpointSha256"] is None else str(payload["checkpointSha256"])
                ),
                consumed_decision_keys=tuple(str(item) for item in payload["consumedDecisionKeys"]),
                decision_consumption_sha256s=tuple(
                    str(item) for item in payload["decisionConsumptionSha256s"]
                ),
            )
        except (KeyError, TypeError, ValueError) as error:
            raise RuntimeError("Poke compound native history marker is invalid") from error
        if len(state.leaf_receipts) > len(state.leaf_intents):
            raise RuntimeError("Poke compound leaf journal is out of order")
        PokeCompoundHistoryLock._validate_state(state)
        return state

    @staticmethod
    def _write(scene: bpy.types.Scene, state: PokeCompoundHistoryState) -> None:
        PokeCompoundHistoryLock._validate_state(state)
        scene[POKE_COMPOUND_HISTORY_MARKER_KEY] = PokeCompoundHistoryLock._encode(
            state
        )

    def acquire(
        self,
        scene: bpy.types.Scene,
        state: PokeCompoundHistoryState,
        decision: Mapping[str, object],
    ) -> None:
        if POKE_COMPOUND_HISTORY_MARKER_KEY in scene:
            raise RuntimeError("A Poke compound native history lock is already held")
        if (
            state.recipe_kind != "forward"
            or state.status != "intent_recorded"
            or state.leaf_intents
            or state.leaf_receipts
        ):
            raise RuntimeError("Poke compound Forward must acquire before Enter Edit")
        self._validate_state(state)
        consumed = self._consume_decision(
            state, decision, "BlenderExecutionDecisionReceipt", "forward"
        )
        self._write(scene, consumed)

    def read(self, scene: bpy.types.Scene) -> PokeCompoundHistoryState:
        return self._decode(scene.get(POKE_COMPOUND_HISTORY_MARKER_KEY))

    def reconcile(
        self,
        scene: bpy.types.Scene,
        observed: Mapping[str, object] | None,
    ) -> str:
        try:
            state = self.read(scene)
        except (RuntimeError, json.JSONDecodeError):
            return "history_lost"
        if observed is None or any(
            observed.get(key) is None
            for key in (
                "blenderProcessIdentitySha256",
                "blenderSessionUid",
                "nativeHistoryMarkerSha256",
            )
        ):
            return "history_lost"
        if (
            observed.get("blenderProcessIdentitySha256")
            != state.blender_process_identity_sha256
            or observed.get("blenderSessionUid") != state.blender_session_uid
            or observed.get("nativeHistoryMarkerSha256")
            != state.native_history_marker_sha256
        ):
            return "history_lost"
        expected = {
            "compoundId": state.compound_id,
            "replayId": state.replay_id,
            "compoundContentSha256": state.compound_content_sha256,
            "historyLockTokenSha256": state.lock_token_sha256,
            "blenderProcessIdentitySha256": state.blender_process_identity_sha256,
            "blenderSessionUid": state.blender_session_uid,
            "documentFingerprintSha256": state.document_fingerprint_sha256,
            "nativeHistoryMarkerSha256": state.native_history_marker_sha256,
            "historyHeadSha256": state.history_head_sha256,
            "objectIdentitySha256": state.object_identity_sha256,
            "meshIdentitySha256": state.mesh_identity_sha256,
            "objectPointerSha256": state.object_pointer_sha256,
            "meshPointerSha256": state.mesh_pointer_sha256,
            "meshDatablockSha256": state.mesh_datablock_sha256,
            "topologySha256": state.topology_sha256,
            "selectionSha256": state.selection_sha256,
            "stateSha256": state.state_sha256,
            "integritySha256": state.integrity_sha256,
            "status": state.status,
            "lifecycleState": state.lifecycle_state,
            "mode": state.mode,
            "historyLock": state.history_lock,
            "historyContinuity": state.history_continuity,
            "nativeHistoryLossRecorded": state.native_history_loss_recorded,
            "inProgressLeafId": state.in_progress_leaf_id,
            "permittedHistoryTransitions": list(state.permitted_history_transitions),
        }
        return (
            "same_live_session"
            if all(observed.get(key) == value for key, value in expected.items())
            else "history_conflict"
        )

    def reconcile_and_quarantine(
        self,
        scene: bpy.types.Scene,
        observed: Mapping[str, object] | None,
    ) -> str:
        classification = self.reconcile(scene, observed)
        if classification == "same_live_session":
            return classification
        try:
            state = self.read(scene)
        except (RuntimeError, json.JSONDecodeError):
            return "history_lost"
        if classification == "history_lost":
            quarantined = self._replace(
                state,
                status="history_lost",
                lifecycle_state="unknown",
                mode="UNKNOWN",
                history_lock="quarantined",
                history_continuity="lost_permanently",
                native_history_loss_recorded=True,
                in_progress_leaf_id=None,
                permitted_history_transitions=("abandon_baseline",),
            )
        else:
            quarantined = self._replace(
                state,
                status="history_conflict",
                lifecycle_state="unknown",
                mode="UNKNOWN",
                history_lock="quarantined",
                in_progress_leaf_id=None,
                permitted_history_transitions=(),
            )
        self._write(scene, quarantined)
        return classification

    def record_leaf_intent(
        self,
        scene: bpy.types.Scene,
        leaf_id: str,
        intent_sha256: str,
    ) -> PokeCompoundHistoryState:
        state = self.read(scene)
        if len(state.leaf_intents) != len(state.leaf_receipts) or len(state.leaf_intents) >= 3:
            raise RuntimeError("Poke compound leaf intent is out of order")
        next_state = self._replace(
            state,
            status="recovery_required",
            lifecycle_state="unknown",
            mode="UNKNOWN",
            in_progress_leaf_id=leaf_id,
            permitted_history_transitions=(),
            leaf_intents=(*state.leaf_intents, intent_sha256),
            native_history_operation_count=0,
        )
        self._write(scene, next_state)
        return next_state

    def begin_recipe(
        self,
        scene: bpy.types.Scene,
        recipe_kind: str,
        decision: Mapping[str, object],
    ) -> PokeCompoundHistoryState:
        state = self.read(scene)
        allowed = (
            recipe_kind == "back"
            and state.status in {"forward_applied_locked", "reapplied_locked"}
        ) or (recipe_kind == "redo" and state.status == "restored_locked")
        if not allowed:
            raise RuntimeError("Poke compound history transition is not authorized")
        consumed = self._consume_decision(
            state,
            decision,
            "BlenderHistoryTransitionDecisionReceipt",
            recipe_kind,
        )
        next_state = self._replace(
            consumed,
            recipe_kind=recipe_kind,
            leaf_intents=(),
            leaf_receipts=(),
            native_history_operation_count=0,
            checkpoint_sha256=None,
        )
        self._write(scene, next_state)
        return next_state

    def record_native_history_operation(
        self,
        scene: bpy.types.Scene,
        direction: str,
    ) -> PokeCompoundHistoryState:
        state = self.read(scene)
        if len(state.leaf_intents) != 2 or len(state.leaf_receipts) != 1:
            raise RuntimeError("Native Undo/Redo is allowed only in the middle leaf")
        expected = {"back": "undo", "redo": "redo"}.get(state.recipe_kind)
        if direction != expected:
            raise RuntimeError("Native history direction is not authorized")
        count = state.native_history_operation_count + 1
        if count != 1:
            raise RuntimeError("Poke compound middle leaf requires exactly one native operation")
        next_state = self._replace(state, native_history_operation_count=count)
        self._write(scene, next_state)
        return next_state

    def record_leaf_receipt(
        self,
        scene: bpy.types.Scene,
        recipe_kind: str,
        receipt_sha256: str,
        *,
        mode: str,
        history_proof_attached: bool,
        native_history_operation_count: int,
        history_head_sha256: str,
        observed: Mapping[str, str],
        checkpoint_sha256: str | None = None,
    ) -> PokeCompoundHistoryState:
        state = self.read(scene)
        index = len(state.leaf_receipts)
        if len(state.leaf_intents) != index + 1 or index >= 3:
            raise RuntimeError("Poke compound leaf receipt is out of order")
        middle = index == 1
        expected_mode = "EDIT_MESH" if middle else ("EDIT_MESH" if index == 0 else "OBJECT")
        expected_count = 1 if middle and recipe_kind in {"back", "redo"} else 0
        if (
            recipe_kind != state.recipe_kind
            or mode != expected_mode
            or history_proof_attached is not middle
            or native_history_operation_count != expected_count
            or (middle and checkpoint_sha256 is None)
        ):
            raise RuntimeError("Poke compound proof is attached to the wrong leaf or mode")
        terminal = index == 2
        next_status = self._TERMINAL_BY_RECIPE[recipe_kind] if terminal else "recovery_required"
        next_state = self._replace(
            state,
            status=next_status,
            lifecycle_state=(
                "object_baseline"
                if next_status == "restored_locked"
                else "object_final"
                if terminal
                else "unknown"
            ),
            mode=mode if terminal else "UNKNOWN",
            in_progress_leaf_id=None if terminal else state.in_progress_leaf_id,
            permitted_history_transitions=self._PERMITTED_BY_STATUS[next_status],
            leaf_receipts=(*state.leaf_receipts, receipt_sha256),
            history_head_sha256=history_head_sha256,
            object_identity_sha256=observed["objectIdentitySha256"],
            mesh_identity_sha256=observed["meshIdentitySha256"],
            object_pointer_sha256=observed["objectPointerSha256"],
            mesh_pointer_sha256=observed["meshPointerSha256"],
            mesh_datablock_sha256=observed["meshDatablockSha256"],
            topology_sha256=observed["topologySha256"],
            selection_sha256=observed["selectionSha256"],
            state_sha256=observed["stateSha256"],
            checkpoint_sha256=(
                checkpoint_sha256
                if checkpoint_sha256 is not None
                else state.checkpoint_sha256
            ),
            native_history_operation_count=0,
        )
        self._write(scene, next_state)
        return next_state

    def release(
        self,
        scene: bpy.types.Scene,
        transition: str,
        decision: Mapping[str, object],
        observed: Mapping[str, object],
    ) -> dict[str, object]:
        state = self.read(scene)
        allowed = (
            transition == "unlock_final"
            and state.status in {"forward_applied_locked", "reapplied_locked"}
        ) or (
            transition == "abandon_baseline" and state.status == "restored_locked"
        ) or (
            transition == "abandon_baseline" and state.status == "history_lost"
        )
        lost_abandon = state.status == "history_lost"
        if not allowed or (
            not lost_abandon
            and (
                len(state.leaf_receipts) != 3
                or state.checkpoint_sha256 is None
                or state.in_progress_leaf_id is not None
            )
        ):
            raise RuntimeError("Poke compound history lock cannot be released")
        if lost_abandon:
            baseline = json.loads(state.recorded_object_baseline_json)
            if not isinstance(baseline, dict) or any(
                observed.get(key) != value for key, value in baseline.items()
            ):
                raise RuntimeError(
                    "Poke compound history loss requires a fresh exact baseline observation"
                )
        elif self.reconcile(scene, observed) != "same_live_session":
            raise RuntimeError("Poke compound terminal state is not exactly reconciled")
        consumed = self._consume_decision(
            state,
            decision,
            "BlenderHistoryTransitionDecisionReceipt",
            transition,
        )
        terminal = self._replace(
            consumed,
            status="unlocked_final" if transition == "unlock_final" else "abandoned_baseline",
            lifecycle_state=(
                "object_final" if transition == "unlock_final" else "object_baseline"
            ),
            mode="OBJECT",
            history_lock="released",
            permitted_history_transitions=(),
            object_identity_sha256=str(observed["objectIdentitySha256"]),
            mesh_identity_sha256=str(observed["meshIdentitySha256"]),
            object_pointer_sha256=str(observed["objectPointerSha256"]),
            mesh_pointer_sha256=str(observed["meshPointerSha256"]),
            mesh_datablock_sha256=str(observed["meshDatablockSha256"]),
            topology_sha256=str(observed["topologySha256"]),
            selection_sha256=str(observed["selectionSha256"]),
            state_sha256=str(observed["stateSha256"]),
            history_head_sha256=str(observed["historyHeadSha256"]),
        )
        terminal_state = self.current_state(terminal)
        del scene[POKE_COMPOUND_HISTORY_MARKER_KEY]
        return terminal_state


SessionProvider = Callable[[], DemoSession]
RestoreCallback = Callable[[NativeHistoryRestore], None]
ResetCallback = Callable[[], None]


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _read_bounded(path: Path) -> bytes:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise RuntimeError(f"Cannot inspect native Undo artifact: {path}") from error
    if size > MAX_ARTIFACT_BYTES:
        raise RuntimeError(f"Native Undo artifact is too large: {path.name}")
    try:
        content = path.read_bytes()
    except OSError as error:
        raise RuntimeError(f"Cannot read native Undo artifact: {path}") from error
    if len(content) > MAX_ARTIFACT_BYTES:
        raise RuntimeError(f"Native Undo artifact is too large: {path.name}")
    return content


def _write_atomic(path: Path, content: bytes) -> None:
    if not path.parent.is_dir():
        raise RuntimeError(
            f"Native Undo artifact directory is unavailable: {path.parent}"
        )
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.operating-line-",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    except Exception:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


class NativeHistoryController:
    """Own the checkpoint journal used by Blender history handlers."""

    def __init__(self) -> None:
        self._session_provider: SessionProvider | None = None
        self._restore_callback: RestoreCallback | None = None
        self._reset_callback: ResetCallback | None = None
        self._checkpoints: dict[str | None, NativeHistoryCheckpoint] = {}
        self._artifact_blobs: dict[str, bytes] = {}
        self._owner_scene_uid: int | None = None
        self._current_id: str | None = None
        self._prepared_from: str | None = None
        self._prepared_operation: str | None = None
        self._requires_native_undo = False
        self._native_undo_recovery_id: str | None = None
        self._native_undo_recovery_probe: Callable[[], bool] | None = None
        self._native_undo_recovery_token: str | None = None
        self._native_undo_restoration_witness: NativeUndoRestorationWitness | None = None
        self._native_undo_redo_guard_id: str | None = None
        self._native_undo_redo_guard_probe: Callable[[], bool] | None = None
        self._native_undo_redo_guard_token: str | None = None
        self._registered = False
        self._handling = False
        self.error = ""

    @property
    def registered(self) -> bool:
        return self._registered

    @property
    def checkpoint_count(self) -> int:
        return len(self._checkpoints)

    @property
    def requires_native_undo(self) -> bool:
        return self._requires_native_undo

    def _owner_scene(self) -> bpy.types.Scene | None:
        if self._owner_scene_uid is None:
            return None
        return next(
            (
                scene
                for scene in bpy.data.scenes
                if scene.session_uid == self._owner_scene_uid
            ),
            None,
        )

    @staticmethod
    def _marker(scene: bpy.types.Scene) -> str | None:
        value = scene.get(NATIVE_HISTORY_MARKER_KEY)
        if value is None:
            return None
        if not isinstance(value, str) or not value:
            raise RuntimeError("Blender native Undo marker is invalid")
        return value

    @staticmethod
    def _remove_markers() -> None:
        for scene in bpy.data.scenes:
            if NATIVE_HISTORY_MARKER_KEY in scene:
                del scene[NATIVE_HISTORY_MARKER_KEY]
            if NATIVE_HISTORY_RECOVERY_KEY in scene:
                del scene[NATIVE_HISTORY_RECOVERY_KEY]

    def _clear_journal(self) -> None:
        self._checkpoints.clear()
        self._artifact_blobs.clear()
        self._owner_scene_uid = None
        self._current_id = None
        self._prepared_from = None
        self._prepared_operation = None
        self._requires_native_undo = False
        self._native_undo_recovery_id = None
        self._native_undo_recovery_probe = None
        self._native_undo_recovery_token = None
        self._native_undo_restoration_witness = None
        self._native_undo_redo_guard_id = None
        self._native_undo_redo_guard_probe = None
        self._native_undo_redo_guard_token = None
        self._handling = False
        self.error = ""

    def register(
        self,
        session_provider: SessionProvider,
        restore_callback: RestoreCallback,
        reset_callback: ResetCallback,
    ) -> None:
        self._session_provider = session_provider
        self._restore_callback = restore_callback
        self._reset_callback = reset_callback
        if self._registered:
            return
        self._remove_markers()
        self._clear_journal()
        for handlers, callback in (
            (bpy.app.handlers.undo_post, _undo_post),
            (bpy.app.handlers.redo_post, _redo_post),
            (bpy.app.handlers.load_post, _load_post),
        ):
            if callback not in handlers:
                handlers.append(callback)
        self._registered = True

    def unregister(self) -> None:
        if self._registered:
            for handlers, callback in (
                (bpy.app.handlers.undo_post, _undo_post),
                (bpy.app.handlers.redo_post, _redo_post),
                (bpy.app.handlers.load_post, _load_post),
            ):
                if callback in handlers:
                    handlers.remove(callback)
        self._remove_markers()
        self._clear_journal()
        self._session_provider = None
        self._restore_callback = None
        self._reset_callback = None
        self._registered = False

    def discard(self) -> None:
        """End the current session's history without rolling Blender data back."""
        self._remove_markers()
        self._clear_journal()

    def _capture_artifacts(
        self,
        snapshot: SessionSnapshot,
    ) -> tuple[ArtifactIdentity, ...]:
        formal_artifacts = tuple(
            artifact
            for _step_id, receipt in snapshot.receipts
            for artifact in receipt.artifacts
        )
        partial_artifacts = tuple(
            artifact
            for _step_id, run in snapshot.leaf_operation_runs
            if run.partial_action_receipt is not None
            for artifact in run.partial_action_receipt.artifacts
        )
        artifacts = (*formal_artifacts, *partial_artifacts)
        seen_paths: dict[str, str] = {}
        for artifact in artifacts:
            path = Path(artifact.path)
            if not path.is_absolute():
                raise RuntimeError(
                    f"Native Undo artifact path is not absolute: {artifact.logical_id}"
                )
            prior_sha256 = seen_paths.get(artifact.path)
            if prior_sha256 is not None and prior_sha256 != artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact path is ambiguous: {artifact.path}"
                )
            seen_paths[artifact.path] = artifact.sha256
            if not path.is_file():
                raise RuntimeError(
                    f"Native Undo artifact is unavailable: {artifact.logical_id}"
                )
            content = _read_bounded(path)
            if _sha256(content) != artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact was modified: {artifact.logical_id}"
                )
            if artifact.sha256 not in self._artifact_blobs:
                cached_bytes = sum(len(item) for item in self._artifact_blobs.values())
                if cached_bytes + len(content) > MAX_ARTIFACT_CACHE_BYTES:
                    raise RuntimeError("Native Undo artifact cache limit was reached")
                self._artifact_blobs[artifact.sha256] = content
        return artifacts

    def _checkpoint(
        self,
        checkpoint_id: str | None,
        previous_id: str | None,
        operation: str,
        session: DemoSession,
        committed_at: str | None = None,
    ) -> NativeHistoryCheckpoint:
        snapshot = session.snapshot_state()
        return NativeHistoryCheckpoint(
            checkpoint_id=checkpoint_id,
            previous_id=previous_id,
            operation=operation,
            snapshot=snapshot,
            artifacts=self._capture_artifacts(snapshot),
            committed_at=committed_at,
        )

    def _prune_redo_branches(self) -> None:
        retained: set[str | None] = set()
        checkpoint_id = self._current_id
        while checkpoint_id not in retained:
            retained.add(checkpoint_id)
            checkpoint = self._checkpoints.get(checkpoint_id)
            if checkpoint is None or checkpoint_id is None:
                break
            checkpoint_id = checkpoint.previous_id
        self._checkpoints = {
            key: checkpoint
            for key, checkpoint in self._checkpoints.items()
            if key in retained
        }
        retained_hashes = {
            artifact.sha256
            for checkpoint in self._checkpoints.values()
            for artifact in checkpoint.artifacts
        }
        self._artifact_blobs = {
            digest: content
            for digest, content in self._artifact_blobs.items()
            if digest in retained_hashes
        }

    def prepare(
        self,
        session: DemoSession,
        scene: bpy.types.Scene,
        operation: str,
    ) -> None:
        if not self._registered:
            raise RuntimeError("Blender native Undo integration is not registered")
        if self.error:
            raise RuntimeError(self.error)
        if self._prepared_operation is not None:
            raise RuntimeError("A Blender native Undo checkpoint is already pending")
        if self._owner_scene_uid is None:
            self._owner_scene_uid = scene.session_uid
            try:
                marker = self._marker(scene)
            except RuntimeError as error:
                self._set_error(error)
                raise NativeUndoRequiredError(self.error) from error
            if marker is not None:
                error = RuntimeError("Blender native Undo marker is already in use")
                self._set_error(error)
                raise RuntimeError(self.error) from error
            self._checkpoints[None] = self._checkpoint(
                None,
                None,
                "root",
                session,
            )
            self._current_id = None
        owner = self._owner_scene()
        if owner is None:
            error = RuntimeError("Blender native Undo owner Scene is unavailable")
            self._set_error(error)
            raise RuntimeError(self.error) from error
        try:
            marker = self._marker(owner)
        except RuntimeError as error:
            self._set_error(error)
            raise RuntimeError(self.error) from error
        if marker != self._current_id:
            error = RuntimeError("Blender native Undo marker is out of sync")
            self._set_error(error)
            raise RuntimeError(self.error) from error
        current = self._checkpoints.get(self._current_id)
        if current is None:
            error = RuntimeError("Blender native Undo checkpoint is unavailable")
            self._set_error(error)
            raise RuntimeError(self.error) from error
        if current.operation == "leaf_operation_failure":
            raise RuntimeError(
                "Blender native Undo must restore the failed guided operation "
                "before any further scene mutation"
            )
        self._checkpoints[self._current_id] = self._checkpoint(
            current.checkpoint_id,
            current.previous_id,
            current.operation,
            session,
            current.committed_at,
        )
        if current.alternate_snapshots:
            self._checkpoints[self._current_id] = replace(
                self._checkpoints[self._current_id],
                alternate_snapshots=current.alternate_snapshots,
            )
        self._prepared_from = self._current_id
        self._prepared_operation = operation

    def cancel(self) -> None:
        self._prepared_from = None
        self._prepared_operation = None

    def prepared_state_changed(self, session: DemoSession) -> bool:
        if self._prepared_operation is None:
            return False
        checkpoint = self._checkpoints.get(self._prepared_from)
        return checkpoint is not None and session.snapshot_state() != checkpoint.snapshot

    def _restore_session_snapshot(
        self,
        session: DemoSession,
        snapshot: SessionSnapshot,
    ) -> SessionSnapshot:
        rebound_receipts = rebind_receipts_after_native_restore(
            dict(snapshot.receipts)
        )
        rebound_runs = {}
        for step_id, run in snapshot.leaf_operation_runs:
            partial = run.partial_action_receipt
            if partial is not None:
                partial = rebind_receipts_after_native_restore(
                    {step_id: partial}
                )[step_id]
            rebound_runs[step_id] = replace(
                run,
                partial_action_receipt=partial,
            )
        managed_receipts = dict(rebound_receipts)
        for step_id, run in rebound_runs.items():
            partial = run.partial_action_receipt
            if partial is not None:
                if step_id in managed_receipts:
                    raise RuntimeError(
                        "Native history partial receipt collides with a formal receipt"
                    )
                managed_receipts[step_id] = partial
        ensure_receipts_intact(managed_receipts)
        session.restore_state(
            snapshot,
            receipts=rebound_receipts,
            leaf_operation_runs=rebound_runs,
        )
        return session.snapshot_state()

    def commit(
        self,
        session: DemoSession,
        *,
        rollback: Callable[[], NativeHistoryRecovery | None] | None = None,
        quarantine: bool = False,
        recovery_probe: Callable[[], bool] | None = None,
    ) -> str:
        operation = self._prepared_operation
        if operation is None:
            raise RuntimeError("No Blender native Undo checkpoint was prepared")
        previous_id = self._prepared_from
        prepared = self._checkpoints.get(previous_id)
        if prepared is None:
            raise RuntimeError("Prepared Blender native Undo checkpoint is unavailable")
        checkpoints_before = dict(self._checkpoints)
        artifacts_before = dict(self._artifact_blobs)
        owner = None
        try:
            owner = self._owner_scene()
            if owner is None:
                raise RuntimeError("Blender native Undo owner Scene is unavailable")
            self._prune_redo_branches()
            checkpoint_id = str(uuid.uuid4())
            checkpoint = self._checkpoint(
                checkpoint_id,
                previous_id,
                "leaf_operation_failure" if quarantine else operation,
                session,
                datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            )
            owner[NATIVE_HISTORY_MARKER_KEY] = checkpoint_id
            if self._marker(owner) != checkpoint_id:
                raise RuntimeError("Blender rejected the native Undo marker")
        except Exception as error:
            if quarantine:
                recovery_errors: list[Exception] = []
                try:
                    self._checkpoints = checkpoints_before
                    self._artifact_blobs = artifacts_before
                    self._restore_session_snapshot(session, prepared.snapshot)
                except Exception as recovery_error:
                    recovery_errors.append(recovery_error)
                if owner is not None:
                    try:
                        if previous_id is None:
                            if NATIVE_HISTORY_MARKER_KEY in owner:
                                del owner[NATIVE_HISTORY_MARKER_KEY]
                        else:
                            owner[NATIVE_HISTORY_MARKER_KEY] = previous_id
                        if self._marker(owner) != previous_id:
                            raise RuntimeError(
                                "Blender native Undo marker recovery was rejected"
                            )
                    except Exception as recovery_error:
                        recovery_errors.append(recovery_error)
                detail = (
                    f"; recovery also failed: {recovery_errors[0]}"
                    if recovery_errors
                    else ""
                )
                quarantine_error = RuntimeError(
                    "Managed Blender mutation could not be journaled; "
                    f"use Blender native Undo before continuing ({error}){detail}"
                )
                recovery_token = None
                if owner is not None:
                    try:
                        recovery_token = self._arm_native_undo_recovery(owner)
                    except Exception as recovery_error:
                        quarantine_error = RuntimeError(
                            f"{quarantine_error}; native Undo recovery witness "
                            f"could not be armed ({recovery_error}); reload the .blend"
                        )
                self._require_native_undo(
                    previous_id,
                    recovery_probe,
                    recovery_token=recovery_token,
                )
                self._set_error(quarantine_error)
                raise RuntimeError(self.error) from error
            try:
                recovery_snapshot = prepared.snapshot
                restored_probe = recovery_probe
                trusted_replay = False
                if rollback is not None:
                    rollback_result = rollback()
                    if rollback_result is not None:
                        if not isinstance(rollback_result, NativeHistoryRecovery):
                            raise TypeError(
                                "Native history rollback returned an invalid recovery"
                            )
                        if not callable(rollback_result.recovery_probe):
                            raise TypeError(
                                "Native history replay recovery probe is invalid"
                            )
                        recovery_snapshot = rollback_result.snapshot
                        restored_probe = rollback_result.recovery_probe
                        trusted_replay = True
                restored_snapshot = self._restore_session_snapshot(
                    session,
                    recovery_snapshot,
                )
                if owner is not None:
                    if previous_id is None:
                        if NATIVE_HISTORY_MARKER_KEY in owner:
                            del owner[NATIVE_HISTORY_MARKER_KEY]
                    else:
                        owner[NATIVE_HISTORY_MARKER_KEY] = previous_id
                    if self._marker(owner) != previous_id:
                        raise RuntimeError(
                            "Blender native Undo marker recovery was rejected"
                        )
                if restored_probe is None:
                    raise RuntimeError(
                        "Blender host recovery proof is unavailable"
                    )
                try:
                    recovered = restored_probe()
                except Exception as probe_error:
                    raise RuntimeError(
                        "Blender host recovery proof failed"
                    ) from probe_error
                if recovered is not True:
                    raise RuntimeError(
                        "Blender host recovery proof rejected the restored state"
                    )
                alternate_snapshots = prepared.alternate_snapshots
                if trusted_replay and recovery_snapshot != prepared.snapshot:
                    alternate_snapshots = (
                        prepared.snapshot,
                        *tuple(
                            snapshot
                            for snapshot in alternate_snapshots
                            if snapshot != prepared.snapshot
                        ),
                    )
                checkpoints_before[previous_id] = replace(
                    prepared,
                    snapshot=restored_snapshot,
                    alternate_snapshots=alternate_snapshots,
                )
                self._checkpoints = checkpoints_before
                self._artifact_blobs = artifacts_before
            except Exception as recovery_error:
                self._checkpoints = checkpoints_before
                self._artifact_blobs = artifacts_before
                recovery_token = None
                witness_error = None
                if owner is not None:
                    try:
                        recovery_token = self._arm_native_undo_recovery(owner)
                    except Exception as error:
                        witness_error = error
                self._require_native_undo(
                    previous_id,
                    recovery_probe,
                    recovery_token=recovery_token,
                )
                if witness_error is not None:
                    recovery_error = RuntimeError(
                        f"{recovery_error}; native Undo recovery witness could "
                        f"not be armed ({witness_error}); reload the .blend"
                    )
                self._set_error(recovery_error)
                raise NativeUndoRequiredError(
                    f"{self.error}; use Blender native Undo before continuing; "
                    f"original commit error: {error}"
                ) from recovery_error
            self.cancel()
            raise RuntimeError(
                "Blender native Undo checkpoint commit failed; "
                f"operation restored: {error}"
            ) from error
        self._checkpoints[checkpoint_id] = checkpoint
        self._current_id = checkpoint_id
        self._native_undo_redo_guard_id = None
        self._native_undo_redo_guard_probe = None
        self._native_undo_redo_guard_token = None
        if quarantine:
            try:
                recovery_token = self._arm_native_undo_recovery(owner)
            except Exception as error:
                self._require_native_undo(
                    previous_id,
                    recovery_probe,
                    recovery_token=None,
                )
                self.cancel()
                self.error = (
                    "Native Undo recovery witness could not be armed; "
                    f"reload the .blend ({error})"
                )
                raise NativeUndoRequiredError(self.error) from error
            self._require_native_undo(
                previous_id,
                recovery_probe,
                recovery_token=recovery_token,
            )
        self.cancel()
        return checkpoint_id

    def _current_checkpoint_attestation(
        self,
        session: DemoSession,
        *,
        allow_leaf_operation: bool,
    ) -> dict[str, Any] | None:
        """Describe the exact journal entry currently selected by Blender history."""
        if not self._registered or self._current_id is None:
            return None
        checkpoint = self._checkpoints.get(self._current_id)
        owner = self._owner_scene()
        if checkpoint is None or owner is None:
            raise RuntimeError("Blender native Undo checkpoint is unavailable")
        if checkpoint.operation in {
            "leaf_operation",
            "leaf_operation_back",
            "leaf_operation_failure",
        } and not allow_leaf_operation:
            return None
        if checkpoint.operation not in {
            "start",
            "next",
            "recheck",
            "back",
            "leaf_operation",
            "leaf_operation_back",
            "leaf_operation_failure",
        }:
            raise RuntimeError("Blender native Undo checkpoint operation is invalid")
        if checkpoint.committed_at is None:
            raise RuntimeError("Blender native Undo checkpoint timestamp is unavailable")
        if self._marker(owner) != checkpoint.checkpoint_id:
            raise RuntimeError("Blender native Undo checkpoint marker is out of sync")
        current_snapshot = session.snapshot_state()
        if current_snapshot != checkpoint.snapshot:
            raise RuntimeError("Blender native Undo checkpoint no longer matches the session")
        if (
            current_snapshot.plan_id is None
            or current_snapshot.revision is None
            or session.plan_content_sha256 is None
            or current_snapshot.execution_id is None
        ):
            return None
        for artifact in checkpoint.artifacts:
            content = self._artifact_blobs.get(artifact.sha256)
            if content is None or _sha256(content) != artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact backup is unavailable: {artifact.logical_id}"
                )
        active = session.active_step
        lineage_checkpoint_ids: list[str] = []
        lineage_contains_leaf_operation = False
        lineage_checkpoint = checkpoint
        visited: set[str] = set()
        while lineage_checkpoint.checkpoint_id is not None:
            lineage_id = lineage_checkpoint.checkpoint_id
            if lineage_id in visited:
                raise RuntimeError("Blender native Undo checkpoint lineage contains a cycle")
            visited.add(lineage_id)
            lineage_checkpoint_ids.append(lineage_id)
            lineage_contains_leaf_operation = lineage_contains_leaf_operation or (
                lineage_checkpoint.operation
                in {
                    "leaf_operation",
                    "leaf_operation_back",
                    "leaf_operation_failure",
                }
            )
            previous_id = lineage_checkpoint.previous_id
            if previous_id is None:
                break
            previous = self._checkpoints.get(previous_id)
            if previous is None:
                raise RuntimeError(
                    "Blender native Undo checkpoint lineage is incomplete"
                )
            lineage_checkpoint = previous
        lineage_checkpoint_ids.reverse()
        journal: dict[str, Any] = {
            "entryPresent": True,
            "snapshotMatchesSession": True,
            "artifactsBackedUp": True,
        }
        if lineage_contains_leaf_operation and len(lineage_checkpoint_ids) >= 2:
            journal["lineageCheckpointIds"] = lineage_checkpoint_ids
        return {
            "formatVersion": "1.0.0",
            "evidenceClass": "companion_reported_native_undo_checkpoint",
            "checkpointId": checkpoint.checkpoint_id,
            "previousCheckpointId": checkpoint.previous_id,
            "operation": checkpoint.operation,
            "committedAt": checkpoint.committed_at,
            "marker": {
                "key": NATIVE_HISTORY_MARKER_KEY,
                "matched": True,
            },
            "journal": journal,
            "session": {
                "plan": {
                    "id": current_snapshot.plan_id,
                    "revision": current_snapshot.revision,
                },
                "planContentSha256": session.plan_content_sha256,
                "executionId": current_snapshot.execution_id,
                "activeStepId": active.id if active is not None else None,
                "completedStepIds": list(session.completed_step_ids),
                "receiptStepIds": [
                    step_id for step_id, _receipt in current_snapshot.receipts
                ],
            },
        }

    def current_checkpoint_attestation(
        self,
        session: DemoSession,
    ) -> dict[str, Any] | None:
        return self._current_checkpoint_attestation(
            session,
            allow_leaf_operation=False,
        )

    def current_leaf_checkpoint_attestation(
        self,
        session: DemoSession,
    ) -> dict[str, Any] | None:
        return self._current_checkpoint_attestation(
            session,
            allow_leaf_operation=True,
        )

    @staticmethod
    def _artifact_map(
        checkpoint: NativeHistoryCheckpoint,
    ) -> dict[Path, ArtifactIdentity]:
        return {Path(artifact.path): artifact for artifact in checkpoint.artifacts}

    def _apply_artifact_transition(
        self,
        source: NativeHistoryCheckpoint,
        target: NativeHistoryCheckpoint,
    ) -> Callable[[], None]:
        source_artifacts = self._artifact_map(source)
        target_artifacts = self._artifact_map(target)
        paths = tuple(sorted(source_artifacts.keys() | target_artifacts.keys()))
        before: dict[Path, bytes | None] = {}
        target_content: dict[Path, bytes | None] = {}
        applied: dict[Path, bytes | None] = {}

        for path in paths:
            actual = _read_bounded(path) if path.is_file() else None
            before[path] = actual
            actual_sha256 = _sha256(actual) if actual is not None else None
            source_artifact = source_artifacts.get(path)
            target_artifact = target_artifacts.get(path)
            if target_artifact is None:
                if actual is not None and (
                    source_artifact is None
                    or actual_sha256 != source_artifact.sha256
                ):
                    raise RuntimeError(
                        f"Cannot remove modified native Undo artifact: {path.name}"
                    )
                target_content[path] = None
                continue
            blob = self._artifact_blobs.get(target_artifact.sha256)
            if blob is None or _sha256(blob) != target_artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact backup is unavailable: {path.name}"
                )
            if actual is not None and actual_sha256 not in {
                target_artifact.sha256,
                source_artifact.sha256 if source_artifact is not None else None,
            }:
                raise RuntimeError(
                    f"Cannot replace modified native Undo artifact: {path.name}"
                )
            target_content[path] = blob

        def restore_before() -> None:
            for path, expected in applied.items():
                current = _read_bounded(path) if path.is_file() else None
                if current != expected:
                    raise RuntimeError(
                        f"Native Undo artifact changed during recovery: {path.name}"
                    )
            for path, content in before.items():
                if path not in applied:
                    continue
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    _write_atomic(path, content)

        try:
            for path, content in target_content.items():
                current = _read_bounded(path) if path.is_file() else None
                if current != before[path]:
                    raise RuntimeError(
                        f"Native Undo artifact changed during transition: {path.name}"
                    )
                if content is None:
                    if current is not None:
                        path.unlink()
                        applied[path] = None
                elif before[path] != content:
                    _write_atomic(path, content)
                    applied[path] = content
        except Exception:
            try:
                restore_before()
            except Exception as restore_error:
                raise RuntimeError(
                    "Native Undo artifact transaction and recovery both failed"
                ) from restore_error
            raise
        return restore_before

    def _set_error(self, error: Exception) -> None:
        self.cancel()
        self.error = f"Native Undo synchronization failed: {error}"
        print(f"OperatingLine {self.error}")

    def _require_native_undo(
        self,
        recovery_id: str | None,
        recovery_probe: Callable[[], bool] | None,
        *,
        recovery_token: str | None = None,
    ) -> None:
        self._native_undo_restoration_witness = None
        self._requires_native_undo = True
        self._native_undo_recovery_id = recovery_id
        self._native_undo_recovery_probe = recovery_probe
        self._native_undo_recovery_token = recovery_token

    @staticmethod
    def _native_undo_recovery_marker(owner: bpy.types.Scene) -> str | None:
        value = owner.get(NATIVE_HISTORY_RECOVERY_KEY)
        if value is None:
            return None
        if not isinstance(value, str) or not value:
            raise RuntimeError("Blender native Undo recovery marker is invalid")
        return value

    def _arm_native_undo_recovery(self, owner: bpy.types.Scene) -> str:
        token = str(uuid.uuid4())
        owner[NATIVE_HISTORY_RECOVERY_KEY] = token
        if self._native_undo_recovery_marker(owner) != token:
            raise RuntimeError("Blender rejected the native Undo recovery marker")
        return token

    def _probe_native_undo_recovery(self, direction: str) -> bool:
        if not self._requires_native_undo:
            return True
        if direction != "undo":
            return False
        owner = self._owner_scene()
        if owner is None or self._marker(owner) != self._native_undo_recovery_id:
            return False
        recovery_token = self._native_undo_recovery_token
        if recovery_token is None:
            return False
        if self._native_undo_recovery_marker(owner) is not None:
            return False
        probe = self._native_undo_recovery_probe
        if probe is not None:
            try:
                recovered = probe()
            except Exception as error:
                print(f"OperatingLine native Undo recovery probe failed: {error}")
                return False
            if recovered is not True:
                return False
        return True

    def _restore_checkpoint_session(
        self,
        session: DemoSession,
        checkpoint: NativeHistoryCheckpoint,
    ) -> tuple[SessionSnapshot, tuple[SessionSnapshot, ...]]:
        """Restore one exact recorded identity variant for a trusted replay checkpoint."""

        candidates = (checkpoint.snapshot, *checkpoint.alternate_snapshots)
        first_error: Exception | None = None
        for index, candidate in enumerate(candidates):
            try:
                restored = self._restore_session_snapshot(session, candidate)
            except Exception as error:
                if first_error is None:
                    first_error = error
                continue
            remaining = tuple(
                snapshot
                for candidate_index, snapshot in enumerate(candidates)
                if candidate_index != index and snapshot != restored
            )
            return restored, remaining
        if first_error is None:
            raise RuntimeError("Native history checkpoint has no session snapshot")
        raise first_error

    def _clear_native_undo_requirement(self) -> None:
        self._requires_native_undo = False
        self._native_undo_recovery_id = None
        self._native_undo_recovery_probe = None
        self._native_undo_recovery_token = None

    def peek_native_undo_restoration_witness(
        self,
    ) -> NativeUndoRestorationWitness | None:
        return self._native_undo_restoration_witness

    def peek_native_undo_recovery_guard(self) -> NativeUndoRecoveryGuard | None:
        token = self._native_undo_recovery_token
        if not self._requires_native_undo or token is None:
            return None
        return NativeUndoRecoveryGuard(
            expected_restored_checkpoint_id=self._native_undo_recovery_id,
            recovery_token_sha256=_sha256(token.encode("utf-8")),
        )

    def consume_native_undo_restoration_witness(
        self,
    ) -> NativeUndoRestorationWitness | None:
        witness = self._native_undo_restoration_witness
        self._native_undo_restoration_witness = None
        return witness

    def sync(self, direction: str) -> None:
        if not self._registered or self._handling or not self._checkpoints:
            return
        self._handling = True
        try:
            owner = self._owner_scene()
            if (
                direction == "redo"
                and owner is not None
                and self._native_undo_redo_guard_token is not None
                and self._native_undo_recovery_marker(owner)
                == self._native_undo_redo_guard_token
            ):
                self._require_native_undo(
                    self._native_undo_redo_guard_id,
                    self._native_undo_redo_guard_probe,
                    recovery_token=self._native_undo_redo_guard_token,
                )
                self.error = (
                    "Native Undo synchronization failed: Redo restored an "
                    "unjournaled failed mutation; use Blender native Undo"
                )
                return
            recovering_native_undo = self._requires_native_undo
            if not self._probe_native_undo_recovery(direction):
                return
            if owner is None:
                raise RuntimeError("owner Scene is unavailable")
            target_id = self._marker(owner)
            marker_changed = target_id != self._current_id
            target = self._checkpoints.get(target_id)
            source = self._checkpoints.get(self._current_id)
            if target is None or source is None:
                raise RuntimeError("checkpoint marker is unknown")
            provider = self._session_provider
            if provider is None:
                raise RuntimeError("session provider is unavailable")
            session = provider()
            before_snapshot = session.snapshot_state()
            restore_artifacts = self._apply_artifact_transition(source, target)
            try:
                rebound_snapshot, alternate_snapshots = (
                    self._restore_checkpoint_session(session, target)
                )
            except Exception:
                restore_artifacts()
                raise
            self._checkpoints[target_id] = replace(
                target,
                snapshot=rebound_snapshot,
                alternate_snapshots=alternate_snapshots,
            )
            self._current_id = target_id
            if recovering_native_undo:
                recovery_token = self._native_undo_recovery_token
                if recovery_token is None:
                    raise RuntimeError("Native Undo recovery token is unavailable")
                self._native_undo_restoration_witness = NativeUndoRestorationWitness(
                    direction="undo",
                    source_checkpoint_id=source.checkpoint_id,
                    restored_checkpoint_id=target.checkpoint_id,
                    recovery_token_sha256=_sha256(recovery_token.encode("utf-8")),
                    restored_at=datetime.now(timezone.utc)
                    .isoformat()
                    .replace("+00:00", "Z"),
                    recovery_probe_satisfied=True,
                )
                if self._native_undo_recovery_token is not None:
                    self._native_undo_redo_guard_id = self._native_undo_recovery_id
                    self._native_undo_redo_guard_probe = (
                        self._native_undo_recovery_probe
                    )
                    self._native_undo_redo_guard_token = (
                        self._native_undo_recovery_token
                    )
                self._clear_native_undo_requirement()
            self.error = ""
            callback = self._restore_callback
            if callback is not None and marker_changed:
                try:
                    callback(
                        NativeHistoryRestore(
                            direction=direction,
                            source_operation=source.operation,
                            target_operation=target.operation,
                            before=before_snapshot,
                            after=rebound_snapshot,
                        )
                    )
                except Exception as callback_error:
                    print(
                        "OperatingLine native Undo reporting failed: "
                        f"{callback_error}"
                    )
        except Exception as error:
            self._set_error(error)
        finally:
            self._handling = False

    def loaded_file(self) -> None:
        if not self._registered:
            return
        provider = self._session_provider
        if provider is not None:
            provider().abandon_state()
        self._remove_markers()
        self._clear_journal()
        callback = self._reset_callback
        if callback is not None:
            try:
                callback()
            except Exception as error:
                print(f"OperatingLine file-load reset reporting failed: {error}")


_CONTROLLER = NativeHistoryController()


@persistent
def _undo_post(_unused: Any) -> None:
    _CONTROLLER.sync("undo")


@persistent
def _redo_post(_unused: Any) -> None:
    _CONTROLLER.sync("redo")


@persistent
def _load_post(_unused: Any) -> None:
    _CONTROLLER.loaded_file()


def register_native_history(
    session_provider: SessionProvider,
    restore_callback: RestoreCallback,
    reset_callback: ResetCallback,
) -> None:
    _CONTROLLER.register(session_provider, restore_callback, reset_callback)


def unregister_native_history() -> None:
    _CONTROLLER.unregister()


def discard_native_history() -> None:
    _CONTROLLER.discard()


def prepare_native_history(
    session: DemoSession,
    scene: bpy.types.Scene,
    operation: str,
) -> None:
    _CONTROLLER.prepare(session, scene, operation)


def cancel_native_history() -> None:
    _CONTROLLER.cancel()


def commit_native_history(
    session: DemoSession,
    *,
    rollback: Callable[[], NativeHistoryRecovery | None] | None = None,
    quarantine: bool = False,
    recovery_probe: Callable[[], bool] | None = None,
) -> str:
    return _CONTROLLER.commit(
        session,
        rollback=rollback,
        quarantine=quarantine,
        recovery_probe=recovery_probe,
    )


def prepared_native_history_changed(session: DemoSession) -> bool:
    return _CONTROLLER.prepared_state_changed(session)


def native_history_error() -> str:
    return _CONTROLLER.error


def native_history_requires_native_undo() -> bool:
    return _CONTROLLER.requires_native_undo


def peek_native_undo_restoration_witness() -> NativeUndoRestorationWitness | None:
    return _CONTROLLER.peek_native_undo_restoration_witness()


def peek_native_undo_recovery_guard() -> NativeUndoRecoveryGuard | None:
    return _CONTROLLER.peek_native_undo_recovery_guard()


def consume_native_undo_restoration_witness() -> NativeUndoRestorationWitness | None:
    return _CONTROLLER.consume_native_undo_restoration_witness()


def native_history_checkpoint_count() -> int:
    return _CONTROLLER.checkpoint_count


def native_undo_checkpoint_attestation(
    session: DemoSession,
) -> dict[str, Any] | None:
    return _CONTROLLER.current_checkpoint_attestation(session)


def native_leaf_checkpoint_attestation(
    session: DemoSession,
) -> dict[str, Any] | None:
    return _CONTROLLER.current_leaf_checkpoint_attestation(session)


__all__ = (
    "NATIVE_HISTORY_MARKER_KEY",
    "NATIVE_HISTORY_RECOVERY_KEY",
    "POKE_COMPOUND_HISTORY_MARKER_KEY",
    "NativeHistoryCheckpoint",
    "NativeHistoryController",
    "NativeHistoryRecovery",
    "NativeHistoryRestore",
    "NativeUndoRecoveryGuard",
    "NativeUndoRestorationWitness",
    "NativeUndoRequiredError",
    "PokeCompoundHistoryLock",
    "PokeCompoundHistoryState",
    "cancel_native_history",
    "commit_native_history",
    "consume_native_undo_restoration_witness",
    "discard_native_history",
    "native_history_checkpoint_count",
    "native_history_error",
    "native_history_requires_native_undo",
    "native_leaf_checkpoint_attestation",
    "native_undo_checkpoint_attestation",
    "peek_native_undo_restoration_witness",
    "peek_native_undo_recovery_guard",
    "prepare_native_history",
    "prepared_native_history_changed",
    "register_native_history",
    "unregister_native_history",
)
