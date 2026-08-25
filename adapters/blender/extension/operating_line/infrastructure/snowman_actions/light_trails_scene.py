"""Owned look-development scene for the bounded light-trails tutorial."""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import bpy
from mathutils import Vector

from ...application import ActionReceipt
from ...application.session import MutationRecord, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    action_fcurves,
    action_keyframe_signature,
    build_resource_registry,
    embedded_node_tree_semantic_signature,
    ensure_collection_contents_tracked,
    ensure_logical_ids_available,
    ensure_name_available,
    ensure_receipts_intact,
    integer,
    journal_created_resource,
    logical_id,
    make_receipt,
    new_receipt_id,
    node_tree_semantic_signature,
    number,
    owned_resource,
    reference_data_block,
    require_keys,
    rollback_partial,
    text,
    vector,
)


@dataclass(frozen=True, slots=True)
class LightTrailsSceneDefinition:
    collection_id: str
    trail_target_id: str
    floor_target_id: str
    scene_id: str
    scene_name: str
    world_id: str
    world_name: str
    camera_id: str
    camera_object_name: str
    camera_data_name: str
    controller_id: str
    controller_object_name: str
    trail_material_id: str
    trail_material_name: str
    floor_material_id: str
    floor_material_name: str
    camera_action_id: str
    camera_action_name: str
    frame_start: int
    frame_end: int
    camera_start: tuple[float, float, float]
    camera_end: tuple[float, float, float]
    camera_target: tuple[float, float, float]
    lens: float
    f_stop: float
    focus_distance: float
    trail_base_color: tuple[float, float, float, float]
    trail_glow_color: tuple[float, float, float, float]
    trail_emission_strength: float
    gradient_rotation_degrees: float
    gradient_start: float
    glow_band_start: float
    glow_band_end: float
    gradient_end: float
    wave_scale: float
    floor_base_color: tuple[float, float, float, float]
    floor_emission_color: tuple[float, float, float, float]
    floor_emission_strength: float
    floor_metallic: float
    floor_voronoi_scale: float
    floor_roughness_minimum: float
    floor_roughness_maximum: float
    floor_bump_strength: float
    floor_bump_distance: float


_FIELDS = {
    "collectionId",
    "trailTargetId",
    "floorTargetId",
    "sceneId",
    "sceneName",
    "worldId",
    "worldName",
    "cameraId",
    "cameraObjectName",
    "cameraDataName",
    "controllerId",
    "controllerObjectName",
    "trailMaterialId",
    "trailMaterialName",
    "floorMaterialId",
    "floorMaterialName",
    "cameraActionId",
    "cameraActionName",
    "frameStart",
    "frameEnd",
    "cameraStart",
    "cameraEnd",
    "cameraTarget",
    "lens",
    "fStop",
    "focusDistance",
    "trailBaseColor",
    "trailGlowColor",
    "trailEmissionStrength",
    "gradientRotationDegrees",
    "gradientStart",
    "glowBandStart",
    "glowBandEnd",
    "gradientEnd",
    "waveScale",
    "floorBaseColor",
    "floorEmissionColor",
    "floorEmissionStrength",
    "floorMetallic",
    "floorVoronoiScale",
    "floorRoughnessMinimum",
    "floorRoughnessMaximum",
    "floorBumpStrength",
    "floorBumpDistance",
}


def _unit_color(value: Any, label: str) -> tuple[float, float, float, float]:
    color = vector(value, label, 4, minimum=0.0, maximum=1.0)
    return color  # type: ignore[return-value]


def _position(value: Any, label: str) -> tuple[float, float, float]:
    position = vector(value, label, 3, minimum=-1000.0, maximum=1000.0)
    return position  # type: ignore[return-value]


def validate_light_trails_scene(
    arguments: Mapping[str, Any],
) -> LightTrailsSceneDefinition:
    """Validate the exact, bounded light-trails look-development surface."""

    require_keys(arguments, _FIELDS, _FIELDS, "arguments")
    definition = LightTrailsSceneDefinition(
        collection_id=logical_id(arguments["collectionId"], "arguments.collectionId"),
        trail_target_id=logical_id(
            arguments["trailTargetId"], "arguments.trailTargetId"
        ),
        floor_target_id=logical_id(
            arguments["floorTargetId"], "arguments.floorTargetId"
        ),
        scene_id=logical_id(arguments["sceneId"], "arguments.sceneId"),
        scene_name=text(
            arguments["sceneName"], "arguments.sceneName", prefix="OperatingLine."
        ),
        world_id=logical_id(arguments["worldId"], "arguments.worldId"),
        world_name=text(
            arguments["worldName"], "arguments.worldName", prefix="OperatingLine."
        ),
        camera_id=logical_id(arguments["cameraId"], "arguments.cameraId"),
        camera_object_name=text(
            arguments["cameraObjectName"],
            "arguments.cameraObjectName",
            prefix="OperatingLine.",
        ),
        camera_data_name=text(
            arguments["cameraDataName"],
            "arguments.cameraDataName",
            prefix="OperatingLine.",
        ),
        controller_id=logical_id(arguments["controllerId"], "arguments.controllerId"),
        controller_object_name=text(
            arguments["controllerObjectName"],
            "arguments.controllerObjectName",
            prefix="OperatingLine.",
        ),
        trail_material_id=logical_id(
            arguments["trailMaterialId"], "arguments.trailMaterialId"
        ),
        trail_material_name=text(
            arguments["trailMaterialName"],
            "arguments.trailMaterialName",
            prefix="OperatingLine.",
        ),
        floor_material_id=logical_id(
            arguments["floorMaterialId"], "arguments.floorMaterialId"
        ),
        floor_material_name=text(
            arguments["floorMaterialName"],
            "arguments.floorMaterialName",
            prefix="OperatingLine.",
        ),
        camera_action_id=logical_id(
            arguments["cameraActionId"], "arguments.cameraActionId"
        ),
        camera_action_name=text(
            arguments["cameraActionName"],
            "arguments.cameraActionName",
            prefix="OperatingLine.",
        ),
        frame_start=integer(
            arguments["frameStart"],
            "arguments.frameStart",
            minimum=0,
            maximum=100_000,
        ),
        frame_end=integer(
            arguments["frameEnd"],
            "arguments.frameEnd",
            minimum=0,
            maximum=100_000,
        ),
        camera_start=_position(arguments["cameraStart"], "arguments.cameraStart"),
        camera_end=_position(arguments["cameraEnd"], "arguments.cameraEnd"),
        camera_target=_position(arguments["cameraTarget"], "arguments.cameraTarget"),
        lens=number(arguments["lens"], "arguments.lens", minimum=1.0, maximum=1000.0),
        f_stop=number(arguments["fStop"], "arguments.fStop", minimum=0.1, maximum=64.0),
        focus_distance=number(
            arguments["focusDistance"],
            "arguments.focusDistance",
            minimum=0.001,
            maximum=1000.0,
        ),
        trail_base_color=_unit_color(
            arguments["trailBaseColor"], "arguments.trailBaseColor"
        ),
        trail_glow_color=_unit_color(
            arguments["trailGlowColor"], "arguments.trailGlowColor"
        ),
        trail_emission_strength=number(
            arguments["trailEmissionStrength"],
            "arguments.trailEmissionStrength",
            minimum=0.0,
            maximum=10_000.0,
        ),
        gradient_rotation_degrees=number(
            arguments["gradientRotationDegrees"],
            "arguments.gradientRotationDegrees",
            minimum=-360.0,
            maximum=360.0,
        ),
        gradient_start=number(
            arguments["gradientStart"],
            "arguments.gradientStart",
            minimum=0.0,
            maximum=1.0,
        ),
        glow_band_start=number(
            arguments["glowBandStart"],
            "arguments.glowBandStart",
            minimum=0.0,
            maximum=1.0,
        ),
        glow_band_end=number(
            arguments["glowBandEnd"],
            "arguments.glowBandEnd",
            minimum=0.0,
            maximum=1.0,
        ),
        gradient_end=number(
            arguments["gradientEnd"],
            "arguments.gradientEnd",
            minimum=0.0,
            maximum=1.0,
        ),
        wave_scale=number(
            arguments["waveScale"],
            "arguments.waveScale",
            minimum=0.0001,
            maximum=1000.0,
        ),
        floor_base_color=_unit_color(
            arguments["floorBaseColor"], "arguments.floorBaseColor"
        ),
        floor_emission_color=_unit_color(
            arguments["floorEmissionColor"], "arguments.floorEmissionColor"
        ),
        floor_emission_strength=number(
            arguments["floorEmissionStrength"],
            "arguments.floorEmissionStrength",
            minimum=0.0,
            maximum=10_000.0,
        ),
        floor_metallic=number(
            arguments["floorMetallic"],
            "arguments.floorMetallic",
            minimum=0.0,
            maximum=1.0,
        ),
        floor_voronoi_scale=number(
            arguments["floorVoronoiScale"],
            "arguments.floorVoronoiScale",
            minimum=0.0001,
            maximum=1000.0,
        ),
        floor_roughness_minimum=number(
            arguments["floorRoughnessMinimum"],
            "arguments.floorRoughnessMinimum",
            minimum=0.0,
            maximum=1.0,
        ),
        floor_roughness_maximum=number(
            arguments["floorRoughnessMaximum"],
            "arguments.floorRoughnessMaximum",
            minimum=0.0,
            maximum=1.0,
        ),
        floor_bump_strength=number(
            arguments["floorBumpStrength"],
            "arguments.floorBumpStrength",
            minimum=0.0,
            maximum=100.0,
        ),
        floor_bump_distance=number(
            arguments["floorBumpDistance"],
            "arguments.floorBumpDistance",
            minimum=0.0001,
            maximum=1000.0,
        ),
    )
    if definition.frame_end <= definition.frame_start:
        raise ValueError("arguments.frameEnd must be greater than frameStart")
    if definition.trail_target_id == definition.floor_target_id:
        raise ValueError("Trail and floor targets must differ")
    if Vector(definition.camera_start) == Vector(definition.camera_target):
        raise ValueError("arguments.cameraStart and cameraTarget must differ")
    if Vector(definition.camera_start) == Vector(definition.camera_end):
        raise ValueError("arguments.cameraStart and cameraEnd must differ")
    if not (
        definition.gradient_start
        < definition.glow_band_start
        < definition.glow_band_end
        < definition.gradient_end
    ):
        raise ValueError(
            "Gradient positions must satisfy gradientStart < glowBandStart < "
            "glowBandEnd < gradientEnd"
        )
    if definition.floor_roughness_minimum >= definition.floor_roughness_maximum:
        raise ValueError(
            "floorRoughnessMinimum must be less than floorRoughnessMaximum"
        )

    created_ids = (
        definition.scene_id,
        definition.world_id,
        definition.camera_id,
        f"{definition.camera_id}.data",
        definition.controller_id,
        definition.trail_material_id,
        definition.floor_material_id,
        definition.camera_action_id,
        f"{definition.scene_id}.compositor",
    )
    ensure_logical_ids_available({}, created_ids)
    overlap = set(created_ids).intersection(
        {
            definition.collection_id,
            definition.trail_target_id,
            definition.floor_target_id,
        }
    )
    if overlap:
        raise ValueError(
            f"Created logical ID cannot replace a referenced resource: {min(overlap)}"
        )
    if definition.camera_object_name == definition.controller_object_name:
        raise ValueError("Camera and controller object names must differ")
    if definition.trail_material_name == definition.floor_material_name:
        raise ValueError("Trail and floor material names must differ")
    return definition


def _socket(sockets: Any, *names: str) -> Any:
    matches = tuple(
        socket
        for socket in sockets
        if socket.identifier in names or socket.name in names
    )
    if len(matches) != 1:
        raise RuntimeError(
            f"Expected one node socket from {', '.join(names)}; found {len(matches)}"
        )
    return matches[0]


def _input(node: Any, *names: str) -> Any:
    return _socket(node.inputs, *names)


def _output(node: Any, *names: str) -> Any:
    return _socket(node.outputs, *names)


def _node(tree: Any, node_type: str, name: str) -> Any:
    node = tree.nodes.new(node_type)
    node.name = name
    node.label = name
    return node


def _clear_nodes(tree: Any) -> None:
    for node in tuple(tree.nodes):
        tree.nodes.remove(node)


def _set_ramp(
    ramp: Any,
    points: tuple[tuple[float, tuple[float, float, float, float]], ...],
) -> None:
    color_ramp = ramp.color_ramp
    while len(color_ramp.elements) > 2:
        color_ramp.elements.remove(color_ramp.elements[-1])
    for index, (position, color) in enumerate(points):
        element = (
            color_ramp.elements[index]
            if index < len(color_ramp.elements)
            else color_ramp.elements.new(position)
        )
        element.position = position
        element.color = color
    color_ramp.interpolation = "LINEAR"


def _configure_world(world: bpy.types.World) -> None:
    world.use_nodes = True
    tree = world.node_tree
    if tree is None:
        raise RuntimeError("Blender did not create the World node tree")
    _clear_nodes(tree)
    background = _node(tree, "ShaderNodeBackground", "OperatingLine Background")
    output = _node(tree, "ShaderNodeOutputWorld", "OperatingLine World Output")
    _input(background, "Color").default_value = (0.0, 0.0, 0.0, 1.0)
    _input(background, "Strength").default_value = 0.0
    tree.links.new(_output(background, "Background"), _input(output, "Surface"))


def _configure_trail_material(
    material: bpy.types.Material,
    controller: bpy.types.Object,
    definition: LightTrailsSceneDefinition,
) -> None:
    material.use_nodes = True
    material.surface_render_method = "BLENDED"
    tree = material.node_tree
    if tree is None:
        raise RuntimeError("Blender did not create the trail material node tree")
    _clear_nodes(tree)
    texcoord = _node(tree, "ShaderNodeTexCoord", "OperatingLine Trail Coordinates")
    texcoord.object = controller
    mapping = _node(tree, "ShaderNodeMapping", "OperatingLine Trail Mapping")
    _input(mapping, "Rotation").default_value[2] = math.radians(
        definition.gradient_rotation_degrees
    )
    gradient = _node(tree, "ShaderNodeTexGradient", "OperatingLine Trail Gradient")
    gradient.gradient_type = "LINEAR"
    gradient_ramp = _node(
        tree, "ShaderNodeValToRGB", "OperatingLine Trail Gradient Ramp"
    )
    _set_ramp(
        gradient_ramp,
        (
            (definition.gradient_start, (0.0, 0.0, 0.0, 0.0)),
            (definition.gradient_end, definition.trail_base_color),
        ),
    )
    wave = _node(tree, "ShaderNodeTexWave", "OperatingLine Trail Wave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "X"
    _input(wave, "Scale").default_value = definition.wave_scale
    wave_ramp = _node(tree, "ShaderNodeValToRGB", "OperatingLine Trail Glow Ramp")
    _set_ramp(
        wave_ramp,
        (
            (definition.gradient_start, (0.0, 0.0, 0.0, 1.0)),
            (definition.glow_band_start, (0.0, 0.0, 0.0, 1.0)),
            (definition.glow_band_end, (1.0, 1.0, 1.0, 1.0)),
            (definition.gradient_end, (0.0, 0.0, 0.0, 1.0)),
        ),
    )
    mix = _node(tree, "ShaderNodeMixRGB", "OperatingLine Trail Bright Band")
    mix.blend_type = "ADD"
    mix.use_clamp = True
    _input(mix, "Fac").default_value = 1.0
    _input(mix, "Color2").default_value = definition.trail_glow_color
    principled = _node(tree, "ShaderNodeBsdfPrincipled", "OperatingLine Trail Shader")
    _input(principled, "Roughness").default_value = 0.2
    _input(principled, "Metallic").default_value = 0.0
    _input(
        principled, "Emission Strength"
    ).default_value = definition.trail_emission_strength
    output = _node(tree, "ShaderNodeOutputMaterial", "OperatingLine Trail Output")

    tree.links.new(_output(texcoord, "Object"), _input(mapping, "Vector"))
    tree.links.new(_output(mapping, "Vector"), _input(gradient, "Vector"))
    tree.links.new(_output(gradient, "Fac"), _input(gradient_ramp, "Fac"))
    tree.links.new(_output(mapping, "Vector"), _input(wave, "Vector"))
    tree.links.new(_output(wave, "Color"), _input(wave_ramp, "Fac"))
    tree.links.new(_output(gradient_ramp, "Color"), _input(mix, "Color1"))
    tree.links.new(_output(wave_ramp, "Color"), _input(mix, "Fac"))
    tree.links.new(_output(mix, "Color"), _input(principled, "Base Color"))
    tree.links.new(
        _output(mix, "Color"), _input(principled, "Emission Color", "Emission")
    )
    tree.links.new(
        _output(gradient_ramp, "Alpha"),
        _input(principled, "Alpha"),
    )
    tree.links.new(_output(principled, "BSDF"), _input(output, "Surface"))


def _configure_floor_material(
    material: bpy.types.Material,
    definition: LightTrailsSceneDefinition,
) -> None:
    material.use_nodes = True
    tree = material.node_tree
    if tree is None:
        raise RuntimeError("Blender did not create the floor material node tree")
    _clear_nodes(tree)
    texcoord = _node(tree, "ShaderNodeTexCoord", "OperatingLine Floor Coordinates")
    mapping = _node(tree, "ShaderNodeMapping", "OperatingLine Floor Mapping")
    voronoi = _node(tree, "ShaderNodeTexVoronoi", "OperatingLine Floor Voronoi")
    voronoi.voronoi_dimensions = "3D"
    voronoi.feature = "F1"
    _input(voronoi, "Scale").default_value = definition.floor_voronoi_scale
    roughness_ramp = _node(
        tree, "ShaderNodeValToRGB", "OperatingLine Floor Roughness Ramp"
    )
    low = definition.floor_roughness_minimum
    high = definition.floor_roughness_maximum
    _set_ramp(
        roughness_ramp,
        (
            (0.0, (low, low, low, 1.0)),
            (1.0, (high, high, high, 1.0)),
        ),
    )
    bump = _node(tree, "ShaderNodeBump", "OperatingLine Floor Bump")
    _input(bump, "Strength").default_value = definition.floor_bump_strength
    _input(bump, "Distance").default_value = definition.floor_bump_distance
    emission_ramp = _node(
        tree, "ShaderNodeValToRGB", "OperatingLine Floor Emission Ramp"
    )
    _set_ramp(
        emission_ramp,
        (
            (0.0, (0.0, 0.0, 0.0, 1.0)),
            (1.0, definition.floor_emission_color),
        ),
    )
    principled = _node(tree, "ShaderNodeBsdfPrincipled", "OperatingLine Floor Shader")
    _input(principled, "Base Color").default_value = definition.floor_base_color
    _input(principled, "Metallic").default_value = definition.floor_metallic
    _input(
        principled, "Emission Strength"
    ).default_value = definition.floor_emission_strength
    output = _node(tree, "ShaderNodeOutputMaterial", "OperatingLine Floor Output")

    tree.links.new(_output(texcoord, "Object"), _input(mapping, "Vector"))
    tree.links.new(_output(mapping, "Vector"), _input(voronoi, "Vector"))
    tree.links.new(_output(voronoi, "Distance"), _input(roughness_ramp, "Fac"))
    tree.links.new(_output(voronoi, "Distance"), _input(bump, "Height"))
    tree.links.new(_output(voronoi, "Distance"), _input(emission_ramp, "Fac"))
    tree.links.new(_output(roughness_ramp, "Color"), _input(principled, "Roughness"))
    tree.links.new(_output(bump, "Normal"), _input(principled, "Normal"))
    tree.links.new(
        _output(emission_ramp, "Color"),
        _input(principled, "Emission Color", "Emission"),
    )
    tree.links.new(_output(principled, "BSDF"), _input(output, "Surface"))


def _configure_compositor(
    scene: bpy.types.Scene,
    definition: LightTrailsSceneDefinition,
    receipt_id: str,
    step_id: str,
    action_name: str,
    created: list[ResourceIdentity],
) -> None:
    scene.use_nodes = True
    tree = getattr(scene, "node_tree", None)
    if tree is None and hasattr(scene, "compositing_node_group"):
        tree = bpy.data.node_groups.new(
            f"{definition.scene_name}.Compositor", "CompositorNodeTree"
        )
        tree_identity = journal_created_resource(
            created,
            tree,
            f"{definition.scene_id}.compositor",
            receipt_id,
            step_id,
            action_name,
        )
        scene.compositing_node_group = tree
    if tree is None:
        raise RuntimeError("Blender did not create the Scene compositor node tree")
    _clear_nodes(tree)
    render_layers = _node(tree, "CompositorNodeRLayers", "OperatingLine Render Layers")
    if hasattr(render_layers, "scene"):
        render_layers.scene = scene
    glare = _node(tree, "CompositorNodeGlare", "OperatingLine Fog Glow")
    if hasattr(glare, "glare_type"):
        glare.glare_type = "FOG_GLOW"
        glare.quality = "HIGH"
    else:
        _input(glare, "Type").default_value = "Bloom"
        _input(glare, "Quality").default_value = "High"
    threshold = _input(glare, "Highlights Threshold", "Threshold")
    if hasattr(threshold, "default_value"):
        threshold.default_value = 0.8
    else:
        glare.threshold = 0.8
    size = _input(glare, "Size")
    if hasattr(size, "default_value"):
        size.default_value = 0.7
    else:
        glare.size = 7
    tree.links.new(_output(render_layers, "Image"), _input(glare, "Image"))
    if tree.bl_idname == "CompositorNodeTree" and not hasattr(
        bpy.types, "CompositorNodeComposite"
    ):
        tree.interface.new_socket(
            name="Image", in_out="OUTPUT", socket_type="NodeSocketColor"
        )
        composite = _node(tree, "NodeGroupOutput", "OperatingLine Composite")
    else:
        composite = _node(tree, "CompositorNodeComposite", "OperatingLine Composite")
    tree.links.new(_output(glare, "Image"), _input(composite, "Image"))


def _assign_material(
    target_identity: ResourceIdentity,
    target: bpy.types.Object,
    material_identity: ResourceIdentity,
    material: bpy.types.Material,
    mutations: list[MutationRecord],
) -> None:
    before = tuple(
        reference_data_block(slot.material) if slot.material is not None else None
        for slot in target.material_slots
    )
    target.data.materials.clear()
    target.data.materials.append(material)
    mutations.append(
        MutationRecord(
            target_identity,
            "material_slots",
            before,
            (material_identity,),
        )
    )


def _ensure_cycles(scene: bpy.types.Scene) -> None:
    try:
        scene.render.engine = "CYCLES"
    except (TypeError, ValueError) as error:
        raise RuntimeError(
            "This Blender build does not provide the Cycles engine"
        ) from error


def execute_light_trails_scene(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: LightTrailsSceneDefinition,
) -> ActionReceipt:
    """Create the pre-bake, pre-render look-development scene and animation."""

    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    collection_identity, collection = owned_resource(
        registry, definition.collection_id, "COLLECTION"
    )
    trail_identity, trail = owned_resource(
        registry, definition.trail_target_id, "OBJECT"
    )
    floor_identity, floor = owned_resource(
        registry, definition.floor_target_id, "OBJECT"
    )
    ensure_collection_contents_tracked(collection, registry)
    if trail is floor:
        raise RuntimeError("Trail and floor targets resolve to the same object")
    if trail.type not in {"CURVE", "MESH"} or not hasattr(trail.data, "materials"):
        raise ValueError("Trail target must be an owned curve or mesh object")
    if floor.type != "MESH" or not hasattr(floor.data, "materials"):
        raise ValueError("Floor target must be an owned mesh object")
    collection_objects = {obj.as_pointer() for obj in collection.all_objects}
    if (
        trail.as_pointer() not in collection_objects
        or floor.as_pointer() not in collection_objects
    ):
        raise RuntimeError(
            "Trail and floor targets must belong to the managed collection"
        )

    created_ids = (
        definition.scene_id,
        definition.world_id,
        definition.camera_id,
        f"{definition.camera_id}.data",
        definition.controller_id,
        definition.trail_material_id,
        definition.floor_material_id,
        definition.camera_action_id,
        f"{definition.scene_id}.compositor",
    )
    ensure_logical_ids_available(registry, created_ids)
    ensure_name_available(bpy.data.scenes, definition.scene_name, "scene")
    ensure_name_available(bpy.data.worlds, definition.world_name, "world")
    ensure_name_available(bpy.data.objects, definition.camera_object_name, "object")
    ensure_name_available(bpy.data.objects, definition.controller_object_name, "object")
    ensure_name_available(bpy.data.cameras, definition.camera_data_name, "camera data")
    ensure_name_available(
        bpy.data.materials, definition.trail_material_name, "material"
    )
    ensure_name_available(
        bpy.data.materials, definition.floor_material_name, "material"
    )
    ensure_name_available(bpy.data.actions, definition.camera_action_name, "action")
    if hasattr(bpy.types.Scene, "compositing_node_group"):
        ensure_name_available(
            bpy.data.node_groups,
            f"{definition.scene_name}.Compositor",
            "compositor node group",
        )

    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        scene = bpy.data.scenes.new(definition.scene_name)
        scene_identity = journal_created_resource(
            created, scene, definition.scene_id, receipt_id, step_id, action.name
        )
        scene.frame_start = definition.frame_start
        scene.frame_end = definition.frame_end
        _ensure_cycles(scene)

        world = bpy.data.worlds.new(definition.world_name)
        world_identity = journal_created_resource(
            created, world, definition.world_id, receipt_id, step_id, action.name
        )
        _configure_world(world)
        mutations.append(
            MutationRecord(
                world_identity,
                "embedded_node_tree_semantic_signature_v1",
                None,
                embedded_node_tree_semantic_signature(world),
            )
        )
        scene.world = world
        scene.collection.children.link(collection)
        mutations.append(
            MutationRecord(
                scene_identity, "collection_children", (), (collection_identity,)
            )
        )

        camera_data = bpy.data.cameras.new(definition.camera_data_name)
        camera_data_identity = journal_created_resource(
            created,
            camera_data,
            f"{definition.camera_id}.data",
            receipt_id,
            step_id,
            action.name,
        )
        camera_data.lens = definition.lens
        camera_data.dof.use_dof = True
        camera_data.dof.aperture_fstop = definition.f_stop
        camera_data.dof.focus_distance = definition.focus_distance

        camera = bpy.data.objects.new(definition.camera_object_name, camera_data)
        camera_identity = journal_created_resource(
            created, camera, definition.camera_id, receipt_id, step_id, action.name
        )
        camera.location = definition.camera_start
        direction = Vector(definition.camera_target) - Vector(definition.camera_start)
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        collection.objects.link(camera)
        mutations.append(
            MutationRecord(
                camera_identity, "users_collection", (), (collection_identity,)
            )
        )
        scene.camera = camera
        mutations.append(
            MutationRecord(scene_identity, "camera", None, camera_identity)
        )

        controller = bpy.data.objects.new(definition.controller_object_name, None)
        controller_identity = journal_created_resource(
            created,
            controller,
            definition.controller_id,
            receipt_id,
            step_id,
            action.name,
        )
        controller.empty_display_type = "PLAIN_AXES"
        controller.parent = camera
        controller.location = (0.0, 0.0, 0.0)
        collection.objects.link(controller)
        mutations.append(
            MutationRecord(
                controller_identity, "users_collection", (), (collection_identity,)
            )
        )

        trail_material = bpy.data.materials.new(definition.trail_material_name)
        trail_material_identity = journal_created_resource(
            created,
            trail_material,
            definition.trail_material_id,
            receipt_id,
            step_id,
            action.name,
        )
        _configure_trail_material(trail_material, controller, definition)
        mutations.append(
            MutationRecord(
                trail_material_identity,
                "embedded_node_tree_semantic_signature_v1",
                None,
                embedded_node_tree_semantic_signature(trail_material),
            )
        )
        _assign_material(
            trail_identity,
            trail,
            trail_material_identity,
            trail_material,
            mutations,
        )

        floor_material = bpy.data.materials.new(definition.floor_material_name)
        floor_material_identity = journal_created_resource(
            created,
            floor_material,
            definition.floor_material_id,
            receipt_id,
            step_id,
            action.name,
        )
        _configure_floor_material(floor_material, definition)
        mutations.append(
            MutationRecord(
                floor_material_identity,
                "embedded_node_tree_semantic_signature_v1",
                None,
                embedded_node_tree_semantic_signature(floor_material),
            )
        )
        _assign_material(
            floor_identity,
            floor,
            floor_material_identity,
            floor_material,
            mutations,
        )

        camera_action = bpy.data.actions.new(definition.camera_action_name)
        camera_action_identity = journal_created_resource(
            created,
            camera_action,
            definition.camera_action_id,
            receipt_id,
            step_id,
            action.name,
        )
        had_animation_data = camera.animation_data is not None
        camera.animation_data_create().action = camera_action
        mutations.append(
            MutationRecord(
                camera_identity,
                "animation_action",
                (had_animation_data, None),
                camera_action_identity,
            )
        )
        camera.location = definition.camera_start
        if not camera.keyframe_insert(
            data_path="location", frame=definition.frame_start, group="Location"
        ):
            raise RuntimeError("Blender rejected the camera start keyframe")
        camera.location = definition.camera_end
        if not camera.keyframe_insert(
            data_path="location", frame=definition.frame_end, group="Location"
        ):
            raise RuntimeError("Blender rejected the camera end keyframe")
        for curve in action_fcurves(camera_action):
            curve.extrapolation = "CONSTANT"
            for point in curve.keyframe_points:
                point.interpolation = "LINEAR"
        mutations.append(
            MutationRecord(
                camera_action_identity,
                "action_keyframes",
                None,
                action_keyframe_signature(camera_action),
            )
        )

        _configure_compositor(
            scene,
            definition,
            receipt_id,
            step_id,
            action.name,
            created,
        )
        compositor_tree = getattr(scene, "node_tree", None)
        compositor_identity = next(
            (
                identity
                for identity in created
                if identity.logical_id == f"{definition.scene_id}.compositor"
            ),
            None,
        )
        if compositor_tree is not None:
            mutations.append(
                MutationRecord(
                    scene_identity,
                    "embedded_node_tree_semantic_signature_v1",
                    None,
                    embedded_node_tree_semantic_signature(scene),
                )
            )
        elif compositor_identity is not None:
            compositor_tree = getattr(scene, "compositing_node_group", None)
            if not isinstance(compositor_tree, bpy.types.NodeTree):
                raise RuntimeError("Blender did not retain the compositor node group")
            mutations.append(
                MutationRecord(
                    compositor_identity,
                    "node_tree_semantic_signature_v2",
                    None,
                    node_tree_semantic_signature(compositor_tree),
                )
            )
        else:
            raise RuntimeError("Blender did not retain the compositor node tree")
        scene.frame_set(definition.frame_start)
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            camera_identity,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise
