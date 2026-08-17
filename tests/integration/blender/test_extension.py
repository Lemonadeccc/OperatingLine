"""Headless Blender integration test for the extension lifecycle."""

import importlib.util
from copy import deepcopy
from dataclasses import replace
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

import bmesh
import bpy
from mathutils import Vector

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
from operating_line_extension.operating_line.infrastructure.companion_transport import (  # noqa: E402
    CompanionSessionSnapshot,
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
    PROTOCOL_VERSION,
    RESOURCE_PATH,
    SUPPORTED_PROTOCOL_VERSIONS,
    executable_steps,
    load_task_tree,
    load_task_tree_data,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    ALLOWED_ACTIONS,
    COLLECTION_NAME,
    OWNER_VALUE,
    ensure_receipts_intact,
    mesh_content_signature,
    tag_resource,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.editing import (  # noqa: E402
    _ensure_edit_bevel_topology_is_bounded,
    _ensure_edit_inset_topology_is_bounded,
    _ensure_edit_poke_topology_is_bounded,
    _ensure_extrude_topology_is_bounded,
    _ensure_mirror_input_is_bounded,
    _ensure_triangulate_topology_is_bounded,
    _extrude_region_geometry,
    _normalized_squared_vector_length,
    _validate_edit_bevel_source,
    _validate_edit_inset_source,
    _validate_edit_poke_source,
    validate_bevel,
    validate_edit_bevel_edges,
    validate_edit_inset_faces,
    validate_edit_poke_faces,
    validate_mirror,
    validate_extrude_region,
    validate_geometry_nodes_transform,
    validate_solidify,
    validate_subdivide,
    validate_triangulate,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.model import (  # noqa: E402
    validate_cube,
    validate_icosphere,
    validate_torus,
)


class FakeSessionView:
    negotiated_guide_protocol_version = PROTOCOL_VERSION


FAKE_SESSION_VIEW = FakeSessionView()


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
    assert any(mutation.attribute == "mesh_content" for mutation in receipt.mutations)

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


def assert_uv_sphere_ready_observation() -> None:
    object_name = "OperatingLine.ReplayUvSphere"
    resource_id = "replay.uv_sphere"
    radius = 0.75
    location = [1.25, -2.5, 3.75]
    sphere_step = step(
        "replay.uv_sphere.create",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_uv_sphere",
            "arguments": {
                "resourceId": resource_id,
                "objectName": object_name,
                "radius": radius,
                "location": location,
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), sphere_step])
    session = DemoSession(root, action_registry(root))
    parameters = {
        "resourceId": resource_id,
        "objectName": object_name,
        "radius": radius,
        "location": location,
    }

    def observe(
        candidate_parameters=parameters,
        candidate_receipts=None,
    ):
        return observation_module.evaluate_observations(
            (
                {
                    "kind": "uv_sphere_ready",
                    "parameters": candidate_parameters,
                },
            ),
            session.receipts if candidate_receipts is None else candidate_receipts,
        )[0]

    session.start()
    assert session.next() is not None
    sphere = bpy.data.objects.get(object_name)
    collection = bpy.data.collections.get(COLLECTION_NAME)
    assert sphere is not None and sphere.type == "MESH"
    assert collection is not None
    mesh = sphere.data
    successful = observe()
    assert successful["satisfied"] is True
    details = successful["details"]
    assert (details["vertexCount"], details["edgeCount"], details["faceCount"]) == (
        482,
        992,
        512,
    )
    assert len(details["meshContentSha256"]) == 64
    serialized_details = json.dumps(details, sort_keys=True)
    for forbidden_field in ('"receiptToken"', '"pointer"', '"sessionUid"'):
        assert forbidden_field not in serialized_details

    malformed_parameters = (
        {key: value for key, value in parameters.items() if key != "objectName"},
        {**parameters, "unexpected": True},
        {**parameters, "radius": True},
        {**parameters, "location": [1.25, -2.5]},
    )
    for malformed in malformed_parameters:
        assert observe(malformed)["satisfied"] is False

    sphere.name = f"{object_name}.Tampered"
    assert observe()["satisfied"] is False
    sphere.name = object_name
    sphere.location.x += 0.25
    assert observe()["satisfied"] is False
    sphere.location = location
    sphere.scale = (1.0, 1.0, 1.25)
    assert observe()["satisfied"] is False
    sphere.scale = (1.0, 1.0, 1.0)

    sphere.rotation_mode = "QUATERNION"
    sphere.rotation_quaternion = (math.cos(0.25), 0.0, 0.0, math.sin(0.25))
    assert observe()["satisfied"] is False
    sphere.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
    sphere.rotation_mode = "AXIS_ANGLE"
    sphere.rotation_axis_angle = (0.5, 0.0, 0.0, 1.0)
    assert observe()["satisfied"] is False
    sphere.rotation_axis_angle = (0.0, 0.0, 0.0, 1.0)
    sphere.rotation_mode = "XYZ"

    alternate_mesh = bpy.data.meshes.new(f"{object_name}.Alternate")
    sphere.data = alternate_mesh
    assert observe()["satisfied"] is False
    sphere.data = mesh
    bpy.data.meshes.remove(alternate_mesh)

    original_coordinate = mesh.vertices[0].co.copy()
    mesh.vertices[0].co.x += 0.125
    mesh.update()
    assert observe()["satisfied"] is False
    mesh.vertices[0].co = original_coordinate
    mesh.update()

    external_modifier = sphere.modifiers.new(f"{object_name}.External", "BEVEL")
    assert observe()["satisfied"] is False
    sphere.modifiers.remove(external_modifier)
    sphere.shape_key_add(name="Basis")
    assert observe()["satisfied"] is False
    sphere.shape_key_clear()
    external_material = bpy.data.materials.new(f"{object_name}.External")
    mesh.materials.append(external_material)
    material_observation = observe()
    assert material_observation["satisfied"] is False
    assert material_observation["details"]["materialsAbsent"] is False
    mesh.materials.clear()
    bpy.data.materials.remove(external_material)

    collection.objects.unlink(sphere)
    assert observe()["satisfied"] is False
    collection.objects.link(sphere)
    original_action_tag = sphere["operating_line_action"]
    sphere["operating_line_action"] = "blender.mesh.create_cube"
    assert observe()["satisfied"] is False
    sphere["operating_line_action"] = original_action_tag

    receipt = session.receipts["replay.uv_sphere.create"]
    mismatched_receipts = {
        **session.receipts,
        "replay.uv_sphere.create": replace(
            receipt,
            action_name="blender.mesh.create_cube",
        ),
    }
    assert observe(candidate_receipts=mismatched_receipts)["satisfied"] is False
    assert observe()["satisfied"] is True

    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_icosphere_ready_observation() -> None:
    object_name = "OperatingLine.ReplayIcosphere"
    resource_id = "replay.icosphere"
    subdivisions = 2
    radius = 1.25
    location = [-1.0, 2.0, 3.5]
    ico_step = step(
        "replay.icosphere.create",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_icosphere",
            "arguments": {
                "resourceId": resource_id,
                "objectName": object_name,
                "subdivisions": subdivisions,
                "radius": radius,
                "location": location,
            },
        },
    )
    root = load_temporary_plan([step("root", None, 0), ico_step])
    session = DemoSession(root, action_registry(root))
    parameters = {
        "resourceId": resource_id,
        "objectName": object_name,
        "subdivisions": subdivisions,
        "radius": radius,
        "location": location,
    }

    def observe(
        candidate_parameters=parameters,
        candidate_receipts=None,
    ):
        return observation_module.evaluate_observations(
            (
                {
                    "kind": "icosphere_ready",
                    "parameters": candidate_parameters,
                },
            ),
            session.receipts if candidate_receipts is None else candidate_receipts,
        )[0]

    session.start()
    assert session.next() is not None
    icosphere = bpy.data.objects.get(object_name)
    assert icosphere is not None and icosphere.type == "MESH"
    mesh = icosphere.data
    successful = observe()
    assert successful["satisfied"] is True
    details = successful["details"]
    assert (details["vertexCount"], details["edgeCount"], details["faceCount"]) == (
        42,
        120,
        80,
    )
    assert len(details["meshContentSha256"]) == 64
    assert details["parameters"] == parameters

    malformed_parameters = (
        {key: value for key, value in parameters.items() if key != "subdivisions"},
        {**parameters, "unexpected": True},
        {**parameters, "subdivisions": True},
        {**parameters, "subdivisions": 6},
    )
    for malformed in malformed_parameters:
        assert observe(malformed)["satisfied"] is False

    original_coordinate = mesh.vertices[0].co.copy()
    mesh.vertices[0].co.x += 0.125
    mesh.update()
    assert observe()["satisfied"] is False
    mesh.vertices[0].co = original_coordinate
    mesh.update()

    original_action_tag = icosphere["operating_line_action"]
    icosphere["operating_line_action"] = "blender.mesh.create_uv_sphere"
    assert observe()["satisfied"] is False
    icosphere["operating_line_action"] = original_action_tag

    receipt = session.receipts["replay.icosphere.create"]
    mismatched_receipts = {
        **session.receipts,
        "replay.icosphere.create": replace(
            receipt,
            action_name="blender.mesh.create_uv_sphere",
        ),
    }
    assert observe(candidate_receipts=mismatched_receipts)["satisfied"] is False
    assert observe()["satisfied"] is True

    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_sized_primitive_ready_observations() -> None:
    cases = (
        {
            "kind": "cube",
            "actionName": "blender.mesh.create_cube",
            "observationKind": "cube_ready",
            "resourceId": "replay.cube",
            "objectName": "OperatingLine.ReplayCube",
            "size": 2.5,
            "location": [1.0, -2.0, 3.0],
            "topology": (8, 12, 6),
        },
        {
            "kind": "plane",
            "actionName": "blender.mesh.create_plane",
            "observationKind": "plane_ready",
            "resourceId": "replay.plane",
            "objectName": "OperatingLine.ReplayPlane",
            "size": 5.0,
            "location": [-1.5, 2.5, -0.75],
            "topology": (4, 4, 1),
        },
    )

    for case in cases:
        step_id = f"{case['resourceId']}.create"
        primitive_step = step(
            step_id,
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": case["actionName"],
                "arguments": {
                    "resourceId": case["resourceId"],
                    "objectName": case["objectName"],
                    "size": case["size"],
                    "location": case["location"],
                },
            },
        )
        root = load_temporary_plan([step("root", None, 0), primitive_step])
        session = DemoSession(root, action_registry(root))
        parameters = {
            "resourceId": case["resourceId"],
            "objectName": case["objectName"],
            "size": case["size"],
            "location": case["location"],
        }

        def observe(
            candidate_parameters=parameters,
            candidate_receipts=None,
        ):
            return observation_module.evaluate_observations(
                (
                    {
                        "kind": case["observationKind"],
                        "parameters": candidate_parameters,
                    },
                ),
                session.receipts
                if candidate_receipts is None
                else candidate_receipts,
            )[0]

        session.start()
        assert session.next() is not None
        primitive = bpy.data.objects.get(case["objectName"])
        assert primitive is not None and primitive.type == "MESH"
        mesh = primitive.data
        successful = observe()
        assert successful["satisfied"] is True
        details = successful["details"]
        assert (
            details["vertexCount"],
            details["edgeCount"],
            details["faceCount"],
        ) == case["topology"]
        assert details["sizeMatches"] is True
        assert "radiusMatches" not in details
        assert details["parameters"] == parameters

        malformed_parameters = (
            {key: value for key, value in parameters.items() if key != "size"},
            {**parameters, "unexpected": True},
            {**parameters, "size": True},
        )
        for malformed in malformed_parameters:
            assert observe(malformed)["satisfied"] is False

        original_coordinate = mesh.vertices[0].co.copy()
        mesh.vertices[0].co.x += 0.125
        mesh.update()
        assert observe()["satisfied"] is False
        mesh.vertices[0].co = original_coordinate
        mesh.update()

        original_action_tag = primitive["operating_line_action"]
        primitive["operating_line_action"] = "blender.mesh.create_uv_sphere"
        assert observe()["satisfied"] is False
        primitive["operating_line_action"] = original_action_tag

        receipt = session.receipts[step_id]
        mismatched_receipts = {
            **session.receipts,
            step_id: replace(
                receipt,
                action_name="blender.mesh.create_uv_sphere",
            ),
        }
        assert observe(candidate_receipts=mismatched_receipts)["satisfied"] is False
        assert observe()["satisfied"] is True

        assert session.back() is not None
        assert bpy.data.objects.get(case["objectName"]) is None
        assert bpy.data.collections.get(COLLECTION_NAME) is None


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


def triangulate_steps(
    *,
    object_name: str = "OperatingLine.TriangulateCube",
    result_mesh_id: str = "triangulate.cube.result_mesh",
    result_mesh_name: str = "OperatingLine.TriangulateCube.ResultMesh",
) -> list[dict]:
    return [
        step("root", None, 0),
        step(
            "triangulate.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "triangulate.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "triangulate.mesh",
            "root",
            2,
            depends_on=["triangulate.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_triangulate",
                "arguments": {
                    "targetId": "triangulate.cube",
                    "resultMeshId": result_mesh_id,
                    "resultMeshName": result_mesh_name,
                },
            },
        ),
    ]


def assert_triangulate_round_trip_and_guards() -> None:
    object_name = "OperatingLine.TriangulateCube"
    result_mesh_name = "OperatingLine.TriangulateCube.ResultMesh"
    root = load_temporary_plan(triangulate_steps())
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    cube = bpy.data.objects[object_name]
    source_mesh = cube.data
    assert (
        len(source_mesh.vertices),
        len(source_mesh.edges),
        len(source_mesh.polygons),
    ) == (8, 12, 6)

    assert session.next() is not None
    result_mesh = cube.data
    assert result_mesh is not source_mesh
    assert result_mesh.name == result_mesh_name
    assert (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    ) == (8, 18, 12)
    assert all(len(polygon.vertices) == 3 for polygon in result_mesh.polygons)
    receipt = session.receipts["triangulate.mesh"]
    assert len(receipt.created) == 1
    assert tuple(mutation.attribute for mutation in receipt.mutations) == (
        "data",
        "mesh_content",
    )
    ensure_receipts_intact(session.receipts)
    cube.data = source_mesh
    try:
        ensure_receipts_intact(session.receipts)
    except RuntimeError as error:
        assert "triangulate.cube.data" in str(error)
    else:
        raise AssertionError(
            "The latest owned data mutation must reject an earlier managed value"
        )
    cube.data = result_mesh

    observation_parameters = {
        "targetId": "triangulate.cube",
        "resultMeshId": "triangulate.cube.result_mesh",
    }
    observations = observation_module.evaluate_observations(
        (
            {"kind": "mesh_triangulated", "parameters": observation_parameters},
            {
                "kind": "mesh_triangulated",
                "parameters": {**observation_parameters, "unexpected": True},
            },
            {
                "kind": "mesh_triangulated",
                "parameters": {**observation_parameters, "targetId": 7},
            },
        ),
        session.receipts,
    )
    assert tuple(item["satisfied"] for item in observations) == (
        True,
        False,
        False,
    )

    original_vertex = result_mesh.vertices[0].co.copy()
    result_mesh.vertices[0].co.x += 0.25
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited triangulated meshes must block rollback")
    result_mesh.vertices[0].co = original_vertex

    external_user = cube.copy()
    external_user.data = result_mesh
    external_user.name = "ExternalTriangulateResultUser"
    bpy.context.scene.collection.objects.link(external_user)
    try:
        session.back()
    except RuntimeError as error:
        assert "externally used data" in str(error).lower()
    else:
        raise AssertionError("Externally used triangulated meshes must block rollback")
    bpy.data.objects.remove(external_user, do_unlink=True)

    assert session.back() is not None
    assert cube.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None

    modifier_root = load_temporary_plan(triangulate_steps())
    modifier_session = DemoSession(modifier_root, action_registry(modifier_root))
    modifier_session.start()
    assert modifier_session.next() is not None
    modifier_cube = bpy.data.objects[object_name]
    source_mesh = modifier_cube.data
    external_modifier = modifier_cube.modifiers.new("External", "BEVEL")
    try:
        modifier_session.next()
    except RuntimeError as error:
        assert "must not have modifiers" in str(error)
    else:
        raise AssertionError("Triangulate must reject modifier-bearing targets")
    assert modifier_cube.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    modifier_cube.modifiers.remove(external_modifier)

    bpy.context.view_layer.objects.active = modifier_cube
    modifier_cube.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        modifier_session.next()
    except RuntimeError as error:
        assert "Completed resource was modified" in str(error)
    else:
        raise AssertionError("Triangulate must reject Edit Mode targets")
    assert modifier_cube.data is source_mesh
    bpy.ops.object.mode_set(mode="OBJECT")

    modifier_cube.shape_key_add(name="Basis")
    try:
        modifier_session.next()
    except RuntimeError as error:
        assert "completed resource was modified" in str(error).lower()
    else:
        raise AssertionError("Triangulate must reject shape-key targets")
    assert modifier_cube.data is source_mesh
    modifier_cube.shape_key_clear()
    assert modifier_session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_triangulate_ngon_conflicts_and_boundaries() -> None:
    cylinder_name = "OperatingLine.TriangulateCylinder"
    result_mesh_name = "OperatingLine.TriangulateCylinder.ResultMesh"
    steps = [
        step("root", None, 0),
        step(
            "triangulate.ngon.cylinder",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cylinder",
                "arguments": {
                    "resourceId": "triangulate.ngon.cylinder",
                    "objectName": cylinder_name,
                    "radius": 1.0,
                    "start": [0.0, 0.0, -1.0],
                    "end": [0.0, 0.0, 1.0],
                },
            },
        ),
        step(
            "triangulate.ngon.mesh",
            "root",
            2,
            depends_on=["triangulate.ngon.cylinder"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_triangulate",
                "arguments": {
                    "targetId": "triangulate.ngon.cylinder",
                    "resultMeshId": "triangulate.ngon.result_mesh",
                    "resultMeshName": result_mesh_name,
                },
            },
        ),
    ]
    root = load_temporary_plan(steps)
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    cylinder = bpy.data.objects[cylinder_name]
    source_face_count = len(cylinder.data.polygons)
    assert any(len(polygon.vertices) > 4 for polygon in cylinder.data.polygons)
    assert session.next() is not None
    assert len(cylinder.data.polygons) > source_face_count
    assert all(len(polygon.vertices) == 3 for polygon in cylinder.data.polygons)
    assert session.back() is not None
    assert session.back() is not None
    assert bpy.data.collections.get(COLLECTION_NAME) is None

    _ensure_triangulate_topology_is_bounded((8192, 16384, 8192), "boundary")
    for topology in ((8193, 0, 0), (0, 16385, 0), (0, 0, 8193)):
        try:
            _ensure_triangulate_topology_is_bounded(topology, "boundary")
        except ValueError as error:
            assert "topology limits" in str(error)
        else:
            raise AssertionError(f"Triangulate must reject topology {topology}")

    result_mesh_name = "OperatingLine.TriangulateConflict.ResultMesh"
    conflict_steps = triangulate_steps(
        object_name="OperatingLine.TriangulateConflict",
        result_mesh_name=result_mesh_name,
    )
    conflict_root = load_temporary_plan(conflict_steps)
    conflict_session = DemoSession(conflict_root, action_registry(conflict_root))
    conflict_session.start()
    assert conflict_session.next() is not None
    conflict_cube = bpy.data.objects["OperatingLine.TriangulateConflict"]
    source_mesh = conflict_cube.data
    conflicting_mesh = bpy.data.meshes.new(result_mesh_name)
    try:
        conflict_session.next()
    except RuntimeError as error:
        assert "Cannot replace existing mesh" in str(error)
    else:
        raise AssertionError("Triangulate must reject a result mesh name conflict")
    assert conflict_cube.data is source_mesh
    assert len(conflict_session.receipts) == 1
    bpy.data.meshes.remove(conflicting_mesh)
    assert conflict_session.back() is not None

    duplicate_steps = triangulate_steps()
    duplicate_steps.append(
        step(
            "triangulate.duplicate",
            "root",
            3,
            depends_on=["triangulate.mesh"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_triangulate",
                "arguments": {
                    "targetId": "triangulate.cube",
                    "resultMeshId": "triangulate.cube.result_mesh",
                    "resultMeshName": "OperatingLine.TriangulateCube.DuplicateMesh",
                },
            },
        )
    )
    duplicate_root = load_temporary_plan(duplicate_steps)
    try:
        action_registry(duplicate_root)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Triangulate must reject duplicate planned result IDs")

    triangle_steps = triangulate_steps(
        object_name="OperatingLine.TriangulateTwice",
        result_mesh_name="OperatingLine.TriangulateTwice.FirstMesh",
    )
    triangle_steps.append(
        step(
            "triangulate.twice",
            "root",
            3,
            depends_on=["triangulate.mesh"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_triangulate",
                "arguments": {
                    "targetId": "triangulate.cube",
                    "resultMeshId": "triangulate.cube.second_mesh",
                    "resultMeshName": "OperatingLine.TriangulateTwice.SecondMesh",
                },
            },
        )
    )
    triangle_root = load_temporary_plan(triangle_steps)
    triangle_session = DemoSession(triangle_root, action_registry(triangle_root))
    triangle_session.start()
    assert triangle_session.next() is not None
    assert triangle_session.next() is not None
    triangle_cube = bpy.data.objects["OperatingLine.TriangulateTwice"]
    first_result = triangle_cube.data
    try:
        triangle_session.next()
    except ValueError as error:
        assert "non-triangle" in str(error)
    else:
        raise AssertionError("Triangulate must reject an already triangular mesh")
    assert triangle_cube.data is first_result
    assert bpy.data.meshes.get("OperatingLine.TriangulateTwice.SecondMesh") is None
    assert triangle_session.back() is not None
    assert triangle_session.back() is not None


def assert_triangulate_observation_success_gate() -> None:
    object_name = "OperatingLine.TriangulateGateCube"

    def gated_steps(*, result_mesh_id: str) -> list[dict]:
        result = triangulate_steps(
            object_name=object_name,
            result_mesh_id="triangulate.gate.result_mesh",
            result_mesh_name="OperatingLine.TriangulateGateCube.ResultMesh",
        )
        result[2]["expectedObservations"] = [
            {
                "kind": "mesh_triangulated",
                "parameters": {
                    "targetId": "triangulate.cube",
                    "resultMeshId": result_mesh_id,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    passing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps(result_mesh_id="triangulate.gate.result_mesh"),
        }
    )
    passing_session = DemoSession(
        passing_root,
        action_registry(passing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    passing_session.start()
    assert passing_session.next() is not None
    assert passing_session.next() is not None
    assert passing_session.active_index == 1
    assert passing_session.back() is not None
    assert passing_session.back() is not None

    failing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps(result_mesh_id="triangulate.gate.wrong_mesh"),
        }
    )
    failing_session = DemoSession(
        failing_root,
        action_registry(failing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    failing_session.start()
    assert failing_session.next() is not None
    source_mesh = bpy.data.objects[object_name].data
    try:
        failing_session.next()
    except RuntimeError as error:
        assert "Observation gate failed" in str(error)
    else:
        raise AssertionError("A wrong triangulated mesh ID must fail the success gate")
    assert failing_session.active_index == 0
    assert "triangulate.mesh" not in failing_session.receipts
    assert bpy.data.objects[object_name].data is source_mesh
    assert bpy.data.meshes.get("OperatingLine.TriangulateGateCube.ResultMesh") is None
    assert failing_session.back() is not None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_solidify_round_trip_and_conflicts() -> None:
    object_name = "OperatingLine.SolidifyCube"
    modifier_name = "OperatingLine.SolidifyCube.Solidify"
    solidify_arguments = {
        "targetId": "solidify.cube",
        "modifierId": "solidify.cube.modifier",
        "modifierName": modifier_name,
        "thickness": 0.25,
        "offset": -0.5,
    }
    steps = [
        step("root", None, 0),
        step(
            "solidify.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "solidify.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "solidify.modifier",
            "root",
            2,
            depends_on=["solidify.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_solidify",
                "arguments": solidify_arguments,
            },
        ),
    ]
    root = load_temporary_plan(steps)
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    cube = bpy.data.objects[object_name]
    source_mesh = cube.data
    source_topology = (
        len(source_mesh.vertices),
        len(source_mesh.edges),
        len(source_mesh.polygons),
    )
    assert source_topology == (8, 12, 6)

    assert session.next() is not None
    modifier = cube.modifiers[modifier_name]
    assert modifier.type == "SOLIDIFY"
    assert modifier.solidify_mode == "EXTRUDE"
    assert math.isclose(modifier.thickness, 0.25, abs_tol=1e-6)
    assert math.isclose(modifier.offset, -0.5, abs_tol=1e-6)
    assert modifier.use_even_offset is True
    assert modifier.use_rim is True
    assert modifier.use_rim_only is False
    assert cube.data is source_mesh
    assert (
        len(source_mesh.vertices),
        len(source_mesh.edges),
        len(source_mesh.polygons),
    ) == source_topology
    evaluated = cube.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    try:
        assert (
            len(evaluated_mesh.vertices),
            len(evaluated_mesh.edges),
            len(evaluated_mesh.polygons),
        ) == (16, 24, 12)
    finally:
        evaluated.to_mesh_clear()
    observation = observation_module.evaluate_observations(
        (
            {
                "kind": "modifier_ready",
                "parameters": {
                    "targetId": "solidify.cube",
                    "modifierId": "solidify.cube.modifier",
                    "modifierType": "SOLIDIFY",
                    "thickness": 0.25,
                    "offset": -0.5,
                    "solidifyMode": "EXTRUDE",
                    "useEvenOffset": True,
                    "useRim": True,
                    "useRimOnly": False,
                },
            },
        ),
        session.receipts,
    )
    assert observation[0]["satisfied"] is True
    exact_observation_parameters = observation[0]["details"]["parameters"]
    for field, wrong_value in (
        ("thickness", "0.25"),
        ("offset", "-0.5"),
        ("solidifyMode", 1),
        ("useEvenOffset", 1),
        ("useRim", "true"),
        ("useRimOnly", 0),
        ("axis", "X"),
        ("unexpected", True),
    ):
        malformed = observation_module.evaluate_observations(
            (
                {
                    "kind": "modifier_ready",
                    "parameters": {
                        **exact_observation_parameters,
                        field: wrong_value,
                    },
                },
            ),
            session.receipts,
        )
        assert malformed[0]["satisfied"] is False, field

    modifier.thickness = 0.5
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Externally edited Solidify modifiers must block rollback")
    assert session.active_index == 1
    assert "solidify.modifier" in session.receipts
    modifier.thickness = 0.25
    assert session.back() is not None
    assert cube.modifiers.get(modifier_name) is None
    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None

    unowned_name = "OperatingLine.UnownedSolidifyTarget"
    unowned_mesh = bpy.data.meshes.new(f"{unowned_name}.Mesh")
    unowned_target = bpy.data.objects.new(unowned_name, unowned_mesh)
    bpy.context.scene.collection.objects.link(unowned_target)
    unowned_root = load_temporary_plan(
        [
            step("root", None, 0),
            step(
                "solidify.unowned",
                "root",
                1,
                step_action={
                    "adapterId": "blender",
                    "name": "blender.modifier.add_solidify",
                    "arguments": {**solidify_arguments, "targetId": "unowned.target"},
                },
            ),
        ]
    )
    unowned_session = DemoSession(unowned_root, action_registry(unowned_root))
    unowned_session.start()
    try:
        unowned_session.next()
    except (RuntimeError, ValueError) as error:
        assert "unowned.target" in str(error)
    else:
        raise AssertionError("Solidify must reject unowned target IDs")
    bpy.data.objects.remove(unowned_target, do_unlink=True)
    if unowned_mesh.users == 0:
        bpy.data.meshes.remove(unowned_mesh)

    conflict_root = load_temporary_plan(steps)
    conflict_session = DemoSession(conflict_root, action_registry(conflict_root))
    conflict_session.start()
    assert conflict_session.next() is not None
    conflict_cube = bpy.data.objects[object_name]
    external_modifier = conflict_cube.modifiers.new(modifier_name, "SOLIDIFY")
    try:
        conflict_session.next()
    except RuntimeError as error:
        assert "untracked existing modifiers" in str(error)
    else:
        raise AssertionError("Solidify must reject existing untracked modifier names")
    conflict_cube.modifiers.remove(external_modifier)
    assert conflict_session.next() is not None
    assert conflict_session.back() is not None
    assert conflict_session.back() is not None

    duplicate_id_steps = deepcopy(steps)
    duplicate_id_steps.insert(
        2,
        step(
            "solidify.bevel",
            "root",
            2,
            depends_on=["solidify.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "solidify.cube",
                    "modifierId": "solidify.cube.modifier",
                    "modifierName": "OperatingLine.SolidifyCube.Bevel",
                    "width": 0.1,
                    "segments": 2,
                    "angleLimit": 0.5,
                },
            },
        ),
    )
    duplicate_id_steps[3]["order"] = 3
    duplicate_id_steps[3]["dependsOn"] = ["solidify.bevel"]
    duplicate_id_root = load_temporary_plan(duplicate_id_steps)
    try:
        action_registry(duplicate_id_root)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Solidify must reject duplicate logical modifier IDs")

    topology_root = load_temporary_plan(steps)
    topology_session = DemoSession(topology_root, action_registry(topology_root))
    topology_session.start()
    assert topology_session.next() is not None
    topology_cube = bpy.data.objects[object_name]
    topology_cube.data.clear_geometry()
    topology_cube.data.from_pydata(
        [(float(index), 0.0, 0.0) for index in range(8193)], [], []
    )
    topology_cube.data.update()
    assert len(topology_cube.modifiers) == 0
    try:
        topology_session.next()
    except RuntimeError as error:
        assert "completed resource was modified" in str(error).lower()
    else:
        raise AssertionError("Solidify must reject source topology above its bound")
    assert topology_session.active_index == 0
    assert "solidify.modifier" not in topology_session.receipts
    assert len(topology_cube.modifiers) == 0
    topology_cube.data.clear_geometry()
    restored = bmesh.new()
    try:
        bmesh.ops.create_cube(restored, size=2.0)
        restored.to_mesh(topology_cube.data)
    finally:
        restored.free()
    topology_cube.data.update()
    ensure_receipts_intact(topology_session.receipts)
    assert topology_session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.meshes.get(f"{object_name}.Mesh") is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_solidify_evaluated_topology_and_untracked_modifier_guards() -> None:
    object_name = "OperatingLine.SolidifyTopologyCube"
    bevel_name = "OperatingLine.SolidifyTopologyCube.Bevel"
    solidify_name = "OperatingLine.SolidifyTopologyCube.Solidify"
    steps = [
        step("root", None, 0),
        step(
            "solidify.topology.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "solidify.topology.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "solidify.topology.subdivide",
            "root",
            2,
            depends_on=["solidify.topology.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_subdivide",
                "arguments": {
                    "targetId": "solidify.topology.cube",
                    "resultMeshId": "solidify.topology.mesh",
                    "resultMeshName": "OperatingLine.SolidifyTopologyCube.SubdividedMesh",
                    "cuts": 8,
                    "smooth": 0.0,
                },
            },
        ),
        step(
            "solidify.topology.bevel",
            "root",
            3,
            depends_on=["solidify.topology.subdivide"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "solidify.topology.cube",
                    "modifierId": "solidify.topology.bevel",
                    "modifierName": bevel_name,
                    "width": 0.1,
                    "segments": 16,
                    "angleLimit": 0.0,
                },
            },
        ),
        step(
            "solidify.topology.solidify",
            "root",
            4,
            depends_on=["solidify.topology.bevel"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_solidify",
                "arguments": {
                    "targetId": "solidify.topology.cube",
                    "modifierId": "solidify.topology.solidify",
                    "modifierName": solidify_name,
                    "thickness": 0.1,
                    "offset": 0.0,
                },
            },
        ),
    ]
    root = load_temporary_plan(steps)
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    assert session.next() is not None
    assert session.next() is not None
    cube = bpy.data.objects[object_name]
    assert tuple(modifier.name for modifier in cube.modifiers) == (bevel_name,)
    evaluated = cube.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    try:
        evaluated_topology = (
            len(evaluated_mesh.vertices),
            len(evaluated_mesh.edges),
            len(evaluated_mesh.polygons),
        )
    finally:
        evaluated.to_mesh_clear()
    assert evaluated_topology == (31336, 62668, 31334), evaluated_topology
    try:
        session.next()
    except ValueError as error:
        assert "evaluated input exceeds" in str(error).lower()
    else:
        raise AssertionError("Solidify must reject excessive evaluated topology")
    assert session.active_index == 2
    assert "solidify.topology.solidify" not in session.receipts
    assert tuple(modifier.name for modifier in cube.modifiers) == (bevel_name,)
    assert session.back() is not None
    assert session.back() is not None
    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.meshes.get("OperatingLine.SolidifyTopologyCube.SubdividedMesh") is None

    guard_name = "OperatingLine.SolidifyUntrackedCube"
    guard_steps = [
        step("root", None, 0),
        step(
            "solidify.untracked.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "solidify.untracked.cube",
                    "objectName": guard_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "solidify.untracked.solidify",
            "root",
            2,
            depends_on=["solidify.untracked.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_solidify",
                "arguments": {
                    "targetId": "solidify.untracked.cube",
                    "modifierId": "solidify.untracked.solidify",
                    "modifierName": f"{guard_name}.Solidify",
                    "thickness": 0.1,
                    "offset": 0.0,
                },
            },
        ),
    ]
    guard_root = load_temporary_plan(guard_steps)
    guard_session = DemoSession(guard_root, action_registry(guard_root))
    guard_session.start()
    assert guard_session.next() is not None
    guard_cube = bpy.data.objects[guard_name]
    untracked = guard_cube.modifiers.new(f"{guard_name}.External", "BEVEL")
    try:
        guard_session.next()
    except RuntimeError as error:
        assert "untracked existing modifiers" in str(error).lower()
    else:
        raise AssertionError("Solidify must reject an existing untracked modifier")
    assert guard_session.active_index == 0
    assert "solidify.untracked.solidify" not in guard_session.receipts
    assert tuple(guard_cube.modifiers) == (untracked,)
    guard_cube.modifiers.remove(untracked)
    assert guard_session.back() is not None
    assert bpy.data.objects.get(guard_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def assert_solidify_observation_success_gate() -> None:
    object_name = "OperatingLine.SolidifyGateCube"
    modifier_name = "OperatingLine.SolidifyGateCube.Solidify"

    def gated_steps(*, solidify_mode: str) -> list[dict]:
        result = [
            step("root", None, 0),
            step(
                "solidify.gate.cube",
                "root",
                1,
                step_action={
                    "adapterId": "blender",
                    "name": "blender.mesh.create_cube",
                    "arguments": {
                        "resourceId": "solidify.gate.cube",
                        "objectName": object_name,
                        "size": 2.0,
                        "location": [0.0, 0.0, 0.0],
                    },
                },
            ),
            step(
                "solidify.gate.modifier",
                "root",
                2,
                depends_on=["solidify.gate.cube"],
                step_action={
                    "adapterId": "blender",
                    "name": "blender.modifier.add_solidify",
                    "arguments": {
                        "targetId": "solidify.gate.cube",
                        "modifierId": "solidify.gate.modifier",
                        "modifierName": modifier_name,
                        "thickness": 0.25,
                        "offset": -0.5,
                    },
                },
            ),
        ]
        result[2]["expectedObservations"] = [
            {
                "kind": "modifier_ready",
                "parameters": {
                    "targetId": "solidify.gate.cube",
                    "modifierId": "solidify.gate.modifier",
                    "modifierType": "SOLIDIFY",
                    "thickness": 0.25,
                    "offset": -0.5,
                    "solidifyMode": solidify_mode,
                    "useEvenOffset": True,
                    "useRim": True,
                    "useRimOnly": False,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    passing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps(solidify_mode="EXTRUDE"),
        }
    )
    passing_session = DemoSession(
        passing_root,
        action_registry(passing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    passing_session.start()
    assert passing_session.next() is not None
    assert passing_session.next() is not None
    assert passing_session.active_index == 1
    assert "solidify.gate.modifier" in passing_session.receipts
    assert bpy.data.objects[object_name].modifiers.get(modifier_name) is not None
    assert passing_session.back() is not None
    assert passing_session.back() is not None

    failing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps(solidify_mode="NON_MANIFOLD"),
        }
    )
    failing_session = DemoSession(
        failing_root,
        action_registry(failing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    failing_session.start()
    assert failing_session.next() is not None
    try:
        failing_session.next()
    except RuntimeError as error:
        assert "Observation gate failed" in str(error)
    else:
        raise AssertionError("Wrong fixed Solidify properties must fail the success gate")
    assert failing_session.active_index == 0
    assert "solidify.gate.modifier" not in failing_session.receipts
    assert bpy.data.objects[object_name].modifiers.get(modifier_name) is None
    assert failing_session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None


def extrude_region_steps(
    *,
    object_name: str = "OperatingLine.ExtrudeRegionCube",
    result_mesh_id: str = "extrude.cube.result_mesh",
    result_mesh_name: str = "OperatingLine.ExtrudeRegionCube.ResultMesh",
    polygon_indices: list[int] | None = None,
    translation: list[float] | None = None,
) -> list[dict]:
    return [
        step("root", None, 0),
        step(
            "extrude.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "extrude.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "extrude.region",
            "root",
            2,
            depends_on=["extrude.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_extrude_region",
                "arguments": {
                    "targetId": "extrude.cube",
                    "resultMeshId": result_mesh_id,
                    "resultMeshName": result_mesh_name,
                    "polygonIndices": polygon_indices or [5],
                    "translation": translation or [0.25, -0.5, 1.0],
                },
            },
        ),
    ]


def assert_extrude_region_round_trip_and_guards() -> None:
    object_name = "OperatingLine.ExtrudeRegionCube"
    result_mesh_name = "OperatingLine.ExtrudeRegionCube.ResultMesh"
    root = load_temporary_plan(extrude_region_steps())
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    cube = bpy.data.objects[object_name]
    source_mesh = cube.data
    source_coordinates = tuple(tuple(vertex.co) for vertex in source_mesh.vertices)

    assert session.next() is not None
    result_mesh = cube.data
    assert result_mesh is not source_mesh
    assert result_mesh.name == result_mesh_name
    assert (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    ) == (12, 20, 10)
    assert tuple(
        tuple(sorted(polygon.vertices)) for polygon in result_mesh.polygons
    ) == (
        (0, 1, 2, 3),
        (0, 1, 4, 5),
        (0, 2, 4, 6),
        (1, 3, 8, 9),
        (1, 5, 8, 10),
        (2, 3, 6, 7),
        (3, 7, 9, 11),
        (4, 5, 6, 7),
        (5, 7, 10, 11),
        (8, 9, 10, 11),
    )
    assert result_mesh.attributes.get("OperatingLine.source_vertex_index") is None
    assert tuple(tuple(vertex.co) for vertex in source_mesh.vertices) == source_coordinates
    new_coordinates = tuple(tuple(vertex.co) for vertex in result_mesh.vertices[8:])
    assert set(new_coordinates) == {
        (-0.75, -1.5, 2.0),
        (-0.75, 0.5, 2.0),
        (1.25, -1.5, 2.0),
        (1.25, 0.5, 2.0),
    }
    receipt = session.receipts["extrude.region"]
    assert receipt.action_name == "blender.mesh.edit_extrude_region"
    assert tuple(mutation.attribute for mutation in receipt.mutations) == (
        "data",
        "mesh_content",
    )

    parameters = {
        "targetId": "extrude.cube",
        "resultMeshId": "extrude.cube.result_mesh",
    }
    observations = observation_module.evaluate_observations(
        (
            {"kind": "mesh_region_extruded", "parameters": parameters},
            {
                "kind": "mesh_region_extruded",
                "parameters": {**parameters, "unexpected": True},
            },
        ),
        session.receipts,
    )
    assert tuple(item["satisfied"] for item in observations) == (True, False)

    original_vertex = result_mesh.vertices[0].co.copy()
    result_mesh.vertices[0].co.x += 0.25
    assert (
        observation_module.evaluate_observations(
            ({"kind": "mesh_region_extruded", "parameters": parameters},),
            session.receipts,
        )[0]["satisfied"]
        is False
    )
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited extruded meshes must block rollback")
    result_mesh.vertices[0].co = original_vertex

    assert session.back() is not None
    assert cube.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None
    assert bpy.data.collections.get(COLLECTION_NAME) is None

    for label, mutate, message in (
        (
            "modifier",
            lambda target: target.modifiers.new("External", "BEVEL"),
            "must not have modifiers",
        ),
        (
            "shape_key",
            lambda target: target.shape_key_add(name="Basis"),
            "Completed resource was modified",
        ),
    ):
        guarded_name = f"OperatingLine.ExtrudeRegionGuard.{label}"
        guarded_mesh_name = f"{guarded_name}.ResultMesh"
        guarded_root = load_temporary_plan(
            extrude_region_steps(
                object_name=guarded_name,
                result_mesh_name=guarded_mesh_name,
            )
        )
        guarded_session = DemoSession(guarded_root, action_registry(guarded_root))
        guarded_session.start()
        assert guarded_session.next() is not None
        guarded_target = bpy.data.objects[guarded_name]
        guarded_source = guarded_target.data
        mutate(guarded_target)
        try:
            guarded_session.next()
        except RuntimeError as error:
            assert message in str(error)
        else:
            raise AssertionError(f"Extrude Region must reject a {label} target")
        assert guarded_target.data is guarded_source
        assert bpy.data.meshes.get(guarded_mesh_name) is None
        if label == "modifier":
            guarded_target.modifiers.clear()
        else:
            guarded_target.shape_key_clear()
        assert guarded_session.back() is not None

    mode_name = "OperatingLine.ExtrudeRegionGuard.EditMode"
    mode_root = load_temporary_plan(
        extrude_region_steps(
            object_name=mode_name,
            result_mesh_name=f"{mode_name}.ResultMesh",
        )
    )
    mode_session = DemoSession(mode_root, action_registry(mode_root))
    mode_session.start()
    assert mode_session.next() is not None
    mode_target = bpy.data.objects[mode_name]
    bpy.context.view_layer.objects.active = mode_target
    mode_target.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        mode_session.next()
    except RuntimeError as error:
        assert "Completed resource was modified" in str(error)
    else:
        raise AssertionError("Extrude Region must reject Edit Mode targets")
    bpy.ops.object.mode_set(mode="OBJECT")
    assert mode_session.back() is not None

    invalid_name = "OperatingLine.ExtrudeRegionGuard.Index"
    invalid_mesh_name = f"{invalid_name}.ResultMesh"
    invalid_index_root = load_temporary_plan(
        extrude_region_steps(
            object_name=invalid_name,
            result_mesh_name=invalid_mesh_name,
            polygon_indices=[6],
        )
    )
    invalid_index_session = DemoSession(
        invalid_index_root, action_registry(invalid_index_root)
    )
    invalid_index_session.start()
    assert invalid_index_session.next() is not None
    invalid_target = bpy.data.objects[invalid_name]
    invalid_source = invalid_target.data
    try:
        invalid_index_session.next()
    except ValueError as error:
        assert "outside the target mesh" in str(error)
    else:
        raise AssertionError("Extrude Region must reject out-of-range polygon indices")
    assert invalid_target.data is invalid_source
    assert bpy.data.meshes.get(invalid_mesh_name) is None
    assert invalid_index_session.back() is not None

    _ensure_extrude_topology_is_bounded((8192, 16384, 8192), "boundary")
    for topology in ((8193, 0, 0), (0, 16385, 0), (0, 0, 8193)):
        try:
            _ensure_extrude_topology_is_bounded(topology, "boundary")
        except ValueError as error:
            assert "topology limits" in str(error)
        else:
            raise AssertionError(f"Extrude Region must reject topology {topology}")


def _bmesh_for_faces(
    coordinates: tuple[tuple[float, float, float], ...],
    face_indices: tuple[tuple[int, ...], ...],
) -> bmesh.types.BMesh:
    bm = bmesh.new()
    vertices = tuple(bm.verts.new(coordinate) for coordinate in coordinates)
    for indices in face_indices:
        bm.faces.new(tuple(vertices[index] for index in indices))
    bm.verts.index_update()
    bm.edges.index_update()
    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    return bm


def assert_extrude_region_connectivity_guards() -> None:
    connected_name = "OperatingLine.ExtrudeRegionConnected"
    connected_mesh_name = f"{connected_name}.ResultMesh"
    connected_root = load_temporary_plan(
        extrude_region_steps(
            object_name=connected_name,
            result_mesh_name=connected_mesh_name,
            polygon_indices=[0, 1],
        )
    )
    connected_session = DemoSession(
        connected_root, action_registry(connected_root)
    )
    connected_session.start()
    assert connected_session.next() is not None
    connected_target = bpy.data.objects[connected_name]
    connected_source = connected_target.data
    assert connected_session.next() is not None
    assert (
        len(connected_target.data.vertices),
        len(connected_target.data.edges),
        len(connected_target.data.polygons),
    ) == (14, 24, 12)
    assert tuple(
        tuple(sorted(polygon.vertices))
        for polygon in connected_target.data.polygons
    ) == (
        (0, 1, 4, 5),
        (0, 1, 8, 9),
        (0, 2, 4, 6),
        (0, 2, 8, 10),
        (1, 3, 5, 7),
        (1, 3, 9, 11),
        (2, 6, 10, 12),
        (3, 7, 11, 13),
        (4, 5, 6, 7),
        (6, 7, 12, 13),
        (8, 9, 10, 11),
        (10, 11, 12, 13),
    )
    assert connected_session.back() is not None
    assert connected_target.data is connected_source
    assert bpy.data.meshes.get(connected_mesh_name) is None
    assert connected_session.back() is not None

    for label, polygon_indices, message in (
        ("Disconnected", [0, 2], "edge-connected"),
        ("Closed", [0, 1, 2, 3, 4, 5], "boundary edge"),
    ):
        object_name = f"OperatingLine.ExtrudeRegion{label}"
        result_mesh_name = f"{object_name}.ResultMesh"
        root = load_temporary_plan(
            extrude_region_steps(
                object_name=object_name,
                result_mesh_name=result_mesh_name,
                polygon_indices=polygon_indices,
            )
        )
        session = DemoSession(root, action_registry(root))
        session.start()
        assert session.next() is not None
        target = bpy.data.objects[object_name]
        source = target.data
        try:
            session.next()
        except ValueError as error:
            assert message in str(error)
        else:
            raise AssertionError(f"Extrude Region must reject {label.lower()} faces")
        assert target.data is source
        assert bpy.data.meshes.get(result_mesh_name) is None
        assert session.back() is not None

    non_manifold = _bmesh_for_faces(
        (
            (0.0, 0.0, 0.0),
            (1.0, 0.0, 0.0),
            (0.5, 1.0, 0.0),
            (0.5, -1.0, 0.0),
            (0.5, 0.0, 1.0),
        ),
        ((0, 1, 2), (1, 0, 3), (0, 1, 4)),
    )
    try:
        try:
            _extrude_region_geometry(non_manifold, (0, 1))
        except ValueError as error:
            assert "non-manifold" in str(error)
        else:
            raise AssertionError("Extrude Region must reject non-manifold edges")
    finally:
        non_manifold.free()


def assert_extrude_region_rejects_modified_source() -> None:
    object_name = "OperatingLine.ExtrudeRegionModifiedSource"
    result_mesh_name = f"{object_name}.ResultMesh"
    root = load_temporary_plan(
        extrude_region_steps(
            object_name=object_name,
            result_mesh_name=result_mesh_name,
        )
    )
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    target = bpy.data.objects[object_name]
    source_mesh = target.data
    original_coordinate = source_mesh.vertices[0].co.copy()
    source_mesh.vertices[0].co.x += 0.125
    try:
        session.next()
    except RuntimeError as error:
        assert "Completed resource was modified" in str(error)
        assert "extrude.cube.mesh.mesh_content" in str(error)
    else:
        raise AssertionError("Extrude Region must reject a modified source mesh")
    assert target.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    source_mesh.vertices[0].co = original_coordinate
    assert session.back() is not None


def assert_extrude_region_chained_indices() -> None:
    object_name = "OperatingLine.ExtrudeRegionChained"
    first_mesh_name = f"{object_name}.FirstMesh"
    second_mesh_name = f"{object_name}.SecondMesh"
    steps = extrude_region_steps(
        object_name=object_name,
        result_mesh_id="extrude.cube.first_mesh",
        result_mesh_name=first_mesh_name,
    )
    steps.append(
        step(
            "extrude.region.second",
            "root",
            3,
            depends_on=["extrude.region"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_extrude_region",
                "arguments": {
                    "targetId": "extrude.cube",
                    "resultMeshId": "extrude.cube.second_mesh",
                    "resultMeshName": second_mesh_name,
                    "polygonIndices": [9],
                    "translation": [0.0, 0.0, 0.5],
                },
            },
        )
    )
    root = load_temporary_plan(steps)
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    target = bpy.data.objects[object_name]
    source_mesh = target.data
    assert session.next() is not None
    first_mesh = target.data
    assert tuple(sorted(first_mesh.polygons[9].vertices)) == (8, 9, 10, 11)
    assert session.next() is not None
    assert (
        len(target.data.vertices),
        len(target.data.edges),
        len(target.data.polygons),
    ) == (16, 28, 14)
    assert session.back() is not None
    assert target.data is first_mesh
    assert bpy.data.meshes.get(second_mesh_name) is None
    assert session.back() is not None
    assert target.data is source_mesh
    assert bpy.data.meshes.get(first_mesh_name) is None
    assert session.back() is not None


def assert_extrude_region_observation_success_gate() -> None:
    object_name = "OperatingLine.ExtrudeRegionGateCube"

    def gated_steps(*, result_mesh_id: str) -> list[dict]:
        result = extrude_region_steps(
            object_name=object_name,
            result_mesh_name="OperatingLine.ExtrudeRegionGateCube.ResultMesh",
        )
        result[2]["expectedObservations"] = [
            {
                "kind": "mesh_region_extruded",
                "parameters": {
                    "targetId": "extrude.cube",
                    "resultMeshId": result_mesh_id,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    passing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps(result_mesh_id="extrude.cube.result_mesh"),
        }
    )
    passing_session = DemoSession(
        passing_root,
        action_registry(passing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    passing_session.start()
    assert passing_session.next() is not None
    assert passing_session.next() is not None
    assert passing_session.back() is not None
    assert passing_session.back() is not None

    failing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps(result_mesh_id="extrude.cube.wrong_mesh"),
        }
    )
    failing_session = DemoSession(
        failing_root,
        action_registry(failing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    failing_session.start()
    assert failing_session.next() is not None
    source_mesh = bpy.data.objects[object_name].data
    try:
        failing_session.next()
    except RuntimeError as error:
        assert "Observation gate failed" in str(error)
    else:
        raise AssertionError("A wrong extruded mesh ID must fail the success gate")
    assert failing_session.active_index == 0
    assert "extrude.region" not in failing_session.receipts
    assert bpy.data.objects[object_name].data is source_mesh
    assert bpy.data.meshes.get("OperatingLine.ExtrudeRegionGateCube.ResultMesh") is None
    assert failing_session.back() is not None


def edit_bevel_edges_steps(
    *,
    object_name: str = "OperatingLine.EditBevelCube",
    result_mesh_id: str = "edit_bevel.cube.result_mesh",
    result_mesh_name: str = "OperatingLine.EditBevelCube.ResultMesh",
    width: float = 0.2,
    segments: int = 3,
    profile: float = 0.6,
) -> list[dict]:
    return [
        step("root", None, 0),
        step(
            "edit_bevel.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "edit_bevel.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "edit_bevel.edges",
            "root",
            2,
            depends_on=["edit_bevel.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_bevel_edges",
                "arguments": {
                    "targetId": "edit_bevel.cube",
                    "resultMeshId": result_mesh_id,
                    "resultMeshName": result_mesh_name,
                    "width": width,
                    "segments": segments,
                    "profile": profile,
                },
            },
        ),
    ]


def assert_edit_bevel_edges_round_trip_and_guards() -> None:
    object_name = "OperatingLine.EditBevelCube"
    result_mesh_name = "OperatingLine.EditBevelCube.ResultMesh"
    root = load_temporary_plan(edit_bevel_edges_steps())
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    target = bpy.data.objects[object_name]
    source_mesh = target.data
    source_signature = tuple(tuple(vertex.co) for vertex in source_mesh.vertices)
    assert session.next() is not None
    result_mesh = target.data
    assert result_mesh is not source_mesh
    assert result_mesh.name == result_mesh_name
    assert (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    ) == (96, 192, 98)
    assert tuple(tuple(vertex.co) for vertex in source_mesh.vertices) == source_signature
    receipt = session.receipts["edit_bevel.edges"]
    assert receipt.action_name == "blender.mesh.edit_bevel_edges"
    assert tuple(mutation.attribute for mutation in receipt.mutations) == (
        "data",
        "mesh_content",
    )

    parameters = {
        "targetId": "edit_bevel.cube",
        "resultMeshId": "edit_bevel.cube.result_mesh",
    }
    observations = observation_module.evaluate_observations(
        (
            {"kind": "mesh_edges_beveled", "parameters": parameters},
            {
                "kind": "mesh_edges_beveled",
                "parameters": {**parameters, "unexpected": True},
            },
            {
                "kind": "mesh_edges_beveled",
                "parameters": {**parameters, "resultMeshId": "wrong.mesh"},
            },
        ),
        session.receipts,
    )
    assert tuple(item["satisfied"] for item in observations) == (True, False, False)

    original_vertex = result_mesh.vertices[0].co.copy()
    result_mesh.vertices[0].co.x += 0.25
    assert (
        observation_module.evaluate_observations(
            ({"kind": "mesh_edges_beveled", "parameters": parameters},),
            session.receipts,
        )[0]["satisfied"]
        is False
    )
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited bevel result meshes must block rollback")
    result_mesh.vertices[0].co = original_vertex
    assert session.back() is not None
    assert target.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    assert session.back() is not None

    for label, mutate, cleanup in (
        (
            "modifier",
            lambda item: item.modifiers.new("External", "BEVEL"),
            lambda item: item.modifiers.clear(),
        ),
        (
            "shape_key",
            lambda item: item.shape_key_add(name="Basis"),
            lambda item: item.shape_key_clear(),
        ),
    ):
        guarded_name = f"OperatingLine.EditBevelGuard.{label}"
        guarded_root = load_temporary_plan(
            edit_bevel_edges_steps(
                object_name=guarded_name,
                result_mesh_name=f"{guarded_name}.ResultMesh",
            )
        )
        guarded_session = DemoSession(
            guarded_root, action_registry(guarded_root)
        )
        guarded_session.start()
        assert guarded_session.next() is not None
        guarded_target = bpy.data.objects[guarded_name]
        mutate(guarded_target)
        try:
            guarded_session.next()
        except RuntimeError as error:
            assert "modified" in str(error) or "must not have" in str(error)
        else:
            raise AssertionError(f"Edit Bevel must reject a {label} target")
        cleanup(guarded_target)
        assert guarded_session.back() is not None

    mode_name = "OperatingLine.EditBevelGuard.EditMode"
    mode_root = load_temporary_plan(
        edit_bevel_edges_steps(
            object_name=mode_name,
            result_mesh_name=f"{mode_name}.ResultMesh",
        )
    )
    mode_session = DemoSession(mode_root, action_registry(mode_root))
    mode_session.start()
    assert mode_session.next() is not None
    mode_target = bpy.data.objects[mode_name]
    bpy.context.view_layer.objects.active = mode_target
    mode_target.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        mode_session.next()
    except RuntimeError as error:
        assert "modified" in str(error) or "Object Mode" in str(error)
    else:
        raise AssertionError("Edit Bevel must reject Edit Mode targets")
    bpy.ops.object.mode_set(mode="OBJECT")
    assert mode_session.back() is not None

    empty_mesh = bpy.data.meshes.new("OperatingLine.EditBevel.Empty")
    open_mesh = bpy.data.meshes.new("OperatingLine.EditBevel.Open")
    open_mesh.from_pydata(
        [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (1.0, 1.0, 0.0)],
        [],
        [(0, 1, 2)],
    )
    try:
        for mesh, expected in (
            (empty_mesh, "nonempty"),
            (open_mesh, "exactly two adjacent faces"),
        ):
            try:
                _validate_edit_bevel_source(mesh)
            except ValueError as error:
                assert expected in str(error)
            else:
                raise AssertionError("Edit Bevel must reject unsupported topology")
    finally:
        bpy.data.meshes.remove(empty_mesh)
        bpy.data.meshes.remove(open_mesh)

    _ensure_edit_bevel_topology_is_bounded((8192, 16384, 8192), "boundary")
    for topology in ((8193, 0, 0), (0, 16385, 0), (0, 0, 8193)):
        try:
            _ensure_edit_bevel_topology_is_bounded(topology, "result")
        except ValueError as error:
            assert "supported topology limits" in str(error)
        else:
            raise AssertionError("Edit Bevel must reject out-of-bounds topology")

    overflow_name = "OperatingLine.EditBevelOverflow"
    overflow_result_name = f"{overflow_name}.ResultMesh"
    overflow_steps = edit_bevel_edges_steps(
        object_name=overflow_name,
        result_mesh_name=overflow_result_name,
        segments=16,
    )
    overflow_steps[2]["order"] = 3
    overflow_steps[2]["dependsOn"] = ["edit_bevel.subdivide"]
    overflow_steps.insert(
        2,
        step(
            "edit_bevel.subdivide",
            "root",
            2,
            depends_on=["edit_bevel.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_subdivide",
                "arguments": {
                    "targetId": "edit_bevel.cube",
                    "resultMeshId": "edit_bevel.cube.subdivided_mesh",
                    "resultMeshName": f"{overflow_name}.SubdividedMesh",
                    "cuts": 8,
                    "smooth": 0.0,
                },
            },
        ),
    )
    overflow_root = load_temporary_plan(overflow_steps)
    overflow_session = DemoSession(
        overflow_root, action_registry(overflow_root)
    )
    overflow_session.start()
    assert overflow_session.next() is not None
    assert overflow_session.next() is not None
    overflow_target = bpy.data.objects[overflow_name]
    overflow_source = overflow_target.data
    try:
        overflow_session.next()
    except ValueError as error:
        assert "result exceeds the supported topology limits" in str(error)
    else:
        raise AssertionError("Edit Bevel must reject oversized BMesh results")
    assert overflow_target.data is overflow_source
    assert bpy.data.meshes.get(overflow_result_name) is None
    assert "edit_bevel.edges" not in overflow_session.receipts
    assert overflow_session.back() is not None
    assert overflow_session.back() is not None

    conflict_steps = edit_bevel_edges_steps(
        result_mesh_id="edit_bevel.cube.mesh"
    )
    conflict_root = load_temporary_plan(conflict_steps)
    try:
        action_registry(conflict_root)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Edit Bevel result IDs must be reserved")

    def gated_steps(result_mesh_id: str) -> list[dict]:
        result = edit_bevel_edges_steps(
            object_name="OperatingLine.EditBevelGateCube",
            result_mesh_name="OperatingLine.EditBevelGateCube.ResultMesh",
        )
        result[2]["expectedObservations"] = [
            {
                "kind": "mesh_edges_beveled",
                "parameters": {
                    "targetId": "edit_bevel.cube",
                    "resultMeshId": result_mesh_id,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    passing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps("edit_bevel.cube.result_mesh"),
        }
    )
    passing_session = DemoSession(
        passing_root,
        action_registry(passing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    passing_session.start()
    assert passing_session.next() is not None
    assert passing_session.next() is not None
    assert passing_session.back() is not None
    assert passing_session.back() is not None

    failing_root = load_task_tree_data(
        {
            "protocolVersion": "1.2.0",
            "rootStepId": "root",
            "steps": gated_steps("edit_bevel.cube.wrong_mesh"),
        }
    )
    failing_session = DemoSession(
        failing_root,
        action_registry(failing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    failing_session.start()
    assert failing_session.next() is not None
    source_mesh = bpy.data.objects["OperatingLine.EditBevelGateCube"].data
    try:
        failing_session.next()
    except RuntimeError as error:
        assert "Observation gate failed" in str(error)
    else:
        raise AssertionError("Wrong beveled mesh IDs must fail the success gate")
    assert failing_session.active_index == 0
    assert "edit_bevel.edges" not in failing_session.receipts
    assert bpy.data.objects["OperatingLine.EditBevelGateCube"].data is source_mesh
    assert bpy.data.meshes.get("OperatingLine.EditBevelGateCube.ResultMesh") is None
    assert failing_session.back() is not None


def edit_inset_faces_steps(
    *,
    object_name: str = "OperatingLine.EditInsetCube",
    result_mesh_id: str = "edit_inset.cube.result_mesh",
    result_mesh_name: str = "OperatingLine.EditInsetCube.ResultMesh",
    thickness: float = 0.2,
    depth: float = 0.1,
) -> list[dict]:
    return [
        step("root", None, 0),
        step(
            "edit_inset.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "edit_inset.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "edit_inset.faces",
            "root",
            2,
            depends_on=["edit_inset.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_inset_faces",
                "arguments": {
                    "targetId": "edit_inset.cube",
                    "resultMeshId": result_mesh_id,
                    "resultMeshName": result_mesh_name,
                    "thickness": thickness,
                    "depth": depth,
                },
            },
        ),
    ]


def assert_edit_inset_faces_round_trip_and_guards() -> None:
    object_name = "OperatingLine.EditInsetCube"
    result_mesh_name = "OperatingLine.EditInsetCube.ResultMesh"
    root = load_temporary_plan(edit_inset_faces_steps())
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    target = bpy.data.objects[object_name]
    source_mesh = target.data
    source_signature = tuple(tuple(vertex.co) for vertex in source_mesh.vertices)
    assert session.next() is not None
    result_mesh = target.data
    assert result_mesh is not source_mesh
    assert result_mesh.name == result_mesh_name
    assert (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    ) == (32, 60, 30)
    assert tuple(tuple(vertex.co) for vertex in source_mesh.vertices) == source_signature
    assert target.mode == "OBJECT"
    receipt = session.receipts["edit_inset.faces"]
    assert receipt.action_name == "blender.mesh.edit_inset_faces"
    assert tuple(mutation.attribute for mutation in receipt.mutations) == (
        "data",
        "mesh_content",
        "mesh_content",
    )
    assert receipt.mutations[1].resource.pointer == source_mesh.as_pointer()
    assert receipt.mutations[1].before == receipt.mutations[1].after

    parameters = {
        "targetId": "edit_inset.cube",
        "resultMeshId": "edit_inset.cube.result_mesh",
    }
    observations = observation_module.evaluate_observations(
        (
            {"kind": "mesh_faces_inset", "parameters": parameters},
            {
                "kind": "mesh_faces_inset",
                "parameters": {**parameters, "unexpected": True},
            },
            {
                "kind": "mesh_faces_inset",
                "parameters": {**parameters, "resultMeshId": "wrong.mesh"},
            },
        ),
        session.receipts,
    )
    assert tuple(item["satisfied"] for item in observations) == (True, False, False)
    assert observations[0]["details"]["sourceLoopCount"] == 24
    assert observations[0]["details"]["topologyMatches"] is True

    original_vertex = result_mesh.vertices[0].co.copy()
    result_mesh.vertices[0].co.x += 0.25
    assert (
        observation_module.evaluate_observations(
            ({"kind": "mesh_faces_inset", "parameters": parameters},),
            session.receipts,
        )[0]["satisfied"]
        is False
    )
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited inset result meshes must block rollback")
    result_mesh.vertices[0].co = original_vertex

    original_source_vertex = source_mesh.vertices[0].co.copy()
    source_mesh.vertices[0].co.x += 0.25
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited inset source meshes must block rollback")
    assert target.data is result_mesh
    assert bpy.data.meshes.get(result_mesh_name) is result_mesh
    source_mesh.vertices[0].co = original_source_vertex
    assert session.back() is not None
    assert target.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    assert session.back() is not None

    triangle_name = "OperatingLine.EditInsetTriangleMesh"
    triangle_result_name = f"{triangle_name}.ResultMesh"
    triangle_steps = [
        step("root", None, 0),
        step(
            "edit_inset.triangles",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_icosphere",
                "arguments": {
                    "resourceId": "edit_inset.triangles",
                    "objectName": triangle_name,
                    "subdivisions": 1,
                    "radius": 1.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "edit_inset.triangle_faces",
            "root",
            2,
            depends_on=["edit_inset.triangles"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_inset_faces",
                "arguments": {
                    "targetId": "edit_inset.triangles",
                    "resultMeshId": "edit_inset.triangles.result_mesh",
                    "resultMeshName": triangle_result_name,
                    "thickness": 0.1,
                    "depth": 0.0,
                },
            },
        ),
    ]
    triangle_root = load_temporary_plan(triangle_steps)
    triangle_session = DemoSession(triangle_root, action_registry(triangle_root))
    triangle_session.start()
    assert triangle_session.next() is not None
    triangle_target = bpy.data.objects[triangle_name]
    triangle_source = triangle_target.data
    assert (
        len(triangle_source.vertices),
        len(triangle_source.edges),
        len(triangle_source.polygons),
    ) == (12, 30, 20)
    assert triangle_session.next() is not None
    triangle_result = triangle_target.data
    assert (
        len(triangle_result.vertices),
        len(triangle_result.edges),
        len(triangle_result.polygons),
    ) == (72, 150, 80)
    assert sum(len(face.vertices) == 3 for face in triangle_result.polygons) == 20
    assert sum(len(face.vertices) == 4 for face in triangle_result.polygons) == 60
    assert triangle_source is not triangle_result
    assert triangle_session.back() is not None
    assert triangle_target.data is triangle_source
    assert bpy.data.meshes.get(triangle_result_name) is None
    assert triangle_session.back() is not None

    for label, mutate, cleanup in (
        (
            "modifier",
            lambda item: item.modifiers.new("External", "BEVEL"),
            lambda item: item.modifiers.clear(),
        ),
        (
            "shape_key",
            lambda item: item.shape_key_add(name="Basis"),
            lambda item: item.shape_key_clear(),
        ),
    ):
        guarded_name = f"OperatingLine.EditInsetGuard.{label}"
        guarded_root = load_temporary_plan(
            edit_inset_faces_steps(
                object_name=guarded_name,
                result_mesh_name=f"{guarded_name}.ResultMesh",
            )
        )
        guarded_session = DemoSession(guarded_root, action_registry(guarded_root))
        guarded_session.start()
        assert guarded_session.next() is not None
        guarded_target = bpy.data.objects[guarded_name]
        mutate(guarded_target)
        try:
            guarded_session.next()
        except RuntimeError as error:
            assert "modified" in str(error) or "must not have" in str(error)
        else:
            raise AssertionError(f"Edit Inset must reject a {label} target")
        cleanup(guarded_target)
        assert guarded_session.back() is not None

    mode_name = "OperatingLine.EditInsetGuard.EditMode"
    mode_root = load_temporary_plan(
        edit_inset_faces_steps(
            object_name=mode_name,
            result_mesh_name=f"{mode_name}.ResultMesh",
        )
    )
    mode_session = DemoSession(mode_root, action_registry(mode_root))
    mode_session.start()
    assert mode_session.next() is not None
    mode_target = bpy.data.objects[mode_name]
    bpy.context.view_layer.objects.active = mode_target
    mode_target.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        mode_session.next()
    except RuntimeError as error:
        assert "modified" in str(error) or "Object Mode" in str(error)
    else:
        raise AssertionError("Edit Inset must reject Edit Mode targets")
    bpy.ops.object.mode_set(mode="OBJECT")
    assert mode_session.back() is not None

    invalid_meshes = []
    for name, vertices, faces, expected in (
        ("Empty", [], [], "nonempty"),
        (
            "Open",
            [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (0.0, 1.0, 0.0)],
            [(0, 1, 2)],
            "exactly two adjacent faces",
        ),
        (
            "NonManifold",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1)],
            [(0, 1, 2), (1, 0, 3), (0, 1, 4)],
            "exactly two adjacent faces",
        ),
        (
            "Degenerate",
            [(0, 0, 0), (1, 0, 0), (2, 0, 0), (0, 1, 0)],
            [(0, 1, 2), (0, 3, 1), (1, 3, 2), (2, 3, 0)],
            "finite positive area",
        ),
    ):
        mesh = bpy.data.meshes.new(f"OperatingLine.EditInset.{name}")
        mesh.from_pydata(vertices, [], faces)
        invalid_meshes.append(mesh)
        try:
            _validate_edit_inset_source(mesh)
        except ValueError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"Edit Inset must reject {name} topology")
    for mesh in invalid_meshes:
        bpy.data.meshes.remove(mesh)

    oversized_source = bpy.data.meshes.new("OperatingLine.EditInset.OversizedSource")
    oversized_source.from_pydata(
        [(float(index), 0.0, 0.0) for index in range(8193)], [], []
    )
    try:
        try:
            _validate_edit_inset_source(oversized_source)
        except ValueError as error:
            assert "source exceeds the supported topology limits" in str(error)
        else:
            raise AssertionError("Edit Inset must reject oversized sources")
    finally:
        bpy.data.meshes.remove(oversized_source)

    _ensure_edit_inset_topology_is_bounded((8192, 16384, 8192), "boundary")
    for topology in ((8193, 0, 0), (0, 16385, 0), (0, 0, 8193)):
        try:
            _ensure_edit_inset_topology_is_bounded(topology, "result")
        except ValueError as error:
            assert "supported topology limits" in str(error)
        else:
            raise AssertionError("Edit Inset must reject out-of-bounds topology")

    overflow_name = "OperatingLine.EditInsetOverflow"
    overflow_result_name = f"{overflow_name}.ResultMesh"
    overflow_steps = [
        step("root", None, 0),
        step(
            "edit_inset.torus",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_torus",
                "arguments": {
                    "resourceId": "edit_inset.cube",
                    "objectName": overflow_name,
                    "majorRadius": 2.0,
                    "minorRadius": 0.5,
                    "majorSegments": 65,
                    "minorSegments": 64,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        edit_inset_faces_steps(result_mesh_name=overflow_result_name)[2],
    ]
    overflow_steps[2]["dependsOn"] = ["edit_inset.torus"]
    overflow_root = load_temporary_plan(overflow_steps)
    overflow_session = DemoSession(overflow_root, action_registry(overflow_root))
    overflow_session.start()
    assert overflow_session.next() is not None
    overflow_target = bpy.data.objects[overflow_name]
    overflow_source = overflow_target.data
    try:
        overflow_session.next()
    except ValueError as error:
        assert "result exceeds the supported topology limits" in str(error)
    else:
        raise AssertionError("Edit Inset must reject predicted result overflow")
    assert overflow_target.data is overflow_source
    assert bpy.data.meshes.get(overflow_result_name) is None
    assert "edit_inset.faces" not in overflow_session.receipts
    assert overflow_session.back() is not None

    conflict_root = load_temporary_plan(
        edit_inset_faces_steps(result_mesh_id="edit_inset.cube.mesh")
    )
    try:
        action_registry(conflict_root)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Edit Inset result IDs must be reserved")

    collision_name = "OperatingLine.EditInsetCollision.ResultMesh"
    collision_root = load_temporary_plan(
        edit_inset_faces_steps(
            object_name="OperatingLine.EditInsetCollision",
            result_mesh_name=collision_name,
        )
    )
    collision_session = DemoSession(collision_root, action_registry(collision_root))
    collision_session.start()
    assert collision_session.next() is not None
    collision_source = bpy.data.objects["OperatingLine.EditInsetCollision"].data
    collision = bpy.data.meshes.new(collision_name)
    try:
        try:
            collision_session.next()
        except RuntimeError as error:
            assert "Cannot replace existing mesh" in str(error)
        else:
            raise AssertionError("Edit Inset result names must be unique")
        assert bpy.data.objects["OperatingLine.EditInsetCollision"].data is collision_source
    finally:
        bpy.data.meshes.remove(collision)
    assert collision_session.back() is not None

    def gated_steps(result_mesh_id: str) -> list[dict]:
        result = edit_inset_faces_steps(
            object_name="OperatingLine.EditInsetGateCube",
            result_mesh_name="OperatingLine.EditInsetGateCube.ResultMesh",
        )
        result[2]["expectedObservations"] = [
            {
                "kind": "mesh_faces_inset",
                "parameters": {
                    "targetId": "edit_inset.cube",
                    "resultMeshId": result_mesh_id,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    for result_mesh_id, should_pass in (
        ("edit_inset.cube.result_mesh", True),
        ("edit_inset.cube.wrong_mesh", False),
    ):
        gated_root = load_task_tree_data(
            {
                "protocolVersion": "1.2.0",
                "rootStepId": "root",
                "steps": gated_steps(result_mesh_id),
            }
        )
        gated_session = DemoSession(
            gated_root,
            action_registry(gated_root),
            observation_evaluator=observation_module.evaluate_observations,
        )
        gated_session.start()
        assert gated_session.next() is not None
        gated_target = bpy.data.objects["OperatingLine.EditInsetGateCube"]
        gated_source = gated_target.data
        if should_pass:
            assert gated_session.next() is not None
            assert gated_session.back() is not None
        else:
            try:
                gated_session.next()
            except RuntimeError as error:
                assert "Observation gate failed" in str(error)
            else:
                raise AssertionError("Wrong inset mesh IDs must fail the success gate")
            assert gated_target.data is gated_source
            assert "edit_inset.faces" not in gated_session.receipts
        assert gated_session.back() is not None


def edit_poke_faces_steps(
    *,
    object_name: str = "OperatingLine.EditPokeCube",
    result_mesh_id: str = "edit_poke.cube.result_mesh",
    result_mesh_name: str = "OperatingLine.EditPokeCube.ResultMesh",
    offset: float = 0.1,
) -> list[dict]:
    return [
        step("root", None, 0),
        step(
            "edit_poke.cube",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": "edit_poke.cube",
                    "objectName": object_name,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "edit_poke.faces",
            "root",
            2,
            depends_on=["edit_poke.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_poke_faces",
                "arguments": {
                    "targetId": "edit_poke.cube",
                    "resultMeshId": result_mesh_id,
                    "resultMeshName": result_mesh_name,
                    "offset": offset,
                },
            },
        ),
    ]


def assert_edit_poke_faces_round_trip_and_guards() -> None:
    object_name = "OperatingLine.EditPokeCube"
    result_mesh_name = "OperatingLine.EditPokeCube.ResultMesh"
    root = load_temporary_plan(edit_poke_faces_steps())
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    target = bpy.data.objects[object_name]
    source_mesh = target.data
    source_signature = tuple(tuple(vertex.co) for vertex in source_mesh.vertices)
    assert session.next() is not None
    result_mesh = target.data
    assert result_mesh is not source_mesh
    assert result_mesh.name == result_mesh_name
    assert (
        len(result_mesh.vertices),
        len(result_mesh.edges),
        len(result_mesh.polygons),
    ) == (14, 36, 24)
    assert all(len(face.vertices) == 3 for face in result_mesh.polygons)
    result_coordinates = tuple(
        float(component)
        for vertex in result_mesh.vertices
        for component in vertex.co
    )
    assert math.isclose(min(result_coordinates), -1.1, rel_tol=0.0, abs_tol=1e-6)
    assert math.isclose(max(result_coordinates), 1.1, rel_tol=0.0, abs_tol=1e-6)
    assert tuple(tuple(vertex.co) for vertex in source_mesh.vertices) == source_signature
    receipt = session.receipts["edit_poke.faces"]
    assert receipt.action_name == "blender.mesh.edit_poke_faces"
    assert tuple(mutation.attribute for mutation in receipt.mutations) == (
        "data",
        "mesh_content",
        "mesh_content",
    )
    assert receipt.mutations[1].resource.pointer == source_mesh.as_pointer()
    assert receipt.mutations[1].before == receipt.mutations[1].after

    parameters = {
        "targetId": "edit_poke.cube",
        "resultMeshId": "edit_poke.cube.result_mesh",
    }
    observations = observation_module.evaluate_observations(
        (
            {"kind": "mesh_faces_poked", "parameters": parameters},
            {
                "kind": "mesh_faces_poked",
                "parameters": {**parameters, "unexpected": True},
            },
            {
                "kind": "mesh_faces_poked",
                "parameters": {**parameters, "resultMeshId": "wrong.mesh"},
            },
        ),
        session.receipts,
    )
    assert tuple(item["satisfied"] for item in observations) == (
        True,
        False,
        False,
    ), observations
    assert observations[0]["details"]["sourceLoopCount"] == 24
    assert observations[0]["details"]["allTriangles"] is True

    original_result_vertex = result_mesh.vertices[0].co.copy()
    result_mesh.vertices[0].co.x += 0.25
    assert not observation_module.evaluate_observations(
        ({"kind": "mesh_faces_poked", "parameters": parameters},),
        session.receipts,
    )[0]["satisfied"]
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited poke result meshes must block rollback")
    result_mesh.vertices[0].co = original_result_vertex

    original_source_vertex = source_mesh.vertices[0].co.copy()
    source_mesh.vertices[0].co.x += 0.25
    assert not observation_module.evaluate_observations(
        ({"kind": "mesh_faces_poked", "parameters": parameters},),
        session.receipts,
    )[0]["satisfied"]
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Edited poke source meshes must block rollback")
    source_mesh.vertices[0].co = original_source_vertex
    assert observation_module.evaluate_observations(
        ({"kind": "mesh_faces_poked", "parameters": parameters},),
        session.receipts,
    )[0]["satisfied"]
    assert session.back() is not None
    assert target.data is source_mesh
    assert bpy.data.meshes.get(result_mesh_name) is None
    assert session.back() is not None

    triangle_name = "OperatingLine.EditPokeIcosphere"
    triangle_result_name = f"{triangle_name}.ResultMesh"
    triangle_steps = [
        step("root", None, 0),
        step(
            "edit_poke.triangles",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_icosphere",
                "arguments": {
                    "resourceId": "edit_poke.triangles",
                    "objectName": triangle_name,
                    "subdivisions": 1,
                    "radius": 1.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "edit_poke.triangle_faces",
            "root",
            2,
            depends_on=["edit_poke.triangles"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_poke_faces",
                "arguments": {
                    "targetId": "edit_poke.triangles",
                    "resultMeshId": "edit_poke.triangles.result_mesh",
                    "resultMeshName": triangle_result_name,
                    "offset": 0.05,
                },
            },
        ),
    ]
    triangle_root = load_temporary_plan(triangle_steps)
    triangle_session = DemoSession(triangle_root, action_registry(triangle_root))
    triangle_session.start()
    assert triangle_session.next() is not None
    triangle_target = bpy.data.objects[triangle_name]
    triangle_source = triangle_target.data
    assert triangle_session.next() is not None
    triangle_result = triangle_target.data
    assert (
        len(triangle_result.vertices),
        len(triangle_result.edges),
        len(triangle_result.polygons),
    ) == (32, 90, 60)
    assert all(len(face.vertices) == 3 for face in triangle_result.polygons)
    assert triangle_session.back() is not None
    assert triangle_target.data is triangle_source
    assert triangle_session.back() is not None

    for label, mutate, cleanup in (
        (
            "modifier",
            lambda item: item.modifiers.new("External", "BEVEL"),
            lambda item: item.modifiers.clear(),
        ),
        (
            "shape_key",
            lambda item: item.shape_key_add(name="Basis"),
            lambda item: item.shape_key_clear(),
        ),
    ):
        guarded_name = f"OperatingLine.EditPokeGuard.{label}"
        guarded_root = load_temporary_plan(
            edit_poke_faces_steps(
                object_name=guarded_name,
                result_mesh_name=f"{guarded_name}.ResultMesh",
            )
        )
        guarded_session = DemoSession(guarded_root, action_registry(guarded_root))
        guarded_session.start()
        assert guarded_session.next() is not None
        guarded_target = bpy.data.objects[guarded_name]
        mutate(guarded_target)
        try:
            guarded_session.next()
        except RuntimeError as error:
            assert "modified" in str(error) or "must not have" in str(error)
        else:
            raise AssertionError(f"Edit Poke must reject a {label} target")
        cleanup(guarded_target)
        assert guarded_session.back() is not None

    mode_name = "OperatingLine.EditPokeGuard.EditMode"
    mode_root = load_temporary_plan(
        edit_poke_faces_steps(
            object_name=mode_name,
            result_mesh_name=f"{mode_name}.ResultMesh",
        )
    )
    mode_session = DemoSession(mode_root, action_registry(mode_root))
    mode_session.start()
    assert mode_session.next() is not None
    mode_target = bpy.data.objects[mode_name]
    bpy.context.view_layer.objects.active = mode_target
    mode_target.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        mode_session.next()
    except RuntimeError as error:
        assert "modified" in str(error) or "Object Mode" in str(error)
    else:
        raise AssertionError("Edit Poke must reject Edit Mode targets")
    bpy.ops.object.mode_set(mode="OBJECT")
    assert mode_session.back() is not None

    invalid_meshes = []
    for name, vertices, faces, expected in (
        ("Empty", [], [], "nonempty"),
        (
            "Open",
            [(-1.0, -1.0, 0.0), (1.0, -1.0, 0.0), (0.0, 1.0, 0.0)],
            [(0, 1, 2)],
            "exactly two adjacent faces",
        ),
        (
            "NonManifold",
            [(0, 0, 0), (1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1)],
            [(0, 1, 2), (1, 0, 3), (0, 1, 4)],
            "exactly two adjacent faces",
        ),
        (
            "IsolatedVertex",
            [
                (0, 0, 0),
                (1, 0, 0),
                (0, 1, 0),
                (0, 0, 1),
                (3, 3, 3),
            ],
            [(0, 2, 1), (0, 1, 3), (1, 2, 3), (2, 0, 3)],
            "one manifold face fan",
        ),
        (
            "BowTieVertex",
            [
                (0, 0, 0),
                (1, 0, 0),
                (0, 1, 0),
                (0, 0, 1),
                (-1, 0, 0),
                (0, -1, 0),
                (0, 0, -1),
            ],
            [
                (0, 2, 1),
                (0, 1, 3),
                (1, 2, 3),
                (2, 0, 3),
                (0, 4, 5),
                (0, 6, 4),
                (4, 6, 5),
                (5, 6, 0),
            ],
            "one manifold face fan",
        ),
        (
            "Degenerate",
            [(0, 0, 0), (1, 0, 0), (2, 0, 0), (0, 1, 0)],
            [(0, 1, 2), (0, 3, 1), (1, 3, 2), (2, 3, 0)],
            "finite positive area",
        ),
    ):
        mesh = bpy.data.meshes.new(f"OperatingLine.EditPoke.{name}")
        mesh.from_pydata(vertices, [], faces)
        invalid_meshes.append(mesh)
        try:
            _validate_edit_poke_source(mesh)
        except ValueError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"Edit Poke must reject {name} topology")
    for mesh in invalid_meshes:
        bpy.data.meshes.remove(mesh)

    oversized_source = bpy.data.meshes.new("OperatingLine.EditPoke.OversizedSource")
    oversized_source.from_pydata(
        [(float(index), 0.0, 0.0) for index in range(8193)], [], []
    )
    try:
        try:
            _validate_edit_poke_source(oversized_source)
        except ValueError as error:
            assert "source exceeds the supported topology limits" in str(error)
        else:
            raise AssertionError("Edit Poke must reject oversized sources")
    finally:
        bpy.data.meshes.remove(oversized_source)

    _ensure_edit_poke_topology_is_bounded((8192, 16384, 8192), "boundary")
    for topology in ((8193, 0, 0), (0, 16385, 0), (0, 0, 8193)):
        try:
            _ensure_edit_poke_topology_is_bounded(topology, "result")
        except ValueError as error:
            assert "supported topology limits" in str(error)
        else:
            raise AssertionError("Edit Poke must reject out-of-bounds topology")

    overflow_name = "OperatingLine.EditPokeOverflow"
    overflow_result_name = f"{overflow_name}.ResultMesh"
    overflow_steps = [
        step("root", None, 0),
        step(
            "edit_poke.torus",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_torus",
                "arguments": {
                    "resourceId": "edit_poke.cube",
                    "objectName": overflow_name,
                    "majorRadius": 2.0,
                    "minorRadius": 0.5,
                    "majorSegments": 65,
                    "minorSegments": 64,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        edit_poke_faces_steps(result_mesh_name=overflow_result_name)[2],
    ]
    overflow_steps[2]["dependsOn"] = ["edit_poke.torus"]
    overflow_root = load_temporary_plan(overflow_steps)
    overflow_session = DemoSession(overflow_root, action_registry(overflow_root))
    overflow_session.start()
    assert overflow_session.next() is not None
    overflow_target = bpy.data.objects[overflow_name]
    overflow_source = overflow_target.data
    try:
        overflow_session.next()
    except ValueError as error:
        assert "result exceeds the supported topology limits" in str(error)
    else:
        raise AssertionError("Edit Poke must reject predicted result overflow")
    assert overflow_target.data is overflow_source
    assert bpy.data.meshes.get(overflow_result_name) is None
    assert overflow_session.back() is not None

    conflict_root = load_temporary_plan(
        edit_poke_faces_steps(result_mesh_id="edit_poke.cube.mesh")
    )
    try:
        action_registry(conflict_root)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Edit Poke result IDs must be reserved")

    collision_name = "OperatingLine.EditPokeCollision.ResultMesh"
    collision_root = load_temporary_plan(
        edit_poke_faces_steps(
            object_name="OperatingLine.EditPokeCollision",
            result_mesh_name=collision_name,
        )
    )
    collision_session = DemoSession(collision_root, action_registry(collision_root))
    collision_session.start()
    assert collision_session.next() is not None
    collision_target = bpy.data.objects["OperatingLine.EditPokeCollision"]
    collision_source = collision_target.data
    collision = bpy.data.meshes.new(collision_name)
    try:
        try:
            collision_session.next()
        except RuntimeError as error:
            assert "Cannot replace existing mesh" in str(error)
        else:
            raise AssertionError("Edit Poke result names must be unique")
        assert collision_target.data is collision_source
    finally:
        bpy.data.meshes.remove(collision)
    assert collision_session.back() is not None

    def gated_steps(result_mesh_id: str) -> list[dict]:
        result = edit_poke_faces_steps(
            object_name="OperatingLine.EditPokeGateCube",
            result_mesh_name="OperatingLine.EditPokeGateCube.ResultMesh",
        )
        result[2]["expectedObservations"] = [
            {
                "kind": "mesh_faces_poked",
                "parameters": {
                    "targetId": "edit_poke.cube",
                    "resultMeshId": result_mesh_id,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    for result_mesh_id, should_pass in (
        ("edit_poke.cube.result_mesh", True),
        ("edit_poke.cube.wrong_mesh", False),
    ):
        gated_root = load_task_tree_data(
            {
                "protocolVersion": "1.2.0",
                "rootStepId": "root",
                "steps": gated_steps(result_mesh_id),
            }
        )
        gated_session = DemoSession(
            gated_root,
            action_registry(gated_root),
            observation_evaluator=observation_module.evaluate_observations,
        )
        gated_session.start()
        assert gated_session.next() is not None
        gated_target = bpy.data.objects["OperatingLine.EditPokeGateCube"]
        gated_source = gated_target.data
        if should_pass:
            assert gated_session.next() is not None
            assert gated_session.back() is not None
        else:
            try:
                gated_session.next()
            except RuntimeError as error:
                assert "Observation gate failed" in str(error)
            else:
                raise AssertionError("Wrong poke mesh IDs must fail the success gate")
            assert gated_target.data is gated_source
            assert "edit_poke.faces" not in gated_session.receipts
        assert gated_session.back() is not None


def assert_edit_poke_weighted_center_matches_ui() -> None:
    vertices = [
        (-1.2, -0.8, 0.0),
        (1.4, -0.7, 0.0),
        (1.1, 0.5, 0.0),
        (0.2, 1.3, 0.0),
        (-1.0, 0.7, 0.0),
        (0.15, 0.1, 1.7),
    ]
    faces = [
        (4, 3, 2, 1, 0),
        (0, 1, 5),
        (1, 2, 5),
        (2, 3, 5),
        (3, 4, 5),
        (4, 0, 5),
    ]
    managed_source = bpy.data.meshes.new("OperatingLine.EditPokeAlias.Source")
    managed_source.from_pydata(vertices, [], faces)
    managed_object = bpy.data.objects.new(
        "OperatingLine.EditPokeAlias.Managed", managed_source
    )
    bpy.context.scene.collection.objects.link(managed_object)
    ui_mesh = bpy.data.meshes.new("OperatingLine.EditPokeAlias.UI")
    ui_mesh.from_pydata(vertices, [], faces)
    ui_object = bpy.data.objects.new("OperatingLine.EditPokeAlias.UI", ui_mesh)
    bpy.context.scene.collection.objects.link(ui_object)

    source_receipt_id = "edit-poke-asymmetric-source"
    source_receipt = ActionReceipt(
        source_receipt_id,
        "edit_poke.asymmetric_source",
        "test.create_asymmetric_source",
        created=(
            tag_resource(
                managed_object,
                "edit_poke.asymmetric",
                source_receipt_id,
                "edit_poke.asymmetric_source",
                "test.create_asymmetric_source",
            ),
            tag_resource(
                managed_source,
                "edit_poke.asymmetric.mesh",
                source_receipt_id,
                "edit_poke.asymmetric_source",
                "test.create_asymmetric_source",
            ),
        ),
    )
    root = load_temporary_plan(
        [
            step("root", None, 0),
            step(
                "edit_poke.asymmetric_faces",
                "root",
                1,
                step_action={
                    "adapterId": "blender",
                    "name": "blender.mesh.edit_poke_faces",
                    "arguments": {
                        "targetId": "edit_poke.asymmetric",
                        "resultMeshId": "edit_poke.asymmetric.result_mesh",
                        "resultMeshName": "OperatingLine.EditPokeAlias.Result",
                        "offset": 0.17,
                    },
                },
            ),
        ]
    )
    execute, rollback = action_registry(root)["edit_poke.asymmetric_faces"]
    managed_receipt = None
    try:
        managed_receipt = execute({"edit_poke.asymmetric_source": source_receipt})
        managed_signature = mesh_content_signature(managed_object.data)

        bpy.ops.object.select_all(action="DESELECT")
        ui_object.select_set(True)
        bpy.context.view_layer.objects.active = ui_object
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        assert bpy.ops.mesh.poke(
            offset=0.17,
            use_relative_offset=False,
            center_mode="MEDIAN_WEIGHTED",
        ) == {"FINISHED"}
        bpy.ops.object.mode_set(mode="OBJECT")
        assert mesh_content_signature(ui_mesh) == managed_signature
    finally:
        if ui_object.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        if managed_receipt is not None:
            rollback(managed_receipt)
        bpy.data.objects.remove(ui_object, do_unlink=True)
        bpy.data.meshes.remove(ui_mesh)
        bpy.data.objects.remove(managed_object, do_unlink=True)
        bpy.data.meshes.remove(managed_source)


def assert_editing_argument_boundaries() -> None:
    assert _normalized_squared_vector_length((1e308, 1e308), 1.1e308) > 1.0
    assert _normalized_squared_vector_length((5e-201, 0.0), 1e-200) < 1.0
    triangulate = validate_triangulate(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.triangulated.mesh",
            "resultMeshName": "OperatingLine.TriangulatedMesh",
        }
    )
    assert triangulate.result_mesh_id == "edit.triangulated.mesh"
    extrude = validate_extrude_region(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.extruded.mesh",
            "resultMeshName": "OperatingLine.ExtrudedMesh",
            "polygonIndices": [5, 0],
            "translation": [0.0, 0.0, 0.0001],
        }
    )
    assert extrude.polygon_indices == (0, 5)
    assert extrude.translation == (0.0, 0.0, 0.0001)
    edit_bevel = validate_edit_bevel_edges(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.beveled.mesh",
            "resultMeshName": "OperatingLine.BeveledMesh",
            "width": 0.0001,
            "segments": 16.0,
            "profile": 1.0,
        }
    )
    assert edit_bevel.width == 0.0001
    assert edit_bevel.segments == 16
    assert edit_bevel.profile == 1.0
    edit_inset = validate_edit_inset_faces(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.inset.mesh",
            "resultMeshName": "OperatingLine.InsetMesh",
            "thickness": 0.0001,
            "depth": -100.0,
        }
    )
    assert edit_inset.thickness == 0.0001
    assert edit_inset.depth == -100.0
    assert validate_edit_inset_faces(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.inset.mesh",
            "resultMeshName": "OperatingLine.InsetMesh",
            "thickness": 100.0,
            "depth": 100.0,
        }
    ).depth == 100.0
    edit_poke = validate_edit_poke_faces(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.poked.mesh",
            "resultMeshName": "OperatingLine.PokedMesh",
            "offset": -100.0,
        }
    )
    assert edit_poke.offset == -100.0
    assert validate_edit_poke_faces(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.poked.mesh",
            "resultMeshName": "OperatingLine.PokedMesh",
            "offset": 100.0,
        }
    ).offset == 100.0
    rejected_boundary_translation = [491.34180453259, 870.9668369798349, 0.0]
    try:
        validate_extrude_region(
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.extruded.mesh",
                "resultMeshName": "OperatingLine.ExtrudedMesh",
                "polygonIndices": [0],
                "translation": rejected_boundary_translation,
            }
        )
    except ValueError as error:
        assert (
            "arguments.translation length must be in [0.0001, 1000.0]"
            in str(error)
        )
    else:
        raise AssertionError("Extrude Region must reject a rounded-up squared length")
    accepted_boundary_translation = [999.999985743048, 0.1688606043279722, 0.0]
    assert validate_extrude_region(
        {
            "targetId": "edit.target",
            "resultMeshId": "edit.extruded.mesh",
            "resultMeshName": "OperatingLine.ExtrudedMesh",
            "polygonIndices": [0],
            "translation": accepted_boundary_translation,
        }
    ).translation == tuple(accepted_boundary_translation)
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
    assert validate_solidify(
        {
            "targetId": "edit.target",
            "modifierId": "edit.solidify",
            "modifierName": "OperatingLine.Solidify",
            "thickness": 0.0001,
            "offset": -1.0,
        }
    ).offset == -1.0
    maximum_solidify = validate_solidify(
        {
            "targetId": "edit.target",
            "modifierId": "edit.solidify",
            "modifierName": "OperatingLine.Solidify",
            "thickness": 100.0,
            "offset": 1.0,
        }
    )
    assert maximum_solidify.thickness == 100.0
    assert maximum_solidify.offset == 1.0
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
            validate_edit_poke_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.poked.mesh",
                "resultMeshName": "OperatingLine.PokedMesh",
                "offset": True,
            },
            "arguments.offset",
        ),
        (
            validate_edit_poke_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.poked.mesh",
                "resultMeshName": "OperatingLine.PokedMesh",
                "offset": -100.0001,
            },
            "arguments.offset",
        ),
        (
            validate_edit_poke_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.poked.mesh",
                "resultMeshName": "OperatingLine.PokedMesh",
                "offset": 100.0001,
            },
            "arguments.offset",
        ),
        (
            validate_edit_poke_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.poked.mesh",
                "resultMeshName": "OperatingLine.PokedMesh",
                "offset": float("inf"),
            },
            "arguments.offset",
        ),
        (
            validate_edit_poke_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.poked.mesh",
                "resultMeshName": "OperatingLine.PokedMesh",
                "offset": 0.0,
                "unexpected": True,
            },
            "unsupported fields",
        ),
        (
            validate_edit_inset_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.inset.mesh",
                "resultMeshName": "OperatingLine.InsetMesh",
                "thickness": True,
                "depth": 0.0,
            },
            "arguments.thickness",
        ),
        (
            validate_edit_inset_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.inset.mesh",
                "resultMeshName": "OperatingLine.InsetMesh",
                "thickness": 0.2,
                "depth": False,
            },
            "arguments.depth",
        ),
        (
            validate_edit_inset_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.inset.mesh",
                "resultMeshName": "OperatingLine.InsetMesh",
                "thickness": float("inf"),
                "depth": 0.0,
            },
            "arguments.thickness",
        ),
        (
            validate_edit_inset_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.inset.mesh",
                "resultMeshName": "OperatingLine.InsetMesh",
                "thickness": 0.2,
                "depth": float("nan"),
            },
            "arguments.depth",
        ),
        (
            validate_edit_inset_faces,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.inset.mesh",
                "resultMeshName": "OperatingLine.InsetMesh",
                "thickness": 0.2,
                "depth": 0.0,
                "unexpected": True,
            },
            "unsupported fields",
        ),
        (
            validate_edit_bevel_edges,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.beveled.mesh",
                "resultMeshName": "OperatingLine.BeveledMesh",
                "width": True,
                "segments": 3,
                "profile": 0.5,
            },
            "arguments.width",
        ),
        (
            validate_edit_bevel_edges,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.beveled.mesh",
                "resultMeshName": "OperatingLine.BeveledMesh",
                "width": 0.2,
                "segments": True,
                "profile": 0.5,
            },
            "arguments.segments",
        ),
        (
            validate_edit_bevel_edges,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.beveled.mesh",
                "resultMeshName": "OperatingLine.BeveledMesh",
                "width": 0.2,
                "segments": 3,
                "profile": False,
            },
            "arguments.profile",
        ),
        (
            validate_edit_bevel_edges,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.beveled.mesh",
                "resultMeshName": "OperatingLine.BeveledMesh",
                "width": 0.2,
                "segments": 3,
                "profile": 0.5,
                "unexpected": True,
            },
            "unsupported fields",
        ),
        (
            validate_extrude_region,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.extruded.mesh",
                "resultMeshName": "OperatingLine.ExtrudedMesh",
                "polygonIndices": [0, 0],
                "translation": [0.0, 0.0, 1.0],
            },
            "must not repeat",
        ),
        (
            validate_extrude_region,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.extruded.mesh",
                "resultMeshName": "OperatingLine.ExtrudedMesh",
                "polygonIndices": [0],
                "translation": [0.0, 0.0, 0.0],
            },
            "translation length",
        ),
        (
            validate_triangulate,
            {
                "targetId": "edit.target",
                "resultMeshId": "edit.triangulated.mesh",
                "resultMeshName": "OperatingLine.TriangulatedMesh",
                "unexpected": True,
            },
            "unsupported fields",
        ),
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
            validate_solidify,
            {
                "targetId": "edit.target",
                "modifierId": "edit.solidify",
                "modifierName": "OperatingLine.Solidify",
                "thickness": 0.0,
                "offset": 0.0,
            },
            "arguments.thickness",
        ),
        (
            validate_solidify,
            {
                "targetId": "edit.target",
                "modifierId": "edit.solidify",
                "modifierName": "OperatingLine.Solidify",
                "thickness": 0.1,
                "offset": 1.0001,
            },
            "arguments.offset",
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


def assert_cube_candidate_shortcut_projection_contract() -> None:
    """Probe operator/transform projection, not keyboard events or full UI replay.

    It is not equivalent to managed executor baked mesh/scale output: its mesh
    remains the default two-unit cube and its 1.25 scale is not baked.
    """
    object_name = "OperatingLine.CubeShortcutProjection"
    translation = (-1.0, 2.0, 0.5)
    translation_steps = (
        ((-1.0, 0.0, 0.0), (True, False, False), (-1.0, 0.0, 0.0)),
        ((0.0, 2.0, 0.0), (False, True, False), (-1.0, 2.0, 0.0)),
        ((0.0, 0.0, 0.5), (False, False, True), translation),
    )
    resize_factor = 2.5 / 2.0
    operator_properties = bpy.ops.mesh.primitive_cube_add.get_rna_type().properties
    object_count = len(bpy.data.objects)
    mesh_count = len(bpy.data.meshes)
    collection_count = len(bpy.data.collections)
    selected_before = tuple(bpy.context.selected_objects)
    selected_pointers_before = tuple(item.as_pointer() for item in selected_before)
    active_before = bpy.context.view_layer.objects.active

    assert math.isclose(operator_properties["size"].default, 2.0)
    assert tuple(operator_properties["location"].default_array) == (0.0, 0.0, 0.0)
    assert operator_properties["align"].default == "WORLD"
    assert_absent(object_name)
    cube = None
    mesh = None
    try:
        assert bpy.ops.mesh.primitive_cube_add() == {"FINISHED"}
        cube = bpy.context.active_object
        assert cube is not None and cube.type == "MESH" and cube.mode == "OBJECT"
        assert cube in bpy.context.selected_objects
        mesh = cube.data
        default_mesh_name = mesh.name

        for value, constraint_axis, expected_location in translation_steps:
            assert bpy.ops.transform.translate(
                value=value,
                orient_type="GLOBAL",
                constraint_axis=constraint_axis,
            ) == {"FINISHED"}
            assert tuple(round(component, 6) for component in cube.location) == (
                expected_location
            )
        assert bpy.ops.transform.resize(
            value=(resize_factor,) * 3,
            orient_type="GLOBAL",
        ) == {"FINISHED"}
        cube.name = object_name
        bpy.context.view_layer.update()

        assert bpy.context.view_layer.objects.active is cube
        assert tuple(bpy.context.selected_objects) == (cube,)
        assert cube.name == object_name
        assert tuple(round(value, 6) for value in cube.location) == translation
        assert tuple(round(value, 6) for value in cube.dimensions) == (2.5, 2.5, 2.5)
        assert tuple(round(value, 6) for value in cube.scale) == (
            resize_factor,
            resize_factor,
            resize_factor,
        )
        assert (
            cube.data is mesh and mesh.name == default_mesh_name and mesh.users == 1
        )
        assert isinstance(mesh, bpy.types.Mesh)
        assert bpy.data.meshes.get(default_mesh_name) is mesh
        assert len(cube.users_collection) == 1
        assert (len(mesh.vertices), len(mesh.edges), len(mesh.polygons)) == (8, 12, 6)
        assert all(len(polygon.vertices) == 4 for polygon in mesh.polygons)
        assert {
            tuple(round(component, 6) for component in vertex.co)
            for vertex in mesh.vertices
        } == {
            (x, y, z)
            for x in (-1.0, 1.0)
            for y in (-1.0, 1.0)
            for z in (-1.0, 1.0)
        }
    finally:
        if cube is not None and bpy.data.objects.get(cube.name) is cube:
            bpy.data.objects.remove(cube, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        for selected in bpy.context.selected_objects:
            selected.select_set(False)
        for selected in selected_before:
            if bpy.data.objects.get(selected.name) is selected:
                selected.select_set(True)
        if (
            active_before is None
            or bpy.data.objects.get(active_before.name) is active_before
        ):
            bpy.context.view_layer.objects.active = active_before

    assert_absent(object_name)
    assert len(bpy.data.objects) == object_count
    assert len(bpy.data.meshes) == mesh_count
    assert len(bpy.data.collections) == collection_count
    assert tuple(
        item.as_pointer() for item in bpy.context.selected_objects
    ) == selected_pointers_before
    assert bpy.context.view_layer.objects.active is active_before


def assert_plane_candidate_shortcut_projection_contract() -> None:
    """Probe operator/transform projection, not key events or full UI replay.

    It is not equivalent to managed executor baked scale-one output: its mesh
    remains the default two-unit Plane and its 6.25 scale is not baked.
    """
    object_name = "OperatingLine.GroundPlane"
    translation = (0.0, 0.0, -1.25)
    translation_steps = (
        ((0.0, 0.0, 0.0), (True, False, False), (0.0, 0.0, 0.0)),
        ((0.0, 0.0, 0.0), (False, True, False), (0.0, 0.0, 0.0)),
        ((0.0, 0.0, -1.25), (False, False, True), translation),
    )
    resize_factor = 12.5 / 2.0
    operator_properties = bpy.ops.mesh.primitive_plane_add.get_rna_type().properties
    object_count = len(bpy.data.objects)
    mesh_count = len(bpy.data.meshes)
    collection_count = len(bpy.data.collections)
    selected_before = tuple(bpy.context.selected_objects)
    selected_pointers_before = tuple(item.as_pointer() for item in selected_before)
    active_before = bpy.context.view_layer.objects.active

    assert math.isclose(operator_properties["size"].default, 2.0)
    assert tuple(operator_properties["location"].default_array) == (0.0, 0.0, 0.0)
    assert operator_properties["align"].default == "WORLD"
    assert_absent(object_name)
    plane = None
    mesh = None
    try:
        assert bpy.ops.mesh.primitive_plane_add() == {"FINISHED"}
        plane = bpy.context.active_object
        assert plane is not None and plane.type == "MESH" and plane.mode == "OBJECT"
        assert plane in bpy.context.selected_objects
        mesh = plane.data
        default_mesh_name = mesh.name

        for value, constraint_axis, expected_location in translation_steps:
            assert bpy.ops.transform.translate(
                value=value,
                orient_type="GLOBAL",
                constraint_axis=constraint_axis,
            ) == {"FINISHED"}
            assert tuple(round(component, 6) for component in plane.location) == (
                expected_location
            )
        assert bpy.ops.transform.resize(
            value=(resize_factor,) * 3,
            orient_type="GLOBAL",
        ) == {"FINISHED"}
        plane.name = object_name
        bpy.context.view_layer.update()

        assert bpy.context.view_layer.objects.active is plane
        assert tuple(bpy.context.selected_objects) == (plane,)
        assert plane.name == object_name
        assert tuple(round(value, 6) for value in plane.location) == translation
        assert tuple(round(value, 6) for value in plane.dimensions) == (
            12.5,
            12.5,
            0.0,
        )
        assert tuple(round(value, 6) for value in plane.scale) == (
            resize_factor,
            resize_factor,
            resize_factor,
        )
        assert (
            plane.data is mesh and mesh.name == default_mesh_name and mesh.users == 1
        )
        assert isinstance(mesh, bpy.types.Mesh)
        assert bpy.data.meshes.get(default_mesh_name) is mesh
        assert len(plane.users_collection) == 1
        assert (len(mesh.vertices), len(mesh.edges), len(mesh.polygons)) == (4, 4, 1)
        assert tuple(mesh.polygons[0].vertices) == (0, 1, 3, 2)
        assert {
            tuple(round(component, 6) for component in vertex.co)
            for vertex in mesh.vertices
        } == {
            (-1.0, -1.0, 0.0),
            (-1.0, 1.0, 0.0),
            (1.0, -1.0, 0.0),
            (1.0, 1.0, 0.0),
        }
    finally:
        if plane is not None and bpy.data.objects.get(plane.name) is plane:
            bpy.data.objects.remove(plane, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        for selected in bpy.context.selected_objects:
            selected.select_set(False)
        for selected in selected_before:
            if bpy.data.objects.get(selected.name) is selected:
                selected.select_set(True)
        if (
            active_before is None
            or bpy.data.objects.get(active_before.name) is active_before
        ):
            bpy.context.view_layer.objects.active = active_before

    assert_absent(object_name)
    assert len(bpy.data.objects) == object_count
    assert len(bpy.data.meshes) == mesh_count
    assert len(bpy.data.collections) == collection_count
    assert tuple(
        item.as_pointer() for item in bpy.context.selected_objects
    ) == selected_pointers_before
    assert bpy.context.view_layer.objects.active is active_before


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


def assert_torus_ready_observation() -> None:
    object_name = "OperatingLine.ObservedTorus"
    parameters = {
        "resourceId": "torus.observed",
        "objectName": object_name,
        "majorSegments": 16.0,
        "minorSegments": 8.0,
        "majorRadius": 0.25,
        "minorRadius": 0.75,
        "location": [1.0, -2.0, 3.0],
    }
    torus_step = step(
        "torus.observed.create",
        "root",
        1,
        step_action={
            "adapterId": "blender",
            "name": "blender.mesh.create_torus",
            "arguments": parameters,
        },
    )
    root = load_temporary_plan([step("root", None, 0), torus_step])
    session = DemoSession(root, action_registry(root))

    def observe(
        candidate_parameters=parameters,
        candidate_receipts=None,
    ):
        return observation_module.evaluate_observations(
            (
                {
                    "kind": "torus_ready",
                    "parameters": candidate_parameters,
                },
            ),
            session.receipts if candidate_receipts is None else candidate_receipts,
        )[0]

    session.start()
    assert session.next() is not None
    torus = bpy.data.objects.get(object_name)
    assert torus is not None and torus.type == "MESH"
    successful = observe()
    assert successful["satisfied"] is True
    details = successful["details"]
    assert (
        details["vertexCount"],
        details["edgeCount"],
        details["faceCount"],
    ) == (128, 256, 128)
    assert details["geometryMatches"] is True
    assert "radiusMatches" not in details
    assert "sizeMatches" not in details
    assert details["parameters"] == parameters

    for malformed in (
        {key: value for key, value in parameters.items() if key != "minorRadius"},
        {**parameters, "unexpected": True},
        {**parameters, "majorSegments": True},
        {**parameters, "majorSegments": 16.5},
        {**parameters, "minorRadius": True},
    ):
        assert observe(malformed)["satisfied"] is False

    assert observe({**parameters, "majorRadius": 0.5})["satisfied"] is False
    mesh = torus.data
    original_coordinate = mesh.vertices[0].co.copy()
    mesh.vertices[0].co.x += 0.125
    mesh.update()
    assert observe()["satisfied"] is False
    mesh.vertices[0].co = original_coordinate
    mesh.update()

    original_action_tag = torus["operating_line_action"]
    torus["operating_line_action"] = "blender.mesh.create_uv_sphere"
    assert observe()["satisfied"] is False
    torus["operating_line_action"] = original_action_tag

    receipt = session.receipts["torus.observed.create"]
    mismatched_receipts = {
        **session.receipts,
        "torus.observed.create": replace(
            receipt,
            action_name="blender.mesh.create_uv_sphere",
        ),
    }
    assert observe(candidate_receipts=mismatched_receipts)["satisfied"] is False
    assert observe()["satisfied"] is True

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


def assert_cone_materialized_operator_contract() -> None:
    """Probe the catalog's native operator parameters, not a full UI replay."""
    object_name = "OperatingLine.MaterializedConeContract"
    start = Vector((1.0, 2.0, 3.0))
    end = Vector((4.0, 6.0, 3.0))
    midpoint = (start + end) / 2.0
    direction = end - start
    horizontal = math.hypot(direction.x, direction.y)
    depth = math.hypot(horizontal, direction.z)
    rotation = (
        0.0,
        math.atan2(horizontal, direction.z),
        math.atan2(direction.y, direction.x),
    )
    radius_start = 1.25
    radius_end = 0.25
    object_count = len(bpy.data.objects)
    mesh_count = len(bpy.data.meshes)
    selected_before = tuple(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active

    assert_absent(object_name)
    cone = None
    mesh = None
    try:
        assert bpy.ops.mesh.primitive_cone_add(
            vertices=32,
            radius1=radius_start,
            radius2=radius_end,
            depth=depth,
            end_fill_type="NGON",
            calc_uvs=False,
            enter_editmode=False,
            align="WORLD",
            location=(0.0, 0.0, 0.0),
            rotation=rotation,
            scale=(1.0, 1.0, 1.0),
        ) == {"FINISHED"}
        cone = bpy.context.active_object
        assert cone is not None and cone.type == "MESH" and cone.mode == "OBJECT"
        mesh = cone.data
        cone.name = object_name
        cone.location = midpoint
        bpy.context.view_layer.update()

        assert cone.name == object_name
        assert tuple(round(value, 6) for value in cone.location) == (2.5, 4.0, 3.0)
        assert tuple(round(value, 6) for value in cone.rotation_euler) == tuple(
            round(value, 6) for value in rotation
        )
        assert tuple(round(value, 6) for value in cone.scale) == (1.0, 1.0, 1.0)
        assert len(mesh.uv_layers) == 0
        assert len(mesh.vertices) == 64
        assert sum(len(polygon.vertices) == 32 for polygon in mesh.polygons) == 2
        assert sum(len(polygon.vertices) == 4 for polygon in mesh.polygons) == 32

        local_start = Vector((0.0, 0.0, -depth / 2.0))
        local_end = Vector((0.0, 0.0, depth / 2.0))
        assert (cone.matrix_world @ local_start - start).length <= 1e-5
        assert (cone.matrix_world @ local_end - end).length <= 1e-5

        lower_ring = [
            vertex.co
            for vertex in mesh.vertices
            if math.isclose(vertex.co.z, -depth / 2.0, abs_tol=1e-5)
        ]
        upper_ring = [
            vertex.co
            for vertex in mesh.vertices
            if math.isclose(vertex.co.z, depth / 2.0, abs_tol=1e-5)
        ]
        assert len(lower_ring) == 32
        assert len(upper_ring) == 32
        assert all(
            math.isclose(math.hypot(vertex.x, vertex.y), radius_start, abs_tol=1e-5)
            for vertex in lower_ring
        )
        assert all(
            math.isclose(math.hypot(vertex.x, vertex.y), radius_end, abs_tol=1e-5)
            for vertex in upper_ring
        )
    finally:
        if cone is not None and bpy.data.objects.get(cone.name) is cone:
            bpy.data.objects.remove(cone, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        for selected in bpy.context.selected_objects:
            selected.select_set(False)
        for selected in selected_before:
            if bpy.data.objects.get(selected.name) is selected:
                selected.select_set(True)
        if (
            active_before is None
            or bpy.data.objects.get(active_before.name) is active_before
        ):
            bpy.context.view_layer.objects.active = active_before
    assert_absent(object_name)
    assert len(bpy.data.objects) == object_count
    assert len(bpy.data.meshes) == mesh_count


def assert_cylinder_materialized_operator_contract() -> None:
    """Probe the catalog's native operator parameters, not a full UI replay."""
    object_name = "OperatingLine.MaterializedCylinderContract"
    start = Vector((1.0, 2.0, 3.0))
    end = Vector((4.0, 6.0, 3.0))
    midpoint = (start + end) / 2.0
    direction = end - start
    horizontal = math.hypot(direction.x, direction.y)
    depth = math.hypot(horizontal, direction.z)
    rotation = (
        0.0,
        math.atan2(horizontal, direction.z),
        math.atan2(direction.y, direction.x),
    )
    radius = 0.75
    object_count = len(bpy.data.objects)
    mesh_count = len(bpy.data.meshes)
    selected_before = tuple(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active

    assert_absent(object_name)
    cylinder = None
    mesh = None
    try:
        assert bpy.ops.mesh.primitive_cylinder_add(
            vertices=32,
            radius=radius,
            depth=depth,
            end_fill_type="NGON",
            calc_uvs=False,
            enter_editmode=False,
            align="WORLD",
            location=(0.0, 0.0, 0.0),
            rotation=rotation,
            scale=(1.0, 1.0, 1.0),
        ) == {"FINISHED"}
        cylinder = bpy.context.active_object
        assert cylinder is not None and cylinder.type == "MESH"
        assert cylinder.mode == "OBJECT"
        mesh = cylinder.data
        cylinder.name = object_name
        cylinder.location = midpoint
        bpy.context.view_layer.update()

        assert cylinder.name == object_name
        assert tuple(round(value, 6) for value in cylinder.location) == (
            2.5,
            4.0,
            3.0,
        )
        assert tuple(round(value, 6) for value in cylinder.rotation_euler) == tuple(
            round(value, 6) for value in rotation
        )
        assert tuple(round(value, 6) for value in cylinder.scale) == (1.0, 1.0, 1.0)
        assert len(mesh.uv_layers) == 0
        assert len(mesh.vertices) == 64
        assert sum(len(polygon.vertices) == 32 for polygon in mesh.polygons) == 2
        assert sum(len(polygon.vertices) == 4 for polygon in mesh.polygons) == 32

        local_start = Vector((0.0, 0.0, -depth / 2.0))
        local_end = Vector((0.0, 0.0, depth / 2.0))
        assert (cylinder.matrix_world @ local_start - start).length <= 1e-5
        assert (cylinder.matrix_world @ local_end - end).length <= 1e-5

        lower_ring = [
            vertex.co
            for vertex in mesh.vertices
            if math.isclose(vertex.co.z, -depth / 2.0, abs_tol=1e-5)
        ]
        upper_ring = [
            vertex.co
            for vertex in mesh.vertices
            if math.isclose(vertex.co.z, depth / 2.0, abs_tol=1e-5)
        ]
        assert len(lower_ring) == 32
        assert len(upper_ring) == 32
        assert all(
            math.isclose(math.hypot(vertex.x, vertex.y), radius, abs_tol=1e-5)
            for vertex in lower_ring
        )
        assert all(
            math.isclose(math.hypot(vertex.x, vertex.y), radius, abs_tol=1e-5)
            for vertex in upper_ring
        )
    finally:
        if cylinder is not None and bpy.data.objects.get(cylinder.name) is cylinder:
            bpy.data.objects.remove(cylinder, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
        for selected in bpy.context.selected_objects:
            selected.select_set(False)
        for selected in selected_before:
            if bpy.data.objects.get(selected.name) is selected:
                selected.select_set(True)
        if (
            active_before is None
            or bpy.data.objects.get(active_before.name) is active_before
        ):
            bpy.context.view_layer.objects.active = active_before
    assert_absent(object_name)
    assert len(bpy.data.objects) == object_count
    assert len(bpy.data.meshes) == mesh_count
    assert tuple(bpy.context.selected_objects) == selected_before
    assert bpy.context.view_layer.objects.active is active_before


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
    delivery_transport._session_snapshot = CompanionSessionSnapshot(
        lease_id=str(uuid.uuid4()),
        negotiated_guide_protocol_version="1.1.0",
        heartbeat_interval_seconds=60.0,
        expires_at="2099-01-01T00:00:00Z",
        next_heartbeat_at=time.monotonic() + 60.0,
        heartbeat_sequence=0,
    )
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
    companion_sessions: list[dict] = []
    companion_heartbeats: list[dict] = []
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
            if parsed_path.path == "/api/v1/companion/guide":
                assert self.headers.get("x-operatingline-companion-lease") is not None
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
            request_path = urlsplit(self.path).path
            if request_path == "/api/v1/companion/session":
                companion_sessions.append(payload)
                self._reply(
                    {
                        "contractVersion": "1.0.0",
                        "leaseId": str(uuid.uuid4()),
                        "negotiatedGuideProtocolVersion": "1.1.0",
                        "catalogVersion": ACTION_CATALOG["catalogVersion"],
                        "capabilities": payload["capabilities"],
                        "heartbeatIntervalMs": 100,
                        "leaseTtlMs": 1000,
                        "expiresAt": "2099-01-01T00:00:00Z",
                    }
                )
                return
            if request_path == "/api/v1/companion/heartbeat":
                companion_heartbeats.append(payload)
                self._reply(
                    {
                        "contractVersion": "1.0.0",
                        "leaseId": payload["leaseId"],
                        "sequence": payload["sequence"],
                        "expiresAt": "2099-01-01T00:00:00Z",
                    }
                )
                return
            if request_path == "/api/v1/companion/state":
                assert self.headers.get("x-operatingline-companion-lease") is not None
            if request_path == "/api/v1/companion/goal-request":
                goal_requests.append(payload)
                self._reply(
                    {
                        "result": "accepted",
                        "requestId": payload["requestId"],
                    }
                )
                return
            if request_path == "/api/v1/companion/revision-request":
                revision_requests.append(payload)
                self._reply(
                    {
                        "result": "accepted",
                        "requestId": payload["requestId"],
                    }
                )
                return
            if request_path == "/api/v1/companion/replan-run":
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
            if request_path == "/api/v1/companion/proposal-decision":
                assert (
                    self.headers.get("x-operatingline-companion-lease")
                    is not None
                )
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
        companion.status = "Connecting"
        transport.start()
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
        assert companion_sessions
        assert companion_sessions[0] == {
            "contractVersion": "1.0.0",
            "adapterId": "blender",
            "instanceId": companion.instance_id,
            "companionVersion": "0.1.0",
            "hostVersion": "unknown",
            "supportedGuideProtocolVersions": sorted(SUPPORTED_PROTOCOL_VERSIONS),
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "capabilities": {
                "presentation": {
                    "taskTree": "native",
                    "viewportOverlay": "native",
                    "interactiveAnchors": "emulated",
                },
                "execution": {
                    "inspect": "native",
                    "invokeActions": "native",
                    "screenshot": "native",
                    "rollbackModes": ["compensating_action", "native_undo"],
                },
                "runtime": {
                    "dispatch": "main_thread_serial",
                    "network": "native",
                    "persistentProjectState": "native",
                },
            },
        }
        heartbeat_deadline = time.monotonic() + 1.0
        while time.monotonic() < heartbeat_deadline and not companion_heartbeats:
            time.sleep(0.01)
        assert companion_heartbeats
        assert companion_heartbeats[0]["adapterId"] == "blender"
        assert companion_heartbeats[0]["instanceId"] == companion.instance_id
        assert companion_heartbeats[0]["sequence"] == 1
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
            session_snapshot = FAKE_SESSION_VIEW

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
            session_snapshot = FAKE_SESSION_VIEW

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
            session_snapshot = FAKE_SESSION_VIEW

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
        expected_report_fields = {
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
            "error",
            "occurredAt",
        }
        if report["protocolVersion"] in {"1.2.0", "1.3.0", "1.4.0", "1.5.0"}:
            expected_report_fields.add("observationGate")
        if report["protocolVersion"] == "1.5.0":
            expected_report_fields.add("artifactAttestation")
        assert set(report) == expected_report_fields
        uuid.UUID(report["reportId"])
        assert report["plan"] == {
            "id": "live-snowman",
            "revision": DYNAMIC_REVISION,
        }
        assert isinstance(report["planContentSha256"], str)
        assert len(report["planContentSha256"]) == 64
        assert report["executionId"] is None
        assert report["phase"] == "ready" and report["error"] is None
        assert report.get("artifactAttestation") is None

        # A stale/unknown acknowledgement is an error and cannot advance the
        # delivery watermark. Once accepted, the same pending report flushes
        # after a fresh session is negotiated while the transport is running.
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
        recovery_deadline = time.monotonic() + 3.0
        while (
            time.monotonic() < recovery_deadline
            and rejected_transport.last_delivered_sequence != 99
        ):
            time.sleep(0.01)
        assert rejected_transport.last_delivered_sequence == 99
        rejected_transport.stop()
        assert rejected_transport.wait_stopped(2.0)

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
        session_snapshot = FAKE_SESSION_VIEW

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

    class AtomicSessionView:
        negotiated_guide_protocol_version = "1.4.0"

    class InterleavingTransport:
        running = True

        def __init__(self):
            self.snapshot_reads = 0
            self.reports = []

        @property
        def session_snapshot(self):
            self.snapshot_reads += 1
            if self.snapshot_reads > 1:
                raise AssertionError("Controller reread a mutable session view")
            return AtomicSessionView()

        def send_report(self, report):
            self.reports.append(report)

    atomic_controller = CompanionController()
    atomic_transport = InterleavingTransport()
    atomic_controller._transport = atomic_transport
    atomic_controller.report("connected")
    assert atomic_transport.snapshot_reads == 1
    assert atomic_transport.reports[-1]["protocolVersion"] == "1.4.0"

    class IdentityGuardTransport:
        def __init__(self):
            self.incoming = Queue()
            self.running = False
            self.session_snapshot = None
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
        session_snapshot = FAKE_SESSION_VIEW

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
        session_snapshot = FAKE_SESSION_VIEW

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


def assert_mirror_round_trip_and_guards() -> None:
    base_arguments = {
        "targetId": "mirror.cube",
        "modifierId": "mirror.cube.modifier",
        "modifierName": "OperatingLine.MirrorCube.Mirror",
        "axis": "X",
    }
    assert validate_mirror(base_arguments).axis == "X"
    for malformed in (
        {key: value for key, value in base_arguments.items() if key != "axis"},
        {**base_arguments, "axis": "XY"},
        {**base_arguments, "axis": 0},
        {**base_arguments, "extra": True},
        {**base_arguments, "modifierName": "Unmanaged.Mirror"},
    ):
        try:
            validate_mirror(malformed)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Malformed Mirror args accepted: {malformed}")

    guard_mesh = bpy.data.meshes.new("OperatingLine.MirrorDirectGuard.Mesh")
    guard_mesh.from_pydata(
        [(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        [],
        [(0, 1, 2)],
    )
    guard_mesh.update()
    direct_guard = bpy.data.objects.new(
        "OperatingLine.MirrorDirectGuard", guard_mesh
    )
    bpy.context.scene.collection.objects.link(direct_guard)
    try:
        direct_guard.shape_key_add(name="Basis")
        try:
            _ensure_mirror_input_is_bounded({}, direct_guard)
        except RuntimeError as error:
            assert "shape keys" in str(error)
        else:
            raise AssertionError("Mirror must reject shape keys")
        direct_guard.shape_key_clear()
        bpy.context.view_layer.objects.active = direct_guard
        direct_guard.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        try:
            _ensure_mirror_input_is_bounded({}, direct_guard)
        except RuntimeError as error:
            assert "Object Mode" in str(error)
        else:
            raise AssertionError("Mirror must reject Edit Mode targets")
        bpy.ops.object.mode_set(mode="OBJECT")
        direct_guard.data.vertices[0].co.x = float("nan")
        direct_guard.data.update()
        try:
            _ensure_mirror_input_is_bounded({}, direct_guard)
        except ValueError as error:
            assert "finite" in str(error)
        else:
            raise AssertionError("Mirror must reject non-finite source geometry")
        direct_guard.data.vertices[0].co.x = 0.0
        direct_guard.data.update()
        direct_guard.data.clear_geometry()
        direct_guard.data.update()
        try:
            _ensure_mirror_input_is_bounded({}, direct_guard)
        except ValueError as error:
            assert "nonempty" in str(error)
        else:
            raise AssertionError("Mirror must reject empty source geometry")
    finally:
        if direct_guard.mode != "OBJECT":
            bpy.context.view_layer.objects.active = direct_guard
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.data.objects.remove(direct_guard, do_unlink=True)
        if guard_mesh.users == 0:
            bpy.data.meshes.remove(guard_mesh)

    def plan_steps(
        *,
        axis: str = "X",
        object_name: str = "OperatingLine.MirrorCube",
        arguments: dict | None = None,
    ) -> list[dict]:
        mirror_arguments = {
            **base_arguments,
            "axis": axis,
            "modifierName": f"{object_name}.Mirror",
        }
        return [
            step("root", None, 0),
            step(
                "mirror.cube",
                "root",
                1,
                step_action={
                    "adapterId": "blender",
                    "name": "blender.mesh.create_cube",
                    "arguments": {
                        "resourceId": "mirror.cube",
                        "objectName": object_name,
                        "size": 2.0,
                        "location": [0.0, 0.0, 0.0],
                    },
                },
            ),
            step(
                "mirror.modifier",
                "root",
                2,
                depends_on=["mirror.cube"],
                step_action={
                    "adapterId": "blender",
                    "name": "blender.modifier.add_mirror",
                    "arguments": arguments or mirror_arguments,
                },
            ),
        ]

    for axis_index, axis in enumerate(("X", "Y", "Z")):
        object_name = f"OperatingLine.Mirror{axis}Cube"
        root = load_temporary_plan(plan_steps(axis=axis, object_name=object_name))
        session = DemoSession(root, action_registry(root))
        session.start()
        assert session.next() is not None
        target = bpy.data.objects[object_name]
        source_mesh = target.data
        mesh_count = len(bpy.data.meshes)
        source_signature = mesh_content_signature(source_mesh)
        assert session.next() is not None
        modifier = target.modifiers[f"{object_name}.Mirror"]
        assert modifier.type == "MIRROR"
        assert tuple(modifier.use_axis) == tuple(
            index == axis_index for index in range(3)
        )
        assert tuple(modifier.use_bisect_axis) == (False, False, False)
        assert tuple(modifier.use_bisect_flip_axis) == (False, False, False)
        assert modifier.use_clip is False
        assert modifier.use_mirror_merge is True
        assert math.isclose(modifier.merge_threshold, 0.001, abs_tol=1e-9)
        assert math.isclose(modifier.bisect_threshold, 0.001, abs_tol=1e-9)
        assert modifier.mirror_object is None
        assert modifier.use_mirror_vertex_groups is True
        assert modifier.use_mirror_u is False
        assert modifier.use_mirror_v is False
        assert modifier.use_mirror_udim is False
        assert math.isclose(modifier.offset_u, 0.0, abs_tol=1e-9)
        assert math.isclose(modifier.offset_v, 0.0, abs_tol=1e-9)
        assert math.isclose(modifier.mirror_offset_u, 0.0, abs_tol=1e-9)
        assert math.isclose(modifier.mirror_offset_v, 0.0, abs_tol=1e-9)
        assert modifier.show_viewport is True
        assert modifier.show_render is True
        assert modifier.show_in_editmode is True
        assert modifier.show_on_cage is False
        if hasattr(modifier, "use_apply_on_spline"):
            assert modifier.use_apply_on_spline is False
        assert target.data is source_mesh
        assert mesh_content_signature(source_mesh) == source_signature
        assert len(bpy.data.meshes) == mesh_count
        evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
        evaluated_mesh = evaluated.to_mesh()
        try:
            assert (
                len(evaluated_mesh.vertices),
                len(evaluated_mesh.edges),
                len(evaluated_mesh.polygons),
            ) == (16, 24, 12)
        finally:
            evaluated.to_mesh_clear()
        observation_parameters = {
            "targetId": "mirror.cube",
            "modifierId": "mirror.cube.modifier",
            "modifierType": "MIRROR",
            "axis": axis,
        }
        observation = observation_module.evaluate_observations(
            ({"kind": "modifier_ready", "parameters": observation_parameters},),
            session.receipts,
        )[0]
        assert observation["satisfied"] is True
        details = observation["details"]
        assert details["axis"] == axis
        assert details["expectedAxis"] == axis
        assert details["mirrorFixedStateMatches"] is True
        assert details["mirrorObjectAbsent"] is True
        assert details["sourceContentIntact"] is True
        assert details["evaluatedWithinLimits"] is True
        assert (
            details["evaluatedVertexCount"],
            details["evaluatedEdgeCount"],
            details["evaluatedFaceCount"],
        ) == (16, 24, 12)
        for field, wrong_value in (("axis", "Q"), ("unexpected", True)):
            malformed = observation_module.evaluate_observations(
                (
                    {
                        "kind": "modifier_ready",
                        "parameters": {
                            **observation_parameters,
                            field: wrong_value,
                        },
                    },
                ),
                session.receipts,
            )[0]
            assert malformed["satisfied"] is False, field

        if axis == "X":
            fixed_state_tampering = (
                ("use_axis", (True, True, False)),
                ("use_mirror_merge", False),
                ("merge_threshold", 0.002),
                ("bisect_threshold", 0.002),
                ("show_viewport", False),
                ("use_mirror_udim", True),
                ("offset_u", 0.25),
                ("offset_v", -0.25),
            )
            for property_name, tampered_value in fixed_state_tampering:
                original_value = getattr(modifier, property_name)
                if property_name == "use_axis":
                    original_value = tuple(original_value)
                setattr(modifier, property_name, tampered_value)
                tampered_observation = observation_module.evaluate_observations(
                    (
                        {
                            "kind": "modifier_ready",
                            "parameters": observation_parameters,
                        },
                    ),
                    session.receipts,
                )[0]
                assert tampered_observation["satisfied"] is False, property_name
                if property_name == "use_axis":
                    assert tampered_observation["details"]["axis"] is None
                setattr(modifier, property_name, original_value)

            mirror_reference_mesh = bpy.data.meshes.new(
                "OperatingLine.MirrorReference.Mesh"
            )
            mirror_reference = bpy.data.objects.new(
                "OperatingLine.MirrorReference", mirror_reference_mesh
            )
            bpy.context.scene.collection.objects.link(mirror_reference)
            modifier.mirror_object = mirror_reference
            mirror_object_observation = observation_module.evaluate_observations(
                ({"kind": "modifier_ready", "parameters": observation_parameters},),
                session.receipts,
            )[0]
            assert mirror_object_observation["satisfied"] is False
            assert mirror_object_observation["details"]["mirrorObjectAbsent"] is False
            modifier.mirror_object = None
            bpy.data.objects.remove(mirror_reference, do_unlink=True)
            if mirror_reference_mesh.users == 0:
                bpy.data.meshes.remove(mirror_reference_mesh)

            modifier.use_clip = True
            assert observation_module.evaluate_observations(
                ({"kind": "modifier_ready", "parameters": observation_parameters},),
                session.receipts,
            )[0]["satisfied"] is False
            try:
                session.back()
            except RuntimeError as error:
                assert "Cannot rollback modified resource" in str(error)
            else:
                raise AssertionError("Tampered Mirror modifier must block Back")
            modifier.use_clip = False

            relinked_mesh = source_mesh.copy()
            relinked_mesh.name = "OperatingLine.MirrorRelinked.Mesh"
            target.data = relinked_mesh
            relinked_observation = observation_module.evaluate_observations(
                ({"kind": "modifier_ready", "parameters": observation_parameters},),
                session.receipts,
            )[0]
            assert relinked_observation["satisfied"] is False
            assert relinked_observation["details"]["sourceContentIntact"] is False
            try:
                session.back()
            except RuntimeError as error:
                assert "Cannot rollback modified resource" in str(error)
            else:
                raise AssertionError("Relinked Mirror source must block Back")
            target.data = source_mesh
            if relinked_mesh.users == 0:
                bpy.data.meshes.remove(relinked_mesh)

            original_coordinate = source_mesh.vertices[0].co.copy()
            source_mesh.vertices[0].co.x += 0.125
            source_mesh.update()
            assert observation_module.evaluate_observations(
                ({"kind": "modifier_ready", "parameters": observation_parameters},),
                session.receipts,
            )[0]["satisfied"] is False
            try:
                session.back()
            except RuntimeError as error:
                assert "Cannot rollback modified resource" in str(error)
            else:
                raise AssertionError("Tampered Mirror source must block Back")
            source_mesh.vertices[0].co = original_coordinate
            source_mesh.update()
        assert session.back() is not None
        assert target.modifiers.get(f"{object_name}.Mirror") is None
        assert session.back() is not None
        assert bpy.data.objects.get(object_name) is None

    tracked_name = "OperatingLine.MirrorTrackedCube"
    tracked_steps = plan_steps(axis="Y", object_name=tracked_name)
    tracked_steps.insert(
        2,
        step(
            "mirror.bevel",
            "root",
            2,
            depends_on=["mirror.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "mirror.cube",
                    "modifierId": "mirror.cube.bevel",
                    "modifierName": f"{tracked_name}.Bevel",
                    "width": 0.05,
                    "segments": 1,
                    "angleLimit": 0.5,
                },
            },
        ),
    )
    tracked_steps[3]["order"] = 3
    tracked_steps[3]["dependsOn"] = ["mirror.bevel"]
    tracked_root = load_temporary_plan(tracked_steps)
    tracked_session = DemoSession(tracked_root, action_registry(tracked_root))
    tracked_session.start()
    assert tracked_session.next() is not None
    assert tracked_session.next() is not None
    assert tracked_session.next() is not None
    tracked_target = bpy.data.objects[tracked_name]
    assert tuple(item.type for item in tracked_target.modifiers) == ("BEVEL", "MIRROR")
    assert tracked_session.back() is not None
    assert tracked_session.back() is not None
    assert tracked_session.back() is not None

    duplicate_id_steps = plan_steps()
    duplicate_id_steps.insert(
        2,
        step(
            "mirror.bevel",
            "root",
            2,
            depends_on=["mirror.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "mirror.cube",
                    "modifierId": "mirror.cube.modifier",
                    "modifierName": "OperatingLine.MirrorCube.Bevel",
                    "width": 0.05,
                    "segments": 1,
                    "angleLimit": 0.5,
                },
            },
        ),
    )
    duplicate_id_steps[3]["order"] = 3
    duplicate_id_steps[3]["dependsOn"] = ["mirror.bevel"]
    try:
        action_registry(load_temporary_plan(duplicate_id_steps))
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Duplicate Mirror modifier IDs must be rejected")

    duplicate_name_steps = plan_steps()
    duplicate_name_steps.insert(
        2,
        step(
            "mirror.same_name_bevel",
            "root",
            2,
            depends_on=["mirror.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "mirror.cube",
                    "modifierId": "mirror.cube.bevel",
                    "modifierName": "OperatingLine.MirrorCube.Mirror",
                    "width": 0.05,
                    "segments": 1,
                    "angleLimit": 0.5,
                },
            },
        ),
    )
    duplicate_name_steps[3]["order"] = 3
    duplicate_name_steps[3]["dependsOn"] = ["mirror.same_name_bevel"]
    duplicate_name_root = load_temporary_plan(duplicate_name_steps)
    duplicate_name_session = DemoSession(
        duplicate_name_root, action_registry(duplicate_name_root)
    )
    duplicate_name_session.start()
    assert duplicate_name_session.next() is not None
    assert duplicate_name_session.next() is not None
    try:
        duplicate_name_session.next()
    except RuntimeError as error:
        assert "Cannot replace existing modifier" in str(error)
    else:
        raise AssertionError("Duplicate Mirror modifier names must be rejected")
    assert duplicate_name_session.back() is not None
    assert duplicate_name_session.back() is not None

    existing_mirror_steps = plan_steps()
    existing_mirror_steps.append(
        step(
            "mirror.second",
            "root",
            3,
            depends_on=["mirror.modifier"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_mirror",
                "arguments": {
                    **base_arguments,
                    "modifierId": "mirror.cube.second_modifier",
                    "modifierName": "OperatingLine.MirrorCube.SecondMirror",
                    "axis": "Z",
                },
            },
        )
    )
    existing_mirror_root = load_temporary_plan(existing_mirror_steps)
    existing_mirror_session = DemoSession(
        existing_mirror_root, action_registry(existing_mirror_root)
    )
    existing_mirror_session.start()
    assert existing_mirror_session.next() is not None
    assert existing_mirror_session.next() is not None
    try:
        existing_mirror_session.next()
    except RuntimeError as error:
        assert "already has a MIRROR" in str(error)
    else:
        raise AssertionError("A second tracked MIRROR must be rejected")
    assert existing_mirror_session.back() is not None
    assert existing_mirror_session.back() is not None

    overflow_name = "OperatingLine.MirrorOverflowTorus"
    overflow_steps = [
        step("root", None, 0),
        step(
            "mirror.overflow",
            "root",
            1,
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.create_torus",
                "arguments": {
                    "resourceId": "mirror.overflow",
                    "objectName": overflow_name,
                    "majorSegments": 128,
                    "minorSegments": 64,
                    "majorRadius": 2.0,
                    "minorRadius": 0.5,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        step(
            "mirror.overflow.modifier",
            "root",
            2,
            depends_on=["mirror.overflow"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_mirror",
                "arguments": {
                    "targetId": "mirror.overflow",
                    "modifierId": "mirror.overflow.modifier",
                    "modifierName": f"{overflow_name}.Mirror",
                    "axis": "Z",
                },
            },
        ),
    ]
    overflow_root = load_temporary_plan(overflow_steps)
    overflow_session = DemoSession(overflow_root, action_registry(overflow_root))
    overflow_session.start()
    assert overflow_session.next() is not None
    try:
        overflow_session.next()
    except ValueError as error:
        assert "projected output" in str(error)
    else:
        raise AssertionError("Mirror projected topology overflow must be rejected")
    assert bpy.data.objects[overflow_name].modifiers.get(
        f"{overflow_name}.Mirror"
    ) is None
    assert overflow_session.back() is not None

    guard_root = load_temporary_plan(plan_steps())
    guard_session = DemoSession(guard_root, action_registry(guard_root))
    guard_session.start()
    assert guard_session.next() is not None
    guard_target = bpy.data.objects["OperatingLine.MirrorCube"]
    external = guard_target.modifiers.new("OperatingLine.External", "BEVEL")
    try:
        guard_session.next()
    except RuntimeError as error:
        assert "untracked existing modifiers" in str(error)
    else:
        raise AssertionError("Mirror must reject untracked predecessor modifiers")
    guard_target.modifiers.remove(external)
    assert guard_session.back() is not None

    def gated_steps(axis: str) -> list[dict]:
        result = plan_steps()
        result[2]["expectedObservations"] = [
            {
                "kind": "modifier_ready",
                "parameters": {
                    "targetId": "mirror.cube",
                    "modifierId": "mirror.cube.modifier",
                    "modifierType": "MIRROR",
                    "axis": axis,
                },
            }
        ]
        result[2]["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
        }
        return result

    passing_root = load_task_tree_data(
        {"protocolVersion": "1.2.0", "rootStepId": "root", "steps": gated_steps("X")}
    )
    passing_session = DemoSession(
        passing_root,
        action_registry(passing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    passing_session.start()
    assert passing_session.next() is not None
    assert passing_session.next() is not None
    assert passing_session.back() is not None
    assert passing_session.back() is not None

    failing_root = load_task_tree_data(
        {"protocolVersion": "1.2.0", "rootStepId": "root", "steps": gated_steps("Y")}
    )
    failing_session = DemoSession(
        failing_root,
        action_registry(failing_root),
        observation_evaluator=observation_module.evaluate_observations,
    )
    failing_session.start()
    assert failing_session.next() is not None
    source_mesh = bpy.data.objects["OperatingLine.MirrorCube"].data
    try:
        failing_session.next()
    except RuntimeError as error:
        assert "Observation gate failed" in str(error)
    else:
        raise AssertionError("Wrong Mirror axis must fail the success gate")
    assert failing_session.active_index == 0
    assert bpy.data.objects["OperatingLine.MirrorCube"].data is source_mesh
    assert len(bpy.data.objects["OperatingLine.MirrorCube"].modifiers) == 0
    assert failing_session.back() is not None


def assert_subdivision_surface_round_trip_and_guards() -> None:
    object_name = "OperatingLine.SubdivisionSurfaceCube"
    modifier_name = f"{object_name}.SubdivisionSurface"
    arguments = {
        "targetId": "subsurf.cube",
        "modifierId": "subsurf.cube.modifier",
        "modifierName": modifier_name,
        "viewportLevel": 2,
    }

    def plan_steps(action_arguments: dict | None = None) -> list[dict]:
        return [
            step("root", None, 0),
            step(
                "subsurf.cube",
                "root",
                1,
                step_action={
                    "adapterId": "blender",
                    "name": "blender.mesh.create_cube",
                    "arguments": {
                        "resourceId": "subsurf.cube",
                        "objectName": object_name,
                        "size": 2.0,
                        "location": [0.0, 0.0, 0.0],
                    },
                },
            ),
            step(
                "subsurf.modifier",
                "root",
                2,
                depends_on=["subsurf.cube"],
                step_action={
                    "adapterId": "blender",
                    "name": "blender.modifier.add_subdivision_surface",
                    "arguments": action_arguments or arguments,
                },
            ),
        ]

    for malformed in (
        {key: value for key, value in arguments.items() if key != "viewportLevel"},
        {**arguments, "viewportLevel": True},
        {**arguments, "viewportLevel": 0},
        {**arguments, "viewportLevel": 4},
        {**arguments, "extra": 1},
        {**arguments, "modifierName": "Unmanaged.SubdivisionSurface"},
    ):
        malformed_root = load_temporary_plan(plan_steps(malformed))
        try:
            action_registry(malformed_root)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Malformed Subdivision Surface args accepted: {malformed}")

    duplicate_id_steps = plan_steps()
    duplicate_id_steps.insert(
        2,
        step(
            "subsurf.bevel",
            "root",
            2,
            depends_on=["subsurf.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "subsurf.cube",
                    "modifierId": "subsurf.cube.modifier",
                    "modifierName": f"{object_name}.Bevel",
                    "width": 0.05,
                    "segments": 1,
                    "angleLimit": 0.5,
                },
            },
        ),
    )
    duplicate_id_steps[3]["order"] = 3
    duplicate_id_steps[3]["dependsOn"] = ["subsurf.bevel"]
    try:
        action_registry(load_temporary_plan(duplicate_id_steps))
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Duplicate planned SUBSURF logical IDs must be rejected")

    root = load_temporary_plan(plan_steps())
    session = DemoSession(root, action_registry(root))
    session.start()
    assert session.next() is not None
    cube = bpy.data.objects[object_name]
    source_mesh = cube.data
    source_topology = (
        len(source_mesh.vertices),
        len(source_mesh.edges),
        len(source_mesh.polygons),
    )
    assert source_topology == (8, 12, 6)
    assert session.next() is not None
    modifier = cube.modifiers[modifier_name]
    assert modifier.type == "SUBSURF"
    assert modifier.subdivision_type == "CATMULL_CLARK"
    assert modifier.levels == modifier.render_levels == 2
    assert modifier.quality == 3
    assert modifier.show_only_control_edges is True
    assert modifier.use_creases is True
    assert modifier.use_limit_surface is True
    assert modifier.boundary_smooth == "ALL"
    assert modifier.uv_smooth == "PRESERVE_BOUNDARIES"
    assert modifier.use_custom_normals is False
    assert modifier.show_viewport is True
    assert modifier.show_render is True
    assert modifier.show_in_editmode is True
    assert modifier.show_on_cage is False
    assert cube.data is source_mesh
    assert (
        len(source_mesh.vertices),
        len(source_mesh.edges),
        len(source_mesh.polygons),
    ) == source_topology
    evaluated = cube.evaluated_get(bpy.context.evaluated_depsgraph_get())
    evaluated_mesh = evaluated.to_mesh()
    try:
        assert (
            len(evaluated_mesh.vertices),
            len(evaluated_mesh.edges),
            len(evaluated_mesh.polygons),
        ) == (98, 192, 96)
    finally:
        evaluated.to_mesh_clear()

    observation_parameters = {
        "targetId": "subsurf.cube",
        "modifierId": "subsurf.cube.modifier",
        "modifierType": "SUBSURF",
        "levels": 2,
        "renderLevels": 2,
        "subdivisionType": "CATMULL_CLARK",
        "quality": 3,
        "showOnlyControlEdges": True,
        "useCreases": True,
        "useLimitSurface": True,
        "boundarySmooth": "ALL",
        "uvSmooth": "PRESERVE_BOUNDARIES",
        "useCustomNormals": False,
        "showViewport": True,
        "showRender": True,
        "showInEditMode": True,
        "showOnCage": False,
    }
    observation = observation_module.evaluate_observations(
        ({"kind": "modifier_ready", "parameters": observation_parameters},),
        session.receipts,
    )
    assert observation[0]["satisfied"] is True
    for field, wrong_value in (
        ("levels", True),
        ("renderLevels", 1),
        ("subdivisionType", "SIMPLE"),
        ("quality", 2),
        ("showOnlyControlEdges", False),
        ("useCreases", False),
        ("useLimitSurface", False),
        ("boundarySmooth", "PRESERVE_CORNERS"),
        ("uvSmooth", "NONE"),
        ("useCustomNormals", True),
        ("showViewport", False),
        ("showRender", False),
        ("showInEditMode", False),
        ("showOnCage", True),
        ("unexpected", True),
    ):
        malformed_observation = observation_module.evaluate_observations(
            (
                {
                    "kind": "modifier_ready",
                    "parameters": {**observation_parameters, field: wrong_value},
                },
            ),
            session.receipts,
        )
        assert malformed_observation[0]["satisfied"] is False, field

    modifier.levels = 1
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Externally edited SUBSURF modifiers must block rollback")
    assert session.active_index == 1
    modifier.levels = 2
    assert session.back() is not None
    assert cube.modifiers.get(modifier_name) is None
    assert session.back() is not None
    assert bpy.data.objects.get(object_name) is None

    duplicate_steps = plan_steps()
    duplicate_steps.append(
        step(
            "subsurf.duplicate",
            "root",
            3,
            depends_on=["subsurf.modifier"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_subdivision_surface",
                "arguments": {
                    **arguments,
                    "modifierId": "subsurf.cube.duplicate",
                    "modifierName": f"{object_name}.DuplicateSubdivisionSurface",
                    "viewportLevel": 1,
                },
            },
        )
    )
    duplicate_root = load_temporary_plan(duplicate_steps)
    duplicate_session = DemoSession(duplicate_root, action_registry(duplicate_root))
    duplicate_session.start()
    assert duplicate_session.next() is not None
    assert duplicate_session.next() is not None
    try:
        duplicate_session.next()
    except RuntimeError as error:
        assert "already has a SUBSURF" in str(error)
    else:
        raise AssertionError("A second tracked SUBSURF modifier must be rejected")
    assert duplicate_session.back() is not None
    assert duplicate_session.back() is not None

    tracked_steps = plan_steps({**arguments, "viewportLevel": 1})
    tracked_steps.insert(
        2,
        step(
            "subsurf.tracked_bevel",
            "root",
            2,
            depends_on=["subsurf.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.modifier.add_bevel",
                "arguments": {
                    "targetId": "subsurf.cube",
                    "modifierId": "subsurf.cube.bevel",
                    "modifierName": f"{object_name}.TrackedBevel",
                    "width": 0.05,
                    "segments": 1,
                    "angleLimit": 0.5,
                },
            },
        ),
    )
    tracked_steps[3]["order"] = 3
    tracked_steps[3]["dependsOn"] = ["subsurf.tracked_bevel"]
    tracked_root = load_temporary_plan(tracked_steps)
    tracked_session = DemoSession(tracked_root, action_registry(tracked_root))
    tracked_session.start()
    assert tracked_session.next() is not None
    assert tracked_session.next() is not None
    assert tracked_session.next() is not None
    tracked_cube = bpy.data.objects[object_name]
    assert tuple(modifier.type for modifier in tracked_cube.modifiers) == (
        "BEVEL",
        "SUBSURF",
    )
    assert tracked_session.back() is not None
    assert tracked_session.back() is not None
    assert tracked_session.back() is not None

    untracked_root = load_temporary_plan(plan_steps())
    untracked_session = DemoSession(untracked_root, action_registry(untracked_root))
    untracked_session.start()
    assert untracked_session.next() is not None
    untracked_cube = bpy.data.objects[object_name]
    external = untracked_cube.modifiers.new(f"{object_name}.External", "BEVEL")
    try:
        untracked_session.next()
    except RuntimeError as error:
        assert "untracked existing modifiers" in str(error)
    else:
        raise AssertionError("Untracked modifier stacks must be rejected")
    untracked_cube.modifiers.remove(external)
    assert untracked_session.back() is not None

    boundary_steps = plan_steps({**arguments, "viewportLevel": 3})
    boundary_steps.insert(
        2,
        step(
            "subsurf.dense",
            "root",
            2,
            depends_on=["subsurf.cube"],
            step_action={
                "adapterId": "blender",
                "name": "blender.mesh.edit_subdivide",
                "arguments": {
                    "targetId": "subsurf.cube",
                    "resultMeshId": "subsurf.cube.dense_mesh",
                    "resultMeshName": f"{object_name}.DenseMesh",
                    "cuts": 8,
                    "smooth": 0.0,
                },
            },
        ),
    )
    boundary_steps[3]["order"] = 3
    boundary_steps[3]["dependsOn"] = ["subsurf.dense"]
    boundary_root = load_temporary_plan(boundary_steps)
    boundary_session = DemoSession(boundary_root, action_registry(boundary_root))
    boundary_session.start()
    assert boundary_session.next() is not None
    assert boundary_session.next() is not None
    boundary_cube = bpy.data.objects[object_name]
    assert len(boundary_cube.modifiers) == 0
    try:
        boundary_session.next()
    except ValueError as error:
        assert "projected level" in str(error)
        assert "topology limits" in str(error)
    else:
        raise AssertionError("Excessive projected SUBSURF topology must be rejected")
    assert len(boundary_cube.modifiers) == 0
    assert boundary_session.back() is not None
    assert boundary_session.back() is not None


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
    assert_torus_ready_observation()
    assert_torus_maximum_topology()
    assert_cone_materialized_operator_contract()
    assert_cylinder_materialized_operator_contract()
    assert_icosphere_argument_boundaries()
    assert_icosphere_action_round_trip()
    assert_icosphere_ready_observation()
    assert_sized_primitive_ready_observations()
    assert_cube_resource_id_boundaries()
    assert_cube_action_round_trip()
    assert_uv_sphere_ready_observation()
    assert_cube_candidate_shortcut_projection_contract()
    assert_plane_candidate_shortcut_projection_contract()
    assert_editing_argument_boundaries()
    assert_edit_modifier_geometry_nodes_round_trip()
    assert_extrude_region_round_trip_and_guards()
    assert_extrude_region_connectivity_guards()
    assert_extrude_region_rejects_modified_source()
    assert_extrude_region_chained_indices()
    assert_extrude_region_observation_success_gate()
    assert_edit_bevel_edges_round_trip_and_guards()
    assert_edit_inset_faces_round_trip_and_guards()
    assert_edit_poke_faces_round_trip_and_guards()
    assert_edit_poke_weighted_center_matches_ui()
    assert_triangulate_round_trip_and_guards()
    assert_triangulate_ngon_conflicts_and_boundaries()
    assert_triangulate_observation_success_gate()
    assert_solidify_round_trip_and_conflicts()
    assert_solidify_evaluated_topology_and_untracked_modifier_guards()
    assert_solidify_observation_success_gate()
    assert_mirror_round_trip_and_guards()
    assert_subdivision_surface_round_trip_and_guards()

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
        session_snapshot = FAKE_SESSION_VIEW

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
