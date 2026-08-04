"""Isolated render-scene, rig, and managed preview actions."""

from collections.abc import Mapping
from dataclasses import dataclass
import hashlib
import re
from typing import Any

import bpy
from mathutils import Vector

from ...application import ActionReceipt
from ...application.session import ArtifactIdentity, MutationRecord, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    COLLECTION_LOGICAL_ID,
    build_resource_registry,
    ensure_collection_contents_tracked,
    ensure_logical_ids_available,
    ensure_name_available,
    ensure_receipts_intact,
    integer,
    logical_id,
    make_receipt,
    new_receipt_id,
    number,
    owned_resource,
    render_output_root,
    require_keys,
    require_object,
    resolve_resource,
    rollback_partial,
    tag_resource,
    text,
    vector,
)
from .node_access import require_unique_input, require_unique_node

MAX_PREVIEW_RESOLUTION = 1024
MAX_PREVIEW_SAMPLES = 128


@dataclass(frozen=True, slots=True)
class SceneDefinition:
    scene_id: str
    scene_name: str
    world_id: str
    world_name: str
    collection_id: str
    background_color: tuple[float, float, float, float]
    strength: float


@dataclass(frozen=True, slots=True)
class LightDefinition:
    logical_id: str
    object_name: str
    data_name: str
    location: tuple[float, float, float]
    target: tuple[float, float, float]
    color: tuple[float, float, float]
    energy: float
    size: float


@dataclass(frozen=True, slots=True)
class CameraDefinition:
    logical_id: str
    object_name: str
    data_name: str
    location: tuple[float, float, float]
    target: tuple[float, float, float]
    lens: float


@dataclass(frozen=True, slots=True)
class RigDefinition:
    scene_id: str
    collection_id: str
    lights: tuple[LightDefinition, ...]
    camera: CameraDefinition


@dataclass(frozen=True, slots=True)
class RenderDefinition:
    render_id: str
    scene_id: str
    resolution_x: int
    resolution_y: int
    resolution_percentage: int
    frame: int
    samples: int


def _unit_color(value: Any, label: str, length: int) -> tuple[float, ...]:
    result = vector(value, label, length, minimum=0.0)
    if any(item > 1.0 for item in result):
        raise ValueError(f"{label} channels must be in [0, 1]")
    return result


def validate_scene(arguments: Mapping[str, Any]) -> SceneDefinition:
    fields = {
        "sceneId",
        "sceneName",
        "worldId",
        "worldName",
        "collectionId",
        "backgroundColor",
        "strength",
    }
    require_keys(arguments, fields, fields, "arguments")
    definition = SceneDefinition(
        scene_id=logical_id(arguments["sceneId"], "arguments.sceneId"),
        scene_name=text(
            arguments["sceneName"],
            "arguments.sceneName",
            prefix="OperatingLine.",
        ),
        world_id=logical_id(arguments["worldId"], "arguments.worldId"),
        world_name=text(
            arguments["worldName"],
            "arguments.worldName",
            prefix="OperatingLine.",
        ),
        collection_id=logical_id(
            arguments["collectionId"],
            "arguments.collectionId",
        ),
        background_color=_unit_color(
            arguments["backgroundColor"],
            "arguments.backgroundColor",
            4,
        ),
        strength=number(
            arguments["strength"],
            "arguments.strength",
            minimum=0.0,
            maximum=1000.0,
        ),
    )
    ensure_logical_ids_available({}, (definition.scene_id, definition.world_id))
    if definition.collection_id in {definition.scene_id, definition.world_id}:
        raise ValueError("Scene and world logical IDs must differ from collectionId")
    return definition


def _light(raw: Mapping[str, Any], label: str) -> LightDefinition:
    fields = {
        "resourceId",
        "objectName",
        "dataName",
        "location",
        "target",
        "color",
        "energy",
        "size",
    }
    require_keys(raw, fields, fields, label)
    location = vector(
        raw["location"], f"{label}.location", 3, minimum=-1000.0, maximum=1000.0
    )
    target = vector(
        raw["target"], f"{label}.target", 3, minimum=-1000.0, maximum=1000.0
    )
    if Vector(location) == Vector(target):
        raise ValueError(f"{label}.location and target must differ")
    return LightDefinition(
        logical_id=logical_id(raw["resourceId"], f"{label}.resourceId"),
        object_name=text(
            raw["objectName"], f"{label}.objectName", prefix="OperatingLine."
        ),
        data_name=text(
            raw["dataName"], f"{label}.dataName", prefix="OperatingLine."
        ),
        location=location,
        target=target,
        color=_unit_color(raw["color"], f"{label}.color", 3),
        energy=number(
            raw["energy"],
            f"{label}.energy",
            minimum=0.0,
            maximum=10_000_000.0,
        ),
        size=number(
            raw["size"],
            f"{label}.size",
            minimum=0.0001,
            maximum=1000.0,
        ),
    )


def _camera(raw: Mapping[str, Any], label: str) -> CameraDefinition:
    fields = {"resourceId", "objectName", "dataName", "location", "target", "lens"}
    require_keys(raw, fields, fields, label)
    location = vector(raw["location"], f"{label}.location", 3, minimum=-1000.0, maximum=1000.0)
    target = vector(raw["target"], f"{label}.target", 3, minimum=-1000.0, maximum=1000.0)
    if Vector(location) == Vector(target):
        raise ValueError(f"{label}.location and target must differ")
    return CameraDefinition(
        logical_id=logical_id(raw["resourceId"], f"{label}.resourceId"),
        object_name=text(
            raw["objectName"], f"{label}.objectName", prefix="OperatingLine."
        ),
        data_name=text(
            raw["dataName"], f"{label}.dataName", prefix="OperatingLine."
        ),
        location=location,
        target=target,
        lens=number(raw["lens"], f"{label}.lens", minimum=1.0, maximum=1000.0),
    )


def _rig_resource_ids(definition: RigDefinition) -> tuple[str, ...]:
    resource_ids = tuple(item.logical_id for item in definition.lights) + (
        definition.camera.logical_id,
    )
    return tuple(
        logical_id
        for resource_id in resource_ids
        for logical_id in (resource_id, f"{resource_id}.data")
    )


def validate_rig(arguments: Mapping[str, Any]) -> RigDefinition:
    fields = {"sceneId", "collectionId", "lights", "camera"}
    require_keys(arguments, fields, fields, "arguments")
    raw_lights = arguments["lights"]
    if not isinstance(raw_lights, list) or not 1 <= len(raw_lights) <= 4:
        raise ValueError("arguments.lights must contain 1 to 4 definitions")
    lights = tuple(
        _light(
            require_object(raw, f"arguments.lights[{index}]"),
            f"arguments.lights[{index}]",
        )
        for index, raw in enumerate(raw_lights)
    )
    camera = _camera(
        require_object(arguments["camera"], "arguments.camera"),
        "arguments.camera",
    )
    ids = [item.logical_id for item in lights] + [camera.logical_id]
    object_names = [item.object_name for item in lights] + [camera.object_name]
    data_names = [item.data_name for item in lights] + [camera.data_name]
    identifiers_unique = len(set(ids)) == len(ids)
    object_names_unique = len(set(object_names)) == len(object_names)
    data_names_unique = len(set(data_names)) == len(data_names)
    if not identifiers_unique or not object_names_unique or not data_names_unique:
        raise ValueError("Rig resource IDs and names must be unique")
    definition = RigDefinition(
        logical_id(arguments["sceneId"], "arguments.sceneId"),
        logical_id(arguments["collectionId"], "arguments.collectionId"),
        lights,
        camera,
    )
    created_ids = _rig_resource_ids(definition)
    ensure_logical_ids_available({}, created_ids)
    overlap = {definition.scene_id, definition.collection_id}.intersection(created_ids)
    if overlap:
        raise ValueError(
            f"Rig logical ID cannot replace a referenced resource: {min(overlap)}"
        )
    return definition


def validate_render(arguments: Mapping[str, Any]) -> RenderDefinition:
    fields = {
        "renderId",
        "sceneId",
        "engine",
        "resolutionX",
        "resolutionY",
        "resolutionPercentage",
        "frame",
        "format",
        "destination",
        "samples",
    }
    require_keys(arguments, fields, fields, "arguments")
    render_id = text(arguments["renderId"], "arguments.renderId")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", render_id) is None:
        raise ValueError("arguments.renderId is not portable")
    supported_configuration = (
        arguments["engine"] == "auto_eevee"
        and arguments["format"] == "PNG"
        and arguments["destination"] == "extension_temp"
    )
    if not supported_configuration:
        raise ValueError("Render engine, format, or destination is unsupported")
    return RenderDefinition(
        render_id,
        logical_id(arguments["sceneId"], "arguments.sceneId"),
        integer(
            arguments["resolutionX"],
            "arguments.resolutionX",
            maximum=MAX_PREVIEW_RESOLUTION,
        ),
        integer(
            arguments["resolutionY"],
            "arguments.resolutionY",
            maximum=MAX_PREVIEW_RESOLUTION,
        ),
        integer(
            arguments["resolutionPercentage"],
            "arguments.resolutionPercentage",
            maximum=100,
        ),
        integer(arguments["frame"], "arguments.frame", maximum=100_000),
        integer(
            arguments["samples"],
            "arguments.samples",
            maximum=MAX_PREVIEW_SAMPLES,
        ),
    )


def _configure_world(world: bpy.types.World, definition: SceneDefinition) -> None:
    world.use_nodes = True
    background = require_unique_node(
        world.node_tree,
        "ShaderNodeBackground",
        f"World {world.name!r}",
    )
    require_unique_input(
        background,
        "Color",
        "ShaderNodeBackground",
    ).default_value = definition.background_color
    require_unique_input(
        background,
        "Strength",
        "ShaderNodeBackground",
    ).default_value = definition.strength


def execute_scene(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: SceneDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    collection_identity, collection = owned_resource(
        registry,
        definition.collection_id,
        "COLLECTION",
    )
    ensure_collection_contents_tracked(collection, registry)
    ensure_logical_ids_available(
        registry,
        (definition.scene_id, definition.world_id),
    )
    ensure_name_available(bpy.data.scenes, definition.scene_name, "scene")
    ensure_name_available(bpy.data.worlds, definition.world_name, "world")
    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        scene = bpy.data.scenes.new(definition.scene_name)
        scene_identity = tag_resource(
            scene,
            definition.scene_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(scene_identity)
        world = bpy.data.worlds.new(definition.world_name)
        world_identity = tag_resource(
            world,
            definition.world_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(world_identity)
        _configure_world(world, definition)
        scene.world = world
        scene.collection.children.link(collection)
        mutations.append(
            MutationRecord(
                scene_identity,
                "collection_children",
                (),
                (collection_identity,),
            )
        )
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            created,
            mutations,
            [],
            scene_identity,
        )
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise


def execute_rig(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: RigDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    scene_identity, scene = owned_resource(registry, definition.scene_id, "SCENE")
    collection_identity, collection = owned_resource(
        registry,
        definition.collection_id,
        "COLLECTION",
    )
    ensure_collection_contents_tracked(collection, registry)
    ensure_logical_ids_available(registry, _rig_resource_ids(definition))
    for item in definition.lights:
        ensure_name_available(bpy.data.objects, item.object_name, "object")
        ensure_name_available(bpy.data.lights, item.data_name, "light data")
    ensure_name_available(bpy.data.objects, definition.camera.object_name, "object")
    ensure_name_available(bpy.data.cameras, definition.camera.data_name, "camera data")
    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    try:
        for item in definition.lights:
            data = bpy.data.lights.new(item.data_name, "AREA")
            data_identity = tag_resource(
                data,
                f"{item.logical_id}.data",
                receipt_id,
                step_id,
                action.name,
            )
            created.append(data_identity)
            data.color = item.color
            data.energy = item.energy
            data.shape = "DISK"
            data.size = item.size
            obj = bpy.data.objects.new(item.object_name, data)
            object_identity = tag_resource(
                obj,
                item.logical_id,
                receipt_id,
                step_id,
                action.name,
            )
            created.append(object_identity)
            obj.location = item.location
            direction = Vector(item.target) - Vector(item.location)
            obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
            collection.objects.link(obj)
            mutations.append(
                MutationRecord(
                    object_identity,
                    "users_collection",
                    (),
                    (collection_identity,),
                )
            )
        camera_data = bpy.data.cameras.new(definition.camera.data_name)
        camera_data_identity = tag_resource(
            camera_data,
            f"{definition.camera.logical_id}.data",
            receipt_id,
            step_id,
            action.name,
        )
        created.append(camera_data_identity)
        camera_data.lens = definition.camera.lens
        camera = bpy.data.objects.new(definition.camera.object_name, camera_data)
        camera_identity = tag_resource(
            camera,
            definition.camera.logical_id,
            receipt_id,
            step_id,
            action.name,
        )
        created.append(camera_identity)
        camera.location = definition.camera.location
        camera_direction = Vector(definition.camera.target) - Vector(
            definition.camera.location
        )
        camera.rotation_euler = camera_direction.to_track_quat(
            "-Z", "Y"
        ).to_euler()
        collection.objects.link(camera)
        mutations.append(
            MutationRecord(
                camera_identity,
                "users_collection",
                (),
                (collection_identity,),
            )
        )
        before_camera = scene.camera
        scene.camera = camera
        mutations.append(
            MutationRecord(scene_identity, "camera", before_camera, camera_identity)
        )
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


def _eevee_engine(scene: bpy.types.Scene) -> str:
    engine_property = scene.render.bl_rna.properties["engine"]
    identifiers = {item.identifier for item in engine_property.enum_items}
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        if candidate in identifiers:
            return candidate
    raise RuntimeError("This Blender build does not provide a supported Eevee engine")


def _eevee_samples_attribute(scene: bpy.types.Scene) -> str:
    settings = getattr(scene, "eevee", None)
    settings_rna = getattr(settings, "bl_rna", None)
    sample_property = (
        settings_rna.properties.get("taa_render_samples")
        if settings_rna is not None
        else None
    )
    if sample_property is None or sample_property.is_readonly:
        raise RuntimeError(
            "This Blender build does not expose a supported Eevee sample setting"
        )
    return "eevee.taa_render_samples"


def _set_recorded(
    target_identity: ResourceIdentity,
    target: Any,
    attribute: str,
    value: Any,
    mutations: list[MutationRecord],
) -> None:
    owner = target
    parts = attribute.split(".")
    for part in parts[:-1]:
        owner = getattr(owner, part)
    before = getattr(owner, parts[-1])
    setattr(owner, parts[-1], value)
    mutations.append(MutationRecord(target_identity, attribute, before, value))


def execute_render(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definition: RenderDefinition,
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    scene_identity, scene = owned_resource(registry, definition.scene_id, "SCENE")
    _collection_identity, collection = owned_resource(
        registry,
        COLLECTION_LOGICAL_ID,
        "COLLECTION",
    )
    if tuple(scene.collection.children) != (collection,):
        raise RuntimeError("Owned render scene is no longer isolated")
    ensure_collection_contents_tracked(collection, registry)
    camera_is_tracked = scene.camera is not None and any(
        identity.resource_type == "OBJECT"
        and resolve_resource(identity) is scene.camera
        for identity in registry.values()
    )
    world_is_tracked = scene.world is not None and any(
        identity.resource_type == "WORLD"
        and resolve_resource(identity) is scene.world
        for identity in registry.values()
    )
    if not camera_is_tracked:
        raise RuntimeError("Owned render scene has no owned camera")
    if not world_is_tracked:
        raise RuntimeError("Owned render scene has no owned world")
    receipt_id = new_receipt_id()
    output = render_output_root() / f"{definition.render_id}-{receipt_id}.png"
    if output.exists():
        raise RuntimeError(f"Render output already exists: {output.name}")
    engine = _eevee_engine(scene)
    samples_attribute = _eevee_samples_attribute(scene)
    mutations: list[MutationRecord] = []
    artifacts: list[ArtifactIdentity] = []
    try:
        _set_recorded(scene_identity, scene, "render.engine", engine, mutations)
        _set_recorded(
            scene_identity,
            scene,
            "render.resolution_x",
            definition.resolution_x,
            mutations,
        )
        _set_recorded(
            scene_identity,
            scene,
            "render.resolution_y",
            definition.resolution_y,
            mutations,
        )
        _set_recorded(
            scene_identity,
            scene,
            "render.resolution_percentage",
            definition.resolution_percentage,
            mutations,
        )
        _set_recorded(
            scene_identity,
            scene,
            "frame_current",
            definition.frame,
            mutations,
        )
        scene.frame_set(definition.frame)
        _set_recorded(
            scene_identity,
            scene,
            "render.image_settings.file_format",
            "PNG",
            mutations,
        )
        _set_recorded(scene_identity, scene, "render.filepath", str(output), mutations)
        _set_recorded(
            scene_identity,
            scene,
            samples_attribute,
            definition.samples,
            mutations,
        )
        with bpy.context.temp_override(scene=scene):
            result = bpy.ops.render.render(write_still=True)
        if result != {"FINISHED"} or not output.is_file():
            raise RuntimeError("Blender did not produce the preview artifact")
        image = bpy.data.images.get("Render Result")
        scale = definition.resolution_percentage / 100
        expected_width = round(definition.resolution_x * scale)
        expected_height = round(definition.resolution_y * scale)
        width = (
            int(image.size[0])
            if image is not None and image.size[0] > 0
            else expected_width
        )
        height = (
            int(image.size[1])
            if image is not None and image.size[1] > 0
            else expected_height
        )
        artifact = ArtifactIdentity(
            definition.render_id,
            str(output),
            hashlib.sha256(output.read_bytes()).hexdigest(),
            width,
            height,
        )
        artifacts.append(artifact)
        return make_receipt(
            receipt_id,
            step_id,
            action.name,
            [],
            mutations,
            artifacts,
            scene_identity,
        )
    except Exception:
        if output.is_file() and not artifacts:
            output.unlink()
        rollback_partial(receipt_id, step_id, action.name, [], mutations, artifacts)
        raise
