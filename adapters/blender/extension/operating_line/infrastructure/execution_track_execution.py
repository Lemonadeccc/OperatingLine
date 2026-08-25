"""Durable evidence builders for the managed execution-track v2 consumer.

The Blender main-thread controller owns native input and managed action
execution.  This module keeps the protocol construction and Scene-backed
outbox transitions deterministic so every externally visible phase is durable
before the HTTP worker can publish it.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from typing import Any
import uuid

from .companion_transport import CompanionTransport
from .menu_control_proof import _scene_snapshot, compute_scene_fingerprint_sha256


OUTBOX_KEY = "_operating_line_execution_track_v2_outbox"
EXECUTOR_GAP = (
    "managed execution-track v2 proof/restore driver is not wired to the Blender "
    "main-thread input executor; no mutation was attempted"
)

_OUTBOX_ALLOWED_KEYS = {
    "formatVersion",
    "progress",
    "baselineProgress",
    "result",
    "terminalMarker",
    "proofTerminalMarker",
    "proofTerminalResultContentSha256",
    "managedStartSubmission",
    "acknowledgedManagedStartContentSha256",
    "acknowledgedProgressContentSha256s",
    "queuedProgress",
    "restoreTransitions",
    "recoveredReport",
    "recoveryAck",
}


def canonical_sha256(value: Any) -> str:
    """Hash the protocol's length-delimited semantic JSON encoding."""
    return hashlib.sha256(CompanionTransport._canonical_protocol_bytes(value)).hexdigest()


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _identity_hashes(snapshot: dict[str, Any]) -> dict[str, str]:
    objects = snapshot.get("objects", [])
    return {
        "viewLayerIdentitySha256": canonical_sha256(
            {"activeObject": snapshot.get("activeObject"), "selectedObjects": snapshot.get("selectedObjects")}
        ),
        "objectIdentitySha256": canonical_sha256(
            [{"name": item.get("name"), "type": item.get("type")} for item in objects]
        ),
        "meshIdentitySha256": canonical_sha256(
            [item.get("mesh") for item in objects if item.get("type") == "MESH"]
        ),
        "collectionIdentitySha256": canonical_sha256([]),
        "sessionUidDomainSha256": canonical_sha256(
            [item.get("name") for item in objects]
        ),
        "pointerDomainSha256": canonical_sha256(
            [item.get("type") for item in objects]
        ),
        "linksAndSelectionSha256": canonical_sha256(
            {"selectedObjects": snapshot.get("selectedObjects", [])}
        ),
    }


def _progress_delivery_identity(
    progress: dict[str, Any], *, current_lease: dict[str, Any]
) -> dict[str, Any]:
    previous_lease = progress["currentLease"]
    identity_keys = {
        "leaseId",
        "sessionId",
        "target",
        "documentIncarnationId",
    }
    if (
        not isinstance(previous_lease, dict)
        or not isinstance(current_lease, dict)
        or set(previous_lease) != identity_keys | {"expiresAt"}
        or set(current_lease) != identity_keys | {"expiresAt"}
        or any(previous_lease[key] != current_lease[key] for key in identity_keys)
        or datetime.fromisoformat(
            current_lease["expiresAt"].replace("Z", "+00:00")
        )
        < datetime.fromisoformat(previous_lease["expiresAt"].replace("Z", "+00:00"))
    ):
        raise ValueError("execution-track current lease did not advance monotonically")
    return {
        "binding": deepcopy(progress["binding"]),
        "deliveryId": progress["deliveryId"],
        "lease": deepcopy(progress["lease"]),
        "currentLease": deepcopy(current_lease),
        "dispatchedAt": progress["dispatchedAt"],
    }


def _result_identity(
    progress: dict[str, Any], *, current_lease: dict[str, Any], occurred_at: str
) -> dict[str, Any]:
    binding = progress["binding"]
    return {
        "formatVersion": "2.0.0",
        "requestId": binding["requestId"],
        "deliveryId": progress["deliveryId"],
        "bindingContentSha256": binding["bindingContentSha256"],
        "target": deepcopy(binding["target"]),
        "leaseId": progress["lease"]["leaseId"],
        "currentLease": deepcopy(current_lease),
        "proposalId": binding["proposalId"],
        "planId": binding["plan"]["id"],
        "planRevision": binding["plan"]["revision"],
        "executionId": binding["executionId"],
        "leafId": binding["leafId"],
        "occurredAt": occurred_at,
    }


def renew_progress_current_lease(
    progress: dict[str, Any], *, current_lease: dict[str, Any]
) -> dict[str, Any]:
    """Rebind an unsent progress record to a monotonic heartbeat renewal."""

    content = {
        key: deepcopy(value)
        for key, value in progress.items()
        if key != "contentSha256"
    }
    content.update(
        _progress_delivery_identity(progress, current_lease=current_lease)
    )
    return {**content, "contentSha256": canonical_sha256(content)}


def build_baseline_progress(
    delivery: Any,
    *,
    instance_id: str,
    last_report: Any,
    current_lease: Any,
) -> dict[str, Any]:
    """Validate exact start authority and attest the live Blender baseline."""
    if not isinstance(delivery, dict) or set(delivery) != {
        "binding", "deliveryId", "lease", "dispatchedAt"
    }:
        raise ValueError("execution-track delivery fields do not match v2")
    binding = delivery["binding"]
    if not isinstance(binding, dict) or binding.get("formatVersion") != "2.0.0":
        raise ValueError("execution-track binding is not v2")
    target = {"adapterId": "blender", "instanceId": instance_id}
    if binding.get("target") != target or delivery.get("lease") != current_lease:
        raise ValueError("execution-track delivery is not bound to the current Blender lease")
    if not isinstance(last_report, dict) or binding.get("expectedState") != {
        "reportId": last_report.get("reportId"),
        "sequence": last_report.get("sequence"),
    }:
        raise ValueError("execution-track expected state is stale")
    checkpoint = last_report.get("nativeUndoCheckpoint")
    authorized = binding.get("authorizedStartState")
    if not isinstance(checkpoint, dict) or not isinstance(authorized, dict):
        raise ValueError("execution-track authorized native checkpoint is unavailable")
    checkpoint_identity = authorized.get("checkpoint")
    if not isinstance(checkpoint_identity, dict):
        raise ValueError("execution-track authorized checkpoint identity is unavailable")
    if authorized.get("reportContentSha256") != canonical_sha256(last_report):
        raise ValueError(
            "execution-track authorized state report changed "
            f"({authorized.get('reportContentSha256')} != {canonical_sha256(last_report)})"
        )
    if (
        checkpoint_identity.get("checkpointId") != checkpoint.get("checkpointId")
        or checkpoint_identity.get("contentSha256") != canonical_sha256(checkpoint)
    ):
        raise ValueError("execution-track authorized state or native checkpoint changed")

    snapshot = _scene_snapshot()
    occurred_at = _now()
    attestation_content = {
        "checkpointId": checkpoint["checkpointId"],
        "reportId": last_report["reportId"],
        "sequence": last_report["sequence"],
        "sceneFingerprintSha256": compute_scene_fingerprint_sha256(snapshot),
        "identitySnapshot": _identity_hashes(snapshot),
        "documentIncarnationId": current_lease["documentIncarnationId"],
        "sessionId": current_lease["sessionId"],
        "leaseId": current_lease["leaseId"],
        "attestedAt": occurred_at,
    }
    start_attestation = {
        **attestation_content,
        "contentSha256": canonical_sha256(attestation_content),
    }
    progress_content = {
        **deepcopy(delivery),
        "currentLease": deepcopy(current_lease),
        "sequence": 1,
        "previousProgressContentSha256": None,
        "occurredAt": occurred_at,
        "phase": "baseline_attested",
        "startCheckpoint": deepcopy(checkpoint),
        "startAttestation": start_attestation,
    }
    return {**progress_content, "contentSha256": canonical_sha256(progress_content)}


def build_active_outbox(progress: dict[str, Any]) -> dict[str, Any]:
    if progress.get("phase") != "baseline_attested":
        raise ValueError("execution-track active outbox must start at the baseline")
    return {
        "formatVersion": "2.0.0",
        "progress": deepcopy(progress),
        "baselineProgress": deepcopy(progress),
        "acknowledgedProgressContentSha256s": [],
    }


def record_progress_ack(
    outbox: dict[str, Any], content_sha256: Any
) -> tuple[dict[str, Any], bool]:
    """Persist one exact server ACK before its phase-specific side effect."""
    progress = outbox.get("progress")
    acknowledged = outbox.get("acknowledgedProgressContentSha256s", [])
    if (
        not isinstance(progress, dict)
        or not _is_sha256(content_sha256)
        or not isinstance(acknowledged, list)
        or len(acknowledged) > 6
        or len(set(acknowledged)) != len(acknowledged)
        or any(not _is_sha256(value) for value in acknowledged)
    ):
        raise ValueError("execution-track progress ACK state is invalid")
    if content_sha256 in acknowledged:
        return deepcopy(outbox), False
    if content_sha256 != progress.get("contentSha256"):
        raise ValueError("execution-track progress ACK does not match the durable head")
    if len(acknowledged) == 6:
        raise ValueError("execution-track progress ACK chain is already complete")
    durable = deepcopy(outbox)
    durable["acknowledgedProgressContentSha256s"] = [
        *acknowledged,
        content_sha256,
    ]
    return durable, True


def record_managed_start_ack(
    outbox: dict[str, Any], content_sha256: Any
) -> tuple[dict[str, Any], bool]:
    """Persist the managed-start ACK before granting the one-shot operator token."""
    submission = outbox.get("managedStartSubmission")
    expected = (
        submission.get("managedStart", {}).get("contentSha256")
        if isinstance(submission, dict)
        else None
    )
    if not _is_sha256(content_sha256) or content_sha256 != expected:
        raise ValueError("managed-start ACK does not match durable authority")
    acknowledged = outbox.get("acknowledgedManagedStartContentSha256")
    if acknowledged is not None and acknowledged != content_sha256:
        raise ValueError("durable managed-start ACK identity changed")
    if acknowledged == content_sha256:
        return deepcopy(outbox), False
    durable = deepcopy(outbox)
    durable["acknowledgedManagedStartContentSha256"] = content_sha256
    return durable, True


def build_proof_progress_pair(
    baseline: dict[str, Any],
    evidence: dict[str, Any],
    *,
    current_lease: dict[str, Any],
    checkpoint: dict[str, Any],
    observed_at: str,
    occurred_at: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Bind the audited UI proof to new v2 receipts and locked evidence."""
    if baseline.get("phase") != "baseline_attested":
        raise ValueError("execution-track proof requires baseline progress")
    operation_ids = baseline["binding"]["executor"]["proofOperationIds"]
    summaries = evidence.get("operationSummaries")
    if (
        not isinstance(summaries, list)
        or len(summaries) != len(operation_ids)
        or [item.get("operationId") for item in summaries] != operation_ids
    ):
        raise ValueError("execution-track proof summaries changed operation order")
    receipts: list[dict[str, Any]] = []
    previous = None
    for index, item in enumerate(summaries):
        summary = {"status": item["status"], "path": deepcopy(item["path"])}
        summary.update(deepcopy(item.get("parameters") or {}))
        receipt_content = {
            "receiptId": str(uuid.uuid4()),
            "proofId": baseline["binding"]["proofId"],
            "requestId": baseline["binding"]["requestId"],
            "deliveryId": baseline["deliveryId"],
            "bindingContentSha256": baseline["binding"]["bindingContentSha256"],
            "operationId": operation_ids[index],
            "order": index + 1,
            "previousReceiptContentSha256": previous,
            "outcome": "succeeded",
            "summary": summary,
            "occurredAt": observed_at,
        }
        receipt = {
            **receipt_content,
            "contentSha256": canonical_sha256(receipt_content),
        }
        receipts.append(receipt)
        previous = receipt["contentSha256"]

    baseline_references = {
        "startCheckpointId": baseline["startCheckpoint"]["checkpointId"],
        "startAttestationContentSha256": baseline["startAttestation"][
            "contentSha256"
        ],
        "baselineSceneFingerprintSha256": baseline["startAttestation"][
            "sceneFingerprintSha256"
        ],
    }
    proof_content = {
        **_progress_delivery_identity(baseline, current_lease=current_lease),
        "phase": "proof_in_progress",
        "sequence": 2,
        "previousProgressContentSha256": baseline["contentSha256"],
        **baseline_references,
        "proofReceipts": receipts,
        "completedOperationIds": deepcopy(operation_ids),
        "occurredAt": observed_at,
    }
    proof = {**proof_content, "contentSha256": canonical_sha256(proof_content)}
    final = evidence["finalState"]
    observation_content = {
        "kind": "uv_sphere_menu_controls_ready",
        "satisfied": True,
        "observationId": str(uuid.uuid4()),
        "objectName": final["objectName"],
        "objectType": final["objectType"],
        "location": deepcopy(final["location"]),
        "scale": deepcopy(final["scale"]),
        "meshTopology": deepcopy(final["meshTopology"]),
        "meshSha256": final["meshSha256"],
        "sceneFingerprintSha256": evidence["finalSceneFingerprintSha256"],
        "observedAt": observed_at,
    }
    strong_observation = {
        **observation_content,
        "contentSha256": canonical_sha256(observation_content),
    }
    native_checkpoint = {
        "checkpointId": checkpoint["checkpointId"],
        "undoLockId": checkpoint["undoLockId"],
        "nativeUndoDepth": 8,
        "nativeHistoryCursor": 8,
        "mutationStages": [
            "uv_sphere_created",
            "location_x_set",
            "location_y_set",
            "location_z_set",
            "scale_x_set",
            "scale_y_set",
            "scale_z_set",
            "object_name_set",
        ],
        "baselineSceneFingerprintSha256": evidence[
            "baselineSceneFingerprintSha256"
        ],
        "finalSceneFingerprintSha256": evidence["finalSceneFingerprintSha256"],
        "restoredSceneFingerprintSha256": evidence[
            "restoredSceneFingerprintSha256"
        ],
        "reappliedSceneFingerprintSha256": evidence[
            "reappliedSceneFingerprintSha256"
        ],
        "receiptChainRootSha256": receipts[0]["contentSha256"],
        "receiptChainHeadSha256": receipts[-1]["contentSha256"],
        "strongObservationContentSha256": strong_observation["contentSha256"],
        "committedAt": checkpoint["committedAt"],
    }
    proof_evidence_content = {
        "kind": "succeeded_locked",
        "operationSummaries": [
            {
                "operationId": receipt["operationId"],
                "summaryContentSha256": canonical_sha256(receipt["summary"]),
            }
            for receipt in receipts
        ],
        "operationReceipts": receipts,
        "strongObservation": strong_observation,
        "nativeUndoCheckpoint": native_checkpoint,
        "managedActionExecuted": False,
        "managedIdentityVerified": False,
        "managedReceiptCreated": False,
    }
    proof_evidence = {
        **proof_evidence_content,
        "proofEvidenceContentSha256": canonical_sha256(proof_evidence_content),
    }
    observed_content = {
        **_progress_delivery_identity(baseline, current_lease=current_lease),
        "phase": "proof_observed_locked",
        "sequence": 3,
        "previousProgressContentSha256": proof["contentSha256"],
        **baseline_references,
        "evidence": proof_evidence,
        "occurredAt": occurred_at,
    }
    observed = {
        **observed_content,
        "contentSha256": canonical_sha256(observed_content),
    }
    return proof, observed


def build_native_undo_transition(
    transition: dict[str, Any],
    *,
    stage_fingerprints: list[str],
    order: int,
) -> dict[str, Any]:
    if (
        transition.get("direction") != "undo"
        or transition.get("fromCursor") != 9 - order
        or transition.get("toCursor") != 8 - order
        or transition.get("sceneFingerprintSha256")
        != stage_fingerprints[8 - order]
    ):
        raise ValueError("execution-track native Undo transition is not adjacent")
    content = {
        "order": order,
        "operation": "native_undo",
        "fromCursor": transition["fromCursor"],
        "toCursor": transition["toCursor"],
        "beforeSceneFingerprintSha256": stage_fingerprints[9 - order],
        "afterSceneFingerprintSha256": stage_fingerprints[8 - order],
        "occurredAt": transition["occurredAt"],
    }
    return {**content, "contentSha256": canonical_sha256(content)}


def build_restore_progress(
    observed: dict[str, Any],
    transition: dict[str, Any],
    *,
    current_lease: dict[str, Any],
) -> dict[str, Any]:
    if observed.get("phase") != "proof_observed_locked" or transition.get("order") != 1:
        raise ValueError("execution-track restore requires its first native Undo")
    native = observed["evidence"]["nativeUndoCheckpoint"]
    content = {
        **_progress_delivery_identity(observed, current_lease=current_lease),
        "phase": "restore_in_progress",
        "sequence": 4,
        "previousProgressContentSha256": observed["contentSha256"],
        "startCheckpointId": observed["startCheckpointId"],
        "startAttestationContentSha256": observed[
            "startAttestationContentSha256"
        ],
        "baselineSceneFingerprintSha256": observed[
            "baselineSceneFingerprintSha256"
        ],
        "proofEvidenceContentSha256": observed["evidence"][
            "proofEvidenceContentSha256"
        ],
        "proofCheckpointId": native["checkpointId"],
        "undoLockId": native["undoLockId"],
        "proofFinalSceneFingerprintSha256": native[
            "finalSceneFingerprintSha256"
        ],
        "transitions": [deepcopy(transition)],
        "nativeHistoryCursor": 7,
        "occurredAt": transition["occurredAt"],
    }
    return {**content, "contentSha256": canonical_sha256(content)}


def build_baseline_restored_progress(
    restore: dict[str, Any],
    transitions: list[dict[str, Any]],
    *,
    baseline: dict[str, Any],
    current_lease: dict[str, Any],
    occurred_at: str,
) -> dict[str, Any]:
    if (
        restore.get("phase") != "restore_in_progress"
        or len(transitions) != 8
        or transitions[0] != restore["transitions"][0]
    ):
        raise ValueError("execution-track baseline restore lacks its exact Undo chain")
    content = {
        **_progress_delivery_identity(restore, current_lease=current_lease),
        "phase": "baseline_restored",
        "sequence": 5,
        "previousProgressContentSha256": restore["contentSha256"],
        "proofEvidenceContentSha256": restore["proofEvidenceContentSha256"],
        "proofCheckpointId": restore["proofCheckpointId"],
        "undoLockId": restore["undoLockId"],
        "proofFinalSceneFingerprintSha256": restore[
            "proofFinalSceneFingerprintSha256"
        ],
        "transitions": deepcopy(transitions),
        "nativeHistoryCursor": 0,
        "undoChainHeadContentSha256": transitions[-1]["contentSha256"],
        "baseline": deepcopy(baseline),
        "occurredAt": occurred_at,
    }
    return {**content, "contentSha256": canonical_sha256(content)}


def build_baseline_identity(
    baseline_progress: dict[str, Any], snapshot: dict[str, Any]
) -> dict[str, Any]:
    if baseline_progress.get("phase") != "baseline_attested":
        raise ValueError("execution-track baseline identity requires start attestation")
    attestation = baseline_progress["startAttestation"]
    identity = _identity_hashes(snapshot)
    scene_fingerprint = compute_scene_fingerprint_sha256(snapshot)
    if (
        scene_fingerprint != attestation["sceneFingerprintSha256"]
        or identity != attestation["identitySnapshot"]
    ):
        raise ValueError("execution-track native Undo did not restore the exact baseline")
    content = {
        "sceneFingerprintSha256": scene_fingerprint,
        **identity,
        "startReportId": attestation["reportId"],
        "startCheckpointId": baseline_progress["startCheckpoint"]["checkpointId"],
        "startAttestationContentSha256": attestation["contentSha256"],
        "sessionId": baseline_progress["lease"]["sessionId"],
        "documentIncarnationId": baseline_progress["lease"][
            "documentIncarnationId"
        ],
    }
    return {**content, "contentSha256": canonical_sha256(content)}


def proof_terminal_marker_identity(progress: dict[str, Any]) -> dict[str, Any]:
    if progress.get("phase") not in {"baseline_restored", "commit_intent_recorded"}:
        raise ValueError("proof terminal marker requires restored proof progress")
    return {
        "formatVersion": "2.0.0",
        "kind": "proof_terminal_marker",
        "proofId": progress["binding"]["proofId"],
        "bindingContentSha256": progress["binding"]["bindingContentSha256"],
        "proofCheckpointId": progress["proofCheckpointId"],
        "undoLockId": progress["undoLockId"],
        "baselineSceneFingerprintSha256": progress["baseline"][
            "sceneFingerprintSha256"
        ],
        "finalSceneFingerprintSha256": progress[
            "proofFinalSceneFingerprintSha256"
        ],
        "proofEvidenceContentSha256": progress["proofEvidenceContentSha256"],
    }


def build_commit_intent_progress(
    restored: dict[str, Any], *, current_lease: dict[str, Any], occurred_at: str
) -> dict[str, Any]:
    if restored.get("phase") != "baseline_restored":
        raise ValueError("execution-track commit intent requires a restored baseline")
    marker_hash = canonical_sha256(proof_terminal_marker_identity(restored))
    barrier_content = {
        "evidenceClass": "companion_reported_native_redo_barrier",
        "method": "view3d_ed_undo_push",
        "message": "OperatingLine supersede restored menu proof",
        "proofCheckpointId": restored["proofCheckpointId"],
        "undoLockId": restored["undoLockId"],
        "proofEvidenceContentSha256": restored["proofEvidenceContentSha256"],
        "proofTerminalMarkerContentSha256": marker_hash,
        "baselineContentSha256": restored["baseline"]["contentSha256"],
        "undoChainHeadContentSha256": restored["undoChainHeadContentSha256"],
        "baselineSceneFingerprintBeforeSha256": restored["baseline"][
            "sceneFingerprintSha256"
        ],
        "baselineSceneFingerprintAfterSha256": restored["baseline"][
            "sceneFingerprintSha256"
        ],
        "markerMatchedBeforeRemoval": True,
        "markerPresentBeforePush": False,
        "markerPresentAfterPush": False,
        "undoPushFinished": True,
        "redoPollAfterBarrier": False,
        "controllerSuperseded": True,
        "controllerCheckpointAbsent": True,
        "verifiedAt": occurred_at,
    }
    barrier = {
        **barrier_content,
        "contentSha256": canonical_sha256(barrier_content),
    }
    intent_content = {
        "intentId": str(uuid.uuid4()),
        "action": deepcopy(restored["binding"]["preflightBinding"]["action"]),
        "baselineContentSha256": restored["baseline"]["contentSha256"],
        "redoBarrier": barrier,
        "managedActionExecuted": False,
        "managedReceiptCreated": False,
        "recordedAt": occurred_at,
    }
    intent = {**intent_content, "contentSha256": canonical_sha256(intent_content)}
    content = {
        **_progress_delivery_identity(restored, current_lease=current_lease),
        "phase": "commit_intent_recorded",
        "sequence": 6,
        "previousProgressContentSha256": restored["contentSha256"],
        "proofEvidenceContentSha256": restored["proofEvidenceContentSha256"],
        "proofCheckpointId": restored["proofCheckpointId"],
        "undoLockId": restored["undoLockId"],
        "proofFinalSceneFingerprintSha256": restored[
            "proofFinalSceneFingerprintSha256"
        ],
        "undoChainHeadContentSha256": restored["undoChainHeadContentSha256"],
        "baseline": deepcopy(restored["baseline"]),
        "intent": intent,
        "occurredAt": occurred_at,
    }
    return {**content, "contentSha256": canonical_sha256(content)}


def build_managed_start_submission(
    commit: dict[str, Any], *, current_lease: dict[str, Any], started_at: str
) -> dict[str, Any]:
    if commit.get("phase") != "commit_intent_recorded":
        raise ValueError("managed start requires a durable commit intent")
    managed_content = {
        "managedStartId": str(uuid.uuid4()),
        "commitIntentId": commit["intent"]["intentId"],
        "commitIntentContentSha256": commit["intent"]["contentSha256"],
        "baselineContentSha256": commit["baseline"]["contentSha256"],
        "proofEvidenceContentSha256": commit["proofEvidenceContentSha256"],
        "previousProgressContentSha256": commit["contentSha256"],
        "startedAt": started_at,
    }
    managed_start = {
        **managed_content,
        "contentSha256": canonical_sha256(managed_content),
    }
    return {
        "formatVersion": "2.0.0",
        "requestId": commit["binding"]["requestId"],
        "deliveryId": commit["deliveryId"],
        "bindingContentSha256": commit["binding"]["bindingContentSha256"],
        "currentLease": deepcopy(current_lease),
        "commitProgress": deepcopy(commit),
        "managedStart": managed_start,
    }


def build_terminal_result(
    baseline: dict[str, Any],
    commit: dict[str, Any],
    submission: dict[str, Any],
    report: dict[str, Any],
    *,
    current_lease: dict[str, Any],
    occurred_at: str,
) -> dict[str, Any]:
    """Bind the canonical managed report to a success or retained failure."""
    if baseline.get("phase") != "baseline_attested" or commit.get(
        "phase"
    ) != "commit_intent_recorded":
        raise ValueError("managed terminal requires the complete proof/restore head")
    checkpoint = report.get("nativeUndoCheckpoint")
    observations = report.get("observations")
    observation = observations[0] if isinstance(observations, list) and observations else None
    if not isinstance(checkpoint, dict) or not isinstance(observation, dict):
        raise ValueError("managed terminal report lacks checkpoint or Observation evidence")
    common = {
        **_result_identity(commit, current_lease=current_lease, occurred_at=occurred_at),
        "startCheckpointId": baseline["startCheckpoint"]["checkpointId"],
        "commitIntentId": commit["intent"]["intentId"],
        "commitIntentContentSha256": commit["intent"]["contentSha256"],
        "baselineContentSha256": commit["baseline"]["contentSha256"],
        "proofEvidenceContentSha256": commit["proofEvidenceContentSha256"],
        "lastProgressContentSha256": commit["contentSha256"],
        "managedStart": deepcopy(submission["managedStart"]),
        "managedReport": {
            "reportId": report["reportId"],
            "sequence": report["sequence"],
            "transition": report["transition"],
            "stepId": commit["binding"]["leafId"],
            "contentSha256": canonical_sha256(report),
        },
        "managedCheckpoint": {
            "checkpointId": checkpoint["checkpointId"],
            "previousCheckpointId": checkpoint["previousCheckpointId"],
            "operation": checkpoint["operation"],
            "receiptStepIds": deepcopy(checkpoint["session"]["receiptStepIds"]),
            "contentSha256": canonical_sha256(checkpoint),
        },
    }
    if report.get("transition") == "step_succeeded":
        return {
            **common,
            "status": "succeeded",
            "managedObservation": {
                "observationIndex": 0,
                "kind": observation["kind"],
                "contentSha256": canonical_sha256(observation),
            },
        }
    gate = report.get("observationGate")
    if report.get("transition") != "step_observation_failed" or not isinstance(gate, dict):
        raise ValueError("managed terminal report has an unsupported transition")
    return {
        **common,
        "status": "failed_managed",
        "observationGate": deepcopy(gate),
        "failedObservation": {
            "observationIndex": 0,
            "kind": observation["kind"],
            "satisfied": False,
            "contentSha256": canonical_sha256(observation),
        },
        "retainsTargetLock": True,
        "error": gate["message"],
    }


def build_persisted_managed_terminal_marker(
    result: dict[str, Any], snapshot: dict[str, Any]
) -> dict[str, Any]:
    if result.get("status") not in {"succeeded", "failed_managed"}:
        raise ValueError("persisted managed marker requires a managed terminal")
    content = {
        "kind": "persisted_managed_terminal",
        "terminalStatus": result["status"],
        "terminalResultContentSha256": canonical_sha256(result),
        "managedReportId": result["managedReport"]["reportId"],
        "managedReportSequence": result["managedReport"]["sequence"],
        "managedCheckpointId": result["managedCheckpoint"]["checkpointId"],
        "sceneFingerprintSha256": compute_scene_fingerprint_sha256(snapshot),
        **_identity_hashes(snapshot),
    }
    if result["status"] == "failed_managed":
        content["failedObservationContentSha256"] = result["failedObservation"][
            "contentSha256"
        ]
    return {**content, "contentSha256": canonical_sha256(content)}


def build_failed_restored_result(
    restored: dict[str, Any], *, current_lease: dict[str, Any], error: str
) -> dict[str, Any]:
    if restored.get("phase") != "baseline_restored":
        raise ValueError("failed-restored terminal requires restored progress")
    return {
        **_result_identity(restored, current_lease=current_lease, occurred_at=_now()),
        "status": "failed_restored",
        "baselineContentSha256": restored["baseline"]["contentSha256"],
        "proofEvidenceContentSha256": restored["proofEvidenceContentSha256"],
        "lastProgressContentSha256": restored["contentSha256"],
        "error": error,
    }


def build_no_mutation_result(
    baseline: dict[str, Any], *, current_lease: dict[str, Any], error: str
) -> dict[str, Any]:
    if baseline.get("phase") != "baseline_attested":
        raise ValueError("no-mutation terminal requires baseline progress")
    return {
        **_result_identity(baseline, current_lease=current_lease, occurred_at=_now()),
        "status": "failed_no_mutation",
        "startCheckpointId": baseline["startCheckpoint"]["checkpointId"],
        "baselineAttestationContentSha256": baseline["startAttestation"][
            "contentSha256"
        ],
        "lastProgressContentSha256": baseline["contentSha256"],
        "error": error,
    }


def build_recovery_required_result(
    progress: dict[str, Any],
    *,
    current_lease: dict[str, Any],
    reason: str,
    error: str,
    managed_start: dict[str, Any] | None = None,
) -> dict[str, Any]:
    content = {
        **_result_identity(progress, current_lease=current_lease, occurred_at=_now()),
        "status": "recovery_required",
        "recoveryReason": reason,
        "lastProgressContentSha256": progress["contentSha256"],
        "automaticReplay": False,
        "error": error,
    }
    if reason == "managed_state_indeterminate":
        if managed_start is None:
            raise ValueError("managed recovery requires its durable start")
        content.update(
            {
                "commitIntentId": progress["intent"]["intentId"],
                "commitIntentContentSha256": progress["intent"]["contentSha256"],
                "managedStart": deepcopy(managed_start),
            }
        )
    elif managed_start is not None:
        raise ValueError("proof recovery cannot include a managed start")
    return content


def build_unresolved_recovery_ack(
    request: Any,
    *,
    outbox: dict[str, Any],
    current_lease: Any,
    current_report: Any,
) -> dict[str, Any]:
    """Attest current state without guessing across an interrupted mutation phase."""
    if (
        not isinstance(request, dict)
        or request.get("formatVersion") != "2.0.0"
        or request.get("mode") != "read_only_reconcile"
        or request.get("automaticReplay") is not False
        or request.get("replacementLease") != current_lease
        or not isinstance(current_report, dict)
    ):
        raise ValueError("execution-track unresolved recovery request is invalid")
    progress = outbox.get("progress")
    accepted = request.get("acceptedProgress")
    durable_progress = progress if isinstance(progress, dict) else None
    binding = (
        durable_progress.get("binding")
        if isinstance(durable_progress, dict)
        else accepted.get("binding")
        if isinstance(accepted, dict)
        else None
    )
    if (
        not isinstance(binding, dict)
        or request.get("requestId") != binding.get("requestId")
        or request.get("originalDeliveryId")
        != (
            durable_progress.get("deliveryId")
            if isinstance(durable_progress, dict)
            else accepted.get("deliveryId")
            if isinstance(accepted, dict)
            else None
        )
        or request.get("bindingContentSha256")
        != binding.get("bindingContentSha256")
    ):
        raise ValueError("execution-track unresolved recovery authority changed")
    snapshot = _scene_snapshot()
    identity = _identity_hashes(snapshot)
    observed_at = _now()
    state_content = {
        "authentication": "replacement_lease_recovery_post",
        "replacementLeaseId": current_lease["leaseId"],
        "sessionId": current_lease["sessionId"],
        "documentIncarnationId": current_lease["documentIncarnationId"],
        "reportId": current_report["reportId"],
        "sequence": current_report["sequence"],
        "sceneFingerprintSha256": compute_scene_fingerprint_sha256(snapshot),
        **identity,
        "observedAt": observed_at,
    }
    current_state = {
        **state_content,
        "contentSha256": canonical_sha256(state_content),
    }
    accepted_phase = accepted.get("phase") if isinstance(accepted, dict) else None
    reason = (
        "document_authority_drift"
        if request.get("source") == "document_authority_drift"
        else "managed_state_indeterminate"
        if accepted_phase == "commit_intent_recorded"
        else "proof_or_restore_indeterminate"
    )
    return {
        "formatVersion": "2.0.0",
        "request": deepcopy(request),
        "recoveryId": request["recoveryId"],
        "requestId": request["requestId"],
        "originalDeliveryId": request["originalDeliveryId"],
        "bindingContentSha256": request["bindingContentSha256"],
        "replacementLeaseId": current_lease["leaseId"],
        "acceptedProgressChainHeadContentSha256": request[
            "acceptedProgressChainHeadContentSha256"
        ],
        "durableReferences": deepcopy(request["durableReferences"]),
        "outcome": "recovery_required",
        "evidence": {
            "kind": "unresolved_current_state",
            "reason": reason,
            "currentState": current_state,
        },
        "retainsTargetLock": True,
        "automaticReplay": False,
        "occurredAt": _now(),
    }


def build_fail_closed_outbox(
    delivery: Any,
    *,
    instance_id: str,
    last_report: Any,
    current_lease: Any,
) -> dict[str, Any]:
    """Validate baseline authority and return a durable no-mutation submission."""
    progress = build_baseline_progress(
        delivery,
        instance_id=instance_id,
        last_report=last_report,
        current_lease=current_lease,
    )
    binding = progress["binding"]
    checkpoint = progress["startCheckpoint"]
    occurred_at = progress["occurredAt"]
    result = {
        **_result_identity(
            progress, current_lease=current_lease, occurred_at=occurred_at
        ),
        "status": "failed_no_mutation",
        "startCheckpointId": checkpoint["checkpointId"],
        "baselineAttestationContentSha256": progress["startAttestation"][
            "contentSha256"
        ],
        "lastProgressContentSha256": progress["contentSha256"],
        "error": EXECUTOR_GAP,
    }
    return {"formatVersion": "1.0.0", "progress": progress, "result": result}


def persist_outbox(scene: Any, outbox: dict[str, Any]) -> None:
    scene[OUTBOX_KEY] = json.dumps(outbox, separators=(",", ":"), sort_keys=True)


def load_outbox(scene: Any) -> dict[str, Any] | None:
    raw = scene.get(OUTBOX_KEY)
    if not isinstance(raw, str):
        return None
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("persisted execution-track outbox is invalid")
    acknowledged_progress = value.get("acknowledgedProgressContentSha256s", [])
    acknowledged_managed_start = value.get(
        "acknowledgedManagedStartContentSha256"
    )
    if (
        not {"formatVersion", "progress"}.issubset(value)
        or not set(value).issubset(_OUTBOX_ALLOWED_KEYS)
        or value.get("formatVersion") not in {"1.0.0", "2.0.0"}
        or not isinstance(value.get("progress"), dict)
        or ("result" in value and not isinstance(value.get("result"), dict))
        or not isinstance(acknowledged_progress, list)
        or len(acknowledged_progress) > 6
        or len(set(acknowledged_progress)) != len(acknowledged_progress)
        or any(not _is_sha256(content_sha256) for content_sha256 in acknowledged_progress)
        or (
            acknowledged_managed_start is not None
            and (
                not _is_sha256(acknowledged_managed_start)
                or not isinstance(value.get("managedStartSubmission"), dict)
                or acknowledged_managed_start
                != value["managedStartSubmission"].get("managedStart", {}).get(
                    "contentSha256"
                )
            )
        )
    ):
        raise ValueError("persisted execution-track outbox is invalid")
    return value


def acknowledge_outbox(scene: Any, request_id: str) -> bool:
    outbox = load_outbox(scene)
    if outbox is None:
        return False
    result = outbox.get("result")
    progress = outbox.get("progress")
    durable_request_id = (
        result.get("requestId")
        if isinstance(result, dict)
        else progress.get("binding", {}).get("requestId")
        if isinstance(progress, dict)
        else None
    )
    if durable_request_id != request_id:
        return False
    del scene[OUTBOX_KEY]
    return True


def resubmit_outbox(transport: Any, scene: Any) -> bool:
    """Queue the exact durable head again after transport reconstruction."""
    outbox = load_outbox(scene)
    if outbox is None:
        return False
    recovery_ack = outbox.get("recoveryAck")
    if isinstance(recovery_ack, dict):
        recovered_report = outbox.get("recoveredReport")
        if recovery_ack.get("evidence", {}).get("kind") == "managed_repair_terminal":
            if (
                not isinstance(recovered_report, dict)
                or recovery_ack["evidence"].get("recoveredReport") != recovered_report
            ):
                raise ValueError("durable managed repair report does not match its ACK")
        transport.submit_execution_track_execution_recovery_ack(recovery_ack)
    else:
        progress = outbox["progress"]
        acknowledged = outbox.get("acknowledgedProgressContentSha256s", [])
        if progress.get("contentSha256") not in acknowledged:
            transport.submit_execution_track_execution_progress(progress)
        result = outbox.get("result")
        if isinstance(result, dict):
            transport.submit_execution_track_execution_result(result)
        else:
            managed_start = outbox.get("managedStartSubmission")
            if isinstance(managed_start, dict):
                managed_start_hash = managed_start.get("managedStart", {}).get(
                    "contentSha256"
                )
                if (
                    outbox.get("acknowledgedManagedStartContentSha256")
                    != managed_start_hash
                ):
                    transport.submit_execution_track_execution_managed_start(
                        managed_start
                    )
    transport.enable_execution_track_execution_recovery_poll()
    return True


def build_baseline_terminal_recovery_ack(
    request: Any,
    *,
    outbox: dict[str, Any],
    current_lease: Any,
) -> dict[str, Any]:
    """Build a strict read-only recovery ACK for the persisted baseline terminal."""
    if not isinstance(request, dict) or request.get("formatVersion") != "2.0.0":
        raise ValueError("execution-track recovery request is not v2")
    progress = outbox.get("progress")
    result = outbox.get("result")
    if not isinstance(progress, dict) or not isinstance(result, dict):
        raise ValueError("execution-track durable baseline terminal is unavailable")
    expected_references = {
        "terminalMarkerContentSha256": None,
        "managedStartContentSha256": None,
        "baselineContentSha256": None,
        "commitIntentId": None,
        "commitIntentContentSha256": None,
    }
    if (
        progress.get("phase") != "baseline_attested"
        or result.get("status") != "failed_no_mutation"
        or request.get("requestId") != result.get("requestId")
        or request.get("originalDeliveryId") != result.get("deliveryId")
        or request.get("bindingContentSha256") != result.get("bindingContentSha256")
        or request.get("acceptedProgress") != progress
        or request.get("acceptedProgressChainHeadContentSha256")
        != progress.get("contentSha256")
        or request.get("durableReferences") != expected_references
        or request.get("replacementLease") != current_lease
        or request.get("mode") != "read_only_reconcile"
        or request.get("automaticReplay") is not False
    ):
        raise ValueError("execution-track recovery request does not match the durable baseline")

    attestation = progress.get("startAttestation")
    if not isinstance(attestation, dict):
        raise ValueError("execution-track baseline attestation is unavailable")
    snapshot = _scene_snapshot()
    identity = _identity_hashes(snapshot)
    scene_fingerprint = compute_scene_fingerprint_sha256(snapshot)
    if (
        scene_fingerprint != attestation.get("sceneFingerprintSha256")
        or attestation.get("identitySnapshot") != identity
    ):
        raise ValueError("live Blender state no longer matches the attested baseline")
    occurred_at = _now()
    state_content = {
        "authentication": "replacement_lease_recovery_post",
        "replacementLeaseId": current_lease["leaseId"],
        "sessionId": current_lease["sessionId"],
        "documentIncarnationId": current_lease["documentIncarnationId"],
        "reportId": attestation["reportId"],
        "sequence": attestation["sequence"],
        "sceneFingerprintSha256": scene_fingerprint,
        **identity,
        "observedAt": occurred_at,
    }
    current_state = {
        **state_content,
        "contentSha256": canonical_sha256(state_content),
    }
    return {
        "formatVersion": "2.0.0",
        "request": deepcopy(request),
        "recoveryId": request["recoveryId"],
        "requestId": request["requestId"],
        "originalDeliveryId": request["originalDeliveryId"],
        "bindingContentSha256": request["bindingContentSha256"],
        "replacementLeaseId": current_lease["leaseId"],
        "acceptedProgressChainHeadContentSha256": request[
            "acceptedProgressChainHeadContentSha256"
        ],
        "durableReferences": deepcopy(request["durableReferences"]),
        "outcome": "reconciled",
        "evidence": {
            "kind": "baseline_terminal",
            "terminalResult": deepcopy(result),
            "terminalResultContentSha256": canonical_sha256(result),
            "progress": deepcopy(progress),
            "currentState": current_state,
        },
        "retainsTargetLock": False,
        "automaticReplay": False,
        "occurredAt": occurred_at,
    }


def build_persisted_managed_terminal_recovery_ack(
    request: Any,
    *,
    outbox: dict[str, Any],
    current_lease: Any,
) -> dict[str, Any]:
    """Attest an exact persisted managed terminal after a lost result ACK."""
    if (
        not isinstance(request, dict)
        or request.get("formatVersion") != "2.0.0"
        or request.get("source") not in {"coordinator_restart", "companion_reported"}
        or request.get("mode") != "read_only_reconcile"
        or request.get("automaticReplay") is not False
        or request.get("replacementLease") != current_lease
    ):
        raise ValueError("execution-track managed-terminal recovery request is invalid")
    progress = outbox.get("progress")
    result = outbox.get("result")
    marker = outbox.get("terminalMarker")
    references = request.get("durableReferences")
    if (
        not isinstance(progress, dict)
        or progress.get("phase") != "commit_intent_recorded"
        or not isinstance(result, dict)
        or result.get("status") not in {"succeeded", "failed_managed"}
        or not isinstance(marker, dict)
        or marker.get("terminalStatus") != result.get("status")
        or request.get("requestId") != result.get("requestId")
        or request.get("originalDeliveryId") != result.get("deliveryId")
        or request.get("bindingContentSha256") != result.get("bindingContentSha256")
        or request.get("acceptedProgress") != progress
        or request.get("acceptedProgressChainHeadContentSha256")
        != progress.get("contentSha256")
        or not isinstance(references, dict)
        or references.get("terminalMarkerContentSha256") is not None
        or references.get("terminalResultContentSha256") is not None
        or references.get("managedStartContentSha256")
        != result.get("managedStart", {}).get("contentSha256")
        or references.get("baselineContentSha256") != result.get("baselineContentSha256")
        or references.get("commitIntentId") != result.get("commitIntentId")
        or references.get("commitIntentContentSha256")
        != result.get("commitIntentContentSha256")
        or marker.get("contentSha256")
        != canonical_sha256({key: value for key, value in marker.items() if key != "contentSha256"})
        or marker.get("terminalResultContentSha256") != canonical_sha256(result)
        or marker.get("managedReportId") != result.get("managedReport", {}).get("reportId")
        or marker.get("managedReportSequence")
        != result.get("managedReport", {}).get("sequence")
        or marker.get("managedCheckpointId")
        != result.get("managedCheckpoint", {}).get("checkpointId")
        or (
            result.get("status") == "failed_managed"
            and marker.get("failedObservationContentSha256")
            != result.get("failedObservation", {}).get("contentSha256")
        )
    ):
        raise ValueError("persisted managed terminal does not match recovery authority")

    snapshot = _scene_snapshot()
    identity = _identity_hashes(snapshot)
    scene_fingerprint = compute_scene_fingerprint_sha256(snapshot)
    if (
        marker.get("sceneFingerprintSha256") != scene_fingerprint
        or any(marker.get(key) != value for key, value in identity.items())
    ):
        raise ValueError("live Blender state differs from the persisted managed terminal")
    state_observed_at = _now()
    state_content = {
        "authentication": "replacement_lease_recovery_post",
        "replacementLeaseId": current_lease["leaseId"],
        "sessionId": current_lease["sessionId"],
        "documentIncarnationId": current_lease["documentIncarnationId"],
        "reportId": result["managedReport"]["reportId"],
        "sequence": result["managedReport"]["sequence"],
        "sceneFingerprintSha256": scene_fingerprint,
        **identity,
        "observedAt": state_observed_at,
    }
    current_state = {**state_content, "contentSha256": canonical_sha256(state_content)}
    return {
        "formatVersion": "2.0.0",
        "request": deepcopy(request),
        "recoveryId": request["recoveryId"],
        "requestId": request["requestId"],
        "originalDeliveryId": request["originalDeliveryId"],
        "bindingContentSha256": request["bindingContentSha256"],
        "replacementLeaseId": current_lease["leaseId"],
        "acceptedProgressChainHeadContentSha256": request[
            "acceptedProgressChainHeadContentSha256"
        ],
        "durableReferences": deepcopy(request["durableReferences"]),
        "outcome": "reconciled",
        "evidence": {
            "kind": "persisted_managed_terminal",
            "terminalResult": deepcopy(result),
            "terminalResultContentSha256": canonical_sha256(result),
            "terminalMarker": deepcopy(marker),
            "currentState": current_state,
        },
        "retainsTargetLock": result["status"] == "failed_managed",
        "automaticReplay": False,
        "occurredAt": _now(),
    }


def build_persisted_failed_managed_recovery_ack(
    request: Any,
    *,
    outbox: dict[str, Any],
    current_lease: Any,
) -> dict[str, Any]:
    """Backward-compatible name for existing failed-managed recovery callers."""
    ack = build_persisted_managed_terminal_recovery_ack(
        request,
        outbox=outbox,
        current_lease=current_lease,
    )
    if ack["evidence"]["terminalResult"].get("status") != "failed_managed":
        raise ValueError("execution-track terminal is not failed-managed")
    return ack


def persist_recovery_ack(scene: Any, outbox: dict[str, Any], ack: dict[str, Any]) -> dict[str, Any]:
    durable = deepcopy(outbox)
    durable["recoveryAck"] = deepcopy(ack)
    recovered_report = ack.get("evidence", {}).get("recoveredReport")
    if isinstance(recovered_report, dict):
        durable["recoveredReport"] = deepcopy(recovered_report)
    persist_outbox(scene, durable)
    return durable


def retain_failed_managed_terminal(scene: Any, request_id: str) -> bool:
    """Retain failed-managed evidence after its first recovery ACK is accepted."""
    outbox = load_outbox(scene)
    if outbox is None or outbox["result"].get("requestId") != request_id:
        return False
    ack = outbox.get("recoveryAck")
    evidence = ack.get("evidence") if isinstance(ack, dict) else None
    if (
        not isinstance(evidence, dict)
        or evidence.get("kind") != "persisted_managed_terminal"
        or evidence.get("terminalResult", {}).get("status") != "failed_managed"
    ):
        return False
    durable = deepcopy(outbox)
    durable["terminalMarker"] = deepcopy(evidence["terminalMarker"])
    durable.pop("recoveryAck", None)
    durable.pop("recoveredReport", None)
    persist_outbox(scene, durable)
    return True


def _validate_managed_repair_request(
    request: Any,
    outbox: dict[str, Any],
    current_lease: Any,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    if (
        not isinstance(request, dict)
        or request.get("formatVersion") != "2.0.0"
        or request.get("source") != "failed_managed_repair"
        or request.get("mode") != "read_only_reconcile"
        or request.get("automaticReplay") is not False
        or request.get("replacementLease") != current_lease
    ):
        raise ValueError("execution-track managed repair request is invalid")
    progress = outbox.get("progress")
    result = outbox.get("result")
    marker = outbox.get("terminalMarker")
    if (
        not isinstance(progress, dict)
        or progress.get("phase") != "commit_intent_recorded"
        or not isinstance(result, dict)
        or result.get("status") != "failed_managed"
        or not isinstance(marker, dict)
        or marker.get("terminalStatus") != "failed_managed"
    ):
        raise ValueError("durable failed-managed evidence is unavailable")
    references = request.get("durableReferences")
    if (
        request.get("requestId") != result.get("requestId")
        or request.get("originalDeliveryId") != result.get("deliveryId")
        or request.get("bindingContentSha256") != result.get("bindingContentSha256")
        or request.get("acceptedProgress") != progress
        or request.get("acceptedProgressChainHeadContentSha256")
        != progress.get("contentSha256")
        or not isinstance(references, dict)
        or references.get("terminalResultContentSha256") != canonical_sha256(result)
        or references.get("terminalMarkerContentSha256") != marker.get("contentSha256")
        or marker.get("contentSha256")
        != canonical_sha256({key: value for key, value in marker.items() if key != "contentSha256"})
        or marker.get("terminalResultContentSha256") != canonical_sha256(result)
        or marker.get("managedReportId") != result.get("managedReport", {}).get("reportId")
        or marker.get("managedReportSequence")
        != result.get("managedReport", {}).get("sequence")
        or marker.get("managedCheckpointId")
        != result.get("managedCheckpoint", {}).get("checkpointId")
        or marker.get("failedObservationContentSha256")
        != result.get("failedObservation", {}).get("contentSha256")
    ):
        raise ValueError("managed repair challenge does not match retained terminal evidence")
    return progress, result, marker


def build_managed_repair_recovery_ack(
    request: Any,
    *,
    outbox: dict[str, Any],
    current_lease: Any,
    recovered_report: Any,
) -> dict[str, Any]:
    """Bind one full recovered Companion report to the retained failed terminal."""
    progress, result, marker = _validate_managed_repair_request(
        request, outbox, current_lease
    )
    if not isinstance(recovered_report, dict):
        raise ValueError("managed repair recovered report is unavailable")
    binding = progress.get("binding")
    checkpoint = recovered_report.get("nativeUndoCheckpoint")
    observations = recovered_report.get("observations")
    observation = (
        observations[0]
        if isinstance(observations, list) and len(observations) == 1
        else None
    )
    details = observation.get("details") if isinstance(observation, dict) else None
    authorized = binding.get("authorizedStartState") if isinstance(binding, dict) else None
    completed = (
        [*authorized.get("completedStepIds", []), result.get("leafId")]
        if isinstance(authorized, dict)
        else None
    )
    receipts = (
        [*authorized.get("receiptStepIds", []), result.get("leafId")]
        if isinstance(authorized, dict)
        else None
    )
    if (
        not isinstance(binding, dict)
        or not isinstance(checkpoint, dict)
        or not isinstance(details, dict)
        or details.get("evidenceClass") != "managed_repair_strong_observation"
        or recovered_report.get("protocolVersion") not in {"1.6.0", "1.7.0"}
        or recovered_report.get("adapterId") != request.get("target", {}).get("adapterId")
        or recovered_report.get("instanceId") != request.get("target", {}).get("instanceId")
        or recovered_report.get("plan")
        != {
            "id": binding.get("plan", {}).get("id"),
            "revision": binding.get("plan", {}).get("revision"),
        }
        or recovered_report.get("planContentSha256") != binding.get("plan", {}).get("contentSha256")
        or recovered_report.get("executionId") != result.get("executionId")
        or recovered_report.get("phase") != authorized.get("successPhase")
        or recovered_report.get("activeStepId") != result.get("leafId")
        or recovered_report.get("completedStepIds") != completed
        or recovered_report.get("transition") != "observation_recovered"
        or recovered_report.get("stepId") != result.get("leafId")
        or recovered_report.get("sequence")
        != result.get("managedReport", {}).get("sequence", 0) + 1
        or recovered_report.get("error") is not None
        or observation.get("kind") != result.get("failedObservation", {}).get("kind")
        or observation.get("satisfied") is not True
        or recovered_report.get("observationGate", {}).get("status") != "recovered"
        or recovered_report.get("observationGate", {}).get("failureStrategy")
        != result.get("observationGate", {}).get("failureStrategy")
        or checkpoint.get("operation") != "recheck"
        or checkpoint.get("previousCheckpointId")
        != result.get("managedCheckpoint", {}).get("checkpointId")
        or checkpoint.get("session", {}).get("completedStepIds") != completed
        or checkpoint.get("session", {}).get("receiptStepIds") != receipts
        or result.get("managedCheckpoint", {}).get("receiptStepIds") != receipts
        or details.get("reportId") != recovered_report.get("reportId")
        or details.get("reportSequence") != recovered_report.get("sequence")
        or details.get("checkpointId") != checkpoint.get("checkpointId")
        or details.get("observationIndex", -1)
        <= result.get("failedObservation", {}).get("observationIndex", -1)
        or details.get("contentSha256")
        != canonical_sha256(
            {key: value for key, value in details.items() if key != "contentSha256"}
        )
    ):
        raise ValueError("recovered Companion report does not match managed repair authority")

    snapshot = _scene_snapshot()
    identity = _identity_hashes(snapshot)
    scene_fingerprint = compute_scene_fingerprint_sha256(snapshot)
    if (
        details.get("sceneFingerprintSha256") != scene_fingerprint
        or any(details.get(key) != value for key, value in identity.items())
    ):
        raise ValueError("live Blender state differs from the recovered observation")
    state_observed_at = _now()
    state_content = {
        "authentication": "replacement_lease_recovery_post",
        "replacementLeaseId": current_lease["leaseId"],
        "sessionId": current_lease["sessionId"],
        "documentIncarnationId": current_lease["documentIncarnationId"],
        "reportId": recovered_report["reportId"],
        "sequence": recovered_report["sequence"],
        "sceneFingerprintSha256": scene_fingerprint,
        **identity,
        "observedAt": state_observed_at,
    }
    current_state = {**state_content, "contentSha256": canonical_sha256(state_content)}
    occurred_at = _now()
    return {
        "formatVersion": "2.0.0",
        "request": deepcopy(request),
        "recoveryId": request["recoveryId"],
        "requestId": request["requestId"],
        "originalDeliveryId": request["originalDeliveryId"],
        "bindingContentSha256": request["bindingContentSha256"],
        "replacementLeaseId": current_lease["leaseId"],
        "acceptedProgressChainHeadContentSha256": request[
            "acceptedProgressChainHeadContentSha256"
        ],
        "durableReferences": deepcopy(request["durableReferences"]),
        "outcome": "reconciled",
        "evidence": {
            "kind": "managed_repair_terminal",
            "failedTerminalResult": deepcopy(result),
            "failedTerminalResultContentSha256": canonical_sha256(result),
            "failedTerminalMarker": deepcopy(marker),
            "recoveredReport": deepcopy(recovered_report),
            "recoveredReportContentSha256": canonical_sha256(recovered_report),
            "currentState": current_state,
        },
        "retainsTargetLock": False,
        "automaticReplay": False,
        "occurredAt": occurred_at,
    }
