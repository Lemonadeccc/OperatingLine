"""Capture one isolated Blender guidance state for visual acceptance.

The Node launcher runs this script in a fresh Blender process for each state so
the real Panel popover is drawn from current data without stacked UI snapshots.
"""

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path
from queue import Queue
import uuid

import bpy
from mathutils import Quaternion, Vector
import numpy as np

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
OUTPUT_DIRECTORY = REPO_ROOT / "artifacts" / "blender"
OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
STATE = os.environ.get("OPERATINGLINE_VISUAL_STATE", "forward")
OUTPUT_NAMES = {
    "initial": "guidance-initial.png",
    "goal-request": "guidance-goal-request.png",
    "revision": "guidance-revision-request.png",
    "revision-collapsed": "guidance-revision-collapsed.png",
    "proposal": "guidance-proposal-review.png",
    "initial-provider-disclosure": "guidance-initial-provider-disclosure.png",
    "initial-provider-generating": "guidance-initial-provider-generating.png",
    "initial-provider-failed": "guidance-initial-provider-failed.png",
    "provider-disclosure": "guidance-provider-disclosure.png",
    "provider-generating": "guidance-provider-generating.png",
    "forward": "guidance-mid-forward.png",
    "back": "guidance-after-back.png",
    "hidden": "guidance-hidden.png",
    "operator": "guidance-operator-fallback.png",
    "menu-add": "guidance-menu-add.png",
    "menu-mesh": "guidance-menu-mesh.png",
    "menu-cube": "guidance-menu-cube.png",
    "menu-icosphere": "guidance-menu-icosphere.png",
    "menu-torus": "guidance-menu-torus.png",
    "menu-cone": "guidance-menu-cone.png",
    "menu-cylinder": "guidance-menu-cylinder.png",
}
if STATE not in OUTPUT_NAMES:
    raise ValueError(f"Unknown visual capture state: {STATE}")
OUTPUT = OUTPUT_DIRECTORY / OUTPUT_NAMES[STATE]
SMOKE_OUTPUT = OUTPUT_DIRECTORY / "overlay-smoke.png"
DOCS_MENU_OUTPUT = REPO_ROOT / "docs" / "assets" / "blender-menu-guidance.png"

spec = importlib.util.spec_from_file_location(
    "operating_line_visual_smoke",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

from operating_line_visual_smoke.operating_line.application import (  # noqa: E402
    GuidanceState,
)
from operating_line_visual_smoke.operating_line.infrastructure.overlay import (  # noqa: E402
    _semantic_hint,
)
from operating_line_visual_smoke.operating_line.presentation.native_menu_guidance import (  # noqa: E402
    interaction_guidance_snapshot,
)
from operating_line_visual_smoke.operating_line.visual_theme import (  # noqa: E402
    color_for,
)

extension.register()
bpy.context.preferences.use_preferences_save = False
bpy.context.preferences.view.use_translate_interface = False
factory_objects = {
    name: bpy.data.objects.get(name) for name in ("Cube", "Camera", "Light")
}
assert all(factory_objects.values())
factory_pointers = {name: obj.as_pointer() for name, obj in factory_objects.items()}
assert bpy.ops.operating_line.start() == {"FINISHED"}
session = extension.get_session()
assert session.active_index == -1
initial_receipts = tuple(session.receipts)


class StrictFakeTransport:
    """Keep visual provider states connected without making network requests."""

    def __init__(self):
        self.incoming = Queue()
        self.running = True
        self.last_delivered_sequence = 0
        self.replan_run_requests = []
        self.initial_plan_run_requests = []
        self.goal_requests = []

    def start_replan_run(self, request):
        self.replan_run_requests.append(json.loads(json.dumps(request)))

    def start_initial_plan_run(self, request):
        self.initial_plan_run_requests.append(json.loads(json.dumps(request)))

    def submit_goal_request(self, request):
        self.goal_requests.append(json.loads(json.dumps(request)))

    def stop(self, *, flush_timeout=0.0):
        del flush_timeout
        self.running = False

    def wait_stopped(self, _timeout):
        return not self.running


def assert_factory_objects_preserved():
    for name, obj in factory_objects.items():
        assert bpy.data.objects.get(name) is obj
        assert obj.as_pointer() == factory_pointers[name]


def assert_active_session_preserved():
    assert extension.get_session() is session
    assert session.active_index == -1
    assert tuple(session.receipts) == initial_receipts == ()


def visual_provider_list():
    return {
        "contractVersion": "1.0.0",
        "generationAvailable": True,
        "providers": [
            {
                "contractVersion": "1.0.0",
                "id": "visual.remote-planner",
                "version": "1.0.0",
                "displayName": "Remote Snowman Planner",
                "description": "Creates one review-only Blender plan proposal.",
                "availability": {"available": True},
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "remote",
                    "dataTransmission": "provider_managed",
                    "credentialManagement": "provider_managed",
                },
            }
        ],
    }


def configure_provider_handoff(*, generating):
    companion = extension.get_companion()
    fake_transport = StrictFakeTransport()
    companion._transport = fake_transport
    companion.status = "Connected"
    companion.provider_handoff.set_providers(visual_provider_list())
    companion.select_replan_provider("visual.remote-planner")
    revision_request_id = str(uuid.uuid4())
    companion.provider_handoff.revision_submitted(revision_request_id)
    companion.provider_handoff.revision_acknowledged(revision_request_id)
    companion.last_revision_request_id = revision_request_id
    companion.revision_request_status = (
        f"Request {revision_request_id[:8]} stored in runtime for MCP planner"
    )
    if generating:
        run = companion.begin_replan_run()
        companion.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": run["generationRequestId"],
                "revisionRequestId": revision_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": companion.instance_id,
                "provider": {
                    "id": "visual.remote-planner",
                    "version": "1.0.0",
                    "displayName": "Remote Snowman Planner",
                },
                "status": "generating",
                "terminal": False,
                "sceneChanged": False,
                "proposalId": None,
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:00Z",
            }
        )
        assert len(fake_transport.replan_run_requests) == 1
        assert companion.provider_handoff.generation_request_id is not None
        assert companion.provider_handoff.phase == "generating"
    else:
        assert companion.provider_handoff.can_run
        assert not fake_transport.replan_run_requests
    assert_active_session_preserved()


def configure_goal_request():
    companion = extension.get_companion()
    fake_transport = StrictFakeTransport()
    companion._transport = fake_transport
    companion.status = "Connected"
    request = companion.submit_goal_request(
        "Create a friendly low-poly robot with simple materials"
    )
    companion.goal_request.delivering(request["requestId"])
    companion.goal_request.acknowledged(request["requestId"])
    companion.initial_plan_handoff.goal_acknowledged(request["requestId"])
    assert fake_transport.goal_requests == [request]
    assert companion.goal_request.phase == "awaiting_planner"
    assert_active_session_preserved()


def configure_initial_provider_handoff(*, generating, failed=False):
    assert not (generating and failed)
    configure_goal_request()
    companion = extension.get_companion()
    fake_transport = companion._transport
    assert isinstance(fake_transport, StrictFakeTransport)
    companion.initial_plan_handoff.set_providers(visual_provider_list())
    companion.select_initial_plan_provider("visual.remote-planner")
    if generating or failed:
        run = companion.begin_initial_plan_run()
        companion.initial_plan_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": run["generationRequestId"],
                "goalRequestId": run["goalRequestId"],
                "targetAdapterId": "blender",
                "targetInstanceId": companion.instance_id,
                "provider": {
                    "id": "visual.remote-planner",
                    "version": "1.0.0",
                    "displayName": "Remote Snowman Planner",
                },
                "status": "failed" if failed else "generating",
                "terminal": failed,
                "sceneChanged": False,
                "proposalId": None,
                "error": (
                    {
                        "code": "planner_provider_failed",
                        "retryMode": "new_request_id",
                        "message": "Provider failed safely; confirm a new run to retry",
                    }
                    if failed
                    else None
                ),
                "needsRevision": None,
                "updatedAt": "2026-08-09T12:00:00Z",
            }
        )
        assert fake_transport.initial_plan_run_requests == [run]
        assert companion.initial_plan_handoff.phase == (
            "failed" if failed else "generating"
        )
    else:
        assert companion.initial_plan_handoff.can_run
        assert not fake_transport.initial_plan_run_requests
    assert_active_session_preserved()


def view3d_context():
    for area in bpy.context.screen.areas:
        if area.type != "VIEW_3D":
            continue
        space = area.spaces.active
        region = next(item for item in area.regions if item.type == "WINDOW")
        return area, region, space
    raise AssertionError("No VIEW_3D area available for visual capture")


def configure_state():
    if STATE == "initial":
        assert session.active_index == -1
    elif STATE == "goal-request":
        configure_goal_request()
    elif STATE in {"revision", "revision-collapsed"}:
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        bpy.context.window_manager.operating_line_revision_message += (
            "Make this head slightly larger and rougher"
        )
        assert extension.get_companion().revision_reference_scope == "active"
        if STATE == "revision-collapsed":
            bpy.context.window_manager.operating_line_revision_workspace_expanded = (
                False
            )
    elif STATE == "proposal":
        plan_path = (
            ADAPTER_ROOT / "operating_line" / "resources" / "snowman.plan.json"
        )
        base_plan = json.loads(plan_path.read_text(encoding="utf-8"))
        plan = json.loads(json.dumps(base_plan))
        plan["revision"] += 100
        plan["title"] = "AI proposal: create a reviewed snowman"
        plan["steps"][0]["title"] = plan["title"]
        base_head = next(
            step for step in base_plan["steps"] if step["id"] == "snowman.model.head"
        )
        target_head = next(
            step for step in plan["steps"] if step["id"] == "snowman.model.head"
        )
        target_head["action"]["arguments"]["radius"] += 0.08
        request_id = str(uuid.uuid4())
        plan_diff = {
            "basePlan": {
                "id": base_plan["id"],
                "revision": base_plan["revision"],
            },
            "targetPlan": {"id": plan["id"], "revision": plan["revision"]},
            "summary": {
                "planFields": 1,
                "addedSteps": 0,
                "removedSteps": 0,
                "updatedSteps": 2,
                "movedSteps": 0,
            },
            "planChanges": [
                {
                    "field": "title",
                    "before": base_plan["title"],
                    "after": plan["title"],
                }
            ],
            "stepChanges": [
                {
                    "kind": "updated",
                    "stepId": "snowman",
                    "before": {
                        "stepId": "snowman",
                        "nodeNumber": "1",
                        "parentId": None,
                        "order": 0,
                        "title": base_plan["steps"][0]["title"],
                    },
                    "after": {
                        "stepId": "snowman",
                        "nodeNumber": "1",
                        "parentId": None,
                        "order": 0,
                        "title": plan["steps"][0]["title"],
                    },
                    "changes": [
                        {
                            "field": "title",
                            "before": base_plan["steps"][0]["title"],
                            "after": plan["steps"][0]["title"],
                        }
                    ],
                },
                {
                    "kind": "updated",
                    "stepId": "snowman.model.head",
                    "before": {
                        "stepId": "snowman.model.head",
                        "nodeNumber": "1.2.3",
                        "parentId": "snowman.model",
                        "order": 3,
                        "title": base_head["title"],
                    },
                    "after": {
                        "stepId": "snowman.model.head",
                        "nodeNumber": "1.2.3",
                        "parentId": "snowman.model",
                        "order": 3,
                        "title": target_head["title"],
                    },
                    "changes": [
                        {
                            "field": "action",
                            "before": base_head["action"],
                            "after": target_head["action"],
                        }
                    ],
                },
            ],
        }
        accepted_session = extension.get_session()
        companion = extension.get_companion()
        revision_thread = {
            "threadId": request_id,
            "turn": 1,
            "parentRequestId": None,
        }
        proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": companion.instance_id,
            "revisionRequestId": request_id,
            "revisionThread": revision_thread,
            "catalogVersion": "1.8.0",
            "plan": plan,
            "planDiff": plan_diff,
            "proposedAt": "2026-08-04T12:00:00Z",
        }
        assert extension.get_companion().stage_proposal(proposal)
        revision_request = {
            "protocolVersion": "1.1.0",
            "requestId": request_id,
            "adapterId": "blender",
            "catalogVersion": "1.8.0",
            "instanceId": companion.instance_id,
            "basePlan": base_plan,
            "references": [
                {"nodeId": "snowman.model.head", "nodeNumber": "1.2.3"}
            ],
            "message": "Make this head slightly larger and rougher",
            "revisionThread": revision_thread,
            "occurredAt": "2026-08-04T11:59:00Z",
        }
        companion.revision_thread_history = {
            "protocolVersion": "1.1.0",
            "threadId": request_id,
            "targetAdapterId": "blender",
            "instanceId": companion.instance_id,
            "planId": base_plan["id"],
            "latestTurn": 1,
            "status": "awaiting_decision",
            "turns": [
                {
                    "turn": 1,
                    "state": "awaiting_decision",
                    "request": revision_request,
                    "proposal": proposal,
                    "decision": None,
                }
            ],
            "page": {
                "beforeTurn": None,
                "nextBeforeTurn": None,
                "hasMore": False,
            },
        }
        assert extension.get_session() is accepted_session
        assert extension.get_companion().proposal_session is not None
        assert not session.receipts
    elif STATE in {
        "initial-provider-disclosure",
        "initial-provider-generating",
        "initial-provider-failed",
    }:
        configure_initial_provider_handoff(
            generating=STATE == "initial-provider-generating",
            failed=STATE == "initial-provider-failed",
        )
    elif STATE in {"provider-disclosure", "provider-generating"}:
        configure_provider_handoff(generating=STATE == "provider-generating")
    elif STATE == "forward":
        for _ in range(9):
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert session.active_index == 8
        assert len(session.receipts) == 9
    elif STATE in {"back", "hidden"}:
        for _ in range(9):
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert session.active_index == 7
        assert len(session.receipts) == 8
        if STATE == "hidden":
            assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
            assert bpy.context.window_manager.operating_line_overlay_enabled is False
    elif STATE == "operator":
        preview_index = next(
            index
            for index, step in enumerate(session.steps)
            if step.id == "snowman.render.preview"
        )
        while session.active_index < preview_index - 1:
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        next_step = session.steps[session.active_index + 1]
        assert next_step.id == "snowman.render.preview"
        assert _semantic_hint(next_step) == (
            "UI target unavailable | Reference: Render > Render Image"
        )
        reference_path = interaction_guidance_snapshot()
        assert reference_path is not None and not reference_path.native
        assert tuple(item.label for item in reference_path.items) == (
            "Rendering",
            "Render",
            "Render Image",
            "Managed PNG",
        )
        render_scene = bpy.data.scenes.get("OperatingLine.Scene.Snowman")
        assert render_scene is not None
        assert factory_objects["Cube"] not in tuple(render_scene.objects)
        if bpy.context.window is not None:
            bpy.context.window.scene = render_scene
        render_scene.frame_set(20)
    elif STATE == "menu-cube":
        plan_path = ADAPTER_ROOT / "operating_line" / "resources" / "snowman.plan.json"
        cube_plan = json.loads(plan_path.read_text(encoding="utf-8"))
        cube_plan["id"] = "cube-menu-visual"
        cube_plan["revision"] = 1
        cube_step = next(
            step
            for step in cube_plan["steps"]
            if step["id"] == "snowman.scene.ground"
        )
        cube_step["title"] = "Create one cube"
        cube_step["intent"] = "Create a cube from the guided native menu"
        cube_step["action"]["name"] = "blender.mesh.create_cube"
        cube_step["action"]["arguments"]["objectName"] = "OperatingLine.VisualCube"
        cube_step["action"]["arguments"]["size"] = 2.0
        cube_step["anchors"][1] = {
            "kind": "operator",
            "operatorId": "mesh.primitive_cube_add",
            "menuPath": ["Add", "Mesh", "Cube"],
        }
        assert extension.get_companion().install_plan(cube_plan)
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        cube_session = extension.get_session()
        assert cube_session.steps[0].id == "snowman.scene.ground"
        menu_path = interaction_guidance_snapshot()
        assert menu_path is not None and menu_path.native
        assert menu_path.items[-1].label == "Cube"
        assert menu_path.operator_id == "mesh.primitive_cube_add"
    elif STATE == "menu-icosphere":
        plan_path = ADAPTER_ROOT / "operating_line" / "resources" / "snowman.plan.json"
        icosphere_plan = json.loads(plan_path.read_text(encoding="utf-8"))
        icosphere_plan["id"] = "icosphere-menu-visual"
        icosphere_plan["revision"] = 1
        icosphere_step = next(
            step
            for step in icosphere_plan["steps"]
            if step["id"] == "snowman.scene.ground"
        )
        icosphere_step["title"] = "Create one Icosphere"
        icosphere_step["intent"] = "Create an Icosphere from the guided native menu"
        icosphere_step["action"]["name"] = "blender.mesh.create_icosphere"
        arguments = icosphere_step["action"]["arguments"]
        arguments["objectName"] = "OperatingLine.VisualIcosphere"
        del arguments["size"]
        arguments["subdivisions"] = 2
        arguments["radius"] = 1.5
        icosphere_step["anchors"][1] = {
            "kind": "operator",
            "operatorId": "mesh.primitive_ico_sphere_add",
            "menuPath": ["Add", "Mesh", "Ico Sphere"],
        }
        assert extension.get_companion().install_plan(icosphere_plan)
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        icosphere_session = extension.get_session()
        assert icosphere_session.steps[0].id == "snowman.scene.ground"
        menu_path = interaction_guidance_snapshot()
        assert menu_path is not None and menu_path.native
        assert menu_path.items[-1].label == "Ico Sphere"
        assert menu_path.operator_id == "mesh.primitive_ico_sphere_add"
    elif STATE == "menu-torus":
        plan_path = ADAPTER_ROOT / "operating_line" / "resources" / "snowman.plan.json"
        torus_plan = json.loads(plan_path.read_text(encoding="utf-8"))
        torus_plan["id"] = "torus-menu-visual"
        torus_plan["revision"] = 1
        torus_step = next(
            step
            for step in torus_plan["steps"]
            if step["id"] == "snowman.scene.ground"
        )
        torus_step["title"] = "Create one torus"
        torus_step["intent"] = "Create a torus from the guided native menu"
        torus_step["action"]["name"] = "blender.mesh.create_torus"
        arguments = torus_step["action"]["arguments"]
        arguments["objectName"] = "OperatingLine.VisualTorus"
        del arguments["size"]
        arguments["majorSegments"] = 48
        arguments["minorSegments"] = 12
        arguments["majorRadius"] = 2.0
        arguments["minorRadius"] = 0.5
        torus_step["anchors"][1] = {
            "kind": "operator",
            "operatorId": "mesh.primitive_torus_add",
            "menuPath": ["Add", "Mesh", "Torus"],
        }
        assert extension.get_companion().install_plan(torus_plan)
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        torus_session = extension.get_session()
        assert torus_session.steps[0].id == "snowman.scene.ground"
        menu_path = interaction_guidance_snapshot()
        assert menu_path is not None and menu_path.native
        assert menu_path.items[-1].label == "Torus"
        assert menu_path.operator_id == "mesh.primitive_torus_add"
    elif STATE in {"menu-add", "menu-mesh", "menu-cone", "menu-cylinder"}:
        target_step_id = {
            "menu-add": "snowman.model.body_lower",
            "menu-mesh": "snowman.model.body_lower",
            "menu-cone": "snowman.details.face.nose",
            "menu-cylinder": "snowman.details.arms.left",
        }[STATE]
        target_index = next(
            index
            for index, step in enumerate(session.steps)
            if step.id == target_step_id
        )
        while session.active_index < target_index - 1:
            assert bpy.ops.operating_line.next() == {"FINISHED"}
        next_step = session.steps[session.active_index + 1]
        assert next_step.id == target_step_id
        menu_path = interaction_guidance_snapshot()
        assert menu_path is not None and menu_path.native
        assert menu_path.items[-1].label == {
            "menu-add": "UV Sphere",
            "menu-mesh": "UV Sphere",
            "menu-cone": "Cone",
            "menu-cylinder": "Cylinder",
        }[STATE]
    assert_factory_objects_preserved()
    if STATE in {
        "goal-request",
        "initial-provider-disclosure",
        "initial-provider-generating",
        "initial-provider-failed",
        "provider-disclosure",
        "provider-generating",
    }:
        assert_active_session_preserved()


def prepare_view():
    panel_type = getattr(bpy.types, "OPERATINGLINE_PT_sidebar", None)
    assert panel_type is not None
    assert panel_type.bl_space_type == "VIEW_3D"
    assert panel_type.bl_region_type == "UI"
    assert panel_type.bl_category == "OperatingLine"

    area, region, space = view3d_context()
    space.show_region_ui = True
    space.shading.type = "MATERIAL"
    space.overlay.show_relationship_lines = False
    space.overlay.show_extras = False
    if STATE == "operator":
        space.region_3d.view_perspective = "CAMERA"
    else:
        space.region_3d.view_perspective = "PERSP"
        space.region_3d.view_location = Vector((0.0, 0.0, 3.0))
        space.region_3d.view_distance = 10.5
        space.region_3d.view_rotation = Quaternion((0.81, 0.37, 0.16, 0.42))

    if STATE in {
        "menu-add",
        "menu-mesh",
        "menu-cube",
        "menu-icosphere",
        "menu-torus",
        "menu-cone",
        "menu-cylinder",
    }:
        bpy.context.preferences.view.show_tooltips = False
        bpy.context.window.cursor_warp(1400, 900)
        with bpy.context.temp_override(area=area, region=region, space_data=space):
            if STATE == "menu-add":
                result = bpy.ops.operating_line.open_add_menu("EXEC_DEFAULT")
            else:
                result = bpy.ops.wm.call_menu(
                    "EXEC_DEFAULT",
                    name="VIEW3D_MT_mesh_add",
                )
        print(f"OperatingLine menu invocation result: {sorted(result)}", flush=True)
        if STATE == "menu-add":
            assert result == {"FINISHED"}
        else:
            assert result in ({"INTERFACE"}, {"RUNNING_MODAL"})
        bpy.app.timers.register(settle_menu_capture, first_interval=0.15)
        return None

    bpy.context.window.cursor_warp(1320, 820)
    with bpy.context.temp_override(area=area, region=region, space_data=space):
        result = bpy.ops.wm.call_panel(
            "EXEC_DEFAULT",
            name="OPERATINGLINE_PT_sidebar",
            keep_open=True,
        )
    print(f"OperatingLine panel invocation result: {sorted(result)}", flush=True)
    assert result in ({"INTERFACE"}, {"RUNNING_MODAL"})
    bpy.context.window.cursor_warp(1100, 500)
    if STATE in {
        "initial-provider-disclosure",
        "initial-provider-generating",
        "initial-provider-failed",
        "provider-disclosure",
        "provider-generating",
    }:
        bpy.app.timers.register(scroll_provider_panel, first_interval=0.35)
    else:
        bpy.app.timers.register(capture_and_quit, first_interval=0.75)
    return None


def scroll_provider_panel():
    """Reveal the selected provider disclosure and run state in the real popover."""

    for _ in range(32):
        bpy.context.window.event_simulate(
            type="WHEELDOWNMOUSE", value="PRESS", x=1100, y=500
        )
    bpy.app.timers.register(capture_and_quit, first_interval=0.75)
    return None


def settle_menu_capture():
    """Move off the first menu row so screenshots contain no hover tooltip."""

    bpy.context.window.cursor_warp(1580, 940)
    bpy.app.timers.register(capture_and_quit, first_interval=0.15)
    return None


def capture_and_quit():
    bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
    bpy.ops.screen.screenshot(filepath=str(OUTPUT))
    assert OUTPUT.is_file() and OUTPUT.stat().st_size > 10_000
    assert_guidance_pixels()
    if STATE in {
        "initial-provider-disclosure",
        "initial-provider-generating",
        "initial-provider-failed",
        "provider-disclosure",
        "provider-generating",
    }:
        assert_factory_objects_preserved()
        assert_active_session_preserved()
    if STATE == "forward":
        shutil.copyfile(OUTPUT, SMOKE_OUTPUT)
    if STATE == "menu-torus":
        shutil.copyfile(OUTPUT, DOCS_MENU_OUTPUT)
    print(f"OperatingLine visual state captured: {OUTPUT.name}", flush=True)

    if STATE == "hidden":
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_overlay_enabled is True
    hold_seconds = float(os.environ.get("OPERATINGLINE_VISUAL_HOLD_SECONDS", "0"))
    bpy.app.timers.register(cleanup_and_quit, first_interval=max(hold_seconds, 0.5))
    return None


def assert_guidance_pixels():
    """Check the rendered state colors and operator no-fake-line fallback."""

    image = bpy.data.images.load(str(OUTPUT), check_existing=False)
    try:
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgb = pixels.reshape((-1, 4))[:, :3]
        ratios = {}
        for state in (
            GuidanceState.COMPLETED,
            GuidanceState.BACK,
            GuidanceState.NEXT,
            GuidanceState.LOCKED,
        ):
            target = np.asarray(color_for(state)[:3], dtype=np.float32)
            matches = np.max(np.abs(rgb - target), axis=1) < 0.02
            ratios[state] = float(np.count_nonzero(matches)) / len(rgb)
    finally:
        bpy.data.images.remove(image)

    completed = ratios[GuidanceState.COMPLETED]
    back = ratios[GuidanceState.BACK]
    next_step = ratios[GuidanceState.NEXT]
    locked = ratios[GuidanceState.LOCKED]
    print(
        "OperatingLine visual color ratios: "
        f"completed={completed:.6f}, back={back:.6f}, "
        f"next={next_step:.6f}, locked={locked:.6f}",
        flush=True,
    )

    if STATE in {
        "initial",
        "revision",
        "revision-collapsed",
        "proposal",
        "initial-provider-disclosure",
        "initial-provider-generating",
        "initial-provider-failed",
        "provider-disclosure",
        "provider-generating",
    }:
        assert next_step > 0.0003
        assert locked > 0.0001
        # Native-menu navigation starts at the blue current context
        # `01 Layout`, with `02 Add` as the green next target. There is no
        # red previous/BACK menu target until a nested menu has opened.
        assert 0.00003 < completed < 0.0003
        assert back < 0.00003
    elif STATE in {"menu-cube", "menu-icosphere", "menu-torus"}:
        assert completed > 0.00005
        assert back > 0.0001
        assert next_step > 0.0003
    elif STATE in {
        "forward",
        "back",
        "menu-add",
        "menu-mesh",
        "menu-cone",
        "menu-cylinder",
    }:
        assert completed > 0.00005
        assert back > 0.0003
        assert next_step > 0.0003
    elif STATE == "hidden":
        assert max(completed, back, next_step) < 0.00003
    elif STATE == "operator":
        assert completed > 0.00005
        assert 0.00005 < back < 0.0003
        assert 0.00005 < next_step < 0.0003


def cleanup_and_quit():
    extension.unregister()
    bpy.ops.wm.quit_blender()
    return None


configure_state()
bpy.app.timers.register(prepare_view, first_interval=0.5)
