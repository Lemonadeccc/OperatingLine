"""Headless Blender integration test for the extension lifecycle."""

import importlib.util
from copy import deepcopy
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from queue import Queue
import sys
import threading
import time
from tempfile import TemporaryDirectory
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
import uuid

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_extension",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_extension.operating_line.infrastructure import (  # noqa: E402
    CompanionTransport,
    action_registry,
    overlay_enabled,
    remove_factory_startup_objects,
    validate_companion_url,
)
from operating_line_extension.operating_line.infrastructure.native_history import (  # noqa: E402
    NATIVE_HISTORY_MARKER_KEY,
    _load_post,
    _redo_post,
    _undo_post,
)
from operating_line_extension.operating_line.infrastructure import (  # noqa: E402
    observations as observation_module,
)
from operating_line_extension.operating_line.application import (  # noqa: E402
    ActionReceipt,
    DemoSession,
    InteractionPathKind,
    MenuGuidanceTracker,
    RevisionLineage,
)
from operating_line_extension.operating_line.application.session import (  # noqa: E402
    _canonical_json_value_bytes,
    canonical_plan_content_sha256,
)
from operating_line_extension.operating_line.application.companion import (  # noqa: E402
    CompanionController,
    ProposalQueueFullError,
)
from operating_line_extension.operating_line import (  # noqa: E402
    replace_session as replace_operating_line_session,
)
from operating_line_extension.operating_line.presentation.operators import (  # noqa: E402
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_guided_menu_action,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_recheck_observations,
    OPERATINGLINE_OT_start,
)
from operating_line_extension.operating_line.presentation.native_menu_guidance import (  # noqa: E402
    interaction_guidance_snapshot,
    native_menu_guidance_enabled,
    native_menu_snapshot,
    reveal_native_menu,
)
from operating_line_extension.operating_line.presentation.revision_workspace import (  # noqa: E402
    _display_columns,
    _proposal_accept_requires_verifiable_base,
    _wrap_history_message,
)
from operating_line_extension.operating_line.domain import (  # noqa: E402
    RESOURCE_PATH,
    executable_steps,
    load_task_tree,
    load_task_tree_data,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    ALLOWED_ACTIONS,
    COLLECTION_NAME,
    OWNER_VALUE,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.editing import (  # noqa: E402
    validate_bevel,
    validate_geometry_nodes_transform,
    validate_subdivide,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.model import (  # noqa: E402
    validate_cube,
    validate_icosphere,
    validate_torus,
)


with RESOURCE_PATH.open(encoding="utf-8") as resource:
    FULL_PLAN = json.load(resource)
with (RESOURCE_PATH.parent / "action-catalog.json").open(encoding="utf-8") as resource:
    ACTION_CATALOG = json.load(resource)
with (RESOURCE_PATH.parent / "interaction-catalog.json").open(
    encoding="utf-8"
) as resource:
    INTERACTION_CATALOG = json.load(resource)


def geometry_regression_plan(plan: dict) -> dict:
    """Derive the original three-sphere safety slice from the canonical fixture."""
    selected_ids = {
        "snowman",
        "snowman.model",
        "snowman.model.body_lower",
        "snowman.model.body_upper",
        "snowman.model.head",
    }
    derived = {
        **deepcopy(plan),
        "id": "snowman-geometry-regression",
        "title": "Snowman geometry safety regression",
        "steps": [
            deepcopy(item) for item in plan["steps"] if item["id"] in selected_ids
        ],
    }
    by_id = {item["id"]: item for item in derived["steps"]}
    by_id["snowman.model"]["order"] = 1
    by_id["snowman.model.body_lower"]["dependsOn"] = []
    return derived


BUNDLED_PLAN = geometry_regression_plan(FULL_PLAN)
ACTION_STEPS = [step for step in BUNDLED_PLAN["steps"] if step["action"] is not None]
EXPECTED = tuple(step["action"]["arguments"]["objectName"] for step in ACTION_STEPS)
PLAN_REVISION = BUNDLED_PLAN["revision"]
DYNAMIC_REVISION = PLAN_REVISION + 1
FULL_PLAN_CONTENT_SHA256 = (
    "f896ba6e2d9a927e1dee8875bfae3541cdd1d423b9b9e70d39cdef516ad8617e"
)


def assert_absent(name: str) -> None:
    assert bpy.data.objects.get(name) is None, f"{name} should not exist"


def action(name: str) -> dict:
    return {"adapterId": "blender", "name": name, "arguments": {}}


def step(
    step_id: str,
    parent_id: str | None,
    order: int,
    *,
    depends_on: list[str] | None = None,
    step_action: dict | None = None,
) -> dict:
    return {
        "id": step_id,
        "parentId": parent_id,
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": step_action,
    }


def load_temporary_plan(steps: list[dict]):
    with TemporaryDirectory() as temporary_directory:
        path = Path(temporary_directory) / "plan.json"
        path.write_text(
            json.dumps({"rootStepId": "root", "steps": steps}), encoding="utf-8"
        )
        return load_task_tree(path)


def assert_plan_rejected(steps: list[dict], message: str) -> None:
    try:
        load_temporary_plan(steps)
    except ValueError as error:
        assert message in str(error), f"Expected {message!r}, received {error!r}"
    else:
        raise AssertionError(f"Plan should be rejected with {message!r}")


def assert_cube_action_round_trip() -> None:
    cube_name = "OperatingLine.CubeRoundTrip"
    cube_step = step(
        "cube.create",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_cube",
            "arguments": {
                "resourceId": "cube.round_trip",
                "objectName": cube_name,
                "size": 2.5,
                "location": [1.0, -2.0, 3.0],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), cube_step])
    session = DemoSession(root, action_registry(root))

    session.start()
    assert session.next() is not None
    cube = bpy.data.objects.get(cube_name)
    assert cube is not None and cube.type == "MESH"
    assert tuple(round(value, 6) for value in cube.location) == (1.0, -2.0, 3.0)
    assert tuple(round(value, 6) for value in cube.dimensions) == (2.5, 2.5, 2.5)
    receipt = session.receipts["cube.create"]
    assert receipt.action_name == "blender.mesh.create_cube"
    assert {item.logical_id for item in receipt.created} >= {
        "cube.round_trip",
        "cube.round_trip.mesh",
    }

    assert session.back() is not None
    assert bpy.data.objects.get(cube_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_cube_resource_id_boundaries() -> None:
    arguments = {
        "resourceId": "c" * 180,
        "objectName": "OperatingLine.BoundaryCube",
        "size": 1.0,
        "location": [0.0, 0.0, 0.0],
    }
    primitives = validate_cube(arguments)
    assert primitives[0].logical_id == arguments["resourceId"]

    try:
        validate_cube({**arguments, "resourceId": "c" * 181})
    except ValueError as error:
        assert "arguments.resourceId" in str(error)
    else:
        raise AssertionError("Cube resourceId longer than 180 characters must fail")


def assert_edit_modifier_geometry_nodes_round_trip() -> None:
    object_name = "OperatingLine.EditPipelineCube"
    steps = [
        step("root", None, 0),
        step(
            "pipeline.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "pipeline.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "pipeline.subdivide",
            "root",
            2,
            depends_on=["pipeline.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_subdivide",
                "arguments": {
                    "targetId": "pipeline.cube",
                    "resultMeshId": "pipeline.cube.subdivided_mesh",
                    "resultMeshName": "OperatingLine.EditPipelineCube.SubdividedMesh",
                    "cuts": 1,
                    "smooth": 0.0,
                },
            },
        ),
        step(
            "pipeline.bevel",
            "root",
            3,
            depends_on=["pipeline.subdivide"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "pipeline.cube",
                    "modifierId": "pipeline.cube.bevel",
                    "modifierName": "OperatingLine.EditPipeline.Bevel",
                    "width": 0.1,
                    "segments": 3,
                    "angleLimit": 0.5235987755982988,
                },
            },
        ),
        step(
            "pipeline.geometry_nodes",
            "root",
            4,
            depends_on=["pipeline.bevel"],
            step_action={
                "adapterId": "blender",
                "name": "blender.geometry_nodes.create_transform",
                "arguments": {
                    "targetId": "pipeline.cube",
                    "modifierId": "pipeline.cube.geometry_nodes",
                    "modifierName": "OperatingLine.EditPipeline.GeometryNodes",
                    "nodeGroupId": "pipeline.cube.transform_nodes",
                    "nodeGroupName": "OperatingLine.EditPipeline.TransformNodes",
                    "translation": [0.25, -0.5, 0.75],
                    "rotation": [0.0, 0.0, 0.25],
                    "scale": [1.0, 1.5, 0.5],
                },
            },
        ),
    ]
    root = load_temporary_plan(steps)
    session = DemoSession(root, action_registry(root))
    session.start()

    assert session.next() is not None
    cube = bpy.data.objects.get(object_name)
    assert cube is not None and cube.type == "MESH"
    source_mesh = cube.data
    assert (len(source_mesh.vertices), len(source_mesh.edges), len(source_mesh.polygons)) == (
        8,
        12,
        6,
    )

    assert session.next() is not None
    subdivided_mesh = cube.data
    assert subdivided_mesh is not source_mesh
    assert (
        len(subdivided_mesh.vertices),
        len(subdivided_mesh.edges),
        len(subdivided_mesh.polygons),
    ) == (26, 48, 24)
    topology = observation_module.evaluate_observations(
        (
            {
                "kind": "mesh_topology_matches",
                "parameters": {
                    "targetId": "pipeline.cube",
                    "vertexCount": 26,
                    "edgeCount": 48,
                    "faceCount": 24,
                },
            },
        ),
        session.receipts,
    )
    assert topology[0]["satisfied"] is True

    assert session.next() is not None
    bevel = cube.modifiers.get("OperatingLine.EditPipeline.Bevel")
    assert bevel is not None and bevel.type == "BEVEL"
    assert math.isclose(bevel.width, 0.1, abs_tol=1e-6)
    assert bevel.segments == 3
    modifier_observation = observation_module.evaluate_observations(
        (
            {
                "kind": "modifier_ready",
                "parameters": {
                    "targetId": "pipeline.cube",
                    "modifierId": "pipeline.cube.bevel",
                    "modifierType": "BEVEL",
                    "width": 0.1,
                    "segments": 3,
                },
            },
        ),
        session.receipts,
    )
    assert modifier_observation[0]["satisfied"] is True

    assert session.next() is not None
    nodes_modifier = cube.modifiers.get(
        "OperatingLine.EditPipeline.GeometryNodes"
    )
    node_group = bpy.data.node_groups.get("OperatingLine.EditPipeline.TransformNodes")
    assert nodes_modifier is not None and nodes_modifier.type == "NODES"
    assert node_group is not None and nodes_modifier.node_group is node_group
    assert {node.bl_idname for node in node_group.nodes} == {
        "NodeGroupInput",
        "GeometryNodeTransform",
        "NodeGroupOutput",
    }
    nodes_observation = observation_module.evaluate_observations(
        (
            {
                "kind": "geometry_nodes_ready",
                "parameters": {
                    "targetId": "pipeline.cube",
                    "modifierId": "pipeline.cube.geometry_nodes",
                    "nodeGroupId": "pipeline.cube.transform_nodes",
                    "nodeTypes": [
                        "NodeGroupInput",
                        "GeometryNodeTransform",
                        "NodeGroupOutput",
                    ],
                },
            },
        ),
        session.receipts,
    )
    assert nodes_observation[0]["satisfied"] is True

    extra_node = node_group.nodes.new("GeometryNodeJoinGeometry")
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited Geometry Nodes graphs must block rollback")
    assert session.active_index == 3
    assert "pipeline.geometry_nodes" in session.receipts
    node_group.nodes.remove(extra_node)

    assert session.back() is not None
    assert cube.modifiers.get("OperatingLine.EditPipeline.GeometryNodes") is None
    assert bpy.data.node_groups.get("OperatingLine.EditPipeline.TransformNodes") is None

    original_profile = bevel.profile
    bevel.profile = 0.75
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited modifiers must block rollback")
    assert session.active_index == 2
    assert "pipeline.bevel" in session.receipts
    bevel.profile = original_profile

    assert session.back() is not None
    assert cube.modifiers.get("OperatingLine.EditPipeline.Bevel") is None

    original_vertex = subdivided_mesh.vertices[0].co.copy()
    subdivided_mesh.vertices[0].co.x += 0.25
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited subdivided meshes must block rollback")
    assert session.active_index == 1
    assert "pipeline.subdivide" in session.receipts
    subdivided_mesh.vertices[0].co = original_vertex

    assert session.back() is not None
    assert cube.data is source_mesh
    assert bpy.data.meshes.get("OperatingLine.EditPipelineCube.SubdividedMesh") is None
    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_editing_argument_boundaries() -> None:
    assert validate_subdivide(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.result.mesh",
            "resultMeshName": "OperatingLine.EditResult",
            "cuts": 8.0,
            "smooth": 1.0,
        }
    ).cuts == 8
    assert validate_bevel(
        {
            "targetId": "edit.target",
            "modifierId": "edit.bevel",
            "modifierName": "OperatingLine.Bevel",
            "width": 0.1,
            "segments": 16.0,
            "angleLimit": math.pi,
        }
    ).segments == 16
    geometry_nodes = validate_geometry_nodes_transform(
        {
            "targetId": "edit.target",
            "modifierId": "edit.nodes",
            "modifierName": "OperatingLine.Nodes",
            "nodeGroupId": "edit.nodes.group",
            "nodeGroupName": "OperatingLine.Nodes.Group",
            "translation": [-1000.0, 1000.0, 0.0],
            "rotation": [-math.tau, math.tau, 0.0],
            "scale": [0.0001, 1000.0, 1.0],
        }
    )
    assert geometry_nodes.scale == (0.0001, 1000.0, 1.0)

    invalid_cases = (
        (
            validate_subdivide,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.result.mesh",
                "resultMeshName": "OperatingLine.EditResult",
                "cuts": 9,
                "smooth": 0.0,
            },
            "integer in [1, 8]",
        ),
        (
            validate_bevel,
            {
                "targetId": "edit.target",
                "modifierId": "edit.bevel",
                "modifierName": "OperatingLine.Bevel",
                "width": 0.0,
                "segments": 2,
                "angleLimit": 0.5,
            },
            "arguments.width",
        ),
        (
            validate_geometry_nodes_transform,
            {
                "targetId": "edit.target",
                "modifierId": "edit.nodes",
                "modifierName": "OperatingLine.Nodes",
                "nodeGroupId": "edit.nodes.group",
                "nodeGroupName": "OperatingLine.Nodes.Group",
                "translation": [0.0, 0.0, 0.0],
                "rotation": [0.0, 0.0, 0.0],
                "scale": [0.0, 1.0, 1.0],
            },
            "arguments.scale",
        ),
    )
    for validator, arguments, expected in invalid_cases:
        try:
            validator(arguments)
        except ValueError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"Invalid editing arguments must fail: {arguments}")


def assert_cube_guided_menu_round_trip() -> None:
    cube_name = "OperatingLine.GuidedCubeRoundTrip"
    cube_step = step(
        "cube.guided",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_cube",
            "arguments": {
                "resourceId": "cube.guided_round_trip",
                "objectName": cube_name,
                "size": 1.75,
                "location": [-1.0, 2.0, 0.5],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), cube_step])
    session = DemoSession(root, action_registry(root), plan_id="cube-guided", revision=1)
    replace_operating_line_session(session)

    assert bpy.ops.operating_line.start() == {"FINISHED"}
    snapshot = native_menu_snapshot()
    assert snapshot is not None
    assert snapshot.step_id == "cube.guided"
    assert snapshot.items[-1].label == "Cube"
    assert reveal_native_menu("Add")
    assert reveal_native_menu("Mesh")
    assert bpy.ops.operating_line.guided_menu_action(
        step_id="cube.guided",
        operator_id="mesh.primitive_cube_add",
    ) == {"FINISHED"}
    cube = bpy.data.objects.get(cube_name)
    assert cube is not None
    assert tuple(round(value, 6) for value in cube.dimensions) == (1.75, 1.75, 1.75)
    guided_receipt = session.receipts["cube.guided"]
    guided_signature = (
        guided_receipt.action_name,
        tuple(item.logical_id for item in guided_receipt.created),
        tuple(item.display_name for item in guided_receipt.created),
    )

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(cube_name) is None
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    automatic_receipt = session.receipts["cube.guided"]
    assert (
        automatic_receipt.action_name,
        tuple(item.logical_id for item in automatic_receipt.created),
        tuple(item.display_name for item in automatic_receipt.created),
    ) == guided_signature
    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(cube_name) is None
    assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
    assert overlay_enabled() is False
    assert native_menu_guidance_enabled() is False


def assert_icosphere_action_round_trip() -> None:
    object_name = "OperatingLine.IcosphereRoundTrip"
    radius = 1.25
    ico_step = step(
        "icosphere.create",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_icosphere",
            "arguments": {
                "resourceId": "icosphere.round_trip",
                "objectName": object_name,
                "subdivisions": 2,
                "radius": radius,
                "location": [-1.0, 2.0, 3.5],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), ico_step])
    session = DemoSession(root, action_registry(root))

    session.start()
    assert session.next() is not None
    icosphere = bpy.data.objects.get(object_name)
    assert icosphere is not None and icosphere.type == "MESH"
    assert tuple(round(value, 6) for value in icosphere.location) == (-1.0, 2.0, 3.5)
    assert len(icosphere.data.vertices) == 42
    assert len(icosphere.data.polygons) == 80
    assert all(
        math.isclose(vertex.co.length, radius, abs_tol=1e-5)
        for vertex in icosphere.data.vertices
    )
    receipt = session.receipts["icosphere.create"]
    assert receipt.action_name == "blender.mesh.create_icosphere"
    assert {item.logical_id for item in receipt.created} >= {
        "icosphere.round_trip",
        "icosphere.round_trip.mesh",
    }

    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_icosphere_argument_boundaries() -> None:
    arguments = {
        "resourceId": "i" * 180,
        "objectName": "OperatingLine.BoundaryIcosphere",
        "subdivisions": 1,
        "radius": 1.0,
        "location": [0.0, 0.0, 0.0],
    }
    assert validate_icosphere(arguments)[0].subdivisions == 1
    assert validate_icosphere({**arguments, "subdivisions": 5})[0].subdivisions == 5

    for invalid, expected in (
        ({**arguments, "resourceId": "i" * 181}, "arguments.resourceId"),
        ({**arguments, "subdivisions": 0}, "integer in [1, 5]"),
        ({**arguments, "subdivisions": 6}, "integer in [1, 5]"),
        ({**arguments, "radius": 0.00001}, "arguments.radius"),
    ):
        try:
            validate_icosphere(invalid)
        except ValueError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"Invalid Icosphere arguments must fail: {invalid}")


def assert_icosphere_guided_menu_round_trip() -> None:
    object_name = "OperatingLine.GuidedIcosphereRoundTrip"
    ico_step = step(
        "icosphere.guided",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_icosphere",
            "arguments": {
                "resourceId": "icosphere.guided_round_trip",
                "objectName": object_name,
                "subdivisions": 2,
                "radius": 1.5,
                "location": [1.0, -2.0, 0.5],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), ico_step])
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="icosphere-guided",
        revision=1,
    )
    replace_operating_line_session(session)

    assert bpy.ops.operating_line.start() == {"FINISHED"}
    snapshot = native_menu_snapshot()
    assert snapshot is not None
    assert snapshot.step_id == "icosphere.guided"
    assert snapshot.items[-1].label == "Ico Sphere"
    assert reveal_native_menu("Add")
    assert reveal_native_menu("Mesh")
    assert bpy.ops.operating_line.guided_menu_action(
        step_id="icosphere.guided",
        operator_id="mesh.primitive_ico_sphere_add",
    ) == {"FINISHED"}
    icosphere = bpy.data.objects.get(object_name)
    assert icosphere is not None
    assert len(icosphere.data.vertices) == 42
    guided_receipt = session.receipts["icosphere.guided"]
    guided_signature = (
        guided_receipt.action_name,
        tuple(item.logical_id for item in guided_receipt.created),
        tuple(item.display_name for item in guided_receipt.created),
    )

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(object_name) is None
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    automatic_receipt = session.receipts["icosphere.guided"]
    assert (
        automatic_receipt.action_name,
        tuple(item.logical_id for item in automatic_receipt.created),
        tuple(item.display_name for item in automatic_receipt.created),
    ) == guided_signature
    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(object_name) is None


def assert_torus_action_round_trip() -> None:
    object_name = "OperatingLine.TorusRoundTrip"
    major_segments = 16
    minor_segments = 8
    major_radius = 2.0
    minor_radius = 0.5
    torus_step = step(
        "torus.create",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_torus",
            "arguments": {
                "resourceId": "torus.round_trip",
                "objectName": object_name,
                "majorSegments": major_segments,
                "minorSegments": minor_segments,
                "majorRadius": major_radius,
                "minorRadius": minor_radius,
                "location": [1.0, -2.0, 3.0],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), torus_step])
    session = DemoSession(root, action_registry(root))

    session.start()
    assert session.next() is not None
    torus = bpy.data.objects.get(object_name)
    assert torus is not None and torus.type == "MESH"
    assert tuple(round(value, 6) for value in torus.location) == (1.0, -2.0, 3.0)
    assert len(torus.data.vertices) == major_segments * minor_segments
    assert len(torus.data.polygons) == major_segments * minor_segments
    assert all(len(polygon.vertices) == 4 for polygon in torus.data.polygons)
    assert tuple(round(value, 6) for value in torus.dimensions) == (5.0, 5.0, 1.0)
    assert all(
        math.isclose(
            math.hypot(
                math.hypot(vertex.co.x, vertex.co.y) - major_radius,
                vertex.co.z,
            ),
            minor_radius,
            abs_tol=1e-5,
        )
        for vertex in torus.data.vertices
    )
    for polygon in torus.data.polygons:
        center = polygon.center
        radial_length = math.hypot(center.x, center.y)
        outward_x = center.x - major_radius * center.x / radial_length
        outward_y = center.y - major_radius * center.y / radial_length
        outward_dot = (
            polygon.normal.x * outward_x
            + polygon.normal.y * outward_y
            + polygon.normal.z * center.z
        )
        assert outward_dot > 0.0
    receipt = session.receipts["torus.create"]
    assert receipt.action_name == "blender.mesh.create_torus"
    assert {item.logical_id for item in receipt.created} >= {
        "torus.round_trip",
        "torus.round_trip.mesh",
    }

    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_torus_maximum_topology() -> None:
    object_name = "OperatingLine.MaximumTorus"
    torus_step = step(
        "torus.maximum",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_torus",
            "arguments": {
                "resourceId": "torus.maximum",
                "objectName": object_name,
                "majorSegments": 128.0,
                "minorSegments": 64.0,
                "majorRadius": 2.0,
                "minorRadius": 0.5,
                "location": [0.0, 0.0, 0.0],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), torus_step])
    session = DemoSession(root, action_registry(root))

    session.start()
    assert session.next() is not None
    torus = bpy.data.objects.get(object_name)
    assert torus is not None and torus.type == "MESH"
    assert len(torus.data.vertices) == 8192
    assert len(torus.data.edges) == 16384
    assert len(torus.data.polygons) == 8192
    assert all(len(polygon.vertices) == 4 for polygon in torus.data.polygons)

    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_torus_argument_boundaries() -> None:
    arguments = {
        "resourceId": "t" * 180,
        "objectName": "OperatingLine.BoundaryTorus",
        "majorSegments": 3,
        "minorSegments": 3,
        "majorRadius": 2.0,
        "minorRadius": 0.5,
        "location": [0.0, 0.0, 0.0],
    }
    primitive = validate_torus(arguments)[0]
    assert primitive.major_segments == 3
    assert primitive.minor_segments == 3
    maximum = validate_torus(
        {**arguments, "majorSegments": 128, "minorSegments": 64}
    )[0]
    assert maximum.major_segments == 128
    assert maximum.minor_segments == 64
    integral_float = validate_torus(
        {**arguments, "majorSegments": 16.0, "minorSegments": 8.0}
    )[0]
    assert integral_float.major_segments == 16
    assert integral_float.minor_segments == 8
    assert validate_icosphere(
        {
            "resourceId": "icosphere.integral_float",
            "objectName": "OperatingLine.IntegralFloatIcosphere",
            "subdivisions": 2.0,
            "radius": 1.0,
            "location": [0.0, 0.0, 0.0],
        }
    )[0].subdivisions == 2

    for invalid, expected in (
        ({**arguments, "resourceId": "t" * 181}, "arguments.resourceId"),
        ({**arguments, "majorSegments": 2}, "integer in [3, 128]"),
        ({**arguments, "majorSegments": 129}, "integer in [3, 128]"),
        ({**arguments, "minorSegments": 2}, "integer in [3, 64]"),
        ({**arguments, "minorSegments": 65}, "integer in [3, 64]"),
        ({**arguments, "majorSegments": 16.5}, "integer in [3, 128]"),
        ({**arguments, "minorSegments": 8.5}, "integer in [3, 64]"),
        ({**arguments, "majorRadius": 0.00001}, "arguments.majorRadius"),
        ({**arguments, "minorRadius": 0.00001}, "arguments.minorRadius"),
    ):
        try:
            validate_torus(invalid)
        except ValueError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"Invalid Torus arguments must fail: {invalid}")


def assert_torus_guided_menu_round_trip() -> None:
    object_name = "OperatingLine.GuidedTorusRoundTrip"
    torus_step = step(
        "torus.guided",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_torus",
            "arguments": {
                "resourceId": "torus.guided_round_trip",
                "objectName": object_name,
                "majorSegments": 16,
                "minorSegments": 8,
                "majorRadius": 2.0,
                "minorRadius": 0.5,
                "location": [1.0, -2.0, 0.5],
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), torus_step])
    session = DemoSession(root, action_registry(root), plan_id="torus-guided", revision=1)
    replace_operating_line_session(session)

    assert bpy.ops.operating_line.start() == {"FINISHED"}
    snapshot = native_menu_snapshot()
    assert snapshot is not None
    assert snapshot.step_id == "torus.guided"
    assert snapshot.items[-1].label == "Torus"
    assert reveal_native_menu("Add")
    assert reveal_native_menu("Mesh")
    assert bpy.ops.operating_line.guided_menu_action(
        step_id="torus.guided",
        operator_id="mesh.primitive_torus_add",
    ) == {"FINISHED"}
    torus = bpy.data.objects.get(object_name)
    assert torus is not None
    assert len(torus.data.vertices) == 128
    guided_receipt = session.receipts["torus.guided"]
    guided_signature = (
        guided_receipt.action_name,
        tuple(item.logical_id for item in guided_receipt.created),
        tuple(item.display_name for item in guided_receipt.created),
    )

    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(object_name) is None
    assert bpy.ops.operating_line.next() == {"FINISHED"}
    automatic_receipt = session.receipts["torus.guided"]
    assert (
        automatic_receipt.action_name,
        tuple(item.logical_id for item in automatic_receipt.created),
        tuple(item.display_name for item in automatic_receipt.created),
    ) == guided_signature
    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(object_name) is None


def assert_companion_and_plan_semantics() -> None:
    root = step("root", None, 0)
    # Display order deliberately conflicts with dependency order. Execution must
    # follow the DAG, not the hierarchy's depth-first traversal.
    dependency_first = step(
        "action.z-first",
        "root",
        20,
        step_action=action("test.z-first"),
    )
    assert validate_companion_url("http://localhost:3210/") == "http://localhost:3210"
    assert validate_companion_url("http://127.1.2.3:80/runtime/") == (
        "http://127.1.2.3:80/runtime"
    )
    assert validate_companion_url("http://[::1]:8080") == "http://[::1]:8080"
    for unsafe_url in (
        "https://127.0.0.1:3000",
        "http://example.com:3000",
        "http://127.0.0.1:3000?token=bad",
        "http://user:password@127.0.0.1:3000",
    ):
        try:
            validate_companion_url(unsafe_url)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Unsafe URL should be rejected: {unsafe_url}")
    for invalid_timing in ({"poll_interval": 0}, {"timeout": 0}):
        try:
            CompanionTransport(
                "http://127.0.0.1:43123",
                "integration-token-123456",
                str(uuid.uuid4()),
                **invalid_timing,
            )
        except ValueError:
            pass
        else:
            raise AssertionError("Transport timing values must be positive")

    dynamic_plan = deepcopy(BUNDLED_PLAN)
    dynamic_plan["id"] = "live-snowman"
    dynamic_plan["revision"] = DYNAMIC_REVISION
    dynamic_plan["title"] = "Live snowman"
    assert canonical_plan_content_sha256(FULL_PLAN) == FULL_PLAN_CONTENT_SHA256
    for value, expected_sha256 in (
        (1e-7, "69b47e10cce2f956c2d24354284f67ee84f3a0d9d072563498718fd1bb1a3cc3"),
        (1e20, "1df21ce650e785b5d5abb0115da72f0198295bd3befc35ee7bb0bad6b4048c76"),
        (-0.0, "5b87553ae592ab403ab5f5ebfb177424b7c26ca3de95a76b160ac1aef027f1de"),
        (
            {
                "10": "ten",
                "2": "two",
                "é": "accent",
                "😀": "emoji",
                "text": "hello 😀",
                "small": 1e-7,
                "large": 1e20,
                "zero": -0.0,
            },
            "53034233732c02e4a0058220b140da17c9fe8242f55c9455bdb7724529980149",
        ),
        (
            ["😀", -0.0, 1e-7, 1e20],
            "6cf88735d4a75d91930a01aaaeaaece30f54a260d2e10362321a70e42c598b66",
        ),
    ):
        assert sha256(_canonical_json_value_bytes(value, set())).hexdigest() == expected_sha256
    dynamic_plan_content_sha256 = canonical_plan_content_sha256(dynamic_plan)
    try:
        CompanionController._validated_session(dynamic_plan, "0" * 64)
    except ValueError as error:
        assert "does not match the source plan" in str(error)
    else:
        raise AssertionError("A delivery hash must match the exact canonical plan")
    delivery_transport = CompanionTransport(
        "http://127.0.0.1:43123",
        "integration-token-123456",
        str(uuid.uuid4()),
    )
    delivery_transport._request_json = lambda *_args, **_kwargs: {
        "protocolVersion": "1.1.0",
        "plan": deepcopy(dynamic_plan),
        "planContentSha256": dynamic_plan_content_sha256,
        "proposal": None,
        "proposalPlanContentSha256": None,
    }
    delivery_transport._poll()
    assert delivery_transport.incoming.get_nowait() == {
        "kind": "plan",
        "plan": dynamic_plan,
        "planContentSha256": dynamic_plan_content_sha256,
    }
    delivery_transport._request_json = lambda *_args, **_kwargs: {
        "protocolVersion": "1.1.0",
        "plan": deepcopy(dynamic_plan),
        "planContentSha256": dynamic_plan_content_sha256,
        "proposal": None,
    }
    try:
        delivery_transport._poll()
    except ValueError as error:
        assert "proposalPlanContentSha256" in str(error)
    else:
        raise AssertionError("Runtime delivery hash fields must be required")
    assert delivery_transport.incoming.empty()
    for invalid_hash in (None, "A" * 64, "0" * 63):
        try:
            delivery_transport._validated_delivery_hash(
                invalid_hash,
                present=True,
                label="Runtime plan content SHA-256",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("Runtime delivery must reject an invalid plan hash")

    token = "integration-token-123456"
    requests: list[dict] = []
    reports: list[dict] = []
    revision_requests: list[dict] = []
    goal_requests: list[dict] = []
    proposal_decisions: list[dict] = []
    replan_runs: list[dict] = []
    replan_post_attempts: list[dict] = []
    invoked_generation_ids: set[str] = set()
    replan_run_polls = [0]
    reject_replan_runs = [False]
    drop_first_replan_response = [True]
    slow_provider_discovery_once = [False]
    provider_proposal_id = str(uuid.uuid4())
    provider_payload = {
        "contractVersion": "1.0.0",
        "generationAvailable": True,
        "providers": [
            {
                "contractVersion": "1.0.0",
                "id": "available-planner",
                "version": "0.1.0",
                "displayName": "Available Planner",
                "description": "Local deterministic Blender replan provider.",
                "availability": {"available": True},
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "local",
                    "dataTransmission": "none",
                    "credentialManagement": "provider_managed",
                },
            },
            {
                "contractVersion": "1.0.0",
                "id": "unavailable-planner",
                "version": "0.1.0",
                "displayName": "Unavailable Planner",
                "description": "Provider requiring runtime configuration.",
                "availability": {
                    "available": False,
                    "reason": "not_configured",
                    "message": "Provider credential is not configured",
                },
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "remote",
                    "dataTransmission": "provider_managed",
                    "credentialManagement": "provider_managed",
                },
            },
        ],
    }
    post_result = ["accepted"]
    slow_guide = [False]
    slow_guide_started = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, payload: dict, status: int = 200) -> None:
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            assert self.headers.get("Authorization") == f"Bearer {token}"
            parsed_path = urlsplit(self.path)
            if parsed_path.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "http://192.0.2.1/credential-leak")
                self.end_headers()
                return
            if parsed_path.path == "/api/v1/replan/providers":
                if slow_provider_discovery_once[0]:
                    slow_provider_discovery_once[0] = False
                    time.sleep(0.25)
                self._reply(provider_payload)
                return
            if parsed_path.path == "/api/v1/companion/replan-run":
                query = parse_qs(parsed_path.query)
                assert replan_runs
                run = replan_runs[-1]
                assert query == {
                    "generationRequestId": [run["generationRequestId"]]
                }
                replan_run_polls[0] += 1
                terminal = replan_run_polls[0] >= 2
                self._reply(
                    {
                        "contractVersion": "1.0.0",
                        "generationRequestId": run["generationRequestId"],
                        "revisionRequestId": run["revisionRequestId"],
                        "targetAdapterId": "blender",
                        "targetInstanceId": companion.instance_id,
                        "provider": {
                            "id": "available-planner",
                            "version": "0.1.0",
                            "displayName": "Available Planner",
                        },
                        "status": "proposal_created" if terminal else "generating",
                        "terminal": terminal,
                        "sceneChanged": False,
                        "proposalId": provider_proposal_id if terminal else None,
                        "error": None,
                        "needsRevision": None,
                        "updatedAt": "2026-08-05T12:00:02.000Z",
                    }
                )
                return
            if parsed_path.path == "/api/v1/replan/thread":
                query = parse_qs(parsed_path.query)
                assert revision_requests
                revision_request = revision_requests[-1]
                assert query["threadId"] == [
                    revision_request["revisionThread"]["threadId"]
                ]
                assert query["targetAdapterId"] == ["blender"]
                assert query["instanceId"] == [companion.instance_id]
                self._reply(
                    {
                        "protocolVersion": "1.4.0",
                        "threadId": revision_request["revisionThread"]["threadId"],
                        "targetAdapterId": "blender",
                        "instanceId": companion.instance_id,
                        "planId": revision_request["basePlan"]["id"],
                        "latestTurn": 1,
                        "status": "awaiting_proposal",
                        "turns": [
                            {
                                "turn": 1,
                                "state": "awaiting_proposal",
                                "request": revision_request,
                                "proposal": None,
                                "decision": None,
                            }
                        ],
                        "page": {
                            "beforeTurn": None,
                            "nextBeforeTurn": None,
                            "hasMore": False,
                        },
                    }
                )
                return
            if parsed_path.path == "/api/v1/replan/branches":
                query = parse_qs(parsed_path.query)
                assert query["targetAdapterId"] == ["blender"]
                assert query["instanceId"] == [companion.instance_id]
                assert query["limit"] == ["20"]
                self._reply(
                    {
                        "protocolVersion": "1.5.0",
                        "targetAdapterId": "blender",
                        "instanceId": companion.instance_id,
                        "planId": query["planId"][0],
                        "branches": [],
                    }
                )
                return
            if slow_guide[0]:
                slow_guide_started.set()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "1000000")
                self.end_headers()
                for _index in range(100):
                    try:
                        self.wfile.write(b"{")
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    time.sleep(0.05)
                return
            query = parse_qs(parsed_path.query)
            requests.append(query)
            known = query.get("knownPlanId") == ["live-snowman"] and query.get(
                "knownRevision"
            ) == [str(DYNAMIC_REVISION)] and query.get(
                "knownPlanContentSha256"
            ) == [dynamic_plan_content_sha256]
            self._reply(
                {
                    "protocolVersion": "1.1.0",
                    "plan": None if known else dynamic_plan,
                    "planContentSha256": (
                        None if known else dynamic_plan_content_sha256
                    ),
                    "proposal": None,
                    "proposalPlanContentSha256": None,
                }
            )

        def do_POST(self):
            assert self.headers.get("Authorization") == f"Bearer {token}"
            length = int(self.headers["Content-Length"])
            payload = json.loads(self.rfile.read(length))
            if urlsplit(self.path).path == "/api/v1/companion/goal-request":
                goal_requests.append(payload)
                self._reply(
                    {
                        "result": "accepted",
                        "requestId": payload["requestId"],
                    }
                )
                return
            if urlsplit(self.path).path == "/api/v1/companion/revision-request":
                revision_requests.append(payload)
                self._reply(
                    {
                        "result": "accepted",
                        "requestId": payload["requestId"],
                    }
                )
                return
            if urlsplit(self.path).path == "/api/v1/companion/replan-run":
                replan_post_attempts.append(payload)
                if reject_replan_runs[0]:
                    self._reply(
                        {
                            "error": "provider_binding_mismatch",
                            "message": "Selected provider version is stale",
                        },
                        status=409,
                    )
                    return
                generation_request_id = payload["generationRequestId"]
                if generation_request_id not in invoked_generation_ids:
                    invoked_generation_ids.add(generation_request_id)
                    replan_runs.append(payload)
                if drop_first_replan_response[0]:
                    drop_first_replan_response[0] = False
                    try:
                        self.connection.shutdown(2)
                    except OSError:
                        pass
                    self.connection.close()
                    return
                self._reply(
                    {
                        "contractVersion": "1.0.0",
                        "generationRequestId": payload["generationRequestId"],
                        "revisionRequestId": payload["revisionRequestId"],
                        "targetAdapterId": "blender",
                        "targetInstanceId": companion.instance_id,
                        "provider": {
                            "id": "available-planner",
                            "version": "0.1.0",
                            "displayName": "Available Planner",
                        },
                        "status": "proposal_created",
                        "terminal": True,
                        "sceneChanged": False,
                        "proposalId": provider_proposal_id,
                        "error": None,
                        "needsRevision": None,
                        "updatedAt": "2026-08-05T12:00:01.000Z",
                    }
                )
                return
            if urlsplit(self.path).path == "/api/v1/companion/proposal-decision":
                proposal_decisions.append(payload)
                self._reply({"result": "accepted"})
                return
            reports.append(payload)
            self._reply({"result": post_result[0]})

        def log_message(self, _format, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    companion = operating_line.get_companion()
    main_thread_id = threading.get_ident()
    try:
        runtime_url = f"http://127.0.0.1:{server.server_port}"
        redirect_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id=BUNDLED_PLAN["id"],
            known_revision=PLAN_REVISION,
            known_plan_content_sha256=canonical_plan_content_sha256(BUNDLED_PLAN),
        )
        try:
            redirect_transport._request_json("GET", "/redirect")
        except HTTPError as error:
            assert error.code == 302
        else:
            raise AssertionError("Companion transport must reject HTTP redirects")
        if not getattr(bpy.app, "online_access", True):
            try:
                companion.connect(runtime_url, token)
            except ValueError as error:
                assert "online access is disabled" in str(error)
            else:
                raise AssertionError("Disabled Blender networking should block Connect")
        session = operating_line.get_session()
        transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id=session.plan_id,
            known_revision=session.revision,
            known_plan_content_sha256=session.plan_content_sha256,
        )
        companion._transport = transport
        transport.start()
        companion.report("connected")
        deadline = time.monotonic() + 4.0
        while time.monotonic() < deadline:
            companion.pump()
            if (
                operating_line.get_session().plan_id == "live-snowman"
                and any(
                    query.get("knownPlanId") == ["live-snowman"]
                    and query.get("knownRevision") == [str(DYNAMIC_REVISION)]
                    and query.get("knownPlanContentSha256")
                    == [dynamic_plan_content_sha256]
                    for query in requests
                )
            ):
                break
            time.sleep(0.02)
        assert operating_line.get_session().plan_id == "live-snowman"
        assert operating_line.get_session().plan_content_sha256 == (
            dynamic_plan_content_sha256
        )
        assert companion.last_report["planContentSha256"] == (
            dynamic_plan_content_sha256
        )
        assert requests[0].get("knownPlanId") == [BUNDLED_PLAN["id"]]
        assert requests[0].get("knownRevision") == [str(PLAN_REVISION)]
        assert requests[0].get("knownPlanContentSha256") == [
            session.plan_content_sha256
        ]
        assert all(query["adapterId"] == ["blender"] for query in requests)
        assert all(query["instanceId"] == [companion.instance_id] for query in requests)
        assert server_thread.ident != main_thread_id

        # Provider discovery never makes a default choice. Unavailable choices
        # remain visible but cannot cross the explicit selection/ACK/run gates.
        provider_deadline = time.monotonic() + 2.0
        while time.monotonic() < provider_deadline:
            companion.pump()
            if len(companion.provider_descriptors) == 2:
                break
            time.sleep(0.02)
        assert len(companion.provider_descriptors) == 2
        assert companion.selected_provider_id is None
        try:
            companion.select_replan_provider("unavailable-planner")
        except ValueError as error:
            assert "credential is not configured" in str(error)
        else:
            raise AssertionError("Unavailable provider selection must fail")
        assert companion.selected_provider_id is None
        assert companion.select_replan_provider("available-planner")["id"] == (
            "available-planner"
        )
        try:
            companion.begin_replan_run()
        except ValueError as error:
            assert "runtime acknowledges" in str(error)
        else:
            raise AssertionError("Provider run must remain gated before request ACK")

        # The revision workspace keeps structured references separate from the
        # user-authored request body. References are ordered, de-duplicated,
        # and removable one at a time without changing the base session or scene.
        session_before_request = operating_line.get_session()
        scene_objects_before_request = {
            item.as_pointer() for item in bpy.data.objects
        }
        bpy.context.window_manager.operating_line_revision_message = (
            "Make the selected parts slightly rougher"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Make the selected parts slightly rougher"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.body_upper",
        ) == {"FINISHED"}
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head", "snowman.model.body_upper")
        head_fields = {
            field.name: field
            for field in companion.revision_parameter_fields(
                "snowman.model.head"
            )
        }
        assert head_fields["radius"].kind == "number"
        assert head_fields["radius"].editable is True
        assert head_fields["resourceId"].editable is False
        assert bpy.ops.operating_line.edit_revision_parameter(
            node_id="snowman.model.head",
            argument_name="radius",
            value_kind="number",
            float_value=1.05,
        ) == {"FINISHED"}
        assert companion.revision_parameter_edit_count == 1
        assert math.isclose(
            companion.revision_parameter_field(
                "snowman.model.head", "radius"
            ).value,
            1.05,
            abs_tol=1e-6,
        )
        assert bpy.ops.operating_line.remove_revision_reference(
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.body_upper",)
        assert companion.revision_parameter_edit_count == 0
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Make the selected parts slightly rougher"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.body_upper", "snowman.model.head")
        body_radius = companion.revision_parameter_field(
            "snowman.model.body_upper", "radius"
        )
        requested_body_radius = float(body_radius.original_value) + 0.1
        assert bpy.ops.operating_line.edit_revision_parameter(
            node_id="snowman.model.body_upper",
            argument_name="radius",
            value_kind="number",
            float_value=requested_body_radius,
        ) == {"FINISHED"}
        stored_body_radius = companion.revision_parameter_field(
            "snowman.model.body_upper", "radius"
        ).value
        assert math.isclose(
            stored_body_radius,
            requested_body_radius,
            abs_tol=1e-6,
        )
        assert companion.revision_parameter_edits() == (
            {
                "nodeId": "snowman.model.body_upper",
                "argumentName": "radius",
                "before": body_radius.original_value,
                "after": stored_body_radius,
            },
        )
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )
        assert bpy.ops.operating_line.submit_revision_request() == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_revision_message == ""
        assert "queued locally" in companion.revision_request_status
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )
        request_deadline = time.monotonic() + 4.0
        while time.monotonic() < request_deadline:
            companion.pump()
            if revision_requests and "stored in runtime for MCP planner" in (
                companion.revision_request_status
            ):
                break
            time.sleep(0.02)
        assert len(revision_requests) == 1
        revision_request = revision_requests[0]
        uuid.UUID(revision_request["requestId"])
        assert revision_request["protocolVersion"] == "1.5.0"
        assert revision_request["adapterId"] == "blender"
        assert revision_request["catalogVersion"] == ACTION_CATALOG["catalogVersion"]
        assert revision_request["instanceId"] == companion.instance_id
        assert revision_request["basePlan"] == dynamic_plan
        assert revision_request["references"] == [
            {"nodeId": "snowman.model.body_upper", "nodeNumber": "1.1.2"},
            {"nodeId": "snowman.model.head", "nodeNumber": "1.1.3"},
        ]
        assert revision_request["message"] == "Make the selected parts slightly rougher"
        assert revision_request["parameterEdits"] == [
            {
                "nodeId": "snowman.model.body_upper",
                "argumentName": "radius",
                "before": body_radius.original_value,
                "after": stored_body_radius,
            }
        ]
        assert revision_request["revisionThread"] == {
            "threadId": revision_request["requestId"],
            "turn": 1,
            "parentRequestId": None,
        }
        assert revision_request["revisionOperation"] == {"kind": "revise"}
        assert companion.last_revision_request_id == revision_request["requestId"]
        assert companion.revision_parameter_edit_count == 0

        # One explicit authorization queues on the worker and is polled without
        # blocking Blender's main thread. A terminal proposal-created status is
        # still only a review handoff: scene and accepted Session stay unchanged.
        assert companion.provider_handoff.acknowledged_revision_request_id == (
            revision_request["requestId"]
        )
        session_before_provider = operating_line.get_session()
        scene_before_provider = {item.as_pointer() for item in bpy.data.objects}
        try:
            bpy.ops.operating_line.run_replan_provider()
        except RuntimeError as error:
            assert "authorization dialog" in str(error)
        else:
            raise AssertionError("Direct execute must not bypass provider confirmation")
        assert replan_runs == []
        assert companion.provider_handoff.generation_request_id is None
        run_request = companion.begin_replan_run()
        assert run_request["revisionRequestId"] == revision_request["requestId"]
        assert run_request["providerId"] == "available-planner"
        assert run_request["authorization"] == {
            "disclosureVersion": "1.0.0",
            "dataHandlingAcknowledged": True,
            "possibleChargesAcknowledged": True,
            "proposalCreationAcknowledged": True,
            "authorizedAt": run_request["authorization"]["authorizedAt"],
        }
        active_run_identity = (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        )
        try:
            companion.refresh_replan_providers()
        except ValueError as error:
            assert "active provider run" in str(error)
        else:
            raise AssertionError("Active provider run must block provider refresh")
        assert (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        ) == active_run_identity
        unrelated_plan = deepcopy(dynamic_plan)
        unrelated_plan["revision"] = DYNAMIC_REVISION + 1
        unrelated_plan["title"] = "Unrelated guide update during provider run"
        assert companion.install_plan(unrelated_plan)
        assert (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        ) == active_run_identity
        replace_operating_line_session(session_before_provider)
        transport.accept_plan(
            "live-snowman",
            DYNAMIC_REVISION,
            dynamic_plan_content_sha256,
        )
        transport.follow_revision_thread(revision_request["revisionThread"]["threadId"])

        unrelated_preview_plan = deepcopy(dynamic_plan)
        unrelated_preview_plan["id"] = "unrelated-provider-preview"
        unrelated_preview_plan["revision"] = DYNAMIC_REVISION + 2
        unrelated_proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": companion.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "plan": unrelated_preview_plan,
            "planDiff": None,
            "proposedAt": "2026-08-05T12:00:00Z",
        }
        assert companion.stage_proposal(unrelated_proposal)
        assert companion.provider_handoff.phase == "queued"
        assert companion.accept_proposal() is False
        assert companion.reject_proposal() is False
        assert companion.proposed_plan is unrelated_proposal
        assert companion.provider_handoff.generation_request_id == (
            run_request["generationRequestId"]
        )
        companion.add_revision_reference("active", "snowman.model.body_lower")
        blocked_message = "Queue this only after the active provider run"
        bpy.context.window_manager.operating_line_revision_message = blocked_message
        handoff_identity = (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        )
        for active_phase in ("queued", "generating"):
            companion.provider_handoff.phase = active_phase
            try:
                companion.submit_revision_request(blocked_message)
            except ValueError as error:
                assert "active provider run" in str(error)
            else:
                raise AssertionError(
                    f"A {active_phase} provider run must block a second request"
                )
            assert companion.provider_handoff.acknowledged_revision_request_id == (
                handoff_identity[0]
            )
            assert companion.provider_handoff.generation_request_id == handoff_identity[1]
            assert companion.provider_handoff.phase == active_phase
            assert tuple(
                node.id for node in companion.revision_reference_nodes()
            ) == ("snowman.model.body_lower",)
            assert bpy.context.window_manager.operating_line_revision_message == (
                blocked_message
            )
        assert len(revision_requests) == 1
        provider_deadline = time.monotonic() + 3.5
        while time.monotonic() < provider_deadline:
            companion.pump()
            if companion.provider_handoff.phase == "proposal_created":
                break
            time.sleep(0.02)
        assert len(replan_runs) == 1
        assert len(replan_post_attempts) == 2
        assert {
            attempt["generationRequestId"] for attempt in replan_post_attempts
        } == {run_request["generationRequestId"]}
        assert invoked_generation_ids == {run_request["generationRequestId"]}
        assert replan_run_polls[0] == 0
        assert companion.provider_handoff.phase == "proposal_created"
        assert companion.provider_handoff.generation_request_id == (
            run_request["generationRequestId"]
        )
        assert companion.proposed_plan is None
        assert operating_line.get_session() is session_before_provider
        assert {item.as_pointer() for item in bpy.data.objects} == scene_before_provider
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.body_lower",)
        assert bpy.context.window_manager.operating_line_revision_message == blocked_message
        provider_plan = deepcopy(dynamic_plan)
        provider_plan["revision"] = DYNAMIC_REVISION + 1
        provider_plan_content_sha256 = canonical_plan_content_sha256(provider_plan)
        provider_proposal = {
            "protocolVersion": "1.5.0",
            "proposalId": provider_proposal_id,
            "targetAdapterId": "blender",
            "targetInstanceId": companion.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "revisionRequestId": revision_request["requestId"],
            "revisionThread": revision_request["revisionThread"],
            "revisionOperation": revision_request["revisionOperation"],
            "plan": provider_plan,
            "planDiff": {
                "basePlan": {
                    "id": dynamic_plan["id"],
                    "revision": dynamic_plan["revision"],
                },
                "targetPlan": {
                    "id": provider_plan["id"],
                    "revision": provider_plan["revision"],
                },
                "summary": {
                    "planFields": 0,
                    "addedSteps": 0,
                    "removedSteps": 0,
                    "updatedSteps": 0,
                    "movedSteps": 0,
                },
                "planChanges": [],
                "stepChanges": [],
            },
            "proposedAt": "2026-08-05T12:00:03Z",
        }
        provider_proposal_without_operation = deepcopy(provider_proposal)
        provider_proposal_without_operation.pop("revisionOperation")
        try:
            companion.stage_proposal(
                provider_proposal_without_operation,
                provider_plan_content_sha256,
            )
        except ValueError as error:
            assert "require a revision operation" in str(error)
        else:
            raise AssertionError(
                "A protocol 1.4 revision proposal must preserve its explicit operation"
            )
        assert companion.stage_proposal(
            provider_proposal,
            provider_plan_content_sha256,
        )
        assert companion.proposed_plan is provider_proposal
        assert companion.proposal_session.plan_content_sha256 == (
            provider_plan_content_sha256
        )
        assert companion.stage_proposal(unrelated_proposal)
        assert companion.proposed_plan is provider_proposal
        assert companion.provider_handoff.complete_proposal_review(
            revision_request["requestId"], unrelated_proposal["proposalId"]
        ) is False
        assert companion.reject_proposal()
        decision_deadline = time.monotonic() + 2.0
        while time.monotonic() < decision_deadline and not proposal_decisions:
            time.sleep(0.01)
        assert proposal_decisions
        assert proposal_decisions[-1]["proposalId"] == provider_proposal_id
        assert companion.provider_handoff.generation_request_id is None
        assert companion.provider_handoff.phase == "idle"
        assert companion.proposed_plan is unrelated_proposal
        assert companion.reject_proposal()
        companion.clear_revision_draft()

        # A deterministic 4xx authorization rejection is terminal on the
        # transport queue: surface it once and never retry it in the background.
        companion.provider_handoff.revision_submitted(
            revision_request["requestId"]
        )
        companion.provider_handoff.revision_acknowledged(
            revision_request["requestId"]
        )
        reject_replan_runs[0] = True
        rejected_request = companion.begin_replan_run()
        rejected_deadline = time.monotonic() + 2.0
        while time.monotonic() < rejected_deadline:
            companion.pump()
            if companion.provider_handoff.retry_mode == "never":
                break
            time.sleep(0.02)
        assert len(replan_post_attempts) == 3
        assert replan_post_attempts[-1]["generationRequestId"] == (
            rejected_request["generationRequestId"]
        )
        assert len(replan_runs) == 1
        assert companion.provider_handoff.phase == "failed"
        assert companion.provider_handoff.retry_mode == "never"
        assert "provider version is stale" in companion.provider_handoff.message
        time.sleep(0.25)
        companion.pump()
        assert len(replan_post_attempts) == 3
        reject_replan_runs[0] = False

        # Optional provider discovery may time out once, but must not stay at
        # the head of the worker queue and starve reports or guide polling.
        core_requests_before = len(requests)
        slow_provider_discovery_once[0] = True
        starvation_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            known_plan_content_sha256=dynamic_plan_content_sha256,
            timeout=0.1,
            poll_interval=0.05,
        )
        starvation_report = deepcopy(companion.last_report)
        starvation_report["reportId"] = str(uuid.uuid4())
        starvation_report["sequence"] = 10_001
        starvation_report["transition"] = "provider_discovery_probe"
        starvation_report["plan"] = {
            "id": "live-snowman",
            "revision": DYNAMIC_REVISION,
        }
        starvation_transport.send_report(starvation_report)
        starvation_transport.start()
        starvation_deadline = time.monotonic() + 2.0
        saw_provider_unavailable = False
        while time.monotonic() < starvation_deadline:
            while not starvation_transport.incoming.empty():
                saw_provider_unavailable |= (
                    starvation_transport.incoming.get_nowait().get("kind")
                    == "replan_provider_list_unavailable"
                )
            if (
                saw_provider_unavailable
                and starvation_transport.last_delivered_sequence == 10_001
                and len(requests) > core_requests_before
            ):
                break
            time.sleep(0.01)
        assert saw_provider_unavailable
        assert starvation_transport.last_delivered_sequence == 10_001
        assert len(requests) > core_requests_before
        starvation_transport.stop(flush_timeout=0.0)
        assert starvation_transport.wait_stopped(2.0)

        history_deadline = time.monotonic() + 2.0
        while time.monotonic() < history_deadline:
            companion.pump()
            if companion.revision_thread_history is not None:
                break
            time.sleep(0.02)
        assert companion.revision_thread_history is not None
        assert companion.revision_thread_history["turns"][0]["request"][
            "message"
        ] == revision_request["message"]
        assert companion.revision_thread_history["status"] == "awaiting_proposal"
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )

        # The application boundary enforces the documented eight-reference
        # limit without dropping the existing structured selection or body.
        maximum_reference_ids = (
            "snowman",
            "snowman.scene",
            "snowman.scene.ground",
            "snowman.model",
            "snowman.model.body_lower",
            "snowman.model.body_upper",
            "snowman.model.head",
            "snowman.details",
        )
        limit_controller = CompanionController()
        assert limit_controller.stage_proposal(
            {
                "protocolVersion": "1.1.0",
                "proposalId": str(uuid.uuid4()),
                "targetAdapterId": "blender",
                "plan": deepcopy(FULL_PLAN),
                "planDiff": None,
                "proposedAt": "2026-08-05T12:00:00Z",
            }
        ) is True
        bpy.context.window_manager.operating_line_revision_message = (
            "Keep all eight references if another node is rejected"
        )
        for node_id in maximum_reference_ids:
            limit_controller.add_revision_reference("proposal", node_id)
        try:
            limit_controller.add_revision_reference(
                "proposal",
                "snowman.details.face",
            )
        except ValueError as error:
            assert "at most 8 nodes" in str(error)
        else:
            raise AssertionError("A ninth revision reference must be rejected")
        assert tuple(
            node.id for node in limit_controller.revision_reference_nodes()
        ) == maximum_reference_ids
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Keep all eight references if another node is rejected"
        )
        limit_controller.clear_revision_draft()

        # Installing a plan while a revision request is awaiting its runtime
        # ACK invalidates that authorization. A late ACK for the old request
        # must not resurrect the handoff or make a provider runnable.
        late_ack_controller = CompanionController()
        late_request_id = str(uuid.uuid4())
        late_ack_controller.provider_handoff.revision_submitted(late_request_id)
        late_ack_controller.last_revision_request_id = late_request_id
        late_ack_controller._pending_revision_request_ids.add(late_request_id)
        late_ack_controller._invalidate_handoff_for_plan_install()
        assert late_ack_controller.last_revision_request_id is None
        assert late_ack_controller.provider_handoff.pending_revision_request_id is None
        late_ack_controller._acknowledge_revision_request(late_request_id)
        assert (
            late_ack_controller.provider_handoff.acknowledged_revision_request_id
            is None
        )
        assert late_ack_controller.provider_handoff.can_run is False

        # Proposal delivery and terminal status are independent streams. The
        # provider-authored proposal must win by exact proposal/request identity
        # in every meaningful ordering, while unrelated work remains bounded
        # and is promoted only after the provider proposal is reviewed.
        for order in (
            ("P", "U", "S"),
            ("U", "P", "S"),
            ("S", "P"),
            ("P", "S", "U"),
            ("S", "U", "P"),
            ("X", "S", "P"),
            ("S", "X", "P"),
        ):
            ordering_controller = CompanionController()
            ordering_controller.provider_handoff.set_providers(provider_payload)
            ordering_controller.select_replan_provider("available-planner")
            ordering_request_id = str(uuid.uuid4())
            ordering_controller.provider_handoff.revision_submitted(
                ordering_request_id
            )
            ordering_controller.provider_handoff.revision_acknowledged(
                ordering_request_id
            )
            ordering_run = ordering_controller.provider_handoff.begin(
                target_instance_id=ordering_controller.instance_id
            )
            ordering_plan = deepcopy(dynamic_plan)
            ordering_plan["revision"] = DYNAMIC_REVISION + 20
            ordering_proposal_id = str(uuid.uuid4())
            ordering_provider_proposal = {
                "protocolVersion": "1.1.0",
                "proposalId": ordering_proposal_id,
                "targetAdapterId": "blender",
                "targetInstanceId": ordering_controller.instance_id,
                "catalogVersion": ACTION_CATALOG["catalogVersion"],
                "revisionRequestId": ordering_request_id,
                "revisionThread": {
                    "threadId": ordering_request_id,
                    "turn": 1,
                    "parentRequestId": None,
                },
                "plan": ordering_plan,
                "planDiff": {
                    "basePlan": {
                        "id": dynamic_plan["id"],
                        "revision": dynamic_plan["revision"],
                    },
                    "targetPlan": {
                        "id": ordering_plan["id"],
                        "revision": ordering_plan["revision"],
                    },
                    "summary": {
                        "planFields": 0,
                        "addedSteps": 0,
                        "removedSteps": 0,
                        "updatedSteps": 0,
                        "movedSteps": 0,
                    },
                    "planChanges": [],
                    "stepChanges": [],
                },
                "proposedAt": "2026-08-05T12:00:04Z",
            }
            ordering_unrelated_plan = deepcopy(dynamic_plan)
            ordering_unrelated_plan["id"] = f"ordering-unrelated-{''.join(order)}"
            ordering_unrelated_plan["revision"] = DYNAMIC_REVISION + 21
            ordering_unrelated = {
                "protocolVersion": "1.1.0",
                "proposalId": str(uuid.uuid4()),
                "targetAdapterId": "blender",
                "targetInstanceId": ordering_controller.instance_id,
                "catalogVersion": ACTION_CATALOG["catalogVersion"],
                "plan": ordering_unrelated_plan,
                "planDiff": None,
                "proposedAt": "2026-08-05T12:00:05Z",
            }
            poisoning_request_id = str(uuid.uuid4())
            poisoning_proposal = {
                **ordering_provider_proposal,
                "revisionRequestId": poisoning_request_id,
                "revisionThread": {
                    "threadId": poisoning_request_id,
                    "turn": 1,
                    "parentRequestId": None,
                },
            }
            ordering_status = {
                "contractVersion": "1.0.0",
                "generationRequestId": ordering_run["generationRequestId"],
                "revisionRequestId": ordering_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": ordering_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": ordering_proposal_id,
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:06Z",
            }
            for event in order:
                if event == "P":
                    assert ordering_controller.stage_proposal(
                        ordering_provider_proposal
                    )
                elif event == "U":
                    assert ordering_controller.stage_proposal(ordering_unrelated)
                    if ordering_controller.provider_handoff.phase == "proposal_created":
                        if ordering_controller.proposed_plan is None:
                            assert ordering_controller.accept_proposal() is False
                            assert ordering_controller.reject_proposal() is False
                        else:
                            assert (
                                ordering_controller.proposed_plan
                                is ordering_provider_proposal
                            )
                elif event == "X":
                    assert ordering_controller.stage_proposal(poisoning_proposal)
                    if ordering_controller.provider_handoff.phase == "proposal_created":
                        assert ordering_controller.proposed_plan is None
                        assert ordering_controller.accept_proposal() is False
                        assert ordering_controller.reject_proposal() is False
                        assert (
                            ordering_controller.provider_handoff.proposal_id
                            == ordering_proposal_id
                        )
                else:
                    ordering_controller.provider_handoff.apply_status(ordering_status)
                    ordering_controller._bind_provider_proposal()
            assert ordering_controller.proposed_plan is ordering_provider_proposal
            assert ordering_controller.reject_proposal()
            if "U" in order:
                assert ordering_controller.proposed_plan is ordering_unrelated
                assert ordering_controller.reject_proposal()
            else:
                assert ordering_controller.proposed_plan is None, order

        bounded_controller = CompanionController()
        bounded_controller.provider_handoff.set_providers(provider_payload)
        bounded_controller.select_replan_provider("available-planner")
        bounded_request_id = str(uuid.uuid4())
        bounded_controller.provider_handoff.revision_submitted(bounded_request_id)
        bounded_controller.provider_handoff.revision_acknowledged(bounded_request_id)
        bounded_run = bounded_controller.provider_handoff.begin(
            target_instance_id=bounded_controller.instance_id
        )
        bounded_proposal_id = str(uuid.uuid4())
        bounded_plan = deepcopy(dynamic_plan)
        bounded_plan["revision"] = DYNAMIC_REVISION + 30

        def bounded_candidate(request_id):
            return {
                "protocolVersion": "1.1.0",
                "proposalId": bounded_proposal_id,
                "targetAdapterId": "blender",
                "targetInstanceId": bounded_controller.instance_id,
                "catalogVersion": ACTION_CATALOG["catalogVersion"],
                "revisionRequestId": request_id,
                "revisionThread": {
                    "threadId": request_id,
                    "turn": 1,
                    "parentRequestId": None,
                },
                "plan": bounded_plan,
                "planDiff": {
                    "basePlan": {
                        "id": dynamic_plan["id"],
                        "revision": dynamic_plan["revision"],
                    },
                    "targetPlan": {
                        "id": bounded_plan["id"],
                        "revision": bounded_plan["revision"],
                    },
                    "summary": {
                        "planFields": 0,
                        "addedSteps": 0,
                        "removedSteps": 0,
                        "updatedSteps": 0,
                        "movedSteps": 0,
                    },
                    "planChanges": [],
                    "stepChanges": [],
                },
                "proposedAt": "2026-08-05T12:00:06Z",
            }

        for _index in range(7):
            assert bounded_controller.stage_proposal(
                bounded_candidate(str(uuid.uuid4()))
            )
        assert len(bounded_controller._proposal_candidates) == 7
        bounded_decisions = []

        class BoundedTransport:
            running = True

            def __init__(self, proposal):
                self.incoming = Queue()
                self.incoming.put({"kind": "proposal", "proposal": proposal})

            def decide_proposal(self, proposal_id, decision):
                bounded_decisions.append((proposal_id, decision))

            def send_report(self, _report):
                pass

        bounded_controller._transport = BoundedTransport(
            bounded_candidate(str(uuid.uuid4()))
        )
        bounded_controller.pump()
        assert len(bounded_controller._proposal_candidates) == 7
        assert bounded_controller.status == "Proposal review queue full"
        assert "queue is full" in bounded_controller.error
        assert bounded_decisions == []
        bounded_controller._transport = None
        bounded_controller.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": bounded_run["generationRequestId"],
                "revisionRequestId": bounded_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": bounded_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": bounded_proposal_id,
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:07Z",
            }
        )
        try:
            bounded_controller.stage_proposal(
                bounded_candidate(str(uuid.uuid4()))
            )
        except ProposalQueueFullError:
            pass
        else:
            raise AssertionError(
                "A known provider proposal must retain its reserved queue slot"
            )
        assert len(bounded_controller._proposal_candidates) == 7
        exact_bounded_proposal = bounded_candidate(bounded_request_id)
        assert bounded_controller.stage_proposal(exact_bounded_proposal)
        assert bounded_controller.proposed_plan is exact_bounded_proposal
        assert len(bounded_controller._proposal_candidates) == 1

        # A request-linked proposal is bound to the plan snapshot it revised.
        # If an ordinary plan update moves the active session first, Accept is
        # rejected without changing the scene/session/proposal; Reject remains
        # available so the stale review can be closed explicitly.
        drift_controller = CompanionController()
        drift_base_session = operating_line.get_session()
        drift_base_plan = drift_base_session.source_plan_copy()
        drift_target_plan = deepcopy(drift_base_plan)
        drift_target_plan["revision"] = drift_base_session.revision + 2
        drift_request_id = str(uuid.uuid4())
        drift_controller.provider_handoff.set_providers(provider_payload)
        drift_controller.select_replan_provider("available-planner")
        drift_controller.provider_handoff.revision_submitted(drift_request_id)
        drift_controller.provider_handoff.revision_acknowledged(drift_request_id)
        drift_run = drift_controller.provider_handoff.begin(
            target_instance_id=drift_controller.instance_id
        )
        drift_proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": drift_controller.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "revisionRequestId": drift_request_id,
            "revisionThread": {
                "threadId": drift_request_id,
                "turn": 1,
                "parentRequestId": None,
            },
            "plan": drift_target_plan,
            "planDiff": {
                "basePlan": {
                    "id": drift_base_session.plan_id,
                    "revision": drift_base_session.revision,
                },
                "targetPlan": {
                    "id": drift_target_plan["id"],
                    "revision": drift_target_plan["revision"],
                },
                "summary": {
                    "planFields": 0,
                    "addedSteps": 0,
                    "removedSteps": 0,
                    "updatedSteps": 0,
                    "movedSteps": 0,
                },
                "planChanges": [],
                "stepChanges": [],
            },
            "proposedAt": "2026-08-05T12:00:07Z",
        }
        assert drift_controller.stage_proposal(drift_proposal)
        drifted_plan = deepcopy(drift_base_plan)
        drifted_plan["revision"] = drift_base_session.revision + 1
        assert drift_controller.install_plan(drifted_plan)
        drift_controller.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": drift_run["generationRequestId"],
                "revisionRequestId": drift_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": drift_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": drift_proposal["proposalId"],
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:08Z",
            }
        )
        assert drift_controller._bind_provider_proposal()
        drifted_session = operating_line.get_session()
        drift_scene = {item.as_pointer() for item in bpy.data.objects}
        drift_proposal_session = drift_controller.proposal_session
        drift_candidates = dict(drift_controller._proposal_candidates)
        drift_handoff_identity = (
            drift_controller.provider_handoff.acknowledged_revision_request_id,
            drift_controller.provider_handoff.generation_request_id,
            drift_controller.provider_handoff.proposal_id,
            drift_controller.provider_handoff.phase,
        )
        drift_decisions = []

        class DriftTransport:
            running = True

            def send_report(self, _report):
                pass

            def decide_proposal(self, proposal_id, decision):
                drift_decisions.append((proposal_id, decision))

            def follow_revision_thread(self, _thread_id):
                pass

        drift_controller._transport = DriftTransport()
        assert drift_controller.accept_proposal() is False
        assert drift_controller.proposed_plan is drift_proposal
        assert drift_controller.proposal_session is drift_proposal_session
        assert drift_controller._proposal_candidates == drift_candidates
        assert (
            drift_controller.provider_handoff.acknowledged_revision_request_id,
            drift_controller.provider_handoff.generation_request_id,
            drift_controller.provider_handoff.proposal_id,
            drift_controller.provider_handoff.phase,
        ) == drift_handoff_identity
        assert operating_line.get_session() is drifted_session
        assert {item.as_pointer() for item in bpy.data.objects} == drift_scene
        assert drift_decisions == []
        assert "current" in drift_controller.error
        assert "base" in drift_controller.error
        assert drift_controller.reject_proposal()
        assert drift_decisions == [(drift_proposal["proposalId"], "rejected")]
        drift_controller._transport = None
        replace_operating_line_session(drift_base_session)

        # Protocol 1.0 legally permits a request-linked proposal without a
        # planDiff. It remains reviewable and rejectable, but Accept fails
        # closed because Blender cannot verify which active base it revised.
        legacy_controller = CompanionController()
        legacy_controller.provider_handoff.set_providers(provider_payload)
        legacy_controller.select_replan_provider("available-planner")
        legacy_request_id = str(uuid.uuid4())
        legacy_controller.provider_handoff.revision_submitted(legacy_request_id)
        legacy_controller.provider_handoff.revision_acknowledged(legacy_request_id)
        legacy_run = legacy_controller.provider_handoff.begin(
            target_instance_id=legacy_controller.instance_id
        )
        legacy_plan = deepcopy(dynamic_plan)
        legacy_plan["revision"] = DYNAMIC_REVISION + 40
        legacy_proposal = {
            "protocolVersion": "1.0.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": legacy_controller.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "revisionRequestId": legacy_request_id,
            "revisionThread": {
                "threadId": legacy_request_id,
                "turn": 1,
                "parentRequestId": None,
            },
            "plan": legacy_plan,
            "proposedAt": "2026-08-05T12:00:09Z",
        }
        assert legacy_controller.stage_proposal(legacy_proposal)
        legacy_controller.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": legacy_run["generationRequestId"],
                "revisionRequestId": legacy_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": legacy_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": legacy_proposal["proposalId"],
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:10Z",
            }
        )
        assert legacy_controller._bind_provider_proposal()
        assert _proposal_accept_requires_verifiable_base(legacy_proposal)
        legacy_session = operating_line.get_session()
        legacy_scene = {item.as_pointer() for item in bpy.data.objects}
        legacy_proposal_session = legacy_controller.proposal_session
        legacy_candidates = dict(legacy_controller._proposal_candidates)
        legacy_handoff = deepcopy(legacy_controller.provider_handoff.__dict__)
        legacy_decisions = []

        class LegacyTransport:
            running = True

            def decide_proposal(self, proposal_id, decision):
                legacy_decisions.append((proposal_id, decision))

            def follow_revision_thread(self, _thread_id):
                pass

        legacy_controller._transport = LegacyTransport()
        assert legacy_controller.accept_proposal() is False
        assert "protocol 1.1" in legacy_controller.error
        assert legacy_controller.status == "Proposal base cannot be verified"
        assert legacy_controller.proposed_plan is legacy_proposal
        assert legacy_controller.proposal_session is legacy_proposal_session
        assert legacy_controller._proposal_candidates == legacy_candidates
        assert legacy_controller.provider_handoff.__dict__ == legacy_handoff
        assert operating_line.get_session() is legacy_session
        assert {item.as_pointer() for item in bpy.data.objects} == legacy_scene
        assert legacy_decisions == []
        assert legacy_controller.reject_proposal()
        assert legacy_decisions == [(legacy_proposal["proposalId"], "rejected")]
        legacy_controller._transport = None

        # Hiding the visual guidance does not discard a new workspace draft or
        # the loaded immutable thread. Collapsing the workspace and toggling
        # guidance both leave the host state alone.
        history_before_hide = companion.revision_thread_history
        bpy.context.window_manager.operating_line_revision_message = (
            "Preserve this draft while guidance is hidden"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        bpy.context.window_manager.operating_line_revision_workspace_expanded = False
        assert companion.revision_thread_history is history_before_hide
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        bpy.context.window_manager.operating_line_revision_workspace_expanded = True
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert companion.revision_thread_history is history_before_hide
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert overlay_enabled() is False
        assert companion.revision_thread_history is history_before_hide
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )

        # Disconnect may flush queued state, but it must retain and expose any
        # worker that is still stopping instead of claiming to be offline.
        expected_sequence = companion.last_report["sequence"]
        active_transport = transport
        disconnect_started = time.monotonic()
        companion.disconnect()
        assert time.monotonic() - disconnect_started < 0.25
        assert companion.status in {"Disconnecting", "Offline"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert companion.revision_base_session is session_before_request
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        if active_transport.running:
            assert companion.status == "Disconnecting"
            assert active_transport in companion._stopping_transports
        assert active_transport.wait_stopped(2.0)
        companion.pump()
        assert companion.status == "Offline"
        assert companion._stopping_transports == []
        assert active_transport.last_delivered_sequence >= expected_sequence
        companion.clear_revision_draft()
        transitions = [report["transition"] for report in reports]
        assert transitions[:2] == ["connected", "plan_loaded"]
        report = reports[-1]
        assert set(report) == {
            "protocolVersion",
            "reportId",
            "sequence",
            "adapterId",
            "instanceId",
            "companionVersion",
            "hostVersion",
            "plan",
            "planContentSha256",
            "executionId",
            "phase",
            "activeStepId",
            "completedStepIds",
            "transition",
            "stepId",
            "observations",
            "observationGate",
            "artifactAttestation",
            "error",
            "occurredAt",
        }
        uuid.UUID(report["reportId"])
        assert report["plan"] == {
            "id": "live-snowman",
            "revision": DYNAMIC_REVISION,
        }
        assert isinstance(report["planContentSha256"], str)
        assert len(report["planContentSha256"]) == 64
        assert report["executionId"] is None
        assert report["phase"] == "ready" and report["error"] is None
        assert report["artifactAttestation"] is None

        # A stale/unknown acknowledgement is an error and cannot advance the
        # delivery watermark. Once accepted, the same pending report can flush.
        post_result[0] = "stale"
        rejected_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            known_plan_content_sha256=dynamic_plan_content_sha256,
            timeout=0.2,
        )
        rejected_transport.send_report({"sequence": 99, "transition": "connected"})
        rejected_transport.start()
        rejection_deadline = time.monotonic() + 2.0
        saw_rejection = False
        while time.monotonic() < rejection_deadline:
            while not rejected_transport.incoming.empty():
                saw_rejection |= (
                    rejected_transport.incoming.get_nowait().get("kind") == "error"
                )
            if saw_rejection:
                break
            time.sleep(0.01)
        assert saw_rejection and rejected_transport.last_delivered_sequence == 0
        post_result[0] = "accepted"
        rejected_transport.stop()
        assert rejected_transport.wait_stopped(2.0)
        assert rejected_transport.last_delivered_sequence == 99

        # Reconnecting while a goal-linked proposal awaits the human must keep
        # the exact goal/proposal correlation and must not manufacture Reject.
        reconnect_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            known_plan_content_sha256=dynamic_plan_content_sha256,
        )
        companion._transport = reconnect_transport
        reconnect_transport.start()
        reconnect_goal = companion.submit_goal_request(
            "Keep this proposal reviewable across reconnect"
        )
        reconnect_plan = deepcopy(dynamic_plan)
        reconnect_plan["id"] = reconnect_goal["planId"]
        reconnect_plan["revision"] += 30
        reconnect_plan["protocolVersion"] = "1.2.0"
        reconnect_proposal = {
            "protocolVersion": "1.2.0",
            "proposalId": str(uuid.uuid4()),
            "goalRequestId": reconnect_goal["requestId"],
            "targetAdapterId": "blender",
            "targetInstanceId": companion.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "plan": reconnect_plan,
            "planDiff": None,
            "proposedAt": "2026-08-09T12:00:00Z",
        }
        assert companion.stage_proposal(reconnect_proposal)
        decisions_before_reconnect = len(proposal_decisions)
        assert bpy.ops.operating_line.disconnect() == {"FINISHED"}
        assert companion.proposed_plan is reconnect_proposal
        assert companion.goal_request.request_id == reconnect_goal["requestId"]
        bpy.context.window_manager.operating_line_runtime_url = runtime_url
        bpy.context.window_manager.operating_line_bearer_token = token
        previous_online_access = bpy.context.preferences.system.use_online_access
        bpy.context.preferences.system.use_online_access = True
        try:
            assert bpy.ops.operating_line.connect() == {"FINISHED"}
        finally:
            bpy.context.preferences.system.use_online_access = previous_online_access
        assert companion.proposed_plan is reconnect_proposal
        assert companion.goal_request.request_id == reconnect_goal["requestId"]
        assert companion.goal_request.phase == "proposal_received"
        assert len(proposal_decisions) == decisions_before_reconnect
        assert companion.reject_proposal()
        assert len(companion._pending_proposal_decisions) == 1
        decision_deadline = time.monotonic() + 2.0
        while (
            time.monotonic() < decision_deadline
            and companion._pending_proposal_decisions
        ):
            companion.pump()
            time.sleep(0.01)
        assert companion._pending_proposal_decisions == {}
        assert proposal_decisions[-1]["proposalId"] == reconnect_proposal["proposalId"]
        assert proposal_decisions[-1]["decision"] == "rejected"

        # A drip-fed body cannot hold Disconnect/unregister or leave a
        # process-blocking worker behind.
        slow_guide[0] = True
        slow_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            known_plan_content_sha256=dynamic_plan_content_sha256,
            timeout=5.0,
        )
        companion._transport = slow_transport
        slow_transport.start()
        assert slow_guide_started.wait(timeout=2.0)
        stop_started = time.monotonic()
        companion.disconnect(flush_timeout=0.0, wait_timeout=0.0)
        assert time.monotonic() - stop_started < 0.25
        if slow_transport.running:
            assert companion.status == "Disconnecting"
            assert slow_transport in companion._stopping_transports
        assert slow_transport.wait_stopped(2.0)
        companion.pump()
        assert not slow_transport.running
        assert companion.status == "Offline"
        assert companion._stopping_transports == []
        slow_guide[0] = False

        # First malformed deliveries must report once, while idempotent known
        # deliveries do not create false plan_loaded transitions. Recovery
        # clears stale connection-error UI state on the main thread.
        probe_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            known_plan_content_sha256=dynamic_plan_content_sha256,
        )
        companion._transport = probe_transport
        before_malformed = companion.last_report["sequence"]
        probe_transport.incoming.put(
            {"kind": "plan", "plan": {"protocolVersion": "1.0.0"}}
        )
        companion.pump()
        assert companion.last_report["sequence"] == before_malformed + 1
        assert companion.last_report["transition"] == "error"
        malformed_sequence = companion.last_report["sequence"]
        probe_transport.incoming.put(
            {"kind": "plan", "plan": {"protocolVersion": "1.0.0"}}
        )
        companion.pump()
        assert companion.last_report["sequence"] == malformed_sequence

        invalid_proposal_id = str(uuid.uuid4())
        decisions_before_quarantine = len(proposal_decisions)
        probe_transport.incoming.put(
            {
                "kind": "proposal",
                "proposal": {
                    "protocolVersion": "1.1.0",
                    "proposalId": invalid_proposal_id,
                    "targetAdapterId": "not-blender",
                    "plan": deepcopy(dynamic_plan),
                    "planDiff": None,
                    "proposedAt": "2026-08-09T12:00:00Z",
                },
                "proposalPlanContentSha256": dynamic_plan_content_sha256,
            }
        )
        companion.pump()
        assert len(proposal_decisions) == decisions_before_quarantine
        assert probe_transport.control.get_nowait() == {
            "kind": "proposal_seen",
            "proposalId": invalid_proposal_id,
        }
        assert companion.status == "Plan proposal quarantined"
        quarantine_sequence = companion.last_report["sequence"]

        known_plan = deepcopy(dynamic_plan)
        companion.install_plan(known_plan)
        assert companion.last_report["sequence"] == quarantine_sequence
        probe_transport.incoming.put({"kind": "error", "message": "temporary outage"})
        companion.pump()
        assert companion.status == "Connection error"
        probe_transport.incoming.put({"kind": "recovered"})
        companion.pump()
        assert companion.error == ""
        assert companion.status == f"Plan live-snowman r{DYNAMIC_REVISION}"
        companion._transport = None
    finally:
        companion.disconnect()
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2.0)

    # Accepted branch heads stay immutable and installable. Fork starts a new
    # thread, merge continues the active target, and switching replaces only
    # the idle Session while leaving Blender scene objects untouched.
    session_before_branch_test = operating_line.get_session()
    branch_target_plan = deepcopy(BUNDLED_PLAN)
    branch_target_plan["id"] = "revision-branch-regression"
    branch_target_plan["revision"] = PLAN_REVISION + 40
    branch_source_plan = deepcopy(branch_target_plan)
    branch_source_plan["revision"] += 1
    branch_source_plan["steps"][-1]["title"] = "Source branch head"
    branch_target_session = CompanionController._validated_session(branch_target_plan)
    replace_operating_line_session(branch_target_session)
    branch_controller = CompanionController()
    target_thread_id = str(uuid.uuid4())
    target_head_request_id = str(uuid.uuid4())
    source_thread_id = str(uuid.uuid4())
    source_head_request_id = source_thread_id
    branch_controller._active_revision_lineage = RevisionLineage(
        target_thread_id,
        2,
        target_head_request_id,
    )
    branch_controller.set_revision_branches(
        {
            "protocolVersion": "1.5.0",
            "targetAdapterId": "blender",
            "instanceId": branch_controller.instance_id,
            "planId": branch_target_plan["id"],
            "branches": [
                {
                    "threadId": target_thread_id,
                    "headRequestId": target_head_request_id,
                    "headTurn": 2,
                    "status": "accepted",
                    "operation": {"kind": "revise"},
                    "plan": branch_target_plan,
                    "planContentSha256": canonical_plan_content_sha256(
                        branch_target_plan
                    ),
                    "occurredAt": "2026-08-12T12:00:00Z",
                },
                {
                    "threadId": source_thread_id,
                    "headRequestId": source_head_request_id,
                    "headTurn": 1,
                    "status": "accepted",
                    "operation": {
                        "kind": "fork",
                        "sourceThreadId": target_thread_id,
                        "sourceRequestId": target_head_request_id,
                    },
                    "plan": branch_source_plan,
                    "planContentSha256": canonical_plan_content_sha256(
                        branch_source_plan
                    ),
                    "occurredAt": "2026-08-12T12:01:00Z",
                },
            ],
        }
    )

    class BranchTransport:
        running = True

        def __init__(self):
            self.incoming = Queue()
            self.revision_requests = []
            self.accepted_plans = []
            self.followed_threads = []
            self.reports = []

        def submit_revision_request(self, request):
            self.revision_requests.append(request)

        def accept_plan(self, plan_id, revision, plan_content_sha256):
            self.accepted_plans.append((plan_id, revision, plan_content_sha256))

        def follow_revision_thread(self, thread_id):
            self.followed_threads.append(thread_id)

        def send_report(self, report):
            self.reports.append(report)

    branch_transport = BranchTransport()
    branch_controller._transport = branch_transport
    branch_scene = {item.as_pointer() for item in bpy.data.objects}
    branch_controller.begin_revision_fork()
    branch_controller.add_revision_reference("active", "snowman.model.head")
    fork_request = branch_controller.submit_revision_request("Make a forked head edit")
    assert fork_request["protocolVersion"] == "1.5.0"
    assert fork_request["revisionThread"] == {
        "threadId": fork_request["requestId"],
        "turn": 1,
        "parentRequestId": None,
    }
    assert fork_request["revisionOperation"] == {
        "kind": "fork",
        "sourceThreadId": target_thread_id,
        "sourceRequestId": target_head_request_id,
    }
    assert fork_request["basePlan"] == branch_target_plan

    branch_controller.begin_revision_merge(source_thread_id)
    merge_request = branch_controller.submit_revision_request(
        bpy.context.window_manager.operating_line_revision_message
    )
    assert merge_request["revisionThread"] == {
        "threadId": target_thread_id,
        "turn": 3,
        "parentRequestId": target_head_request_id,
    }
    assert merge_request["revisionOperation"] == {
        "kind": "merge",
        "sourceThreadId": source_thread_id,
        "sourceRequestId": source_head_request_id,
    }
    assert merge_request["references"] == [
        {"nodeId": branch_target_plan["rootStepId"], "nodeNumber": "1"}
    ]
    assert "parameterEdits" not in merge_request
    assert branch_transport.revision_requests == [fork_request, merge_request]
    assert {item.as_pointer() for item in bpy.data.objects} == branch_scene

    branch_controller.switch_revision_branch(source_thread_id)
    active_source = operating_line.get_session()
    assert active_source.source_plan_copy() == branch_source_plan
    assert branch_controller.active_revision_lineage == RevisionLineage(
        source_thread_id,
        1,
        source_head_request_id,
    )
    assert branch_transport.accepted_plans[-1][:2] == (
        branch_source_plan["id"],
        branch_source_plan["revision"],
    )
    assert branch_transport.followed_threads[-1] == source_thread_id
    assert {item.as_pointer() for item in bpy.data.objects} == branch_scene
    branch_transport.incoming.put(
        {
            "kind": "revision_branch_list_unavailable",
            "message": "temporary branch endpoint outage",
        }
    )
    branch_controller.pump()
    assert branch_controller.revision_branches == ()
    assert branch_controller.revision_branches_error == (
        "temporary branch endpoint outage"
    )
    branch_controller._transport = None
    replace_operating_line_session(session_before_branch_test)

    installed_session = operating_line.get_session()
    invalid_plan = deepcopy(dynamic_plan)
    invalid_plan["revision"] = DYNAMIC_REVISION + 1
    invalid_plan["steps"][2]["action"]["name"] = "unsafe.execute_python"
    try:
        companion.install_plan(invalid_plan)
    except ValueError as error:
        assert "Unsupported Blender action" in str(error)
    else:
        raise AssertionError("Unsupported live action should be rejected")
    assert operating_line.get_session() is installed_session

    invalid_cases = (
        (
            "preview resolution budget",
            "blender.render.execute_preview",
            lambda arguments: arguments.update({"resolutionX": 1025}),
            "arguments.resolutionX must be an integer in [1, 1024]",
        ),
        (
            "non-portable logical ID",
            "blender.mesh.create_uv_sphere",
            lambda arguments: arguments.update({"resourceId": "snowman body"}),
            "must be a portable logical resource ID",
        ),
        (
            "derived mesh logical ID collision",
            "blender.mesh.create_cone",
            lambda arguments: arguments.update(
                {"resourceId": "snowman.body.lower.mesh"}
            ),
            "Duplicate planned logical resource ID",
        ),
        (
            "cross-step logical ID collision",
            "blender.mesh.create_uv_sphere",
            lambda arguments: arguments.update({"resourceId": "snowman.ground"}),
            "Duplicate planned logical resource ID",
        ),
        (
            "material target logical ID collision",
            "blender.material.create_and_assign",
            lambda arguments: arguments.update(
                {"materialId": arguments["targets"][0]}
            ),
            "Material logical ID cannot also be an assignment target",
        ),
        (
            "derived rig data logical ID collision",
            "blender.render_rig.create",
            lambda arguments: arguments["lights"][1].update(
                {"resourceId": f'{arguments["lights"][0]["resourceId"]}.data'}
            ),
            "Created logical resource IDs must be unique",
        ),
        (
            "cyclic armature parents",
            "blender.rig.create_armature",
            lambda arguments: arguments["bones"][0].update(
                {"parentName": arguments["bones"][1]["boneName"]}
            ),
            "Armature bone parents must be acyclic",
        ),
        (
            "duplicate armature binding target",
            "blender.rig.create_armature",
            lambda arguments: arguments["bindings"][1].update(
                {"targetId": arguments["bindings"][0]["targetId"]}
            ),
            "Armature binding targetId values must be unique",
        ),
        (
            "non-increasing animation frames",
            "blender.animation.create_pose_keyframes",
            lambda arguments: arguments["keyframes"][1].update(
                {"frame": arguments["keyframes"][0]["frame"]}
            ),
            "arguments.keyframes frames must be strictly increasing",
        ),
        (
            "render frame budget",
            "blender.render.execute_preview",
            lambda arguments: arguments.update({"frame": 100_001}),
            "arguments.frame must be an integer in [1, 100000]",
        ),
        (
            "render artifact logical ID collision",
            "blender.render.execute_preview",
            lambda arguments: arguments.update({"renderId": "snowman.render.scene"}),
            "Duplicate planned logical resource ID",
        ),
    )
    for label, action_name, mutate, expected_message in invalid_cases:
        invalid_case = deepcopy(FULL_PLAN)
        invalid_case["id"] = f"invalid-{label.replace(' ', '-')}"
        target = next(
            item
            for item in invalid_case["steps"]
            if (item.get("action") or {}).get("name") == action_name
        )
        mutate(target["action"]["arguments"])
        try:
            companion.install_plan(invalid_case)
        except ValueError as error:
            assert expected_message in str(error)
        else:
            raise AssertionError(f"Plan should reject {label}")
        assert operating_line.get_session() is installed_session

    duplicate_artifact_plan = deepcopy(FULL_PLAN)
    duplicate_artifact_plan["id"] = "invalid-duplicate-render-artifact"
    render_step = next(
        item
        for item in duplicate_artifact_plan["steps"]
        if (item.get("action") or {}).get("name")
        == "blender.render.execute_preview"
    )
    duplicate_render_step = deepcopy(render_step)
    duplicate_render_step["id"] = "snowman.render.preview.copy"
    duplicate_render_step["order"] = render_step["order"] + 1
    duplicate_render_step["dependsOn"] = [render_step["id"]]
    duplicate_artifact_plan["steps"].append(duplicate_render_step)
    try:
        companion.install_plan(duplicate_artifact_plan)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Plan should reject duplicate render artifact IDs")
    assert operating_line.get_session() is installed_session

    # Restore the bundled fallback for the remainder of the offline test.
    companion.install_plan(deepcopy(BUNDLED_PLAN))
    assert operating_line.get_session().plan_id == BUNDLED_PLAN["id"]

    class IdentityGuardTransport:
        def __init__(self):
            self.incoming = Queue()
            self.running = False
            self.accepted_plans = []
            self.proposal_decisions = []
            self.reports = []

        def accept_plan(self, plan_id, revision, plan_content_sha256):
            self.accepted_plans.append((plan_id, revision, plan_content_sha256))

        def decide_proposal(self, proposal_id, decision):
            self.proposal_decisions.append((proposal_id, decision))

        def send_report(self, report):
            self.reports.append(report)

    identity_controller = CompanionController()
    identity_transport = IdentityGuardTransport()
    identity_controller._transport = identity_transport
    identity_collision = deepcopy(BUNDLED_PLAN)
    identity_collision["title"] = "Same identity, different immutable content"
    try:
        identity_controller.install_plan(identity_collision)
    except ValueError as error:
        assert "id/revision was reused" in str(error)
    else:
        raise AssertionError("A plan identity must not be reusable for new content")
    assert identity_transport.accepted_plans == []
    assert operating_line.get_session().plan_content_sha256 == (
        canonical_plan_content_sha256(BUNDLED_PLAN)
    )
    identity_transport.incoming.put(
        {
            "kind": "plan",
            "plan": identity_collision,
            "planContentSha256": canonical_plan_content_sha256(
                identity_collision
            ),
        }
    )
    identity_controller.pump()
    assert identity_transport.accepted_plans == []
    assert operating_line.get_session().plan_content_sha256 == (
        canonical_plan_content_sha256(BUNDLED_PLAN)
    )
    assert identity_controller.last_report["transition"] == "error"
    assert "id/revision was reused" in identity_controller.last_report["error"]

    # Older deliveries keep their established stale-ack behavior.
    identity_controller._transport = None
    future_identity_plan = deepcopy(BUNDLED_PLAN)
    future_identity_plan["id"] = "immutable-identity-regression"
    future_identity_plan["revision"] = PLAN_REVISION + 3
    assert identity_controller.install_plan(future_identity_plan)
    older_identity_plan = deepcopy(future_identity_plan)
    older_identity_plan["revision"] -= 1
    older_identity_plan["title"] = "Stale content remains stale"
    assert identity_controller.install_plan(older_identity_plan)
    assert operating_line.get_session().revision == future_identity_plan["revision"]
    assert identity_controller.install_plan(deepcopy(BUNDLED_PLAN))

    collision_proposal = {
        "protocolVersion": "1.1.0",
        "proposalId": str(uuid.uuid4()),
        "targetAdapterId": "blender",
        "targetInstanceId": identity_controller.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "plan": identity_collision,
        "planDiff": None,
        "proposedAt": "2026-08-04T11:59:00Z",
    }
    identity_controller._transport = identity_transport
    assert identity_controller.stage_proposal(collision_proposal)
    accepted_session = operating_line.get_session()
    try:
        identity_controller.accept_proposal()
    except ValueError as error:
        assert "id/revision was reused" in str(error)
    else:
        raise AssertionError("Proposal acceptance must enforce immutable plan identity")
    assert identity_transport.accepted_plans == []
    assert identity_transport.proposal_decisions == []
    assert identity_controller.proposed_plan is collision_proposal
    assert operating_line.get_session() is accepted_session

    # AI-authored proposals are fully validated and previewed without replacing
    # the accepted session or mutating the scene. Start/Next remain gated until
    # the in-host user accepts or rejects the proposal.
    accepted_before_review = operating_line.get_session()
    objects_before_review = {
        item.as_pointer() for item in bpy.data.objects
    }
    reviewed_plan = deepcopy(BUNDLED_PLAN)
    reviewed_plan["id"] = "reviewed-proposal-plan"
    reviewed_plan["revision"] = PLAN_REVISION + 10
    reviewed_plan["title"] = "Reviewed snowman proposal"
    reviewed_proposal = {
        "protocolVersion": "1.1.0",
        "proposalId": str(uuid.uuid4()),
        "targetAdapterId": "blender",
        "targetInstanceId": companion.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "plan": reviewed_plan,
        "planDiff": None,
        "proposedAt": "2026-08-04T12:00:00Z",
    }
    for invalid_proposal, expected_error in (
        (
            {**reviewed_proposal, "targetInstanceId": str(uuid.uuid4())},
            "different Blender instance",
        ),
        (
            {**reviewed_proposal, "catalogVersion": "2.0.0"},
            "Unsupported proposal catalog version",
        ),
    ):
        try:
            companion.stage_proposal(invalid_proposal)
        except ValueError as error:
            assert expected_error in str(error)
        else:
            raise AssertionError("Invalid request-linked proposal should be rejected")
        assert companion.proposed_plan is None
        assert operating_line.get_session() is accepted_before_review
    assert companion.stage_proposal(reviewed_proposal) is True
    assert operating_line.get_session() is accepted_before_review
    assert companion.proposal_session is not None
    assert companion.proposal_session.plan_id == "reviewed-proposal-plan"

    # A draft cannot silently jump from the active plan to a proposal. The
    # failed cross-base reference preserves both the structured selection and
    # the independently authored request body.
    bpy.context.window_manager.operating_line_revision_message = (
        "Keep this active-plan draft intact"
    )
    assert bpy.ops.operating_line.reference_node(
        scope="active",
        node_id="snowman.model.body_upper",
    ) == {"FINISHED"}
    try:
        bpy.ops.operating_line.reference_node(
            scope="proposal",
            node_id="snowman.model.head",
        )
    except RuntimeError as error:
        assert "Clear the draft before switching bases" in str(error)
    else:
        raise AssertionError("A cross-base reference must fail visibly")
    assert companion.revision_reference_scope == "active"
    assert tuple(
        node.id for node in companion.revision_reference_nodes()
    ) == ("snowman.model.body_upper",)
    assert bpy.context.window_manager.operating_line_revision_message == (
        "Keep this active-plan draft intact"
    )
    assert "clear the draft" in companion.revision_request_status.lower()
    assert accepted_before_review.plan_id in companion.revision_request_status
    assert reviewed_proposal["plan"]["id"] in companion.revision_request_status
    assert operating_line.get_session() is accepted_before_review
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review
    assert bpy.ops.operating_line.clear_revision_request() == {"FINISHED"}

    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    assert companion.revision_reference_scope == "proposal"
    assert tuple(
        node.id for node in companion.revision_reference_nodes()
    ) == ("snowman.model.head",)
    bpy.context.window_manager.operating_line_revision_message = (
        "Replace this proposal-bound draft safely"
    )
    replacement_proposal = deepcopy(reviewed_proposal)
    replacement_proposal["proposalId"] = str(uuid.uuid4())
    replacement_proposal["plan"]["revision"] += 1
    replacement_proposal["plan"]["title"] = "Replacement reviewed proposal"
    assert companion.stage_proposal(replacement_proposal) is True
    assert companion.revision_reference_nodes() == ()
    assert companion.revision_base_session is None
    assert bpy.context.window_manager.operating_line_revision_message == ""
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review
    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    bpy.context.window_manager.operating_line_revision_message = (
        "Discard this proposal-bound draft on reject"
    )
    assert bpy.ops.operating_line.start() == {"CANCELLED"}
    assert bpy.ops.operating_line.next() == {"CANCELLED"}
    assert operating_line.get_session() is accepted_before_review
    assert bpy.ops.operating_line.reject_proposal() == {"FINISHED"}
    assert companion.proposed_plan is reviewed_proposal
    assert bpy.ops.operating_line.reject_proposal() == {"FINISHED"}
    assert companion.proposed_plan is None and companion.proposal_session is None
    assert companion.revision_reference_nodes() == ()
    assert companion.revision_base_session is None
    assert bpy.context.window_manager.operating_line_revision_message == ""
    assert operating_line.get_session() is accepted_before_review
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review

    assert companion.stage_proposal(reviewed_proposal) is True
    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    bpy.context.window_manager.operating_line_revision_message = "Refine after accept"
    assert companion.accept_proposal() is True
    reviewed_session = operating_line.get_session()
    assert reviewed_session is not accepted_before_review
    assert reviewed_session.plan_id == "reviewed-proposal-plan"
    assert companion.revision_reference_scope == "active"
    assert companion.revision_base_session is reviewed_session
    assert bpy.context.window_manager.operating_line_revision_message.endswith(
        "Refine after accept"
    )
    assert bpy.ops.operating_line.clear_revision_request() == {"FINISHED"}
    assert bpy.context.window_manager.operating_line_revision_message == ""
    assert not reviewed_session.started and not reviewed_session.receipts
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review

    # Receipt ownership blocks acceptance but keeps Back available. Once Back
    # reaches the start, acceptance replaces the idle session without executing.
    reviewed_session.start()
    reviewed_session.next()
    lower = bpy.data.objects[EXPECTED[0]]
    lower_pointer = lower.as_pointer()
    blocked_plan = deepcopy(BUNDLED_PLAN)
    blocked_plan["id"] = "blocked-proposal-plan"
    blocked_plan["revision"] = PLAN_REVISION + 11
    blocked_proposal = {
        **reviewed_proposal,
        "proposalId": str(uuid.uuid4()),
        "plan": blocked_plan,
        "proposedAt": "2026-08-04T12:01:00Z",
    }
    assert companion.stage_proposal(blocked_proposal) is True
    assert companion.accept_proposal() is False
    assert companion.status == "Plan proposal blocked"
    assert operating_line.get_session() is reviewed_session
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(EXPECTED[0]) is None
    assert companion.accept_proposal() is True
    assert operating_line.get_session().plan_id == "blocked-proposal-plan"
    assert not operating_line.get_session().receipts

    companion.install_plan(deepcopy(BUNDLED_PLAN))
    assert operating_line.get_session().plan_id == BUNDLED_PLAN["id"]

    # A newer revision is cached without scene mutation while receipts exist,
    # reported once, then installed automatically after Back reaches the start.
    pending_session = operating_line.get_session()
    pending_session.start()
    pending_session.next()
    lower = bpy.data.objects[EXPECTED[0]]
    lower_pointer = lower.as_pointer()
    newer_plan = deepcopy(BUNDLED_PLAN)
    newer_plan["revision"] = PLAN_REVISION + 1
    assert companion.install_plan(newer_plan) is False
    assert companion.last_report["transition"] == "error"
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    conflicting_pending_plan = deepcopy(newer_plan)
    conflicting_pending_plan["title"] = "Same pending identity, different content"
    original_pending_hash = companion.pending_plan_content_sha256
    try:
        companion.install_plan(conflicting_pending_plan)
    except ValueError as error:
        assert "Pending plan id/revision was reused" in str(error)
    else:
        raise AssertionError("Pending plan identity must be immutable")
    assert companion.pending_plan is newer_plan
    assert companion.pending_plan_content_sha256 == original_pending_hash
    pending_identity_transport = IdentityGuardTransport()
    companion._transport = pending_identity_transport
    pending_identity_transport.incoming.put(
        {
            "kind": "plan",
            "plan": conflicting_pending_plan,
            "planContentSha256": canonical_plan_content_sha256(
                conflicting_pending_plan
            ),
        }
    )
    companion.pump()
    assert pending_identity_transport.accepted_plans == []
    assert companion.pending_plan is newer_plan
    assert companion.pending_plan_content_sha256 == original_pending_hash
    assert companion.last_report["transition"] == "error"
    assert "Pending plan id/revision was reused" in companion.last_report["error"]
    pending_collision_sequence = companion.last_report["sequence"]
    companion._transport = None
    assert companion.install_plan(newer_plan) is False
    assert companion.last_report["sequence"] == pending_collision_sequence
    alternate_plan = deepcopy(BUNDLED_PLAN)
    alternate_plan["id"] = "alternate-live-plan"
    alternate_plan["revision"] = PLAN_REVISION
    alternate_plan_content_sha256 = canonical_plan_content_sha256(alternate_plan)
    assert companion.install_plan(
        alternate_plan,
        plan_content_sha256=alternate_plan_content_sha256,
    ) is False
    assert companion.pending_plan["id"] == "alternate-live-plan"
    assert companion.pending_plan_content_sha256 == alternate_plan_content_sha256
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    pending_session.back()
    companion.pump()
    assert bpy.data.objects.get(EXPECTED[0]) is None
    assert companion.pending_plan is None
    assert operating_line.get_session().plan_id == "alternate-live-plan"
    assert operating_line.get_session().revision == PLAN_REVISION
    assert operating_line.get_session().plan_content_sha256 == (
        alternate_plan_content_sha256
    )
    assert companion.last_report["transition"] == "plan_loaded"

    # Disconnect is an explicit boundary: a queued remote plan must not install
    # later after the user rolls the local walkthrough back.
    cancellation_session = operating_line.get_session()
    cancellation_session.start()
    cancellation_session.next()
    cancelled_plan = deepcopy(BUNDLED_PLAN)
    cancelled_plan["id"] = "cancelled-live-plan"
    assert companion.install_plan(cancelled_plan) is False
    companion.disconnect()
    assert companion.pending_plan is None
    cancellation_session.back()
    companion.pump()
    assert operating_line.get_session().plan_id == "alternate-live-plan"

    # In protocol 0.1 observations are telemetry, not success gates. Preserve
    # the action result and report an unsatisfied expectation without claiming
    # that the expectation itself was verified.
    telemetry_plan = deepcopy(BUNDLED_PLAN)
    telemetry_plan["protocolVersion"] = "1.1.0"
    telemetry_plan["id"] = "observation-telemetry-plan"
    for item in telemetry_plan["steps"]:
        item.pop("observationPolicy", None)
    telemetry_step_data = next(
        item for item in telemetry_plan["steps"] if item["action"] is not None
    )
    telemetry_step_data["expectedObservations"] = [
        {
            "kind": "object_exists",
            "parameters": {"name": "OperatingLine.IntentionallyMissing"},
        }
    ]
    assert companion.install_plan(telemetry_plan) is True
    telemetry_session = operating_line.get_session()
    telemetry_session.start()
    telemetry_step = telemetry_session.next()
    telemetry_report = companion.report("step_succeeded", step=telemetry_step)
    assert telemetry_report["transition"] == "step_succeeded"
    assert telemetry_report["observations"] == [
        {
            "kind": "object_exists",
            "satisfied": False,
            "details": {
                "parameters": {"name": "OperatingLine.IntentionallyMissing"},
                "objectName": "OperatingLine.IntentionallyMissing",
                "supported": True,
            },
        }
    ]
    telemetry_session.back()

    gate_ready = {"value": False}
    original_gate_evaluator = observation_module.OBSERVATION_EVALUATORS.get(
        "test_gate_ready"
    )
    original_one_shot_evaluator = observation_module.OBSERVATION_EVALUATORS.get(
        "test_gate_one_shot"
    )
    observation_module.OBSERVATION_EVALUATORS["test_gate_ready"] = (
        lambda _parameters, _receipts: (
            gate_ready["value"],
            {"ready": gate_ready["value"]},
        )
    )
    one_shot_calls = {"count": 0}

    def one_shot_gate(_parameters, _receipts):
        one_shot_calls["count"] += 1
        return one_shot_calls["count"] == 1, {
            "evaluationCount": one_shot_calls["count"]
        }

    observation_module.OBSERVATION_EVALUATORS["test_gate_one_shot"] = (
        one_shot_gate
    )
    try:
        rollback_gate_plan = deepcopy(BUNDLED_PLAN)
        rollback_gate_plan["protocolVersion"] = "1.2.0"
        rollback_gate_plan["id"] = "observation-rollback-gate-plan"
        rollback_gate_step_data = next(
            item for item in rollback_gate_plan["steps"] if item["action"] is not None
        )
        rollback_gate_step_data["expectedObservations"] = [
            {"kind": "test_gate_ready", "parameters": {}}
        ]
        rollback_gate_step_data["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        assert companion.install_plan(rollback_gate_plan) is True
        rollback_gate_session = operating_line.get_session()
        rollback_gate_session.start()
        assert bpy.ops.operating_line.next() == {"CANCELLED"}
        assert rollback_gate_session.active_index == -1
        assert rollback_gate_session.receipts == {}
        assert bpy.data.objects.get(EXPECTED[0]) is None
        assert companion.last_report["transition"] == "step_observation_failed"
        assert companion.last_report["phase"] == "running"
        assert companion.last_report["completedStepIds"] == []
        assert companion.last_report["observationGate"] == {
            "stepId": rollback_gate_step_data["id"],
            "status": "failed_rolled_back",
            "failureStrategy": "rollback_step",
            "message": (
                "Observation gate failed for snowman.model.body_lower: "
                "test_gate_ready; the step was rolled back"
            ),
        }

        one_shot_plan = deepcopy(rollback_gate_plan)
        one_shot_plan["id"] = "observation-one-shot-gate-plan"
        one_shot_step_data = next(
            item for item in one_shot_plan["steps"] if item["action"] is not None
        )
        one_shot_step_data["expectedObservations"] = [
            {"kind": "test_gate_one_shot", "parameters": {}}
        ]
        assert companion.install_plan(one_shot_plan) is True
        one_shot_session = operating_line.get_session()
        one_shot_session.start()
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert one_shot_calls["count"] == 1
        assert companion.last_report["transition"] == "step_succeeded"
        assert companion.last_report["observations"] == [
            {
                "kind": "test_gate_one_shot",
                "satisfied": True,
                "details": {
                    "parameters": {},
                    "evaluationCount": 1,
                    "supported": True,
                },
            }
        ]
        one_shot_session.back()

        retain_gate_plan = deepcopy(rollback_gate_plan)
        retain_gate_plan["id"] = "observation-retain-gate-plan"
        retain_gate_step_data = next(
            item for item in retain_gate_plan["steps"] if item["action"] is not None
        )
        retain_gate_step_data["observationPolicy"]["failureStrategy"] = (
            "retain_for_repair"
        )
        assert companion.install_plan(retain_gate_plan) is True
        retain_gate_session = operating_line.get_session()
        retain_gate_session.start()
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        retained_pointer = bpy.data.objects[EXPECTED[0]].as_pointer()
        assert retain_gate_session.observation_blocked is True
        assert retain_gate_session.active_index == 0
        assert retain_gate_session.completed_step_ids == ()
        assert companion.last_report["phase"] == "blocked"
        assert companion.last_report["observationGate"]["status"] == (
            "repair_required"
        )
        assert bpy.ops.operating_line.next() == {"CANCELLED"}
        assert bpy.data.objects[EXPECTED[0]].as_pointer() == retained_pointer

        gate_ready["value"] = True
        assert bpy.ops.operating_line.recheck_observations() == {"FINISHED"}
        assert retain_gate_session.observation_blocked is False
        assert retain_gate_session.completed_step_ids == (
            retain_gate_step_data["id"],
        )
        assert companion.last_report["transition"] == "observation_recovered"
        assert companion.last_report["observationGate"]["status"] == "recovered"
        assert companion.last_report["observations"][0]["satisfied"] is True
        retain_gate_session.back()
        assert bpy.data.objects.get(EXPECTED[0]) is None

        legacy_gate_plan = deepcopy(retain_gate_plan)
        legacy_gate_plan["protocolVersion"] = "1.1.0"
        try:
            CompanionController._validated_session(legacy_gate_plan)
        except ValueError as error:
            assert "protocol 1.2+" in str(error)
        else:
            raise AssertionError("Legacy plans must not opt into observation gates")
    finally:
        if original_gate_evaluator is None:
            del observation_module.OBSERVATION_EVALUATORS["test_gate_ready"]
        else:
            observation_module.OBSERVATION_EVALUATORS["test_gate_ready"] = (
                original_gate_evaluator
            )
        if original_one_shot_evaluator is None:
            del observation_module.OBSERVATION_EVALUATORS["test_gate_one_shot"]
        else:
            observation_module.OBSERVATION_EVALUATORS["test_gate_one_shot"] = (
                original_one_shot_evaluator
            )

    original_evaluator = observation_module.OBSERVATION_EVALUATORS.get(
        "test_evaluation_error"
    )
    observation_module.OBSERVATION_EVALUATORS["test_evaluation_error"] = (
        lambda _parameters, _receipts: (_ for _ in ()).throw(ValueError("private"))
    )
    try:
        assert observation_module.evaluate_observations(
            ({"kind": "test_evaluation_error", "parameters": {}},),
            {},
        ) == [
            {
                "kind": "test_evaluation_error",
                "satisfied": False,
                "details": {
                    "parameters": {},
                    "supported": True,
                    "evaluationError": "ValueError",
                },
            }
        ]
    finally:
        if original_evaluator is None:
            del observation_module.OBSERVATION_EVALUATORS["test_evaluation_error"]
        else:
            observation_module.OBSERVATION_EVALUATORS[
                "test_evaluation_error"
            ] = original_evaluator
    assert companion.install_plan(deepcopy(BUNDLED_PLAN)) is True

    dependent = step(
        "action.a-second",
        "root",
        1,
        depends_on=["action.z-first"],
        step_action=action("test.a-second"),
    )
    independent = step(
        "action.b-independent",
        "root",
        1,
        step_action=action("test.b-independent"),
    )
    independent_tie = step(
        "action.c-independent",
        "root",
        1,
        step_action=action("test.c-independent"),
    )
    plan_root = load_temporary_plan(
        [root, dependent, independent_tie, independent, dependency_first]
    )
    assert tuple(node.id for node in executable_steps(plan_root)) == (
        "action.b-independent",
        "action.c-independent",
        "action.z-first",
        "action.a-second",
    )

    strict_root = load_temporary_plan(
        [root, step("action.strict", "root", 1, step_action=action("test.strict"))]
    )
    strict_session = DemoSession(
        strict_root,
        {
            "test.strict": (
                lambda _receipts: ActionReceipt(
                    "receipt",
                    "action.strict",
                    "test.strict",
                ),
                lambda _receipt: None,
            )
        },
    )
    strict_session.start()
    strict_execution_id = strict_session.execution_id
    assert strict_execution_id is not None
    uuid.UUID(strict_execution_id)
    try:
        strict_session.next()
    except KeyError as error:
        assert error.args == ("action.strict",)
    else:
        raise AssertionError("Session must not resolve actions by action name")
    assert strict_session.execution_id == strict_execution_id
    strict_session.reset()
    assert strict_session.execution_id is None

    assert_plan_rejected(
        [
            root,
            step("branch", "root", 1, step_action=action("test.branch")),
            step("branch.child", "branch", 1),
        ],
        "must be a hierarchy leaf",
    )
    assert_plan_rejected(
        [
            root,
            step("manual", "root", 1),
            step(
                "action",
                "root",
                2,
                depends_on=["manual"],
                step_action=action("test.action"),
            ),
        ],
        "depends on non-action step",
    )
    assert_plan_rejected(
        [
            root,
            step("manual.a", "root", 1, depends_on=["manual.b"]),
            step("manual.b", "root", 2, depends_on=["manual.a"]),
        ],
        "Dependency cycle includes",
    )
    assert_plan_rejected(
        [root, step("action", "root", 1, depends_on=["missing"])],
        "Unknown dependency missing",
    )
    assert_plan_rejected(
        [root, step("action", "root", 1, depends_on=["action"])],
        "cannot depend on itself",
    )
    assert_plan_rejected(
        [root, step("雪人", "root", 1)],
        "Invalid portable step id",
    )
    assert_plan_rejected(
        [
            root,
            step("action.first", "root", 1, step_action=action("test.first")),
            step("branch", "root", 2, depends_on=["action.first"]),
            step("branch.child", "branch", 1),
        ],
        "Non-executable group branch cannot declare execution dependencies",
    )


def assert_dialogue_proposal_round_trip() -> None:
    """Exercise proposal-first delivery through the Blender main-thread boundary."""
    base_session = operating_line.get_session()
    base_plan = base_session.source_plan_copy()
    assert base_plan is not None
    controller = CompanionController()
    provider_payload = {
        "contractVersion": "1.0.0",
        "generationAvailable": True,
        "providers": [
            {
                "contractVersion": "1.0.0",
                "id": "dialogue-planner",
                "version": "0.1.0",
                "displayName": "Dialogue Planner",
                "description": "Deterministic streamed dialogue integration provider.",
                "availability": {"available": True},
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "local",
                    "dataTransmission": "none",
                    "credentialManagement": "provider_managed",
                },
            }
        ],
    }
    controller.dialogue_handoff.set_providers(provider_payload)
    controller.select_dialogue_provider("dialogue-planner")
    controller.add_revision_reference("active", base_session.root.id)
    queued_runs = []
    decisions = []

    class DialogueTransport:
        running = True

        def __init__(self):
            self.incoming = Queue()

        def start_dialogue_run(self, request):
            queued_runs.append(request)

        def submit_proposal_decision(self, decision):
            decisions.append(decision)

        def accept_plan(self, _plan_id, _revision, _plan_content_sha256):
            pass

        def follow_revision_thread(self, _thread_id):
            pass

        def send_report(self, _report):
            pass

    transport = DialogueTransport()
    controller._transport = transport
    scene_before = {item.as_pointer() for item in bpy.data.objects}
    run_request = controller.begin_dialogue_run(
        "Make this guide clearer and prepare a revision if needed"
    )
    assert queued_runs == [run_request]
    assert run_request["authorization"]["authorizedProviderCallLimit"] == 2
    assert run_request["authorization"]["automaticReplanAcknowledged"] is True
    assert run_request["authorization"]["proposalCreationAcknowledged"] is True
    revision_request = run_request["revisionRequest"]

    proposed_plan = deepcopy(base_plan)
    proposed_plan["revision"] = base_session.revision + 1
    proposal_id = str(uuid.uuid4())
    proposal = {
        "protocolVersion": "1.4.0",
        "proposalId": proposal_id,
        "targetAdapterId": "blender",
        "targetInstanceId": controller.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "revisionRequestId": revision_request["requestId"],
        "revisionThread": revision_request["revisionThread"],
        "revisionOperation": {"kind": "revise"},
        "plan": proposed_plan,
        "planDiff": {
            "basePlan": {
                "id": base_session.plan_id,
                "revision": base_session.revision,
            },
            "targetPlan": {
                "id": proposed_plan["id"],
                "revision": proposed_plan["revision"],
            },
            "summary": {
                "planFields": 0,
                "addedSteps": 0,
                "removedSteps": 0,
                "updatedSteps": 0,
                "movedSteps": 0,
            },
            "planChanges": [],
            "stepChanges": [],
        },
        "proposedAt": "2026-08-12T12:00:03Z",
    }
    status = {
        "contractVersion": "1.0.0",
        "dialogueRequestId": run_request["dialogueRequestId"],
        "revisionRequestId": revision_request["requestId"],
        "replanGenerationRequestId": run_request["replanGenerationRequestId"],
        "targetAdapterId": "blender",
        "targetInstanceId": controller.instance_id,
        "provider": {
            "id": "dialogue-planner",
            "version": "0.1.0",
            "displayName": "Dialogue Planner",
        },
        "status": "proposal_created",
        "terminal": True,
        "sceneChanged": False,
        "assistantMessage": "I prepared a reviewable revision.",
        "assistantMessageRevision": 1,
        "semanticDecision": {
            "kind": "replan",
            "confidence": 0.91,
            "threshold": 0.8,
        },
        "revisionRequestRecorded": True,
        "proposalId": proposal_id,
        "error": None,
        "needsRevision": None,
        "updatedAt": "2026-08-12T12:00:02Z",
    }

    transport.incoming.put({"kind": "proposal", "proposal": proposal})
    transport.incoming.put({"kind": "dialogue_run_status", "run": status})
    controller.pump()
    assert controller.proposed_plan is proposal
    assert controller.dialogue_handoff.phase == "proposal_created"
    assert controller.dialogue_handoff.blocks_plan_work
    assert controller.last_revision_request_id == revision_request["requestId"]
    assert operating_line.get_session() is base_session
    assert {item.as_pointer() for item in bpy.data.objects} == scene_before

    assert controller.accept_proposal()
    assert decisions[-1]["proposalId"] == proposal_id
    assert decisions[-1]["decision"] == "accepted"
    assert controller.dialogue_handoff.phase == "idle"
    assert not controller.dialogue_handoff.blocks_plan_work
    assert controller.dialogue_handoff.history[-1] == {
        "role": "assistant",
        "message": "I prepared a reviewable revision.",
    }
    assert operating_line.get_session().revision == base_session.revision + 1
    assert {item.as_pointer() for item in bpy.data.objects} == scene_before

    controller._transport = None
    replace_operating_line_session(base_session)


def assert_dialogue_proposal_first_failure_promotes_review() -> None:
    """Reveal a cached same-request Proposal after the Dialogue terminal fails."""
    base_session = operating_line.get_session()
    base_plan = base_session.source_plan_copy()
    assert base_plan is not None
    controller = CompanionController()
    provider_payload = {
        "contractVersion": "1.0.0",
        "generationAvailable": True,
        "providers": [
            {
                "contractVersion": "1.0.0",
                "id": "dialogue-planner",
                "version": "0.1.0",
                "displayName": "Dialogue Planner",
                "description": "Deterministic dialogue race provider.",
                "availability": {"available": True},
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "local",
                    "dataTransmission": "none",
                    "credentialManagement": "provider_managed",
                },
            }
        ],
    }
    controller.dialogue_handoff.set_providers(provider_payload)
    controller.select_dialogue_provider("dialogue-planner")
    controller.add_revision_reference("active", base_session.root.id)

    class DialogueRaceTransport:
        running = True

        def __init__(self):
            self.incoming = Queue()

        def start_dialogue_run(self, _request):
            pass

        def submit_proposal_decision(self, _decision):
            pass

        def follow_revision_thread(self, _thread_id):
            pass

        def send_report(self, _report):
            pass

    transport = DialogueRaceTransport()
    controller._transport = transport
    run_request = controller.begin_dialogue_run("Prepare a bounded review revision")
    revision_request = run_request["revisionRequest"]
    proposed_plan = deepcopy(base_plan)
    proposed_plan["revision"] = base_session.revision + 1
    proposal = {
        "protocolVersion": "1.4.0",
        "proposalId": str(uuid.uuid4()),
        "targetAdapterId": "blender",
        "targetInstanceId": controller.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "revisionRequestId": revision_request["requestId"],
        "revisionThread": revision_request["revisionThread"],
        "revisionOperation": {"kind": "revise"},
        "plan": proposed_plan,
        "planDiff": {
            "basePlan": {
                "id": base_session.plan_id,
                "revision": base_session.revision,
            },
            "targetPlan": {
                "id": proposed_plan["id"],
                "revision": proposed_plan["revision"],
            },
            "summary": {
                "planFields": 0,
                "addedSteps": 0,
                "removedSteps": 0,
                "updatedSteps": 0,
                "movedSteps": 0,
            },
            "planChanges": [],
            "stepChanges": [],
        },
        "proposedAt": "2026-08-12T12:00:03Z",
    }
    failed = {
        "contractVersion": "1.0.0",
        "dialogueRequestId": run_request["dialogueRequestId"],
        "revisionRequestId": revision_request["requestId"],
        "replanGenerationRequestId": run_request["replanGenerationRequestId"],
        "targetAdapterId": "blender",
        "targetInstanceId": controller.instance_id,
        "provider": {
            "id": "dialogue-planner",
            "version": "0.1.0",
            "displayName": "Dialogue Planner",
        },
        "status": "failed",
        "terminal": True,
        "sceneChanged": False,
        "assistantMessage": "I prepared the requested bounded revision.",
        "assistantMessageRevision": 1,
        "semanticDecision": {
            "kind": "replan",
            "confidence": 0.91,
            "threshold": 0.8,
        },
        "revisionRequestRecorded": True,
        "proposalId": None,
        "error": {
            "code": "planner_generation_conflict",
            "retryMode": "new_request_id",
            "message": "An external Proposal won the review slot.",
        },
        "needsRevision": None,
        "updatedAt": "2026-08-12T12:00:04Z",
    }

    assert controller.stage_proposal(proposal)
    assert controller.proposed_plan is None
    transport.incoming.put({"kind": "dialogue_run_status", "run": failed})
    controller.pump()
    assert controller.dialogue_handoff.phase == "failed"
    assert controller.proposed_plan is proposal
    assert controller.provider_handoff.acknowledged_revision_request_id == revision_request[
        "requestId"
    ]
    controller._transport = None


def main() -> None:
    original_editor_draw = bpy.types.VIEW3D_MT_editor_menus.draw
    original_add_draw = bpy.types.VIEW3D_MT_add.draw
    original_mesh_draw = bpy.types.VIEW3D_MT_mesh_add.draw
    original_add_label = bpy.types.VIEW3D_MT_add.bl_label
    original_mesh_label = bpy.types.VIEW3D_MT_mesh_add.bl_label
    wrapped_english = _wrap_history_message(
        "@1.2.3 Make this head larger and rougher"
    )
    wrapped_chinese = _wrap_history_message("@1.2.3 把雪人的头部放大并增加粗糙感")
    assert " ".join(wrapped_english) == "@1.2.3 Make this head larger and rougher"
    assert "".join(wrapped_chinese).replace(" ", "") == (
        "@1.2.3 把雪人的头部放大并增加粗糙感".replace(" ", "")
    )
    assert all(_display_columns(line) <= 24 for line in wrapped_english)
    assert all(_display_columns(line) <= 24 for line in wrapped_chinese)

    catalog_actions = {item["name"] for item in ACTION_CATALOG["actions"]}
    implemented_catalog_actions = {
        name for name in ALLOWED_ACTIONS if name.startswith("blender.")
    }
    assert catalog_actions == implemented_catalog_actions
    assert INTERACTION_CATALOG["actionCatalogVersion"] == ACTION_CATALOG["catalogVersion"]
    assert {recipe["actionName"] for recipe in INTERACTION_CATALOG["recipes"]} == (
        catalog_actions
    )
    assert sum(
        recipe["guidance"]["kind"] == "native_path"
        for recipe in INTERACTION_CATALOG["recipes"]
    ) == 7
    assert (ADAPTER_ROOT / "LICENSE").read_text(encoding="utf-8") == (
        REPO_ROOT / "LICENSE"
    ).read_text(encoding="utf-8")
    canonical_path = (
        REPO_ROOT
        / "protocol"
        / "fixtures"
        / "v1"
        / "snowman-teaching.plan.json"
    )
    with canonical_path.open(encoding="utf-8") as canonical_resource:
        assert FULL_PLAN == json.load(canonical_resource)
    canonical_interaction_path = (
        REPO_ROOT / "adapters" / "blender" / "catalog" / "v1"
        / "interaction-catalog.json"
    )
    with canonical_interaction_path.open(encoding="utf-8") as canonical_resource:
        assert INTERACTION_CATALOG == json.load(canonical_resource)

    # The active leaf selects its own catalog recipe. Each directly supported
    # primitive resolves to its exact Add > Mesh item; batches stay semantic.
    full_steps = executable_steps(load_task_tree_data(FULL_PLAN))
    recipe_tracker = MenuGuidanceTracker()
    plane_path = recipe_tracker.snapshot(full_steps[0])
    sphere_path = recipe_tracker.snapshot(full_steps[1])
    cone_path = recipe_tracker.snapshot(full_steps[6])
    cylinder_path = recipe_tracker.snapshot(full_steps[15])
    assert plane_path is not None and plane_path.items[-1].label == "Plane"
    assert sphere_path is not None and sphere_path.items[-1].label == "UV Sphere"
    assert cone_path is not None and cone_path.items[-1].label == "Cone"
    assert cone_path.operator_id == "mesh.primitive_cone_add"
    assert cylinder_path is not None and cylinder_path.items[-1].label == "Cylinder"
    assert cylinder_path.operator_id == "mesh.primitive_cylinder_add"
    batch_recipe = next(
        recipe
        for recipe in INTERACTION_CATALOG["recipes"]
        if recipe["actionName"] == "blender.mesh.create_primitive_batch"
    )
    assert batch_recipe["guidance"]["kind"] == "semantic_path"
    assert tuple(item["label"] for item in batch_recipe["guidance"]["steps"]) == (
        "Layout",
        "Add",
        "Mesh",
        "Planned parts",
    )
    cube_recipe = next(
        recipe
        for recipe in INTERACTION_CATALOG["recipes"]
        if recipe["actionName"] == "blender.mesh.create_cube"
    )
    assert tuple(item["label"] for item in cube_recipe["guidance"]["steps"]) == (
        "Layout",
        "Add",
        "Mesh",
        "Cube",
    )
    assert cube_recipe["guidance"]["execution"]["operatorId"] == (
        "mesh.primitive_cube_add"
    )
    assert INTERACTION_CATALOG["hostVersionRange"] == (
        ">=4.5.0 <4.6.0 || >=5.1.0 <5.2.0"
    )
    icosphere_recipe = next(
        recipe
        for recipe in INTERACTION_CATALOG["recipes"]
        if recipe["actionName"] == "blender.mesh.create_icosphere"
    )
    assert tuple(
        item["label"] for item in icosphere_recipe["guidance"]["steps"]
    ) == ("Layout", "Add", "Mesh", "Ico Sphere")
    assert icosphere_recipe["guidance"]["execution"]["operatorId"] == (
        "mesh.primitive_ico_sphere_add"
    )
    torus_recipe = next(
        recipe
        for recipe in INTERACTION_CATALOG["recipes"]
        if recipe["actionName"] == "blender.mesh.create_torus"
    )
    assert tuple(item["label"] for item in torus_recipe["guidance"]["steps"]) == (
        "Layout",
        "Add",
        "Mesh",
        "Torus",
    )
    assert torus_recipe["guidance"]["execution"]["operatorId"] == (
        "mesh.primitive_torus_add"
    )
    assert_torus_argument_boundaries()
    assert_torus_action_round_trip()
    assert_torus_maximum_topology()
    assert_icosphere_argument_boundaries()
    assert_icosphere_action_round_trip()
    assert_cube_resource_id_boundaries()
    assert_cube_action_round_trip()
    assert_editing_argument_boundaries()
    assert_edit_modifier_geometry_nodes_round_trip()

    session_before_registration = operating_line.get_session()
    assert _undo_post not in bpy.app.handlers.undo_post
    assert _redo_post not in bpy.app.handlers.redo_post
    assert _load_post not in bpy.app.handlers.load_post
    operating_line.register()
    operating_line.register()
    assert bpy.app.handlers.undo_post.count(_undo_post) == 1
    assert bpy.app.handlers.redo_post.count(_redo_post) == 1
    assert bpy.app.handlers.load_post.count(_load_post) == 1
    assert NATIVE_HISTORY_MARKER_KEY not in bpy.context.scene
    assert native_menu_guidance_enabled() is False
    assert bpy.types.VIEW3D_MT_editor_menus.draw is original_editor_draw
    assert bpy.types.VIEW3D_MT_add.draw is original_add_draw
    assert bpy.types.VIEW3D_MT_mesh_add.draw is original_mesh_draw
    assert operating_line.get_session() is session_before_registration
    registered_companion = operating_line.get_companion()
    assert registered_companion.timer_registered
    assert bpy.app.timers.is_registered(registered_companion.timer_callback)
    assert hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_workspace_expanded",
    )
    assert bpy.context.window_manager.operating_line_revision_workspace_expanded is True
    assert hasattr(bpy.types.WindowManager, "operating_line_goal")
    assert hasattr(
        bpy.types.WindowManager,
        "operating_line_goal_workspace_expanded",
    )
    assert bpy.context.window_manager.operating_line_goal_workspace_expanded is True
    assert_torus_guided_menu_round_trip()
    assert_icosphere_guided_menu_round_trip()
    assert_cube_guided_menu_round_trip()
    assert registered_companion.install_plan(deepcopy(BUNDLED_PLAN)) is True
    assert_companion_and_plan_semantics()
    assert_dialogue_proposal_round_trip()
    assert_dialogue_proposal_first_failure_promotes_review()

    # Initial goal entry uses the same nonblocking transport boundary and keeps
    # the accepted session/scene untouched until the linked proposal is accepted.
    class GoalFakeTransport:
        running = True

        def __init__(self):
            self.incoming = Queue()
            self.requests = []
            self.decisions = []
            self.initial_provider_refreshes = 0
            self.initial_runs = []

        def submit_goal_request(self, request):
            self.requests.append(deepcopy(request))

        def decide_proposal(self, proposal_id, decision):
            self.decisions.append((proposal_id, decision))

        def refresh_initial_plan_providers(self):
            self.initial_provider_refreshes += 1

        def start_initial_plan_run(self, request):
            self.initial_runs.append(deepcopy(request))

    goal_transport = GoalFakeTransport()
    registered_companion._transport = goal_transport
    accepted_before_goal = operating_line.get_session()
    active_index_before_goal = accepted_before_goal.active_index
    receipts_before_goal = tuple(accepted_before_goal.receipts)
    scene_objects_before_goal = tuple(bpy.context.scene.objects)
    bpy.context.window_manager.operating_line_goal = "  Build a reviewed robot guide  "
    assert bpy.ops.operating_line.submit_goal_request() == {"FINISHED"}
    assert bpy.context.window_manager.operating_line_goal == ""
    assert len(goal_transport.requests) == 1
    goal_request = goal_transport.requests[0]
    assert goal_request["goal"] == "Build a reviewed robot guide"
    assert goal_request["adapterId"] == ACTION_CATALOG["adapterId"] == "blender"
    assert goal_request["catalogVersion"] == ACTION_CATALOG["catalogVersion"]
    assert registered_companion.goal_request.phase == "local"
    bpy.context.window_manager.operating_line_goal = "A second active goal"
    try:
        registered_companion.submit_goal_request(
            bpy.context.window_manager.operating_line_goal
        )
    except ValueError as error:
        assert "already active" in str(error)
    else:
        raise AssertionError("A parallel active goal request must be blocked")
    assert bpy.context.window_manager.operating_line_goal == "A second active goal"
    bpy.context.window_manager.operating_line_goal = ""

    goal_plan = deepcopy(BUNDLED_PLAN)
    goal_plan["id"] = goal_request["planId"]
    goal_plan["revision"] += 20
    goal_plan["protocolVersion"] = "1.2.0"
    goal_proposal = {
        "protocolVersion": "1.2.0",
        "proposalId": str(uuid.uuid4()),
        "goalRequestId": goal_request["requestId"],
        "targetAdapterId": "blender",
        "targetInstanceId": registered_companion.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "plan": goal_plan,
        "planDiff": None,
        "proposedAt": "2026-08-09T12:00:00Z",
    }
    wrong_goal_proposal = {
        **goal_proposal,
        "proposalId": str(uuid.uuid4()),
        "goalRequestId": str(uuid.uuid4()),
    }
    try:
        registered_companion.stage_proposal(wrong_goal_proposal)
    except ValueError as error:
        assert "active goal request" in str(error)
    else:
        raise AssertionError("An unrelated goal proposal must be rejected")
    conflicting_proposal = {
        **goal_proposal,
        "proposalId": str(uuid.uuid4()),
        "revisionRequestId": str(uuid.uuid4()),
    }
    try:
        registered_companion.stage_proposal(conflicting_proposal)
    except ValueError as error:
        assert "both a goal request and revision request" in str(error)
    else:
        raise AssertionError("A proposal cannot link two request kinds")

    unrelated_proposal = {
        key: value for key, value in goal_proposal.items() if key != "goalRequestId"
    }
    unrelated_proposal["proposalId"] = str(uuid.uuid4())
    assert registered_companion.stage_proposal(unrelated_proposal)
    assert registered_companion.goal_request.phase == "local"
    assert registered_companion.reject_proposal()
    assert registered_companion.goal_request.active

    assert registered_companion.stage_proposal(goal_proposal)
    assert registered_companion.goal_request.phase == "proposal_received"
    assert operating_line.get_session() is accepted_before_goal
    assert tuple(bpy.context.scene.objects) == scene_objects_before_goal
    assert accepted_before_goal.active_index == active_index_before_goal
    assert tuple(accepted_before_goal.receipts) == receipts_before_goal
    assert bpy.ops.operating_line.reject_proposal() == {"FINISHED"}
    assert registered_companion.goal_request.active is False
    assert operating_line.get_session() is accepted_before_goal
    assert tuple(bpy.context.scene.objects) == scene_objects_before_goal
    assert goal_transport.decisions == [
        (unrelated_proposal["proposalId"], "rejected"),
        (goal_proposal["proposalId"], "rejected"),
    ]

    # An optional initial provider remains a separate, explicit authorization
    # gate and binds the delivered proposal to the exact goal/run/instance.
    initial_goal = registered_companion.submit_goal_request(
        "Build a provider-authored reviewed guide"
    )
    registered_companion.goal_request.acknowledged(initial_goal["requestId"])
    registered_companion.initial_plan_handoff.goal_acknowledged(
        initial_goal["requestId"]
    )
    assert registered_companion.selected_initial_plan_provider_id is None
    registered_companion.refresh_initial_plan_providers()
    assert goal_transport.initial_provider_refreshes == 1
    registered_companion.initial_plan_handoff.set_providers(
        {
            "contractVersion": "1.0.0",
            "generationAvailable": True,
            "providers": [
                {
                    "contractVersion": "1.0.0",
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                    "description": "Local deterministic initial planner.",
                    "availability": {"available": True},
                    "limits": {"maxConcurrency": 1},
                    "dataHandling": {
                        "executionLocation": "local",
                        "dataTransmission": "none",
                        "credentialManagement": "provider_managed",
                    },
                }
            ],
        }
    )
    assert registered_companion.selected_initial_plan_provider_id is None
    try:
        bpy.ops.operating_line.run_initial_plan_provider()
    except RuntimeError as error:
        assert "authorization dialog" in str(error)
    else:
        raise AssertionError("Direct execute must not bypass initial provider confirmation")
    assert goal_transport.initial_runs == []
    assert registered_companion.select_initial_plan_provider(
        "available-planner"
    )["id"] == "available-planner"
    scene_before_initial_run = {item.as_pointer() for item in bpy.data.objects}
    session_before_initial_run = operating_line.get_session()
    initial_run = registered_companion.begin_initial_plan_run()
    assert goal_transport.initial_runs == [initial_run]
    assert initial_run["goalRequestId"] == initial_goal["requestId"]
    assert initial_run["targetInstanceId"] == registered_companion.instance_id
    assert operating_line.get_session() is session_before_initial_run
    assert {item.as_pointer() for item in bpy.data.objects} == scene_before_initial_run
    initial_proposal_id = str(uuid.uuid4())
    registered_companion.initial_plan_handoff.apply_status(
        {
            "contractVersion": "1.0.0",
            "generationRequestId": initial_run["generationRequestId"],
            "goalRequestId": initial_goal["requestId"],
            "targetAdapterId": "blender",
            "targetInstanceId": registered_companion.instance_id,
            "provider": {
                "id": "available-planner",
                "version": "0.1.0",
                "displayName": "Available Planner",
            },
            "status": "proposal_created",
            "terminal": True,
            "sceneChanged": False,
            "proposalId": initial_proposal_id,
            "error": None,
            "needsRevision": None,
            "updatedAt": "2026-08-09T12:00:01.000Z",
        }
    )
    initial_plan = deepcopy(BUNDLED_PLAN)
    initial_plan["id"] = initial_goal["planId"]
    initial_plan["revision"] += 21
    initial_plan["protocolVersion"] = "1.2.0"
    initial_proposal = {
        "protocolVersion": "1.2.0",
        "proposalId": initial_proposal_id,
        "goalRequestId": initial_goal["requestId"],
        "targetAdapterId": "blender",
        "targetInstanceId": registered_companion.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "plan": initial_plan,
        "planDiff": None,
        "proposedAt": "2026-08-09T12:00:02Z",
    }
    assert registered_companion.stage_proposal(initial_proposal)
    assert registered_companion.proposed_plan is initial_proposal
    assert operating_line.get_session() is session_before_initial_run
    assert {item.as_pointer() for item in bpy.data.objects} == scene_before_initial_run
    assert registered_companion.reject_proposal()
    assert registered_companion.goal_request.active is False
    assert registered_companion.initial_plan_handoff.phase == "idle"
    assert operating_line.get_session() is session_before_initial_run
    assert {item.as_pointer() for item in bpy.data.objects} == scene_before_initial_run

    # An external MCP Goal Proposal may win the unresolved Proposal slot while
    # an Initial Run is still generating. The Run then fails safely, but the
    # already-delivered external Proposal must become reviewable in either
    # delivery ordering without being relabeled as the Provider result.
    def initial_race_fixture(label):
        controller = CompanionController()
        transport = GoalFakeTransport()
        controller._transport = transport
        goal = controller.submit_goal_request(f"External proposal race {label}")
        controller.goal_request.acknowledged(goal["requestId"])
        controller.initial_plan_handoff.goal_acknowledged(goal["requestId"])
        controller.initial_plan_handoff.set_providers(
            {
                "contractVersion": "1.0.0",
                "generationAvailable": True,
                "providers": [
                    {
                        "contractVersion": "1.0.0",
                        "id": "available-planner",
                        "version": "0.1.0",
                        "displayName": "Available Planner",
                        "description": "Local deterministic initial planner.",
                        "availability": {"available": True},
                        "limits": {"maxConcurrency": 1},
                        "dataHandling": {
                            "executionLocation": "local",
                            "dataTransmission": "none",
                            "credentialManagement": "provider_managed",
                        },
                    }
                ],
            }
        )
        controller.select_initial_plan_provider("available-planner")
        run = controller.begin_initial_plan_run()
        plan = deepcopy(BUNDLED_PLAN)
        plan["id"] = goal["planId"]
        plan["revision"] += 30
        plan["protocolVersion"] = "1.2.0"
        proposal = {
            "protocolVersion": "1.2.0",
            "proposalId": str(uuid.uuid4()),
            "goalRequestId": goal["requestId"],
            "targetAdapterId": "blender",
            "targetInstanceId": controller.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "plan": plan,
            "planDiff": None,
            "proposedAt": "2026-08-09T12:00:03Z",
        }
        failed = {
            "contractVersion": "1.0.0",
            "generationRequestId": run["generationRequestId"],
            "goalRequestId": goal["requestId"],
            "targetAdapterId": "blender",
            "targetInstanceId": controller.instance_id,
            "provider": {
                "id": "available-planner",
                "version": "0.1.0",
                "displayName": "Available Planner",
            },
            "status": "failed",
            "terminal": True,
            "sceneChanged": False,
            "proposalId": None,
            "error": {
                "code": "planner_internal_failed",
                "retryMode": "new_request_id",
                "message": "Provider result lost the Proposal review slot",
            },
            "needsRevision": None,
            "updatedAt": "2026-08-09T12:00:04Z",
        }
        return controller, transport, proposal, failed

    proposal_first, proposal_first_transport, external_first, failed_after = (
        initial_race_fixture("proposal-first")
    )
    assert proposal_first.stage_proposal(external_first)
    assert proposal_first.proposed_plan is None
    proposal_first_transport.incoming.put(
        {"kind": "initial_plan_run_status", "run": failed_after}
    )
    proposal_first.pump()
    assert proposal_first.proposed_plan is external_first
    assert proposal_first.initial_plan_handoff.phase == "failed"
    assert proposal_first.goal_request.phase == "proposal_received"
    assert proposal_first.reject_proposal()

    status_first, status_first_transport, external_after, failed_first = (
        initial_race_fixture("status-first")
    )
    status_first_transport.incoming.put(
        {"kind": "initial_plan_run_status", "run": failed_first}
    )
    status_first.pump()
    assert status_first.proposed_plan is None
    assert status_first.stage_proposal(external_after)
    assert status_first.proposed_plan is external_after
    assert status_first.initial_plan_handoff.phase == "failed"
    assert status_first.goal_request.phase == "proposal_received"
    assert status_first.reject_proposal()

    registered_companion._transport = None
    assert all(
        "UNDO" in operator.bl_options
        for operator in (
            OPERATINGLINE_OT_start,
            OPERATINGLINE_OT_next,
            OPERATINGLINE_OT_recheck_observations,
            OPERATINGLINE_OT_back,
            OPERATINGLINE_OT_guided_menu_action,
        )
    )
    try:
        # An edited startup object is user content: the atomic signature must fail
        # without deleting any member of the scene.
        factory_cube = bpy.data.objects["Cube"]
        factory_cube.location.x = 0.25
        assert remove_factory_startup_objects(bpy.context.scene) is False
        assert all(
            bpy.data.objects.get(name) is not None
            for name in ("Cube", "Camera", "Light")
        )
        factory_cube.location.x = 0.0

        factory_cube.data.vertices[0].co.x = -0.75
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_cube.data.vertices[0].co.x = 1.0

        base_color = factory_cube.data.materials[0].node_tree.nodes[
            "Principled BSDF"
        ].inputs["Base Color"]
        base_color.default_value[0] = 0.25
        assert remove_factory_startup_objects(bpy.context.scene) is False
        base_color.default_value[0] = 0.8

        factory_camera = bpy.data.objects["Camera"]
        factory_camera.data.lens = 35.0
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_camera.data.lens = 50.0
        factory_camera.data.display_size = 2.0
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_camera.data.display_size = 1.0

        factory_light = bpy.data.objects["Light"]
        factory_light.data.energy = 500.0
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_light.data.energy = 1000.0

        # Any additional object makes this a user scene, even if the factory
        # trio itself is untouched.
        blocker_mesh = bpy.data.meshes.new("SceneBlocker.Mesh")
        blocker_object = bpy.data.objects.new("SceneBlocker", blocker_mesh)
        bpy.data.collections["Collection"].objects.link(blocker_object)
        assert remove_factory_startup_objects(bpy.context.scene) is False
        assert all(
            bpy.data.objects.get(name) is not None
            for name in ("Cube", "Camera", "Light", "SceneBlocker")
        )
        bpy.data.objects.remove(blocker_object, do_unlink=True)
        bpy.data.meshes.remove(blocker_mesh)

        assert overlay_enabled() is False
        session = operating_line.get_session()
        nodes = {}

        def collect(node):
            nodes[node.id] = node
            for child in node.children:
                collect(child)

        collect(session.root)
        assert nodes["snowman"].number == "1"
        assert nodes["snowman.model"].number == "1.1"
        assert nodes["snowman.model.body_lower"].number == "1.1.1"
        assert tuple(step.id for step in session.steps) == tuple(
            step["id"] for step in ACTION_STEPS
        )
        assert session.is_expanded("snowman")
        assert bpy.ops.operating_line.toggle_branch(node_id="snowman") == {"FINISHED"}
        assert not session.is_expanded("snowman")
        assert bpy.ops.operating_line.toggle_branch(node_id="snowman") == {"FINISHED"}

        # Safe default: merely starting a guide preserves Blender's factory
        # scene unless the user explicitly opts into replacement.
        result = bpy.ops.operating_line.start()
        assert result == {"FINISHED"}
        first_execution_id = session.execution_id
        assert first_execution_id is not None
        uuid.UUID(first_execution_id)
        assert operating_line.get_companion().last_report["transition"] == (
            "walkthrough_started"
        )
        assert operating_line.get_companion().last_report["executionId"] == (
            first_execution_id
        )
        assert session.started and session.active_index == -1
        assert overlay_enabled() is True
        assert bpy.context.window_manager.operating_line_overlay_enabled is True
        assert native_menu_guidance_enabled() is True
        assert bpy.types.VIEW3D_MT_editor_menus.draw is not original_editor_draw
        assert bpy.types.VIEW3D_MT_add.draw is not original_add_draw
        assert bpy.types.VIEW3D_MT_mesh_add.draw is not original_mesh_draw
        menu_snapshot = native_menu_snapshot()
        assert menu_snapshot is not None
        assert menu_snapshot.step_id == ACTION_STEPS[0]["id"]
        assert tuple(item.label for item in menu_snapshot.items) == (
            "Layout",
            "Add",
            "Mesh",
            "UV Sphere",
        )
        assert menu_snapshot.recipe_id == "blender.mesh.create_uv_sphere.native"
        assert interaction_guidance_snapshot() == menu_snapshot

        # Opening the real native menus only reveals the microstep path. The
        # exact guided final operator and the existing Next operator share the
        # canonical action and rollback receipt path.
        assert reveal_native_menu("Add")
        assert native_menu_snapshot().revealed_depth == 2
        assert reveal_native_menu("Mesh")
        assert native_menu_snapshot().revealed_depth == 3
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        assert session.active_index == -1
        assert native_menu_snapshot().revealed_depth == 1
        assert reveal_native_menu("Add")
        assert reveal_native_menu("Mesh")
        scene_before_wrong_target = {item.as_pointer() for item in bpy.data.objects}
        try:
            bpy.ops.operating_line.guided_menu_action(
                step_id=ACTION_STEPS[0]["id"],
                operator_id="mesh.primitive_ico_sphere_add",
            )
        except RuntimeError as error:
            assert "does not match the accepted next step" in str(error)
        else:
            raise AssertionError("A gray alternative must not execute the accepted leaf")
        assert session.active_index == -1
        assert {item.as_pointer() for item in bpy.data.objects} == scene_before_wrong_target

        assert bpy.ops.operating_line.guided_menu_action(
            step_id=ACTION_STEPS[0]["id"],
            operator_id="mesh.primitive_uv_sphere_add",
        ) == {"FINISHED"}
        guided_receipt = session.receipts[ACTION_STEPS[0]["id"]]
        guided_signature = (
            guided_receipt.action_name,
            tuple(item.logical_id for item in guided_receipt.created),
            tuple(item.display_name for item in guided_receipt.created),
        )
        assert session.active_index == 0
        assert bpy.data.objects.get(EXPECTED[0]) is not None
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert session.active_index == -1
        assert_absent(EXPECTED[0])
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        automatic_receipt = session.receipts[ACTION_STEPS[0]["id"]]
        assert (
            automatic_receipt.action_name,
            tuple(item.logical_id for item in automatic_receipt.created),
            tuple(item.display_name for item in automatic_receipt.created),
        ) == guided_signature
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert session.active_index == -1
        assert_absent(EXPECTED[0])

        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert overlay_enabled() is False
        assert bpy.context.window_manager.operating_line_overlay_enabled is False
        assert native_menu_guidance_enabled() is False
        assert bpy.types.VIEW3D_MT_editor_menus.draw is original_editor_draw
        assert bpy.types.VIEW3D_MT_add.draw is original_add_draw
        assert bpy.types.VIEW3D_MT_mesh_add.draw is original_mesh_draw
        assert bpy.types.VIEW3D_MT_add.bl_label == original_add_label
        assert bpy.types.VIEW3D_MT_mesh_add.bl_label == original_mesh_label
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert overlay_enabled() is True
        assert bpy.context.window_manager.operating_line_overlay_enabled is True
        assert native_menu_guidance_enabled() is True
        assert all(
            bpy.data.objects.get(name) is not None
            for name in ("Cube", "Camera", "Light")
        )

        bpy.context.scene.operating_line_replace_factory_scene = True
        result = bpy.ops.operating_line.start()
        assert result == {"FINISHED"}
        execution_id = session.execution_id
        assert execution_id is not None and execution_id != first_execution_id
        uuid.UUID(execution_id)
        for factory_name in ("Cube", "Camera", "Light"):
            assert_absent(factory_name)

        user_mesh = bpy.data.meshes.new("UserObject.Mesh")
        user_object = bpy.data.objects.new("UserObject", user_mesh)
        bpy.context.scene.collection.objects.link(user_object)
        assert bpy.data.objects.get("UserObject") is user_object

        # A conflicting user-owned name is an observable action failure. The
        # operator must preserve both the object and the walkthrough position.
        conflict_mesh = bpy.data.meshes.new(f"{EXPECTED[0]}.UserMesh")
        conflict_object = bpy.data.objects.new(EXPECTED[0], conflict_mesh)
        bpy.context.scene.collection.objects.link(conflict_object)
        try:
            bpy.ops.operating_line.next()
        except RuntimeError as error:
            assert f"Cannot replace existing object: {EXPECTED[0]}" in str(error)
        else:
            raise AssertionError("Blender should surface the operator error to Python")
        conflict_report = operating_line.get_companion().last_report
        assert conflict_report["transition"] == "error"
        assert conflict_report["phase"] == "error"
        assert conflict_report["stepId"] == ACTION_STEPS[0]["id"]
        assert conflict_report["activeStepId"] is None
        assert conflict_report["completedStepIds"] == []
        assert conflict_report["error"] == (
            f"Cannot replace existing object: {EXPECTED[0]}"
        )
        assert session.active_index == -1
        assert session.receipts == {}
        assert bpy.data.objects.get(EXPECTED[0]) is conflict_object
        bpy.data.objects.remove(conflict_object, do_unlink=True)
        bpy.data.meshes.remove(conflict_mesh)

        for index, (step_data, name) in enumerate(zip(ACTION_STEPS, EXPECTED)):
            result = bpy.ops.operating_line.next()
            assert result == {"FINISHED"}
            assert operating_line.get_companion().last_report["transition"] == (
                "step_succeeded"
            )
            obj = bpy.data.objects.get(name)
            assert obj is not None, f"{name} was not created"
            assert obj.type == "MESH"
            assert obj.get("operating_line_action_owned") is True
            assert obj.get("operating_line_action") == step_data["action"]["name"]
            rollback_token = obj.get("operating_line_rollback_token")
            assert isinstance(rollback_token, str) and rollback_token
            receipt = session.receipts[step_data["id"]]
            assert receipt.display_name == name
            assert receipt.rollback_token == rollback_token
            assert receipt.object_pointer == obj.as_pointer()
            owned_collection = obj.users_collection[0]
            if index == 0:
                assert receipt.collection_pointer == owned_collection.as_pointer()
            assert owned_collection.get("operating_line_owner") == OWNER_VALUE
            arguments = step_data["action"]["arguments"]
            assert all(
                math.isclose(actual, expected, abs_tol=1e-5)
                for actual, expected in zip(obj.location, arguments["location"])
            )
            assert math.isclose(
                max(obj.dimensions) / 2.0, arguments["radius"], abs_tol=1e-5
            )
            assert session.active_index == index
            if index == len(ACTION_STEPS) - 1:
                final_report = operating_line.get_companion().last_report
                assert final_report["phase"] == "completed"
                assert final_report["executionId"] == execution_id
                assert final_report["activeStepId"] == step_data["id"]
                assert final_report["completedStepIds"] == [
                    item["id"] for item in ACTION_STEPS
                ]
                assert final_report["observations"][0]["satisfied"] is True

        # Receiving a duplicate plan is a validated no-op and preserves scene work.
        completed_session = operating_line.get_session()
        pointers_before_update = {
            name: bpy.data.objects[name].as_pointer() for name in EXPECTED
        }
        operating_line.get_companion().install_plan(deepcopy(BUNDLED_PLAN))
        assert operating_line.get_session() is completed_session
        assert {
            name: bpy.data.objects[name].as_pointer() for name in EXPECTED
        } == pointers_before_update

        renamed_head = bpy.data.objects[EXPECTED[-1]]
        managed_collection = renamed_head.users_collection[0]
        duplicate_collection = managed_collection.copy()
        duplicate_collection.name = "UserDuplicateCollection"
        for linked_object in tuple(duplicate_collection.objects):
            duplicate_collection.objects.unlink(linked_object)
        bpy.context.scene.collection.children.link(duplicate_collection)
        assert duplicate_collection.get("operating_line_owner") == managed_collection.get(
            "operating_line_owner"
        )
        duplicate_head = renamed_head.copy()
        duplicate_head.data = renamed_head.data.copy()
        duplicate_head.name = "UserDuplicateSnowmanHead"
        renamed_head.users_collection[0].objects.link(duplicate_head)
        assert duplicate_head.get("operating_line_rollback_token") == renamed_head.get(
            "operating_line_rollback_token"
        )
        renamed_head.name = "UserRenamedSnowmanHead"
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert operating_line.get_companion().last_report["transition"] == (
            "step_rolled_back"
        )
        assert_absent(EXPECTED[-1])
        assert_absent("UserRenamedSnowmanHead")
        assert bpy.data.objects.get("UserDuplicateSnowmanHead") is duplicate_head
        assert bpy.data.collections.get("UserDuplicateCollection") is duplicate_collection
        assert bpy.data.objects.get(EXPECTED[0]) is not None
        assert bpy.data.objects.get(EXPECTED[1]) is not None
        assert bpy.data.objects.get("UserObject") is user_object
        assert session.active_index == 1

        # Forward after rollback must deterministically recreate the same object.
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert bpy.data.objects.get(EXPECTED[-1]) is not None

        # Reset rolls back later steps, then fails closed before touching the
        # lower step whose collection now contains a copied user object.
        try:
            bpy.ops.operating_line.start()
        except RuntimeError as error:
            assert "Cannot rollback collection with external contents" in str(error)
        else:
            raise AssertionError("Reset must retain an unsafe collection receipt")
        assert session.active_index == 0
        assert tuple(session.receipts) == (ACTION_STEPS[0]["id"],)
        assert bpy.data.objects.get(EXPECTED[0]) is not None
        assert_absent(EXPECTED[1])
        assert_absent(EXPECTED[2])
        assert bpy.data.objects.get("UserDuplicateSnowmanHead") is duplicate_head
        assert bpy.data.collections.get("UserDuplicateCollection") is duplicate_collection
        conflict_report = operating_line.get_companion().last_report
        assert conflict_report["transition"] == "error"
        assert conflict_report["stepId"] == ACTION_STEPS[0]["id"]

        # Moving the copied object to its copied collection resolves the
        # ownership conflict. Retrying Start completes the retained receipt.
        managed_collection.objects.unlink(duplicate_head)
        duplicate_collection.objects.link(duplicate_head)
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        assert session.active_index == -1
        assert not session.receipts
        assert bpy.data.collections.get(COLLECTION_NAME) is None
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert session.active_index == 0
    finally:
        operating_line.unregister()

    for name in EXPECTED:
        assert_absent(name)
    assert_absent("UserRenamedSnowmanLowerBody")
    duplicate_head = bpy.data.objects.get("UserDuplicateSnowmanHead")
    assert duplicate_head is not None
    duplicate_collection = bpy.data.collections.get("UserDuplicateCollection")
    assert duplicate_collection is not None
    assert bpy.data.objects.get("UserObject") is user_object
    assert bpy.data.collections.get(COLLECTION_NAME) is None
    assert duplicate_head.name in duplicate_collection.objects

    duplicate_mesh = duplicate_head.data
    bpy.data.objects.remove(duplicate_head, do_unlink=True)
    if duplicate_mesh.users == 0:
        bpy.data.meshes.remove(duplicate_mesh)
    bpy.data.collections.remove(duplicate_collection)
    assert not any(
        collection.get("operating_line_owner") == OWNER_VALUE
        for collection in bpy.data.collections
    )
    assert overlay_enabled() is False
    assert native_menu_guidance_enabled() is False
    assert bpy.types.VIEW3D_MT_editor_menus.draw is original_editor_draw
    assert bpy.types.VIEW3D_MT_add.draw is original_add_draw
    assert bpy.types.VIEW3D_MT_mesh_add.draw is original_mesh_draw
    assert bpy.types.VIEW3D_MT_add.bl_label == original_add_label
    assert bpy.types.VIEW3D_MT_mesh_add.bl_label == original_mesh_label
    assert not hasattr(bpy.types.WindowManager, "operating_line_overlay_enabled")
    assert not hasattr(bpy.types.Scene, "operating_line_replace_factory_scene")
    assert not hasattr(bpy.types.WindowManager, "operating_line_runtime_url")
    assert not hasattr(bpy.types.WindowManager, "operating_line_bearer_token")
    assert not hasattr(bpy.types.WindowManager, "operating_line_revision_message")
    assert not hasattr(bpy.types.WindowManager, "operating_line_goal")
    assert not hasattr(
        bpy.types.WindowManager,
        "operating_line_goal_workspace_expanded",
    )
    assert not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_history_expanded",
    )
    assert not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_workspace_expanded",
    )
    assert not hasattr(bpy.types, "OPERATINGLINE_OT_remove_revision_reference")
    assert not hasattr(bpy.types, "OPERATINGLINE_OT_open_add_menu")
    assert not hasattr(bpy.types, "OPERATINGLINE_OT_guided_menu_action")
    assert not hasattr(bpy.types, "OPERATINGLINE_PT_sidebar")
    assert not registered_companion.timer_registered
    assert not bpy.app.timers.is_registered(registered_companion.timer_callback)
    assert _undo_post not in bpy.app.handlers.undo_post
    assert _redo_post not in bpy.app.handlers.redo_post
    assert _load_post not in bpy.app.handlers.load_post
    assert all(
        NATIVE_HISTORY_MARKER_KEY not in scene for scene in bpy.data.scenes
    )
    print("OperatingLine Blender integration test passed")


if __name__ == "__main__":
    main()
