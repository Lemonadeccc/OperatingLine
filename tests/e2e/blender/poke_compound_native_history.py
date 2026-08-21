"""Foreground proof for Object/Edit Poke Forward, Back, and Redo leaves."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import traceback

import bmesh
import bpy


RESULT_PATH = Path(os.environ["OPERATINGLINE_POKE_COMPOUND_RESULT"])
REPO_ROOT = Path(__file__).resolve().parents[3]
EXTENSION_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
sys.path.insert(0, str(EXTENSION_ROOT))

from operating_line.infrastructure.native_history import (  # noqa: E402
    PokeCompoundHistoryLock,
    PokeCompoundHistoryState,
)


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def mesh_snapshot() -> dict[str, object]:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    mesh = active.data
    if bpy.context.mode == "EDIT_MESH":
        editable = bmesh.from_edit_mesh(mesh)
        editable.verts.ensure_lookup_table()
        editable.edges.ensure_lookup_table()
        editable.faces.ensure_lookup_table()
        editable.verts.index_update()
        editable.edges.index_update()
        editable.faces.index_update()
        vertices = [
            [round(float(component), 9) for component in vertex.co]
            for vertex in editable.verts
        ]
        edges = sorted(
            sorted((edge.verts[0].index, edge.verts[1].index))
            for edge in editable.edges
        )
        faces = sorted(
            sorted(vertex.index for vertex in face.verts) for face in editable.faces
        )
        selection = {
            "vertices": sorted(vertex.index for vertex in editable.verts if vertex.select),
            "edges": sorted(edge.index for edge in editable.edges if edge.select),
            "polygons": sorted(face.index for face in editable.faces if face.select),
        }
    else:
        vertices = [
            [round(float(component), 9) for component in vertex.co]
            for vertex in mesh.vertices
        ]
        edges = sorted(
            sorted((int(edge.vertices[0]), int(edge.vertices[1])))
            for edge in mesh.edges
        )
        faces = sorted(sorted(int(index) for index in face.vertices) for face in mesh.polygons)
        selection = {
            "vertices": sorted(vertex.index for vertex in mesh.vertices if vertex.select),
            "edges": sorted(edge.index for edge in mesh.edges if edge.select),
            "polygons": sorted(face.index for face in mesh.polygons if face.select),
        }
    return {
        "mode": bpy.context.mode,
        "objectName": active.name,
        "meshName": mesh.name,
        "objectPointer": active.as_pointer(),
        "meshPointer": mesh.as_pointer(),
        "meshDatablockCount": len(bpy.data.meshes),
        "topology": {"vertices": len(vertices), "edges": len(edges), "polygons": len(faces)},
        "selection": selection,
        "contentSha256": digest({"vertices": vertices, "edges": edges, "faces": faces}),
    }


def sha(character: str) -> str:
    return character * 64


controller = PokeCompoundHistoryLock()
scene = bpy.context.scene
window = bpy.context.window
assert window is not None
view_area = next(area for area in window.screen.areas if area.type == "VIEW_3D")
view_center = (view_area.x + view_area.width // 2, view_area.y + view_area.height // 2)
snapshots: dict[str, dict[str, object]] = {}
journals: dict[str, dict[str, object]] = {}
reconnect_checks: list[dict[str, object]] = []
negative_checks: dict[str, bool] = {}
terminal_states: dict[str, dict[str, object]] = {}
decision_evidence: dict[str, dict[str, object]] = {}
pending_decision_evidence: dict[int, tuple[str, dict[str, object]]] = {}
object_mode_negative_scene: bpy.types.Scene | None = None


def capture(label: str) -> None:
    snapshots[label] = mesh_snapshot()


def state(recipe_kind: str, status: str) -> PokeCompoundHistoryState:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    snapshot = mesh_snapshot()
    process_identity = digest({"pid": os.getpid(), "binary": bpy.app.binary_path})
    document_identity = digest(bpy.data.filepath or "factory-startup")
    marker_identity = digest(
        {"compound": "00000000-0000-4000-8000-000000000001", "session": scene.session_uid}
    )
    baseline = {
        "blenderProcessIdentitySha256": process_identity,
        "blenderSessionUid": str(scene.session_uid),
        "documentFingerprintSha256": document_identity,
        "nativeHistoryMarkerSha256": marker_identity,
        "historyHeadSha256": sha("d"),
        "objectIdentitySha256": digest({"kind": "object", "name": active.name}),
        "meshIdentitySha256": digest({"kind": "mesh", "name": active.data.name}),
        "objectPointerSha256": digest(str(active.as_pointer())),
        "meshPointerSha256": digest(str(active.data.as_pointer())),
        "meshDatablockSha256": digest(
            {"name": active.data.name, "count": len(bpy.data.meshes)}
        ),
        "topologySha256": digest(snapshot["topology"]),
        "selectionSha256": digest(snapshot["selection"]),
        "stateSha256": digest(snapshot),
    }
    baseline_json = json.dumps(baseline, separators=(",", ":"), sort_keys=True)
    candidate = PokeCompoundHistoryState(
        compound_id="00000000-0000-4000-8000-000000000001",
        replay_id="00000000-0000-4000-8000-000000000002",
        compound_content_sha256=sha("1"),
        plan_content_sha256=sha("2"),
        target_adapter_id="blender",
        target_instance_id="00000000-0000-4000-8000-000000000003",
        action_catalog_version="1.22.0",
        interaction_catalog_version="1.40.0",
        recipe_kind=recipe_kind,
        lock_token_sha256=sha("a"),
        blender_process_identity_sha256=process_identity,
        blender_session_uid=str(scene.session_uid),
        document_fingerprint_sha256=document_identity,
        native_history_marker_sha256=marker_identity,
        object_identity_sha256=digest({"kind": "object", "name": active.name}),
        mesh_identity_sha256=digest({"kind": "mesh", "name": active.data.name}),
        object_pointer_sha256=digest(str(active.as_pointer())),
        mesh_pointer_sha256=digest(str(active.data.as_pointer())),
        mesh_datablock_sha256=digest({"name": active.data.name, "count": len(bpy.data.meshes)}),
        topology_sha256=digest(snapshot["topology"]),
        selection_sha256=digest(snapshot["selection"]),
        history_head_sha256=sha("d"),
        state_sha256=digest(snapshot),
        integrity_sha256=sha("0"),
        marker_integrity_sha256=sha("0"),
        recorded_object_baseline_json=baseline_json,
        recorded_object_baseline_sha256=controller._domain_hash(
            "operatingline.procedure-compound.recorded-object-baseline.v1", baseline
        ),
        status=status,
        lifecycle_state="object_baseline",
        mode="OBJECT",
    )
    return controller.seal(candidate)


def decision(transition: str, target_scene: bpy.types.Scene = scene) -> dict[str, object]:
    current = controller.read(target_scene) if transition != "forward" else None
    source = current if current is not None else state("forward", "intent_recorded")
    issued = datetime.now(timezone.utc)
    ids = {
        "forward": "30000000-0000-4000-8000-000000000001",
        "back": "30000000-0000-4000-8000-000000000002",
        "redo": "30000000-0000-4000-8000-000000000003",
        "unlock_final": "30000000-0000-4000-8000-000000000004",
        "abandon_baseline": "30000000-0000-4000-8000-000000000005",
        "abandon_baseline_history_lost": "30000000-0000-4000-8000-000000000006",
    }
    evidence_key = (
        "abandon_baseline_history_lost"
        if transition == "abandon_baseline" and source.status == "history_lost"
        else transition
    )
    common = {
        "formatVersion": "1.0.0",
        "decisionId": ids[evidence_key],
        "nonce": f"poke_{evidence_key}_single_use_nonce",
        "issuedAt": issued.isoformat().replace("+00:00", "Z"),
        "expiresAt": (issued + timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
    }
    if transition == "forward":
        receipt = {
            **common,
            "kind": "BlenderExecutionDecisionReceipt",
            "acceptedContentSha256": source.plan_content_sha256,
            "acceptedContentKind": "plan",
            "replayId": source.replay_id,
            "target": {
                "adapterId": source.target_adapter_id,
                "instanceId": source.target_instance_id,
            },
            "blenderSessionId": source.blender_session_uid,
            "documentFingerprintSha256": source.document_fingerprint_sha256,
            "actionCatalogVersion": source.action_catalog_version,
            "interactionCatalogVersion": source.interaction_catalog_version,
        }
        binding = {
            "acceptedContentSha256": source.plan_content_sha256,
            "acceptedContentKind": "plan",
            "replayId": source.replay_id,
            "adapterId": source.target_adapter_id,
            "instanceId": source.target_instance_id,
            "blenderSessionId": source.blender_session_uid,
            "documentFingerprintSha256": source.document_fingerprint_sha256,
            "actionCatalogVersion": source.action_catalog_version,
            "interactionCatalogVersion": source.interaction_catalog_version,
        }
        consumption_kind = "blender_decision_consumed"
    else:
        terminal_hash = (
            digest({"transition": transition, "state": controller.current_state(source)})
            if transition in {"unlock_final", "abandon_baseline"}
            else None
        )
        receipt = {
            **common,
            "kind": "BlenderHistoryTransitionDecisionReceipt",
            "compoundId": source.compound_id,
            "replayId": source.replay_id,
            "target": {
                "adapterId": source.target_adapter_id,
                "instanceId": source.target_instance_id,
            },
            "blenderProcessIdentitySha256": source.blender_process_identity_sha256,
            "blenderSessionUid": source.blender_session_uid,
            "documentFingerprintSha256": source.document_fingerprint_sha256,
            "compoundContentSha256": source.compound_content_sha256,
            "historyLockTokenSha256": source.lock_token_sha256,
            "currentStateSha256": source.integrity_sha256,
            "expectedHistoryHeadSha256": source.history_head_sha256,
            "transition": transition,
            "expectedStatus": source.status,
            "terminalObservationSha256": terminal_hash,
            "nativeHistoryLossRecorded": source.native_history_loss_recorded,
            "actionCatalogVersion": source.action_catalog_version,
            "interactionCatalogVersion": source.interaction_catalog_version,
        }
        binding = {
            "compoundId": source.compound_id,
            "replayId": source.replay_id,
            "adapterId": source.target_adapter_id,
            "instanceId": source.target_instance_id,
            "blenderProcessIdentitySha256": source.blender_process_identity_sha256,
            "blenderSessionUid": source.blender_session_uid,
            "documentFingerprintSha256": source.document_fingerprint_sha256,
            "compoundContentSha256": source.compound_content_sha256,
            "historyLockTokenSha256": source.lock_token_sha256,
            "currentStateSha256": source.integrity_sha256,
            "expectedHistoryHeadSha256": source.history_head_sha256,
            "transition": transition,
            "expectedStatus": source.status,
            "terminalObservationSha256": terminal_hash,
            "nativeHistoryLossRecorded": source.native_history_loss_recorded,
            "actionCatalogVersion": source.action_catalog_version,
            "interactionCatalogVersion": source.interaction_catalog_version,
        }
        consumption_kind = "blender_history_transition_consumed"
    single_use = hashlib.sha256(controller._canonical({"nonce": receipt["nonce"]})).hexdigest()
    binding_sha = hashlib.sha256(
        controller._canonical(
            {
                "decisionSha256": hashlib.sha256(controller._canonical(receipt)).hexdigest(),
                "binding": binding,
            }
        )
    ).hexdigest()
    consumption = {
        "formatVersion": "1.0.0",
        "eventId": ids[evidence_key].replace("30000000", "40000000"),
        "sequence": len(decision_evidence),
        "kind": consumption_kind,
        "credentialId": receipt["decisionId"],
        "singleUseKeySha256": single_use,
        "operationId": ids[evidence_key].replace("30000000", "50000000"),
        "bindingSha256": binding_sha,
        "consumedAt": receipt["issuedAt"],
    }
    evidence = {"receipt": receipt, "binding": binding, "consumption": consumption}
    pending_decision_evidence[id(evidence)] = (evidence_key, {
        **evidence,
        "currentState": controller.current_state(source),
        "planContentSha256": source.plan_content_sha256,
        "target": {
            "adapterId": source.target_adapter_id,
            "instanceId": source.target_instance_id,
        },
        "actionCatalogVersion": source.action_catalog_version,
        "interactionCatalogVersion": source.interaction_catalog_version,
    })
    return evidence


def retain_consumed_decision(
    evidence: dict[str, object], resulting_state: PokeCompoundHistoryState
) -> None:
    evidence_key, projection = pending_decision_evidence.pop(id(evidence))
    journal_hashes = list(resulting_state.decision_consumption_sha256s)
    consumption_sha256 = hashlib.sha256(
        controller._canonical(evidence["consumption"])
    ).hexdigest()
    assert consumption_sha256 in journal_hashes
    if evidence_key in decision_evidence:
        raise RuntimeError(f"Consumed decision evidence {evidence_key} was already retained")
    decision_evidence[evidence_key] = {
        **projection,
        "journalDecisionConsumptionSha256s": journal_hashes,
    }
    journals[f"{evidence_key}DecisionConsumption"] = controller._encode(
        resulting_state
    )


def observed(snapshot: dict[str, object], history_head_sha256: str) -> dict[str, str]:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    marker = controller.read(scene)
    return {
        "objectIdentitySha256": digest({"kind": "object", "name": active.name}),
        "meshIdentitySha256": digest({"kind": "mesh", "name": active.data.name}),
        "objectPointerSha256": digest(str(active.as_pointer())),
        "meshPointerSha256": digest(str(active.data.as_pointer())),
        "meshDatablockSha256": digest(
            {"name": active.data.name, "count": len(bpy.data.meshes)}
        ),
        "topologySha256": digest(snapshot["topology"]),
        "selectionSha256": digest(snapshot["selection"]),
        "stateSha256": digest(snapshot),
        "historyHeadSha256": history_head_sha256,
        "compoundId": marker.compound_id,
        "replayId": marker.replay_id,
        "compoundContentSha256": marker.compound_content_sha256,
        "historyLockTokenSha256": marker.lock_token_sha256,
        "blenderProcessIdentitySha256": marker.blender_process_identity_sha256,
        "blenderSessionUid": marker.blender_session_uid,
        "documentFingerprintSha256": marker.document_fingerprint_sha256,
        "nativeHistoryMarkerSha256": marker.native_history_marker_sha256,
    }


def record_reconnect(boundary: str) -> None:
    before = controller.read(scene)
    exact = controller.current_state(before)
    rebuilt = PokeCompoundHistoryLock()
    same = rebuilt.reconcile(scene, exact) == "same_live_session"
    conflict = rebuilt.reconcile(
        scene, {**exact, "selectionSha256": sha("f")}
    ) == "history_conflict"
    lost = rebuilt.reconcile(
        scene, {**exact, "blenderProcessIdentitySha256": sha("e")}
    ) == "history_lost"
    after = rebuilt.read(scene)
    reconnect_checks.append(
        {
            "boundary": boundary,
            "sameLiveSession": same,
            "conflict": conflict,
            "permanentHistoryLoss": lost,
            "noAutoResume": before == after,
        }
    )


def begin_leaf(recipe: str, index: int) -> None:
    controller.record_leaf_intent(
        scene,
        f"{recipe}.leaf.{index}",
        digest({"recipe": recipe, "leaf": index, "kind": "intent"}),
    )
    record_reconnect(f"{recipe}.leaf.{index}.intent")


def finish_leaf(
    recipe: str,
    index: int,
    *,
    proof: bool,
    operation_count: int,
) -> None:
    snapshot = mesh_snapshot()
    head = digest({"recipe": recipe, "leaf": index, "state": snapshot})
    controller.record_leaf_receipt(
        scene,
        recipe,
        digest({"recipe": recipe, "leaf": index, "kind": "receipt"}),
        mode=bpy.context.mode,
        history_proof_attached=proof,
        native_history_operation_count=operation_count,
        history_head_sha256=head,
        observed=observed(snapshot, head),
        checkpoint_sha256=digest(f"checkpoint:{recipe}") if proof else None,
    )
    record_reconnect(f"{recipe}.leaf.{index}.receipt")


def finish_native_history_leaf(recipe: str, index: int) -> None:
    finish_leaf(recipe, index, proof=True, operation_count=1)


def finish_poke_leaf() -> None:
    finish_leaf("forward", 2, proof=True, operation_count=0)


def simulate_event(
    event_type: str,
    value: str = "PRESS",
    *,
    unicode: str = "",
    ctrl: bool = False,
    shift: bool = False,
) -> None:
    event = {
        "type": event_type,
        "value": value,
        "x": view_center[0],
        "y": view_center[1],
        "ctrl": ctrl,
        "shift": shift,
    }
    if unicode:
        event["unicode"] = unicode
    window.event_simulate(**event)


def simulate_history_shortcut(*, redo: bool) -> None:
    simulate_event("Z", ctrl=True, shift=redo)
    simulate_event("Z", "RELEASE", ctrl=True, shift=redo)


def forward_enter() -> None:
    capture("objectBaseline")
    forward_decision = decision("forward")
    controller.acquire(scene, state("forward", "intent_recorded"), forward_decision)
    retain_consumed_decision(forward_decision, controller.read(scene))
    retained_forward = json.dumps(decision_evidence["forward"], sort_keys=True)
    duplicate_forward = decision("forward")
    duplicate_decision_rejected = False
    try:
        controller._consume_decision(
            controller.read(scene),
            duplicate_forward,
            "BlenderExecutionDecisionReceipt",
            "forward",
        )
    except RuntimeError:
        duplicate_decision_rejected = True
    pending_decision_evidence.pop(id(duplicate_forward), None)
    negative_checks["forwardDecisionSingleUse"] = (
        duplicate_decision_rejected
        and json.dumps(decision_evidence["forward"], sort_keys=True) == retained_forward
    )
    begin_leaf("forward", 1)
    assert bpy.ops.object.mode_set(mode="EDIT") == {"FINISHED"}
    assert bpy.ops.mesh.select_all(action="SELECT") == {"FINISHED"}
    capture("forwardEditBaseline")
    wrong_leaf_proof_rejected = False
    try:
        finish_leaf("forward", 1, proof=True, operation_count=0)
    except RuntimeError:
        wrong_leaf_proof_rejected = True
    negative_checks["historyProofOnModeLeafRejected"] = wrong_leaf_proof_rejected
    finish_leaf("forward", 1, proof=False, operation_count=0)
    assert bpy.ops.ed.undo_push(message="OperatingLine compound Edit baseline") == {
        "FINISHED"
    }
    begin_leaf("forward", 2)


def forward_poke_receipt() -> None:
    capture("forwardEditFinal")
    finish_poke_leaf()


def forward_exit() -> None:
    begin_leaf("forward", 3)
    assert bpy.ops.object.mode_set(mode="OBJECT") == {"FINISHED"}
    capture("objectFinal")
    finish_leaf("forward", 3, proof=False, operation_count=0)
    terminal_states["forward"] = controller.current_state(controller.read(scene))
    journals["forward"] = controller._encode(controller.read(scene))  # type: ignore[assignment]


def back_enter() -> None:
    back_decision = decision("back")
    back_state = controller.begin_recipe(scene, "back", back_decision)
    retain_consumed_decision(back_decision, back_state)
    begin_leaf("back", 1)
    assert bpy.ops.object.mode_set(mode="EDIT") == {"FINISHED"}
    capture("backEditFinal")
    finish_leaf("back", 1, proof=False, operation_count=0)


def back_undo() -> None:
    begin_leaf("back", 2)
    simulate_history_shortcut(redo=False)


def back_receipt() -> None:
    zero_operation_rejected = False
    try:
        finish_leaf("back", 2, proof=True, operation_count=0)
    except RuntimeError:
        zero_operation_rejected = True
    negative_checks["zeroHistoryOperationsRejected"] = zero_operation_rejected
    controller.record_native_history_operation(scene, "undo")
    second_operation_rejected = False
    try:
        controller.record_native_history_operation(scene, "undo")
    except RuntimeError:
        second_operation_rejected = True
    negative_checks["twoHistoryOperationsRejected"] = second_operation_rejected
    capture("backEditBaseline")
    finish_native_history_leaf("back", 2)


def back_exit() -> None:
    begin_leaf("back", 3)
    assert bpy.ops.object.mode_set(mode="OBJECT") == {"FINISHED"}
    capture("objectRestored")
    finish_leaf("back", 3, proof=False, operation_count=0)
    terminal_states["back"] = controller.current_state(controller.read(scene))
    journals["back"] = controller._encode(controller.read(scene))  # type: ignore[assignment]
    exact = controller.current_state(controller.read(scene))
    negative_checks["externalHistoryMutationRejected"] = (
        controller.reconcile(scene, {**exact, "historyHeadSha256": sha("f")})
        == "history_conflict"
    )
    negative_checks["wrongPointerRejected"] = (
        controller.reconcile(scene, {**exact, "objectPointerSha256": sha("f")})
        == "history_conflict"
    )
    negative_checks["wrongDatablockRejected"] = (
        controller.reconcile(scene, {**exact, "meshDatablockSha256": sha("f")})
        == "history_conflict"
    )
    negative_checks["wrongSelectionRejected"] = (
        controller.reconcile(scene, {**exact, "selectionSha256": sha("f")})
        == "history_conflict"
    )
    tamper_scene = bpy.data.scenes.new("OperatingLineMarkerTamperProof")
    tamper_payload = json.loads(scene["_operating_line_poke_compound_history_v1"])
    tamper_payload["leafReceipts"][0] = sha("f")
    tamper_scene["_operating_line_poke_compound_history_v1"] = json.dumps(
        tamper_payload, separators=(",", ":"), sort_keys=True
    )
    marker_tamper_rejected = False
    try:
        PokeCompoundHistoryLock().read(tamper_scene)
    except RuntimeError:
        marker_tamper_rejected = True
    negative_checks["fullMarkerJournalTamperRejected"] = marker_tamper_rejected
    checkpoint_scene = bpy.data.scenes.new("OperatingLineMissingCheckpointProof")
    missing_checkpoint = controller.seal(
        replace(controller.read(scene), checkpoint_sha256=None)
    )
    checkpoint_scene["_operating_line_poke_compound_history_v1"] = controller._encode(
        missing_checkpoint
    )
    missing_checkpoint_rejected = False
    try:
        PokeCompoundHistoryLock().read(checkpoint_scene)
    except RuntimeError:
        missing_checkpoint_rejected = True
    negative_checks["terminalMissingCheckpointRejected"] = missing_checkpoint_rejected
    conflict_scene = bpy.data.scenes.new("OperatingLineConflictProof")
    conflict_scene["_operating_line_poke_compound_history_v1"] = scene[
        "_operating_line_poke_compound_history_v1"
    ]
    conflict_observed = controller.current_state(controller.read(conflict_scene))
    negative_checks["historyConflictDurablyQuarantined"] = (
        PokeCompoundHistoryLock().reconcile_and_quarantine(
            conflict_scene,
            {**conflict_observed, "historyHeadSha256": sha("f")},
        )
        == "history_conflict"
        and PokeCompoundHistoryLock().read(conflict_scene).status == "history_conflict"
    )
    conflict_transition_rejected = False
    try:
        PokeCompoundHistoryLock().begin_recipe(
            conflict_scene, "redo", decision("redo")
        )
    except RuntimeError:
        conflict_transition_rejected = True
    negative_checks["historyConflictForbidsRedo"] = conflict_transition_rejected

    lost_scene = bpy.data.scenes.new("OperatingLineLostProof")
    lost_scene["_operating_line_poke_compound_history_v1"] = scene[
        "_operating_line_poke_compound_history_v1"
    ]
    lost_observed = controller.current_state(controller.read(lost_scene))
    negative_checks["historyLossDurablyQuarantined"] = (
        PokeCompoundHistoryLock().reconcile_and_quarantine(
            lost_scene,
            {**lost_observed, "blenderProcessIdentitySha256": sha("e")},
        )
        == "history_lost"
        and PokeCompoundHistoryLock().read(lost_scene).status == "history_lost"
    )
    lost_transition_rejected = False
    try:
        PokeCompoundHistoryLock().begin_recipe(
            lost_scene, "redo", decision("redo")
        )
    except RuntimeError:
        lost_transition_rejected = True
    negative_checks["historyLossForbidsRedo"] = lost_transition_rejected
    lost_controller = PokeCompoundHistoryLock()
    lost_baseline = json.loads(
        lost_controller.read(lost_scene).recorded_object_baseline_json
    )
    lost_abandon = decision("abandon_baseline", lost_scene)
    weak_abandon_rejected = False
    try:
        lost_controller.release(
            lost_scene,
            "abandon_baseline",
            lost_abandon,
            {**lost_baseline, "selectionSha256": sha("f")},
        )
    except RuntimeError:
        weak_abandon_rejected = True
    negative_checks["historyLossWeakAbandonRejected"] = weak_abandon_rejected
    lost_abandon_journal = lost_controller._consume_decision(
        lost_controller.read(lost_scene),
        lost_abandon,
        "BlenderHistoryTransitionDecisionReceipt",
        "abandon_baseline",
    )
    lost_terminal = lost_controller.release(
        lost_scene,
        "abandon_baseline",
        lost_abandon,
        lost_baseline,
    )
    terminal_states["abandonAfterHistoryLoss"] = lost_terminal
    retain_consumed_decision(lost_abandon, lost_abandon_journal)
    negative_checks["historyLossExactBaselineAbandonReleased"] = (
        lost_scene.get("_operating_line_poke_compound_history_v1") is None
    )

    abandon_scene = bpy.data.scenes.new("OperatingLineAbandonProof")
    abandon_scene["_operating_line_poke_compound_history_v1"] = scene[
        "_operating_line_poke_compound_history_v1"
    ]
    abandon_observed = controller.current_state(controller.read(abandon_scene))
    abandon_decision = decision("abandon_baseline", abandon_scene)
    abandon_journal = controller._consume_decision(
        controller.read(abandon_scene),
        abandon_decision,
        "BlenderHistoryTransitionDecisionReceipt",
        "abandon_baseline",
    )
    abandon_terminal = PokeCompoundHistoryLock().release(
        abandon_scene,
        "abandon_baseline",
        abandon_decision,
        abandon_observed,
    )
    terminal_states["abandonBaseline"] = abandon_terminal
    retain_consumed_decision(abandon_decision, abandon_journal)
    negative_checks["abandonBaselineReleased"] = (
        abandon_scene.get("_operating_line_poke_compound_history_v1") is None
    )


def redo_enter() -> None:
    redo_decision = decision("redo")
    redo_state = controller.begin_recipe(scene, "redo", redo_decision)
    retain_consumed_decision(redo_decision, redo_state)
    begin_leaf("redo", 1)
    assert bpy.ops.object.mode_set(mode="EDIT") == {"FINISHED"}
    capture("redoEditBaseline")
    finish_leaf("redo", 1, proof=False, operation_count=0)


def redo_operation() -> None:
    begin_leaf("redo", 2)
    simulate_history_shortcut(redo=True)


def redo_receipt() -> None:
    controller.record_native_history_operation(scene, "redo")
    capture("redoEditFinal")
    finish_native_history_leaf("redo", 2)


def redo_exit() -> None:
    begin_leaf("redo", 3)
    assert bpy.ops.object.mode_set(mode="OBJECT") == {"FINISHED"}
    capture("objectReapplied")
    finish_leaf("redo", 3, proof=False, operation_count=0)
    terminal_states["redo"] = controller.current_state(controller.read(scene))
    journals["redo"] = controller._encode(controller.read(scene))  # type: ignore[assignment]


def object_mode_negative_undo() -> None:
    global object_mode_negative_scene
    assert bpy.context.mode == "OBJECT"
    object_mode_negative_scene = bpy.data.scenes.new("OperatingLineObjectUndoNegative")
    object_mode_negative_scene["_operating_line_poke_compound_history_v1"] = scene[
        "_operating_line_poke_compound_history_v1"
    ]
    simulate_history_shortcut(redo=False)


def object_mode_negative_check_and_redo() -> None:
    assert object_mode_negative_scene is not None
    changed = mesh_snapshot()
    negative_checks["objectModeUndoActuallyChangedState"] = (
        changed["contentSha256"] == snapshots["objectBaseline"]["contentSha256"]
    )
    stale = PokeCompoundHistoryLock().current_state(
        PokeCompoundHistoryLock().read(object_mode_negative_scene)
    )
    classification = PokeCompoundHistoryLock().reconcile_and_quarantine(
        object_mode_negative_scene,
        {
            **stale,
            "historyHeadSha256": digest("external-object-mode-undo"),
            "topologySha256": digest(changed["topology"]),
            "selectionSha256": digest(changed["selection"]),
            "stateSha256": digest(changed),
        },
    )
    negative_checks["objectModeUndoRejectedWithoutCompoundProof"] = (
        classification == "history_conflict"
        and PokeCompoundHistoryLock().read(object_mode_negative_scene).status
        == "history_conflict"
    )
    simulate_history_shortcut(redo=True)


def object_mode_negative_redo_check() -> None:
    restored = mesh_snapshot()
    negative_checks["objectModeNegativeRestoredForHarness"] = (
        restored["contentSha256"] == snapshots["objectFinal"]["contentSha256"]
    )


def finish() -> None:
    baseline = snapshots["objectBaseline"]
    final = snapshots["objectFinal"]
    checks = {
        "forwardObjectToObject": (
            baseline["mode"] == "OBJECT" and final["mode"] == "OBJECT"
        ),
        "forwardTopology": (
            baseline["topology"] == {"vertices": 8, "edges": 12, "polygons": 6}
            and final["topology"]
            == {"vertices": 14, "edges": 36, "polygons": 24}
        ),
        "backEditExact": (
            snapshots["backEditBaseline"]["contentSha256"]
            == snapshots["forwardEditBaseline"]["contentSha256"]
        ),
        "backObjectExact": (
            snapshots["objectRestored"]["contentSha256"]
            == baseline["contentSha256"]
        ),
        "redoEditExact": (
            snapshots["redoEditFinal"]["contentSha256"]
            == snapshots["forwardEditFinal"]["contentSha256"]
        ),
        "redoObjectExact": (
            snapshots["objectReapplied"]["contentSha256"]
            == final["contentSha256"]
        ),
        "identityStable": all(
            snapshot["objectName"] == baseline["objectName"]
            and snapshot["meshName"] == baseline["meshName"]
            and snapshot["objectPointer"] == baseline["objectPointer"]
            and snapshot["meshPointer"] == baseline["meshPointer"]
            and snapshot["meshDatablockCount"] == baseline["meshDatablockCount"]
            for snapshot in snapshots.values()
        ),
        "lockSurvivesRoundTrip": controller.read(scene).status == "reapplied_locked",
        "reconnectAfterEveryLeaf": len(reconnect_checks) == 18
        and all(
            item["sameLiveSession"]
            and item["conflict"]
            and item["permanentHistoryLoss"]
            and item["noAutoResume"]
            for item in reconnect_checks
        ),
        "distinctDecisionConsumptions": len(controller.read(scene).consumed_decision_keys) == 3,
        "noObjectModeTransactionClaim": True,
        "negativeCases": all(negative_checks.values()),
    }
    final_observed = controller.current_state(controller.read(scene))
    unlock_decision = decision("unlock_final")
    unlock_journal = controller._consume_decision(
        controller.read(scene),
        unlock_decision,
        "BlenderHistoryTransitionDecisionReceipt",
        "unlock_final",
    )
    unlock_terminal = controller.release(
        scene, "unlock_final", unlock_decision, final_observed
    )
    terminal_states["unlockFinal"] = unlock_terminal
    retain_consumed_decision(unlock_decision, unlock_journal)
    checks["unlockFinalReleased"] = (
        scene.get("_operating_line_poke_compound_history_v1") is None
    )
    payload = {
        "ok": all(checks.values()),
        "blenderVersion": bpy.app.version_string,
        "checks": checks,
        "snapshots": snapshots,
        "journals": journals,
        "reconnectChecks": reconnect_checks,
        "negativeChecks": negative_checks,
        "terminalStates": terminal_states,
        "decisionEvidence": decision_evidence,
    }
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        "POKE_COMPOUND_NATIVE_HISTORY "
        + json.dumps(
            {
                "ok": payload["ok"],
                "blenderVersion": payload["blenderVersion"],
                "checks": payload["checks"],
            },
            sort_keys=True,
        ),
        flush=True,
    )
    if not payload["ok"]:
        raise RuntimeError("Poke compound native-history checks failed")
    bpy.ops.wm.quit_blender()


def key_steps(event_type: str, *, ctrl: bool = False, shift: bool = False):
    return [
        lambda: simulate_event(event_type, ctrl=ctrl, shift=shift),
        lambda: simulate_event(event_type, "RELEASE", ctrl=ctrl, shift=shift),
    ]


poke_search_steps = []
poke_search_steps.extend(key_steps("F3"))
for character in "poke faces":
    event_type = "SPACE" if character == " " else character.upper()
    poke_search_steps.append(
        lambda event_type=event_type, character=character: simulate_event(
            event_type,
            unicode=character,
        )
    )
poke_search_steps.extend(key_steps("RET"))

steps = [
    lambda: simulate_event("MOUSEMOVE", "NOTHING"),
    forward_enter,
    *poke_search_steps,
    forward_poke_receipt,
    forward_exit,
    back_enter,
    back_undo,
    back_receipt,
    back_exit,
    redo_enter,
    redo_operation,
    redo_receipt,
    redo_exit,
    object_mode_negative_undo,
    object_mode_negative_check_and_redo,
    object_mode_negative_redo_check,
    finish,
]


def advance() -> float | None:
    if not steps:
        return None
    operation = steps.pop(0)
    try:
        operation()
    except BaseException as error:
        payload = {
            "ok": False,
            "blenderVersion": bpy.app.version_string,
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
            "snapshots": snapshots,
        }
        RESULT_PATH.write_text(
            json.dumps(payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(
            "POKE_COMPOUND_NATIVE_HISTORY_FAIL "
            + json.dumps(payload, sort_keys=True),
            flush=True,
        )
        os._exit(1)
    return 0.25


bpy.app.timers.register(advance, first_interval=0.5)
