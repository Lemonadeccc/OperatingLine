"""Real Blender proof for the managed no-bake light-trails action."""

from __future__ import annotations

import importlib.util
import math
import os
from collections import Counter
from pathlib import Path
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
PHASE = os.environ.get("OPERATINGLINE_LIGHT_TRAILS_PHASE", "author")
PROFILE = os.environ.get("OPERATINGLINE_LIGHT_TRAILS_PROFILE", "test")
BLEND_PATH = Path(os.environ["OPERATINGLINE_LIGHT_TRAILS_BLEND_PATH"])

OBJECT_NAME = "OperatingLine.LightTrails.Target"
MODIFIER_NAME = "OperatingLine.LightTrails.GeometryNodes"
NODE_GROUP_NAME = "OperatingLine.LightTrails.NodeGroup"
TARGET_ID = "light_trails.target"
MODIFIER_ID = "light_trails.modifier"
NODE_GROUP_ID = "light_trails.node_group"

EXPECTED_NODE_TYPES = [
    "NodeGroupInput",
    "NodeGroupOutput",
    "GeometryNodeCurvePrimitiveLine",
    "GeometryNodeResampleCurve",
    "GeometryNodeMeshLine",
    "GeometryNodeMeshLine",
    "GeometryNodeInstanceOnPoints",
    "GeometryNodeInstanceOnPoints",
    "GeometryNodeRealizeInstances",
    "GeometryNodeRealizeInstances",
    "GeometryNodeInputPosition",
    "ShaderNodeTexNoise",
    "ShaderNodeMath",
    "ShaderNodeMath",
    "ShaderNodeCombineXYZ",
    "GeometryNodeSetPosition",
    "GeometryNodeTransform",
    "GeometryNodeJoinGeometry",
    "GeometryNodeCurvePrimitiveCircle",
    "GeometryNodeCurveToMesh",
]
FORBIDDEN_NODE_TYPES = {
    "GeometryNodeBake",
    "GeometryNodeSimulationInput",
    "GeometryNodeSimulationOutput",
}
TEST_LIGHT_TRAILS_ARGUMENTS = {
    "targetId": TARGET_ID,
    "modifierId": MODIFIER_ID,
    "modifierName": MODIFIER_NAME,
    "nodeGroupId": NODE_GROUP_ID,
    "nodeGroupName": NODE_GROUP_NAME,
    "trailCount": 12,
    "pointsPerTrail": 48,
    "tileLength": 20.0,
    "trailSpacing": 0.22,
    "noiseScale": 0.4,
    "noiseDetail": 3.0,
    "noiseRoughness": 0.55,
    "noiseSeed": 7.0,
    "height": 1.8,
    "profileSides": 4,
    "profileRadius": 0.025,
    "tileRepeatCount": 3,
}
YOUTUBE_965BGIUHOXA_ARGUMENTS = {
    **TEST_LIGHT_TRAILS_ARGUMENTS,
    "trailCount": 77,
    "pointsPerTrail": 300,
    "trailSpacing": 0.08,
    "noiseScale": 1.5,
    "noiseDetail": 2.0,
    "noiseRoughness": 0.5,
    "noiseSeed": 965.0,
    "height": 1.5,
    "profileRadius": 0.012,
}
if PROFILE == "test":
    LIGHT_TRAILS_ARGUMENTS = TEST_LIGHT_TRAILS_ARGUMENTS
elif PROFILE == "youtube_965bgIUHoxA":
    LIGHT_TRAILS_ARGUMENTS = YOUTUBE_965BGIUHOXA_ARGUMENTS
else:
    raise ValueError(f"Unknown light-trails profile: {PROFILE}")


def _step(
    step_id: str,
    order: int,
    action: dict | None,
    *,
    depends_on: list[str] | None = None,
    expected_observations: list[dict] | None = None,
) -> dict:
    result = {
        "id": step_id,
        "parentId": None if step_id == "root" else "root",
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": action,
    }
    if expected_observations is not None:
        result["expectedObservations"] = expected_observations
        result["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "retain_for_repair",
        }
    return result


LIGHT_TRAILS_OBSERVATION = {
    "kind": "light_trails_ready",
    "parameters": {
        **LIGHT_TRAILS_ARGUMENTS,
        "nodeTypes": EXPECTED_NODE_TYPES,
    },
}

PLAN = {
    "protocolVersion": "1.6.0",
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            "light_trails.target",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": TARGET_ID,
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "light_trails.geometry",
            2,
            {
                "adapterId": "blender",
                "name": "blender.geometry_nodes.create_light_trails",
                "arguments": LIGHT_TRAILS_ARGUMENTS,
            },
            depends_on=["light_trails.target"],
            expected_observations=[LIGHT_TRAILS_OBSERVATION],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_light_trails_e2e",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    return extension


def _recursive_node_types(node_group: bpy.types.NodeTree) -> tuple[str, ...]:
    seen: set[int] = set()

    def visit(group: bpy.types.NodeTree) -> list[str]:
        pointer = group.as_pointer()
        if pointer in seen:
            return []
        seen.add(pointer)
        result: list[str] = []
        for node in group.nodes:
            result.append(node.bl_idname)
            nested = getattr(node, "node_tree", None)
            if isinstance(nested, bpy.types.NodeTree):
                result.extend(visit(nested))
        return result

    return tuple(sorted(visit(node_group)))


def _assert_no_bake_graph(
    target: bpy.types.Object,
) -> tuple[bpy.types.NodesModifier, bpy.types.NodeTree]:
    modifier = target.modifiers.get(MODIFIER_NAME)
    assert modifier is not None and modifier.type == "NODES"
    node_group = modifier.node_group
    assert isinstance(node_group, bpy.types.NodeTree)
    node_types = _recursive_node_types(node_group)
    assert node_types == tuple(sorted(EXPECTED_NODE_TYPES))
    assert not FORBIDDEN_NODE_TYPES.intersection(node_types)
    assert len(modifier.bakes) == 0
    assert modifier.bake_directory == ""

    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.data
    assert isinstance(mesh, bpy.types.Mesh)
    expected_vertex_count = (
        LIGHT_TRAILS_ARGUMENTS["trailCount"]
        * LIGHT_TRAILS_ARGUMENTS["pointsPerTrail"]
        * LIGHT_TRAILS_ARGUMENTS["profileSides"]
        * LIGHT_TRAILS_ARGUMENTS["tileRepeatCount"]
        * 2
    )
    assert len(mesh.vertices) == expected_vertex_count
    assert len(mesh.edges) > 0
    assert len(mesh.polygons) > 0
    assert all(
        math.isfinite(component) for vertex in mesh.vertices for component in vertex.co
    )
    return modifier, node_group


def _author() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    extension = _load_extension()
    extension.register()

    from operating_line_light_trails_e2e.operating_line.application import DemoSession
    from operating_line_light_trails_e2e.operating_line.application.menu_guidance import (
        LeafTargetTrust,
        MenuGuidanceTracker,
    )
    from operating_line_light_trails_e2e.operating_line.domain import load_task_tree_data
    from operating_line_light_trails_e2e.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_light_trails_e2e.operating_line.infrastructure.observations import (
        evaluate_observations,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="light-trails-no-bake-e2e",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == "light_trails.target"
    assert session.next().id == "light_trails.geometry"

    target = bpy.data.objects[OBJECT_NAME]
    _modifier, node_group = _assert_no_bake_graph(target)
    geometry_step = next(
        step for step in session.steps if step.id == "light_trails.geometry"
    )
    guidance = MenuGuidanceTracker().snapshot(geometry_step)
    assert guidance is not None
    assert guidance.catalog_version == "1.55.0"
    assert len(guidance.items) == 42
    assert len(guidance.operations) == 54
    named_node_operations = tuple(
        operation
        for operation in guidance.operations
        if operation.target_kind == "node"
    )
    assert len(named_node_operations) == 20
    assert {
        operation.target_id.removeprefix("node-name:")
        for operation in named_node_operations
    } == {node.name for node in node_group.nodes}
    assert all(
        operation.target_trust is LeafTargetTrust.CONTAINER_CAPABLE
        for operation in named_node_operations
    )
    projected_parameters = {
        operation.parameters[0].name: operation
        for operation in guidance.operations
        if len(operation.parameters) == 1
    }
    assert {
        name: operation.parameters[0].value
        for name, operation in projected_parameters.items()
    } == {
        "tileLength": LIGHT_TRAILS_ARGUMENTS["tileLength"],
        "pointsPerTrail": LIGHT_TRAILS_ARGUMENTS["pointsPerTrail"],
        "trailCount": LIGHT_TRAILS_ARGUMENTS["trailCount"],
        "trailSpacing": LIGHT_TRAILS_ARGUMENTS["trailSpacing"],
        "noiseScale": LIGHT_TRAILS_ARGUMENTS["noiseScale"],
        "noiseDetail": LIGHT_TRAILS_ARGUMENTS["noiseDetail"],
        "noiseRoughness": LIGHT_TRAILS_ARGUMENTS["noiseRoughness"],
        "noiseSeed": LIGHT_TRAILS_ARGUMENTS["noiseSeed"],
        "height": LIGHT_TRAILS_ARGUMENTS["height"],
        "profileSides": LIGHT_TRAILS_ARGUMENTS["profileSides"],
        "profileRadius": LIGHT_TRAILS_ARGUMENTS["profileRadius"],
        "tileRepeatCount": LIGHT_TRAILS_ARGUMENTS["tileRepeatCount"],
    }
    assert all(
        operation.target_trust is LeafTargetTrust.GUIDED_CONTROL
        for operation in projected_parameters.values()
    )
    connection_operations = tuple(
        operation
        for operation in guidance.operations
        if operation.connection is not None
    )
    assert len(connection_operations) == 19
    catalog_links = Counter(
        (
            operation.connection.from_node.removeprefix("node-name:"),
            operation.connection.from_socket,
            operation.connection.to_node.removeprefix("node-name:"),
            operation.connection.to_socket,
        )
        for operation in connection_operations
    )

    def stable_socket_key(node: bpy.types.Node, socket: bpy.types.NodeSocket) -> str:
        if node.bl_idname in {"NodeGroupInput", "NodeGroupOutput"}:
            return socket.name
        return socket.identifier

    actual_links = Counter(
        (
            link.from_node.name,
            stable_socket_key(link.from_node, link.from_socket),
            link.to_node.name,
            stable_socket_key(link.to_node, link.to_socket),
        )
        for link in node_group.links
    )
    assert catalog_links == actual_links, {
        "missingFromBlender": catalog_links - actual_links,
        "missingFromCatalog": actual_links - catalog_links,
    }
    observations = session.success_gate_observation_copy("light_trails.geometry")
    assert observations is not None and len(observations) == 1
    assert observations[0]["kind"] == "light_trails_ready"
    assert observations[0]["satisfied"] is True
    assert observations[0]["details"]["semanticSignatureMatches"] is True
    assert observations[0]["details"]["semanticParametersMatch"] is True
    assert observations[0]["details"]["fixedSemanticsMatch"] is True
    assert observations[0]["details"]["resolvedParameters"] is not None
    assert observations[0]["details"]["interfaceMatches"] is True
    assert observations[0]["details"]["linkTopologyMatches"] is True
    assert observations[0]["details"]["evaluatedVertexCountMatches"] is True
    assert observations[0]["details"]["bakeCount"] == 0
    assert observations[0]["details"]["forbiddenNodeTypes"] == []

    wrong_parameter_observations = evaluate_observations(
        (
            {
                "kind": "light_trails_ready",
                "parameters": {
                    **LIGHT_TRAILS_ARGUMENTS,
                    "height": LIGHT_TRAILS_ARGUMENTS["height"] + 0.5,
                    "nodeTypes": EXPECTED_NODE_TYPES,
                },
            },
        ),
        session.receipts,
    )
    assert len(wrong_parameter_observations) == 1
    assert wrong_parameter_observations[0]["satisfied"] is False
    assert (
        wrong_parameter_observations[0]["details"]["semanticSignatureMatches"]
        is True
    )
    assert (
        wrong_parameter_observations[0]["details"]["semanticParametersMatch"]
        is False
    )

    forged_node_list_observations = evaluate_observations(
        (
            {
                "kind": "light_trails_ready",
                "parameters": {
                    **LIGHT_TRAILS_ARGUMENTS,
                    "nodeTypes": [*EXPECTED_NODE_TYPES, "GeometryNodeBake"],
                },
            },
        ),
        session.receipts,
    )
    assert len(forged_node_list_observations) == 1
    assert forged_node_list_observations[0]["satisfied"] is False
    assert forged_node_list_observations[0]["details"]["forbiddenNodeTypes"] == []

    position_node = node_group.nodes["OperatingLine Trail Position"]
    noise_node = node_group.nodes["OperatingLine Terrain Noise"]
    position_noise_link = next(
        link
        for link in node_group.links
        if link.from_node.name == position_node.name and link.to_node.name == noise_node.name
    )
    node_group.links.remove(position_noise_link)
    _step_node, broken_links = session.evaluate_current_step_observations(
        "light_trails.geometry"
    )
    assert len(broken_links) == 1 and broken_links[0]["satisfied"] is False
    assert broken_links[0]["details"]["linkTopologyMatches"] is False
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
    else:
        raise AssertionError("Back accepted an externally modified node link")
    node_group.links.new(position_node.outputs["Position"], noise_node.inputs["Vector"])
    _step_node, restored_links = session.evaluate_current_step_observations(
        "light_trails.geometry"
    )
    assert len(restored_links) == 1 and restored_links[0]["satisfied"] is True

    height_node = node_group.nodes["OperatingLine Scale Height"]
    height_socket = height_node.inputs[1]
    original_height = float(height_socket.default_value)
    height_socket.default_value = original_height + 0.75
    _step_node, tampered = session.evaluate_current_step_observations(
        "light_trails.geometry"
    )
    assert len(tampered) == 1 and tampered[0]["satisfied"] is False
    assert tampered[0]["details"]["semanticSignatureMatches"] is False
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
        assert "node_tree_semantic_signature_v2" in str(error)
    else:
        raise AssertionError("Back accepted an externally tampered node graph")

    height_socket.default_value = original_height
    _step_node, restored = session.evaluate_current_step_observations(
        "light_trails.geometry"
    )
    assert len(restored) == 1 and restored[0]["satisfied"] is True
    assert session.back().id == "light_trails.geometry"
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is None

    assert session.next().id == "light_trails.geometry"
    target = bpy.data.objects[OBJECT_NAME]
    _assert_no_bake_graph(target)
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    assert bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH)) == {"FINISHED"}
    assert BLEND_PATH.is_file()

    print(
        "OperatingLine no-bake light-trails author proof passed: 54 operations, 19 links",
        bpy.app.version_string,
        flush=True,
    )
    extension.unregister()


def _verify_reopened_file() -> None:
    assert Path(bpy.data.filepath).resolve() == BLEND_PATH.resolve()
    target = bpy.data.objects.get(OBJECT_NAME)
    assert target is not None
    _modifier, node_group = _assert_no_bake_graph(target)

    scale_height = node_group.nodes.get("OperatingLine Scale Height")
    assert scale_height is not None and scale_height.bl_idname == "ShaderNodeMath"
    assert scale_height.operation == "MULTIPLY"
    assert math.isclose(
        float(scale_height.inputs[1].default_value),
        float(LIGHT_TRAILS_ARGUMENTS["height"]),
        abs_tol=1e-6,
    )
    noise = node_group.nodes.get("OperatingLine Terrain Noise")
    assert noise is not None and noise.bl_idname == "ShaderNodeTexNoise"
    assert noise.noise_dimensions == "4D"

    print(
        "OperatingLine no-bake light-trails reopen proof passed",
        bpy.app.version_string,
        flush=True,
    )


def main() -> None:
    if PHASE == "author":
        _author()
    elif PHASE == "verify":
        _verify_reopened_file()
    else:
        raise ValueError(f"Unknown light-trails E2E phase: {PHASE}")


try:
    main()
except BaseException:
    traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
    raise
