"""Fail-closed Blender consumer for managed execution-track v2 deliveries.

The current extension can attest the authorized baseline but does not yet own a
v2 proof/restore driver.  This module therefore consumes every delivery and
terminates it before mutation, instead of leaving the orchestrator target lock
held indefinitely.  The exact progress/result pair is persisted in the Scene
before it is exposed to the HTTP worker.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from typing import Any

from .companion_transport import CompanionTransport
from .menu_control_proof import _scene_snapshot, compute_scene_fingerprint_sha256


OUTBOX_KEY = "_operating_line_execution_track_v2_outbox"
EXECUTOR_GAP = (
    "managed execution-track v2 proof/restore driver is not wired to the Blender "
    "main-thread input executor; no mutation was attempted"
)


def canonical_sha256(value: Any) -> str:
    """Hash the protocol's length-delimited semantic JSON encoding."""
    return hashlib.sha256(CompanionTransport._canonical_protocol_bytes(value)).hexdigest()


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


def build_fail_closed_outbox(
    delivery: Any,
    *,
    instance_id: str,
    last_report: Any,
    current_lease: Any,
) -> dict[str, Any]:
    """Validate baseline authority and return a durable no-mutation submission."""
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
    progress = {**progress_content, "contentSha256": canonical_sha256(progress_content)}
    result = {
        "formatVersion": "2.0.0",
        "requestId": binding["requestId"],
        "deliveryId": delivery["deliveryId"],
        "bindingContentSha256": binding["bindingContentSha256"],
        "target": deepcopy(target),
        "leaseId": delivery["lease"]["leaseId"],
        "currentLease": deepcopy(current_lease),
        "proposalId": binding["proposalId"],
        "planId": binding["plan"]["id"],
        "planRevision": binding["plan"]["revision"],
        "executionId": binding["executionId"],
        "leafId": binding["leafId"],
        "occurredAt": occurred_at,
        "status": "failed_no_mutation",
        "startCheckpointId": checkpoint["checkpointId"],
        "baselineAttestationContentSha256": start_attestation["contentSha256"],
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
    if (
        not isinstance(value, dict)
        or not {"formatVersion", "progress", "result"}.issubset(value)
        or not set(value).issubset(
            {
                "formatVersion",
                "progress",
                "result",
                "terminalMarker",
                "recoveredReport",
                "recoveryAck",
            }
        )
    ):
        raise ValueError("persisted execution-track outbox is invalid")
    return value


def acknowledge_outbox(scene: Any, request_id: str) -> bool:
    outbox = load_outbox(scene)
    if outbox is None or outbox["result"].get("requestId") != request_id:
        return False
    del scene[OUTBOX_KEY]
    return True


def resubmit_outbox(transport: Any, scene: Any) -> bool:
    """Queue the exact durable pair again after transport reconstruction."""
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
        transport.submit_execution_track_execution_progress(outbox["progress"])
        transport.submit_execution_track_execution_result(outbox["result"])
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


def build_persisted_failed_managed_recovery_ack(
    request: Any,
    *,
    outbox: dict[str, Any],
    current_lease: Any,
) -> dict[str, Any]:
    """Attest an exact retained failed-managed terminal while preserving its lock."""
    if (
        not isinstance(request, dict)
        or request.get("formatVersion") != "2.0.0"
        or request.get("source") not in {"coordinator_restart", "companion_reported"}
        or request.get("mode") != "read_only_reconcile"
        or request.get("automaticReplay") is not False
        or request.get("replacementLease") != current_lease
    ):
        raise ValueError("execution-track failed-managed recovery request is invalid")
    progress = outbox.get("progress")
    result = outbox.get("result")
    marker = outbox.get("terminalMarker")
    references = request.get("durableReferences")
    if (
        not isinstance(progress, dict)
        or progress.get("phase") != "commit_intent_recorded"
        or not isinstance(result, dict)
        or result.get("status") != "failed_managed"
        or not isinstance(marker, dict)
        or marker.get("terminalStatus") != "failed_managed"
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
        or marker.get("failedObservationContentSha256")
        != result.get("failedObservation", {}).get("contentSha256")
    ):
        raise ValueError("retained failed-managed terminal does not match recovery authority")

    snapshot = _scene_snapshot()
    identity = _identity_hashes(snapshot)
    scene_fingerprint = compute_scene_fingerprint_sha256(snapshot)
    if (
        marker.get("sceneFingerprintSha256") != scene_fingerprint
        or any(marker.get(key) != value for key, value in identity.items())
    ):
        raise ValueError("live Blender state differs from the retained failed terminal")
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
        "retainsTargetLock": True,
        "automaticReplay": False,
        "occurredAt": _now(),
    }


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
        or recovered_report.get("protocolVersion") != "1.6.0"
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
