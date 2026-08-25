"""Cross-process `.blend` recovery proof for the Poke compound history lock."""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

import bpy


sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
EXTENSION_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
sys.path.insert(0, str(EXTENSION_ROOT))

from operating_line.infrastructure.native_history import (  # noqa: E402
    POKE_COMPOUND_HISTORY_MARKER_KEY,
    PokeCompoundHistoryLock,
    PokeCompoundHistoryState,
)


PHASE = os.environ["OPERATINGLINE_POKE_PROCESS_PHASE"]
BLEND_PATH = Path(os.environ["OPERATINGLINE_POKE_PROCESS_BLEND"]).resolve()
RESULT_PATH = Path(os.environ["OPERATINGLINE_POKE_PROCESS_RESULT"]).resolve()
COMPOUND_ID = "00000000-0000-4000-8000-000000000101"
REPLAY_ID = "00000000-0000-4000-8000-000000000102"
INSTANCE_ID = "00000000-0000-4000-8000-000000000103"
IN_PROGRESS_LEAF_ID = "poke.forward.enter_edit"
controller = PokeCompoundHistoryLock()


def digest(value: object) -> str:
    return hashlib.sha256(
        json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def process_identity() -> str:
    return digest({"pid": os.getpid(), "binary": bpy.app.binary_path})


def document_identity() -> str:
    return digest(str(BLEND_PATH))


def marker_identity(scene: bpy.types.Scene) -> str:
    return digest({"compound": COMPOUND_ID, "session": str(scene.session_uid)})


def mesh_snapshot() -> dict[str, object]:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    mesh = active.data
    return {
        "mode": bpy.context.mode,
        "objectName": active.name,
        "meshName": mesh.name,
        "objectPointer": active.as_pointer(),
        "meshPointer": mesh.as_pointer(),
        "meshDatablockCount": len(bpy.data.meshes),
        "vertices": [
            [round(float(component), 9) for component in vertex.co]
            for vertex in mesh.vertices
        ],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
        "selection": {
            "vertices": [vertex.index for vertex in mesh.vertices if vertex.select],
            "edges": [edge.index for edge in mesh.edges if edge.select],
            "polygons": [
                polygon.index for polygon in mesh.polygons if polygon.select
            ],
        },
    }


def host_evidence(
    scene: bpy.types.Scene,
    *,
    persisted: PokeCompoundHistoryState | None = None,
) -> dict[str, object]:
    active = bpy.context.view_layer.objects.active
    assert active is not None and active.type == "MESH"
    snapshot = mesh_snapshot()
    values = {
        "blenderProcessIdentitySha256": process_identity(),
        "blenderSessionUid": str(scene.session_uid),
        "documentFingerprintSha256": document_identity(),
        "nativeHistoryMarkerSha256": marker_identity(scene),
        "objectIdentitySha256": digest({"kind": "object", "name": active.name}),
        "meshIdentitySha256": digest({"kind": "mesh", "name": active.data.name}),
        "objectPointerSha256": digest(str(active.as_pointer())),
        "meshPointerSha256": digest(str(active.data.as_pointer())),
        "meshDatablockSha256": digest(
            {"name": active.data.name, "count": len(bpy.data.meshes)}
        ),
        "topologySha256": digest(
            {
                "vertices": len(active.data.vertices),
                "edges": len(active.data.edges),
                "polygons": len(active.data.polygons),
            }
        ),
        "selectionSha256": digest(snapshot["selection"]),
        "stateSha256": digest(snapshot),
    }
    if persisted is None:
        return values
    return {
        **controller.current_state(persisted),
        **values,
    }


def seed_state(scene: bpy.types.Scene) -> PokeCompoundHistoryState:
    evidence = host_evidence(scene)
    baseline_json = json.dumps(evidence, separators=(",", ":"), sort_keys=True)
    candidate = PokeCompoundHistoryState(
        compound_id=COMPOUND_ID,
        replay_id=REPLAY_ID,
        compound_content_sha256=digest("compound-content"),
        plan_content_sha256=digest("plan-content"),
        target_adapter_id="blender",
        target_instance_id=INSTANCE_ID,
        action_catalog_version="1.24.0",
        interaction_catalog_version="1.50.0",
        recipe_kind="forward",
        lock_token_sha256=digest("history-lock-token"),
        blender_process_identity_sha256=str(
            evidence["blenderProcessIdentitySha256"]
        ),
        blender_session_uid=str(evidence["blenderSessionUid"]),
        document_fingerprint_sha256=str(
            evidence["documentFingerprintSha256"]
        ),
        native_history_marker_sha256=str(
            evidence["nativeHistoryMarkerSha256"]
        ),
        object_identity_sha256=str(evidence["objectIdentitySha256"]),
        mesh_identity_sha256=str(evidence["meshIdentitySha256"]),
        object_pointer_sha256=str(evidence["objectPointerSha256"]),
        mesh_pointer_sha256=str(evidence["meshPointerSha256"]),
        mesh_datablock_sha256=str(evidence["meshDatablockSha256"]),
        topology_sha256=str(evidence["topologySha256"]),
        selection_sha256=str(evidence["selectionSha256"]),
        history_head_sha256=digest("history-head"),
        state_sha256=str(evidence["stateSha256"]),
        integrity_sha256="0" * 64,
        marker_integrity_sha256="0" * 64,
        recorded_object_baseline_json=baseline_json,
        recorded_object_baseline_sha256=controller._domain_hash(
            "operatingline.procedure-compound.recorded-object-baseline.v1",
            evidence,
        ),
        status="recovery_required",
        lifecycle_state="unknown",
        mode="UNKNOWN",
        in_progress_leaf_id=IN_PROGRESS_LEAF_ID,
        leaf_intents=(digest("enter-edit-intent"),),
    )
    return controller.seal(candidate)


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with RESULT_PATH.open("w", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, sort_keys=True)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def save_document() -> None:
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    assert bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH)) == {"FINISHED"}
    assert Path(bpy.data.filepath).resolve() == BLEND_PATH
    assert BLEND_PATH.is_file() and BLEND_PATH.stat().st_size > 10_000


def seed_and_crash() -> None:
    scene = bpy.context.scene
    state = seed_state(scene)
    controller._write(scene, state)
    assert controller.reconcile(scene, host_evidence(scene, persisted=state)) == (
        "same_live_session"
    )
    save_document()
    persisted = controller.read(scene)
    write_result(
        {
            "ok": True,
            "phase": PHASE,
            "blenderVersion": bpy.app.version_string,
            "processIdentitySha256": process_identity(),
            "documentFingerprintSha256": document_identity(),
            "blendBytes": BLEND_PATH.stat().st_size,
            "markerPersisted": POKE_COMPOUND_HISTORY_MARKER_KEY in scene,
            "currentState": controller.current_state(persisted),
            "simulatedCrashExitCode": 23,
        }
    )
    os._exit(23)


def recover_after_process_loss() -> None:
    scene = bpy.context.scene
    before = controller.read(scene)
    observed = host_evidence(scene, persisted=before)
    assert observed["blenderProcessIdentitySha256"] != (
        before.blender_process_identity_sha256
    )
    classification = controller.reconcile_and_quarantine(scene, observed)
    after = controller.read(scene)
    assert classification == "history_lost"
    assert after.status == "history_lost"
    assert after.history_lock == "quarantined"
    assert after.history_continuity == "lost_permanently"
    assert after.native_history_loss_recorded
    assert after.in_progress_leaf_id is None
    assert after.permitted_history_transitions == ("abandon_baseline",)
    save_document()
    write_result(
        {
            "ok": True,
            "phase": PHASE,
            "blenderVersion": bpy.app.version_string,
            "processIdentitySha256": process_identity(),
            "documentFingerprintSha256": document_identity(),
            "classification": classification,
            "beforeStatus": before.status,
            "markerPersisted": POKE_COMPOUND_HISTORY_MARKER_KEY in scene,
            "currentState": controller.current_state(after),
        }
    )


def verify_persisted_quarantine() -> None:
    scene = bpy.context.scene
    before = controller.read(scene)
    assert before.status == "history_lost"
    assert before.history_lock == "quarantined"
    classification = controller.reconcile_and_quarantine(
        scene, host_evidence(scene, persisted=before)
    )
    after = controller.read(scene)
    assert classification == "history_lost"
    assert after.status == "history_lost"
    assert after.history_continuity == "lost_permanently"
    auto_resume_rejected = False
    try:
        controller.record_leaf_intent(
            scene,
            "poke.forward.poke_faces",
            digest("unauthorized-resume"),
        )
    except RuntimeError:
        auto_resume_rejected = True
    assert auto_resume_rejected
    write_result(
        {
            "ok": True,
            "phase": PHASE,
            "blenderVersion": bpy.app.version_string,
            "processIdentitySha256": process_identity(),
            "documentFingerprintSha256": document_identity(),
            "classification": classification,
            "beforeStatus": before.status,
            "markerPersisted": POKE_COMPOUND_HISTORY_MARKER_KEY in scene,
            "autoResumeRejected": auto_resume_rejected,
            "currentState": controller.current_state(after),
        }
    )


if PHASE == "seed-crash":
    seed_and_crash()
elif PHASE == "recover":
    recover_after_process_loss()
elif PHASE == "reload-quarantine":
    verify_persisted_quarantine()
else:
    raise ValueError(f"Unknown Poke process-recovery phase: {PHASE}")
