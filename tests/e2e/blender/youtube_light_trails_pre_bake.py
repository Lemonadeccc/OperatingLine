"""Reproduce YouTube 965bgIUHoxA through lookdev, without Bake or Render."""

from __future__ import annotations

import importlib.util
import math
import os
from pathlib import Path
import sys

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
PHASE = os.environ.get("OPERATINGLINE_YOUTUBE_LIGHT_TRAILS_PHASE", "author")
BLEND_PATH = Path(os.environ["OPERATINGLINE_YOUTUBE_LIGHT_TRAILS_BLEND_PATH"])

TRAIL_TARGET_ID = "youtube.965bgIUHoxA.trails"
FLOOR_TARGET_ID = "youtube.965bgIUHoxA.floor"
TRAIL_OBJECT_NAME = "OperatingLine.YouTube965bgIUHoxA.Geo"
FLOOR_OBJECT_NAME = "OperatingLine.YouTube965bgIUHoxA.Floor"
MODIFIER_ID = "youtube.965bgIUHoxA.trails.modifier"
MODIFIER_NAME = "OperatingLine.YouTube965bgIUHoxA.LightTrails"
NODE_GROUP_ID = "youtube.965bgIUHoxA.trails.node_group"
NODE_GROUP_NAME = "OperatingLine.YouTube965bgIUHoxA.LightTrailsNodes"

LIGHT_TRAILS_ARGUMENTS = {
    "targetId": TRAIL_TARGET_ID,
    "modifierId": MODIFIER_ID,
    "modifierName": MODIFIER_NAME,
    "nodeGroupId": NODE_GROUP_ID,
    "nodeGroupName": NODE_GROUP_NAME,
    "trailCount": 77,
    "pointsPerTrail": 300,
    "tileLength": 20.0,
    "trailSpacing": 0.13,
    "noiseScale": 0.5,
    "noiseDetail": 2.0,
    "noiseRoughness": 0.5,
    "noiseSeed": 0.0,
    "height": 1.0,
    "profileSides": 4,
    "profileRadius": 0.005,
    "tileRepeatCount": 3,
}

TRAIL_MATERIAL_NODE_TYPES = sorted(
    [
        "ShaderNodeOutputMaterial",
        "ShaderNodeBsdfPrincipled",
        "ShaderNodeTexCoord",
        "ShaderNodeMapping",
        "ShaderNodeTexGradient",
        "ShaderNodeValToRGB",
        "ShaderNodeTexWave",
        "ShaderNodeValToRGB",
        "ShaderNodeMixRGB",
    ]
)
FLOOR_MATERIAL_NODE_TYPES = sorted(
    [
        "ShaderNodeOutputMaterial",
        "ShaderNodeBsdfPrincipled",
        "ShaderNodeTexCoord",
        "ShaderNodeMapping",
        "ShaderNodeTexVoronoi",
        "ShaderNodeValToRGB",
        "ShaderNodeBump",
        "ShaderNodeValToRGB",
    ]
)
COMPOSITOR_NODE_TYPES = sorted(
    [
        "CompositorNodeRLayers",
        "CompositorNodeGlare",
        "CompositorNodeComposite",
    ]
)

LOOKDEV_ARGUMENTS = {
    "collectionId": "snowman.collection",
    "trailTargetId": TRAIL_TARGET_ID,
    "floorTargetId": FLOOR_TARGET_ID,
    "sceneId": "youtube.965bgIUHoxA.scene",
    "sceneName": "OperatingLine.YouTube965bgIUHoxA.Scene",
    "worldId": "youtube.965bgIUHoxA.world",
    "worldName": "OperatingLine.YouTube965bgIUHoxA.World",
    "cameraId": "youtube.965bgIUHoxA.camera",
    "cameraObjectName": "OperatingLine.YouTube965bgIUHoxA.Camera",
    "cameraDataName": "OperatingLine.YouTube965bgIUHoxA.CameraData",
    "controllerId": "youtube.965bgIUHoxA.gradient_controller",
    "controllerObjectName": "OperatingLine.YouTube965bgIUHoxA.GradientController",
    "trailMaterialId": "youtube.965bgIUHoxA.trail_material",
    "trailMaterialName": "OperatingLine.YouTube965bgIUHoxA.TrailMaterial",
    "floorMaterialId": "youtube.965bgIUHoxA.floor_material",
    "floorMaterialName": "OperatingLine.YouTube965bgIUHoxA.FloorMaterial",
    "cameraActionId": "youtube.965bgIUHoxA.camera_action",
    "cameraActionName": "OperatingLine.YouTube965bgIUHoxA.CameraLoop",
    "frameStart": 0,
    "frameEnd": 400,
    "cameraStart": [-5.0, -8.0, 7.0],
    "cameraEnd": [15.0, -8.0, 7.0],
    "cameraTarget": [0.0, 0.0, 0.0],
    "lens": 100.0,
    "fStop": 2.8,
    "focusDistance": 10.0,
    "trailBaseColor": [0.06, 0.025, 0.01, 1.0],
    "trailGlowColor": [1.0, 0.22, 0.03, 1.0],
    "trailEmissionStrength": 3.0,
    "gradientRotationDegrees": 90.0,
    "gradientStart": 0.05,
    "glowBandStart": 0.47,
    "glowBandEnd": 0.53,
    "gradientEnd": 0.95,
    "waveScale": 0.12,
    "floorBaseColor": [0.01, 0.005, 0.002, 1.0],
    "floorEmissionColor": [1.0, 0.07, 0.01, 1.0],
    "floorEmissionStrength": 3.0,
    "floorMetallic": 1.0,
    "floorVoronoiScale": 60.0,
    "floorRoughnessMinimum": 0.18,
    "floorRoughnessMaximum": 0.62,
    "floorBumpStrength": 0.35,
    "floorBumpDistance": 1.5,
}

EXPECTED_OBSERVATION_PARAMETERS = {
    **LOOKDEV_ARGUMENTS,
    "trailMaterialNodeTypes": TRAIL_MATERIAL_NODE_TYPES,
    "floorMaterialNodeTypes": FLOOR_MATERIAL_NODE_TYPES,
    "compositorNodeTypes": COMPOSITOR_NODE_TYPES,
}


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


PLAN = {
    "protocolVersion": "1.6.0",
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            "tutorial.trails.host",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_plane",
                "arguments": {
                    "resourceId": TRAIL_TARGET_ID,
                    "objectName": TRAIL_OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            "tutorial.trails.geometry",
            2,
            {
                "adapterId": "blender",
                "name": "blender.geometry_nodes.create_light_trails",
                "arguments": LIGHT_TRAILS_ARGUMENTS,
            },
            depends_on=["tutorial.trails.host"],
        ),
        _step(
            "tutorial.floor",
            3,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_plane",
                "arguments": {
                    "resourceId": FLOOR_TARGET_ID,
                    "objectName": FLOOR_OBJECT_NAME,
                    "size": 80.0,
                    "location": [0.0, 0.0, -1.4],
                },
            },
        ),
        _step(
            "tutorial.lookdev",
            4,
            {
                "adapterId": "blender",
                "name": "blender.lookdev.create_light_trails_scene",
                "arguments": LOOKDEV_ARGUMENTS,
            },
            depends_on=["tutorial.trails.geometry", "tutorial.floor"],
            expected_observations=[
                {
                    "kind": "light_trails_scene_ready",
                    "parameters": EXPECTED_OBSERVATION_PARAMETERS,
                }
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_youtube_light_trails_e2e",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    return extension


def _node_types(tree: bpy.types.NodeTree, *, compositor: bool = False) -> list[str]:
    result = []
    for node in tree.nodes:
        node_type = node.bl_idname
        if compositor and node_type == "NodeGroupOutput":
            node_type = "CompositorNodeComposite"
        result.append(node_type)
    return sorted(result)


def _compositor_tree(scene: bpy.types.Scene) -> bpy.types.NodeTree:
    tree = getattr(scene, "node_tree", None)
    if tree is None:
        tree = getattr(scene, "compositing_node_group", None)
    assert isinstance(tree, bpy.types.NodeTree)
    return tree


def _assert_no_bake() -> None:
    forbidden = {
        "GeometryNodeBake",
        "GeometryNodeSimulationInput",
        "GeometryNodeSimulationOutput",
    }
    trail = bpy.data.objects[TRAIL_OBJECT_NAME]
    modifier = trail.modifiers[MODIFIER_NAME]
    assert modifier.type == "NODES" and modifier.node_group is not None
    assert not forbidden.intersection(node.bl_idname for node in modifier.node_group.nodes)
    assert len(modifier.bakes) == 0
    assert modifier.bake_directory == ""
    evaluated = trail.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.data
    assert isinstance(mesh, bpy.types.Mesh)
    expected_vertices = (
        LIGHT_TRAILS_ARGUMENTS["trailCount"]
        * LIGHT_TRAILS_ARGUMENTS["pointsPerTrail"]
        * LIGHT_TRAILS_ARGUMENTS["profileSides"]
        * LIGHT_TRAILS_ARGUMENTS["tileRepeatCount"]
        * 2
    )
    assert len(mesh.vertices) == expected_vertices
    assert all(
        math.isfinite(component)
        for vertex in mesh.vertices
        for component in vertex.co
    )


def _assert_lookdev_project() -> None:
    scene = bpy.data.scenes[LOOKDEV_ARGUMENTS["sceneName"]]
    world = bpy.data.worlds[LOOKDEV_ARGUMENTS["worldName"]]
    camera = bpy.data.objects[LOOKDEV_ARGUMENTS["cameraObjectName"]]
    controller = bpy.data.objects[LOOKDEV_ARGUMENTS["controllerObjectName"]]
    trail = bpy.data.objects[TRAIL_OBJECT_NAME]
    floor = bpy.data.objects[FLOOR_OBJECT_NAME]
    trail_material = bpy.data.materials[LOOKDEV_ARGUMENTS["trailMaterialName"]]
    floor_material = bpy.data.materials[LOOKDEV_ARGUMENTS["floorMaterialName"]]
    action = bpy.data.actions[LOOKDEV_ARGUMENTS["cameraActionName"]]

    assert scene.world is world
    assert scene.camera is camera
    assert scene.render.engine == "CYCLES"
    assert (scene.frame_start, scene.frame_end) == (0, 400)
    assert camera.data.lens == 100.0
    assert camera.data.dof.use_dof
    assert math.isclose(camera.data.dof.aperture_fstop, 2.8, abs_tol=1e-6)
    assert math.isclose(camera.data.dof.focus_distance, 10.0, abs_tol=1e-6)
    assert controller.parent is camera
    assert trail.material_slots[0].material is trail_material
    assert floor.material_slots[0].material is floor_material
    assert _node_types(trail_material.node_tree) == TRAIL_MATERIAL_NODE_TYPES
    assert _node_types(floor_material.node_tree) == FLOOR_MATERIAL_NODE_TYPES
    assert _node_types(_compositor_tree(scene), compositor=True) == COMPOSITOR_NODE_TYPES

    from operating_line_youtube_light_trails_e2e.operating_line.infrastructure.snowman_actions.common import (
        action_fcurves,
    )

    curves = sorted(action_fcurves(action), key=lambda curve: curve.array_index)
    assert len(curves) == 3
    assert sum(len(curve.keyframe_points) for curve in curves) == 6
    for index, curve in enumerate(curves):
        assert curve.data_path == "location"
        assert curve.array_index == index
        assert curve.extrapolation == "CONSTANT"
        points = tuple(curve.keyframe_points)
        assert tuple(points[0].co) == (0.0, LOOKDEV_ARGUMENTS["cameraStart"][index])
        assert tuple(points[1].co) == (400.0, LOOKDEV_ARGUMENTS["cameraEnd"][index])
        assert all(point.interpolation == "LINEAR" for point in points)

    assert bpy.data.images.get("Render Result") is None
    _assert_no_bake()


def _author() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    extension = _load_extension()
    extension.register()

    from operating_line_youtube_light_trails_e2e.operating_line.application import (
        DemoSession,
    )
    from operating_line_youtube_light_trails_e2e.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_youtube_light_trails_e2e.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_youtube_light_trails_e2e.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_youtube_light_trails_e2e.operating_line.infrastructure.snowman_actions.common import (
        action_fcurves,
    )
    from operating_line_youtube_light_trails_e2e.operating_line.infrastructure.snowman_actions.light_trails_scene import (
        validate_light_trails_scene,
    )

    assert math.isclose(
        validate_light_trails_scene(
            {**LOOKDEV_ARGUMENTS, "floorVoronoiScale": 0.0001}
        ).floor_voronoi_scale,
        0.0001,
    )
    for invalid_arguments in (
        {**LOOKDEV_ARGUMENTS, "floorVoronoiScale": 0.00009},
        {**LOOKDEV_ARGUMENTS, "floorVoronoiScale": 1000.1},
        {
            **LOOKDEV_ARGUMENTS,
            "floorMaterialName": LOOKDEV_ARGUMENTS["trailMaterialName"],
        },
    ):
        try:
            validate_light_trails_scene(invalid_arguments)
        except ValueError:
            pass
        else:
            raise AssertionError("Invalid light-trails scene arguments were accepted")

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="youtube-965bgIUHoxA-pre-bake-pre-render",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == "tutorial.trails.host"
    assert session.next().id == "tutorial.trails.geometry"
    assert session.next().id == "tutorial.floor"
    try:
        assert session.next().id == "tutorial.lookdev"
    except Exception as error:
        gate = getattr(error, "gate", None)
        if gate is not None:
            print(
                "OperatingLine light-trails observation diagnostics:",
                gate.observation_copy(),
                flush=True,
            )
        raise

    observations = session.success_gate_observation_copy("tutorial.lookdev")
    assert observations is not None and len(observations) == 1
    observation = observations[0]
    assert observation["kind"] == "light_trails_scene_ready"
    assert observation["satisfied"] is True
    details = observation["details"]
    for key in (
        "sceneMatches",
        "collectionMatches",
        "worldMatches",
        "cameraMatches",
        "controllerMatches",
        "animationMatches",
        "trailMaterialMatches",
        "floorMaterialMatches",
        "compositorMatches",
        "noBakeNodes",
        "noRenderArtifacts",
    ):
        assert details[key] is True
    assert details["cameraKeyframeCount"] == 6
    _assert_lookdev_project()

    synthetic_render_result = bpy.data.images.new("Render Result", width=1, height=1)
    _step_node, tampered = session.evaluate_current_step_observations(
        "tutorial.lookdev"
    )
    assert tampered[0]["satisfied"] is False
    assert tampered[0]["details"]["noRenderArtifacts"] is False
    bpy.data.images.remove(synthetic_render_result)

    def assert_invariant_fails(detail_key: str) -> None:
        _step_node, current = session.evaluate_current_step_observations(
            "tutorial.lookdev"
        )
        assert current[0]["satisfied"] is False
        assert current[0]["details"][detail_key] is False

    if bpy.app.version < (5, 0, 0):
        world = bpy.data.worlds[LOOKDEV_ARGUMENTS["worldName"]]
        world.use_nodes = False
        assert_invariant_fails("worldMatches")
        world.use_nodes = True

    trail_material = bpy.data.materials[LOOKDEV_ARGUMENTS["trailMaterialName"]]
    if bpy.app.version < (5, 0, 0):
        trail_material.use_nodes = False
        assert_invariant_fails("trailMaterialMatches")
        trail_material.use_nodes = True
    trail_material.surface_render_method = "DITHERED"
    assert_invariant_fails("trailMaterialMatches")
    trail_material.surface_render_method = "BLENDED"

    floor_material = bpy.data.materials[LOOKDEV_ARGUMENTS["floorMaterialName"]]
    if bpy.app.version < (5, 0, 0):
        floor_material.use_nodes = False
        assert_invariant_fails("floorMaterialMatches")
        floor_material.use_nodes = True

    controller = bpy.data.objects[LOOKDEV_ARGUMENTS["controllerObjectName"]]
    controller.location.x = 0.25
    assert_invariant_fails("controllerMatches")
    controller.location.x = 0.0

    scene = bpy.data.scenes[LOOKDEV_ARGUMENTS["sceneName"]]
    compositor_group = getattr(scene, "compositing_node_group", None)
    if compositor_group is not None:
        unmanaged_twin = compositor_group.copy()
        scene.compositing_node_group = unmanaged_twin
        assert_invariant_fails("compositorMatches")
        scene.compositing_node_group = compositor_group
        bpy.data.node_groups.remove(unmanaged_twin)

    action = bpy.data.actions[LOOKDEV_ARGUMENTS["cameraActionName"]]
    curve = sorted(action_fcurves(action), key=lambda item: item.array_index)[0]
    original_end = float(curve.keyframe_points[1].co[1])
    curve.keyframe_points[1].co[1] = original_end + 0.25
    _step_node, tampered = session.evaluate_current_step_observations(
        "tutorial.lookdev"
    )
    assert tampered[0]["satisfied"] is False
    assert tampered[0]["details"]["animationMatches"] is False
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
        assert "action_keyframes" in str(error)
    else:
        raise AssertionError("Rollback accepted externally changed camera keyframes")
    curve.keyframe_points[1].co[1] = original_end

    trail_material = bpy.data.materials[LOOKDEV_ARGUMENTS["trailMaterialName"]]
    tree = trail_material.node_tree
    assert tree is not None
    target_link = next(
        link
        for link in tree.links
        if link.from_node.name == "OperatingLine Trail Bright Band"
        and link.to_node.name == "OperatingLine Trail Shader"
        and link.to_socket.name == "Emission Color"
    )
    from_socket = target_link.from_socket
    to_socket = target_link.to_socket
    tree.links.remove(target_link)
    _step_node, tampered = session.evaluate_current_step_observations(
        "tutorial.lookdev"
    )
    assert tampered[0]["satisfied"] is False
    assert tampered[0]["details"]["trailMaterialMatches"] is False
    try:
        session.back()
    except RuntimeError as error:
        assert "Cannot rollback modified resource" in str(error)
        assert "embedded_node_tree_semantic_signature_v1" in str(error)
    else:
        raise AssertionError("Rollback accepted an externally changed shader graph")
    tree.links.new(from_socket, to_socket)

    _step_node, restored = session.evaluate_current_step_observations(
        "tutorial.lookdev"
    )
    assert restored[0]["satisfied"] is True
    assert session.back().id == "tutorial.lookdev"
    assert bpy.data.scenes.get(LOOKDEV_ARGUMENTS["sceneName"]) is None
    assert bpy.data.materials.get(LOOKDEV_ARGUMENTS["trailMaterialName"]) is None
    assert len(bpy.data.objects[TRAIL_OBJECT_NAME].material_slots) == 0
    assert len(bpy.data.objects[FLOOR_OBJECT_NAME].material_slots) == 0

    assert session.next().id == "tutorial.lookdev"
    _assert_lookdev_project()
    scene = bpy.data.scenes[LOOKDEV_ARGUMENTS["sceneName"]]
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    scene.frame_set(200)
    BLEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    assert bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH)) == {"FINISHED"}
    assert BLEND_PATH.is_file()
    print(
        "OperatingLine YouTube 965bgIUHoxA pre-bake/pre-render author proof passed",
        bpy.app.version_string,
        flush=True,
    )
    extension.unregister()


def _verify_reopened_file() -> None:
    _load_extension()
    assert Path(bpy.data.filepath).resolve() == BLEND_PATH.resolve()
    _assert_lookdev_project()
    scene = bpy.data.scenes[LOOKDEV_ARGUMENTS["sceneName"]]
    if bpy.context.window is not None:
        bpy.context.window.scene = scene
    assert scene.frame_current == 200
    for frame, expected_x in ((0, -5.0), (200, 5.0), (400, 15.0)):
        scene.frame_set(frame)
        camera = bpy.data.objects[LOOKDEV_ARGUMENTS["cameraObjectName"]]
        assert math.isclose(camera.location.x, expected_x, abs_tol=1e-6)
    assert bpy.data.images.get("Render Result") is None
    print(
        "OperatingLine YouTube 965bgIUHoxA pre-bake/pre-render reopen proof passed",
        bpy.app.version_string,
        flush=True,
    )


if PHASE == "author":
    _author()
elif PHASE == "verify":
    _verify_reopened_file()
else:
    raise ValueError(f"Unknown YouTube light-trails phase: {PHASE}")
