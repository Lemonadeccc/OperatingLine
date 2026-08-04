"""Headless end-to-end Blender test for the complete renderable snowman plan."""

import importlib.util
import json
import math
import os
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_renderable_extension",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_renderable_extension.operating_line.domain import (  # noqa: E402
    RESOURCE_PATH,
)
from operating_line_renderable_extension.operating_line.infrastructure import (  # noqa: E402
    build_resource_registry,
    find_artifact,
    resolve_resource,
)
from operating_line_renderable_extension.operating_line.infrastructure import (  # noqa: E402
    scene_preparation as scene_preparation_actions,
)
from operating_line_renderable_extension.operating_line.infrastructure.snowman_actions import (  # noqa: E402
    material as material_actions,
    model as model_actions,
    render as render_actions,
    rigging as rigging_actions,
)
from operating_line_renderable_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    OWNER_KEY,
    OWNER_VALUE,
    action_fcurves,
)


with RESOURCE_PATH.open(encoding="utf-8") as resource:
    PLAN = json.load(resource)

ACTION_STEPS = [step for step in PLAN["steps"] if step["action"] is not None]
ACTION_BY_ID = {step["id"]: step for step in ACTION_STEPS}
ACTION_INDEX = {step["id"]: index for index, step in enumerate(ACTION_STEPS)}


def assert_pointer(resource, pointer: int, label: str) -> None:
    assert resource is not None, f"{label} should still exist"
    assert resource.as_pointer() == pointer, f"{label} identity changed"


def call_next_expect_failure(message: str) -> None:
    try:
        result = bpy.ops.operating_line.next()
    except RuntimeError as error:
        assert message in str(error), f"Expected {message!r}, received {error!r}"
    else:
        assert result == {"CANCELLED"}
        report = operating_line.get_companion().last_report
        assert message in report["error"]


def call_back_expect_failure(message: str) -> None:
    try:
        result = bpy.ops.operating_line.back()
    except RuntimeError as error:
        assert message in str(error), f"Expected {message!r}, received {error!r}"
    else:
        assert result == {"CANCELLED"}
        report = operating_line.get_companion().last_report
        assert message in report["error"]


def remove_object_and_data(obj: bpy.types.Object) -> None:
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if isinstance(data, bpy.types.Mesh) and data.users == 0:
        bpy.data.meshes.remove(data)


def owned_resources() -> list[object]:
    collections = (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.collections,
        bpy.data.scenes,
        bpy.data.worlds,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.armatures,
        bpy.data.actions,
    )
    return [
        resource
        for resources in collections
        for resource in resources
        if resource.get(OWNER_KEY) == OWNER_VALUE
    ]


def assert_latest_step_satisfied(step_id: str) -> None:
    report = operating_line.get_companion().last_report
    expected_count = len(ACTION_BY_ID[step_id]["expectedObservations"])
    assert report["transition"] == "step_succeeded"
    assert report["stepId"] == step_id
    assert len(report["observations"]) == expected_count
    assert expected_count > 0
    assert all(item["satisfied"] is True for item in report["observations"]), report[
        "observations"
    ]


def node_by_type(node_tree, bl_idname: str):
    matches = tuple(
        node for node in node_tree.nodes if node.bl_idname == bl_idname
    )
    assert len(matches) == 1
    return matches[0]


def input_by_identifier(node, identifier: str):
    matches = tuple(
        socket for socket in node.inputs if socket.identifier == identifier
    )
    assert len(matches) == 1
    return matches[0]


def assert_vector_close(actual, expected) -> None:
    assert len(actual) == len(expected)
    assert all(
        math.isclose(actual_value, expected_value, abs_tol=1e-6)
        for actual_value, expected_value in zip(actual, expected)
    )


def assert_matrix_close(actual, expected) -> None:
    for actual_row, expected_row in zip(actual, expected):
        assert_vector_close(actual_row, expected_row)


def matrices_differ(actual, expected) -> bool:
    return any(
        not math.isclose(actual_value, expected_value, abs_tol=1e-6)
        for actual_row, expected_row in zip(actual, expected)
        for actual_value, expected_value in zip(actual_row, expected_row)
    )


def assert_localized_node_access() -> None:
    factory_mesh = bpy.data.objects["Cube"].data
    factory_material = factory_mesh.materials[0]
    factory_principled = node_by_type(
        factory_material.node_tree,
        "ShaderNodeBsdfPrincipled",
    )
    factory_output = node_by_type(
        factory_material.node_tree,
        "ShaderNodeOutputMaterial",
    )
    localized_factory_sockets = (
        (input_by_identifier(factory_principled, "Base Color"), "基础颜色"),
        (input_by_identifier(factory_principled, "Roughness"), "粗糙度"),
        (input_by_identifier(factory_principled, "Metallic"), "金属度"),
    )
    original_node_names = (factory_principled.name, factory_output.name)
    original_socket_names = tuple(
        socket.name for socket, _localized_name in localized_factory_sockets
    )
    try:
        factory_principled.name = "非英文原理化节点"
        factory_output.name = "非英文材质输出"
        for socket, localized_name in localized_factory_sockets:
            socket.name = localized_name
        assert scene_preparation_actions._matches_factory_material(factory_mesh) is True
    finally:
        factory_principled.name, factory_output.name = original_node_names
        for (socket, _localized_name), original_name in zip(
            localized_factory_sockets,
            original_socket_names,
        ):
            socket.name = original_name

    material_definition = material_actions.MaterialDefinition(
        "test.material.localized",
        "OperatingLine.TestLocalizedMaterial",
        (),
        (0.17, 0.31, 0.73, 1.0),
        0.64,
        0.28,
    )
    material = bpy.data.materials.new("OperatingLine.NodeAccessProbe")
    material.use_nodes = True
    principled = node_by_type(material.node_tree, "ShaderNodeBsdfPrincipled")
    output = node_by_type(material.node_tree, "ShaderNodeOutputMaterial")
    principled.name = "非英文原理化节点"
    output.name = "非英文材质输出"
    for identifier, localized_name in (
        ("Base Color", "基础颜色"),
        ("Roughness", "粗糙度"),
        ("Metallic", "金属度"),
    ):
        input_by_identifier(principled, identifier).name = localized_name

    material_actions._configure_material_nodes(material, material_definition)
    assert_vector_close(
        input_by_identifier(principled, "Base Color").default_value,
        material_definition.base_color,
    )
    assert math.isclose(
        input_by_identifier(principled, "Roughness").default_value,
        material_definition.roughness,
        abs_tol=1e-6,
    )
    assert math.isclose(
        input_by_identifier(principled, "Metallic").default_value,
        material_definition.metallic,
        abs_tol=1e-6,
    )

    material.node_tree.nodes.remove(output)
    node_count = len(material.node_tree.nodes)
    try:
        material_actions._configure_material_nodes(material, material_definition)
    except RuntimeError as error:
        assert "must contain exactly one ShaderNodeOutputMaterial node; found 0" in str(
            error
        )
    else:
        raise AssertionError("Missing Material Output node must fail explicitly")
    assert len(material.node_tree.nodes) == node_count
    output = material.node_tree.nodes.new("ShaderNodeOutputMaterial")
    output.name = "测试恢复的材质输出"

    material.node_tree.nodes.remove(principled)
    node_count = len(material.node_tree.nodes)
    try:
        material_actions._configure_material_nodes(material, material_definition)
    except RuntimeError as error:
        assert "must contain exactly one ShaderNodeBsdfPrincipled node; found 0" in str(
            error
        )
    else:
        raise AssertionError("Missing Principled node must fail explicitly")
    assert len(material.node_tree.nodes) == node_count
    bpy.data.materials.remove(material)

    scene_definition = render_actions.SceneDefinition(
        "test.scene.localized",
        "OperatingLine.TestLocalizedScene",
        "test.world.localized",
        "OperatingLine.TestLocalizedWorld",
        "snowman.collection",
        (0.09, 0.14, 0.22, 1.0),
        0.37,
    )
    world = bpy.data.worlds.new("OperatingLine.WorldNodeAccessProbe")
    world.use_nodes = True
    background = node_by_type(world.node_tree, "ShaderNodeBackground")
    background.name = "非英文背景节点"
    input_by_identifier(background, "Color").name = "颜色"
    input_by_identifier(background, "Strength").name = "强度"
    render_actions._configure_world(world, scene_definition)
    assert_vector_close(
        input_by_identifier(background, "Color").default_value,
        scene_definition.background_color,
    )
    assert math.isclose(
        input_by_identifier(background, "Strength").default_value,
        scene_definition.strength,
        abs_tol=1e-6,
    )

    world.node_tree.nodes.remove(background)
    node_count = len(world.node_tree.nodes)
    try:
        render_actions._configure_world(world, scene_definition)
    except RuntimeError as error:
        assert "must contain exactly one ShaderNodeBackground node; found 0" in str(
            error
        )
    else:
        raise AssertionError("Missing Background node must fail explicitly")
    assert len(world.node_tree.nodes) == node_count
    bpy.data.worlds.remove(world)


def execute_through(session, last_step_id: str) -> None:
    for expected_index in range(
        session.active_index + 1, ACTION_INDEX[last_step_id] + 1
    ):
        step_id = ACTION_STEPS[expected_index]["id"]
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert session.active_index == expected_index
        assert_latest_step_satisfied(step_id)


def main() -> None:
    assert PLAN["id"] == "snowman-demo"
    assert len(ACTION_STEPS) == 15
    assert os.environ.get("OPERATINGLINE_RENDER_OUTPUT_DIR")
    assert_localized_node_access()

    factory_objects = {name: bpy.data.objects[name] for name in ("Cube", "Camera", "Light")}
    factory_object_pointers = {
        name: obj.as_pointer() for name, obj in factory_objects.items()
    }
    factory_data_pointers = {
        name: obj.data.as_pointer() for name, obj in factory_objects.items()
    }
    factory_cube_materials = tuple(factory_objects["Cube"].data.materials)
    factory_scene = bpy.context.scene
    factory_scene_pointer = factory_scene.as_pointer()

    operating_line.register()
    session = operating_line.get_session()
    try:
        assert session.plan_id == PLAN["id"]
        assert session.revision == PLAN["revision"]
        assert tuple(step.id for step in session.steps) == tuple(
            step["id"] for step in ACTION_STEPS
        )
        assert bpy.context.scene.operating_line_replace_factory_scene is False
        assert bpy.ops.operating_line.start() == {"FINISHED"}

        # Partial compensation must also handle a collection created just
        # before it is linked into the scene. The original failure remains the
        # reported error and no untracked owned resource is orphaned.
        original_ensure_collection = model_actions._ensure_collection

        def fail_before_collection_link(
            registry,
            receipt_id,
            step_id,
            action_name,
            created,
        ):
            assert not registry
            collection = bpy.data.collections.new(model_actions.COLLECTION_NAME)
            collection_identity = model_actions.tag_resource(
                collection,
                model_actions.COLLECTION_LOGICAL_ID,
                receipt_id,
                step_id,
                action_name,
            )
            created.append(collection_identity)
            raise RuntimeError("Injected failure before collection link")

        model_actions._ensure_collection = fail_before_collection_link
        try:
            call_next_expect_failure("Injected failure before collection link")
        finally:
            model_actions._ensure_collection = original_ensure_collection
        assert session.active_index == -1
        assert session.receipts == {}
        assert bpy.data.collections.get(model_actions.COLLECTION_NAME) is None
        assert owned_resources() == []

        # Ground and the three snow volumes execute before the atomic face batch.
        execute_through(session, "snowman.model.head")

        # A conflict anywhere in a compound face batch must prevent every item.
        face_items = ACTION_BY_ID["snowman.details.face"]["action"]["arguments"][
            "items"
        ]
        nose_item = next(item for item in face_items if item["primitive"] == "cone")
        conflict_mesh = bpy.data.meshes.new(f"{nose_item['objectName']}.UserMesh")
        conflict_nose = bpy.data.objects.new(nose_item["objectName"], conflict_mesh)
        factory_scene.collection.objects.link(conflict_nose)
        created_before = {item["objectName"] for item in face_items if item is not nose_item}
        call_next_expect_failure(f"Cannot replace existing object: {nose_item['objectName']}")
        assert session.active_index == ACTION_INDEX["snowman.model.head"]
        assert len(session.receipts) == session.active_index + 1
        assert all(bpy.data.objects.get(name) is None for name in created_before)
        assert bpy.data.objects.get(nose_item["objectName"]) is conflict_nose
        remove_object_and_data(conflict_nose)

        # Finish details. Every declared observation must be satisfied after Next.
        execute_through(session, "snowman.details.arms")

        # A missing required shader node must fail the action and roll back the
        # just-created material instead of silently assigning an unconfigured one.
        snow_arguments = ACTION_BY_ID["snowman.materials.snow"]["action"]["arguments"]
        original_configure_material = material_actions._configure_material_nodes

        def reject_missing_principled(material, definition):
            material.use_nodes = True
            principled = node_by_type(
                material.node_tree,
                "ShaderNodeBsdfPrincipled",
            )
            material.node_tree.nodes.remove(principled)
            original_configure_material(material, definition)

        material_actions._configure_material_nodes = reject_missing_principled
        try:
            call_next_expect_failure(
                "must contain exactly one ShaderNodeBsdfPrincipled node; found 0"
            )
        finally:
            material_actions._configure_material_nodes = original_configure_material
        assert session.active_index == ACTION_INDEX["snowman.details.arms"]
        assert bpy.data.materials.get(snow_arguments["materialName"]) is None
        registry = build_resource_registry(session.receipts)
        assert all(
            len(resolve_resource(registry[logical_id]).material_slots) == 0
            for logical_id in snow_arguments["targets"]
        )

        # Material name conflicts are also checked before assignments are mutated.
        material_targets_before = {}
        registry = build_resource_registry(session.receipts)
        for logical_id in snow_arguments["targets"]:
            obj = resolve_resource(registry[logical_id])
            material_targets_before[logical_id] = tuple(
                slot.material for slot in obj.material_slots
            )
        conflict_material = bpy.data.materials.new(snow_arguments["materialName"])
        call_next_expect_failure(
            f"Cannot replace existing material: {snow_arguments['materialName']}"
        )
        assert session.active_index == ACTION_INDEX["snowman.details.arms"]
        assert len(session.receipts) == session.active_index + 1
        registry = build_resource_registry(session.receipts)
        for logical_id, before in material_targets_before.items():
            obj = resolve_resource(registry[logical_id])
            assert tuple(slot.material for slot in obj.material_slots) == before
        assert bpy.data.materials.get(snow_arguments["materialName"]) is conflict_material
        bpy.data.materials.remove(conflict_material)

        execute_through(session, "snowman.materials.ground")

        # Armature preflight rejects name conflicts before creating data or
        # changing any target parent. Successful binding preserves world space.
        rig_arguments = ACTION_BY_ID["snowman.animation.rig"]["action"]["arguments"]
        registry = build_resource_registry(session.receipts)
        binding_world_matrices = {
            binding["targetId"]: resolve_resource(
                registry[binding["targetId"]]
            ).matrix_world.copy()
            for binding in rig_arguments["bindings"]
        }
        armature_conflict_mesh = bpy.data.meshes.new(
            f"{rig_arguments['objectName']}.UserMesh"
        )
        armature_conflict = bpy.data.objects.new(
            rig_arguments["objectName"], armature_conflict_mesh
        )
        factory_scene.collection.objects.link(armature_conflict)
        call_next_expect_failure(
            f"Cannot replace existing object: {rig_arguments['objectName']}"
        )
        assert session.active_index == ACTION_INDEX["snowman.materials.ground"]
        assert bpy.data.armatures.get(rig_arguments["dataName"]) is None
        remove_object_and_data(armature_conflict)

        execute_through(session, "snowman.animation.rig")
        registry = build_resource_registry(session.receipts)
        armature = resolve_resource(registry[rig_arguments["armatureId"]])
        assert armature.type == "ARMATURE"
        for binding in rig_arguments["bindings"]:
            target = resolve_resource(registry[binding["targetId"]])
            assert target.parent is armature
            assert target.parent_type == "BONE"
            assert target.parent_bone == binding["boneName"]
            assert_matrix_close(
                target.matrix_world,
                binding_world_matrices[binding["targetId"]],
            )

        # Partial keyframe failure must clear the assigned Action, restore all
        # pose values, and leave the completed rig receipt intact.
        animation_arguments = ACTION_BY_ID["snowman.animation.pose"]["action"][
            "arguments"
        ]
        armature_pose_before = {
            bone.name: (
                bone.rotation_mode,
                tuple(bone.rotation_euler),
            )
            for bone in armature.pose.bones
        }
        original_insert_pose_keyframe = rigging_actions._insert_pose_keyframe
        insertion_count = [0]

        def fail_during_keyframe_insert(pose_bone, frame, bone_name):
            insertion_count[0] += 1
            if insertion_count[0] == 2:
                raise RuntimeError("Injected failure during pose keyframes")
            return original_insert_pose_keyframe(pose_bone, frame, bone_name)

        rigging_actions._insert_pose_keyframe = fail_during_keyframe_insert
        try:
            call_next_expect_failure("Injected failure during pose keyframes")
        finally:
            rigging_actions._insert_pose_keyframe = original_insert_pose_keyframe
        assert session.active_index == ACTION_INDEX["snowman.animation.rig"]
        assert bpy.data.actions.get(animation_arguments["actionName"]) is None
        assert armature.animation_data is None
        for bone in armature.pose.bones:
            rotation_mode, rotation_euler = armature_pose_before[bone.name]
            assert bone.rotation_mode == rotation_mode
            assert_vector_close(bone.rotation_euler, rotation_euler)

        execute_through(session, "snowman.animation.pose")
        animation_scene = bpy.context.scene
        original_frame = animation_scene.frame_current
        animated_targets = {
            logical_id: resolve_resource(registry[logical_id])
            for logical_id in ("snowman.face.nose", "snowman.arm.left")
        }
        animation_scene.frame_set(1)
        rest_matrices = {
            logical_id: target.matrix_world.copy()
            for logical_id, target in animated_targets.items()
        }
        animation_scene.frame_set(20)
        assert all(
            matrices_differ(target.matrix_world, rest_matrices[logical_id])
            for logical_id, target in animated_targets.items()
        )
        animation_scene.frame_set(40)
        for logical_id, target in animated_targets.items():
            assert_matrix_close(target.matrix_world, rest_matrices[logical_id])
        animation_scene.frame_set(original_frame)

        # A scene action can fail after both Scene and World datablocks exist
        # but before the World is assigned. Partial compensation accepts that
        # incomplete internal relation while still removing both datablocks.
        scene_arguments = ACTION_BY_ID["snowman.lighting.scene"]["action"]["arguments"]
        owned_before_scene_failure = {
            resource.as_pointer() for resource in owned_resources()
        }
        original_configure_world = render_actions._configure_world

        def fail_before_world_assignment(_world, _definition):
            raise RuntimeError("Injected failure before world assignment")

        render_actions._configure_world = fail_before_world_assignment
        try:
            call_next_expect_failure("Injected failure before world assignment")
        finally:
            render_actions._configure_world = original_configure_world
        assert session.active_index == ACTION_INDEX["snowman.animation.pose"]
        assert len(session.receipts) == session.active_index + 1
        assert bpy.data.scenes.get(scene_arguments["sceneName"]) is None
        assert bpy.data.worlds.get(scene_arguments["worldName"]) is None
        assert {
            resource.as_pointer() for resource in owned_resources()
        } == owned_before_scene_failure

        execute_through(session, "snowman.lighting.scene")

        # The isolated scene records the exact managed collection pointer. An
        # extra child collection is an external edit, so the next action stops
        # before creating any rig resources and keeps the scene receipt.
        registry = build_resource_registry(session.receipts)
        render_scene = resolve_resource(registry["snowman.render.scene"])
        external_scene_collection = bpy.data.collections.new(
            "UserRenderSceneCollection"
        )
        render_scene.collection.children.link(external_scene_collection)
        scene_index = session.active_index
        scene_receipt = session.receipts["snowman.lighting.scene"]
        call_next_expect_failure(
            "Completed resource was modified: "
            "snowman.render.scene.collection_children"
        )
        assert session.active_index == scene_index
        assert session.receipts["snowman.lighting.scene"] is scene_receipt
        assert tuple(render_scene.collection.children)[-1] is external_scene_collection
        bpy.data.collections.remove(external_scene_collection)

        # Rig preflight must reject a conflicting object before creating any light
        # data, fill light, or camera resource.
        rig_arguments = ACTION_BY_ID["snowman.lighting.rig"]["action"]["arguments"]
        key_light = rig_arguments["lights"][0]
        fill_light = rig_arguments["lights"][1]
        camera = rig_arguments["camera"]
        rig_conflict_mesh = bpy.data.meshes.new(f"{key_light['objectName']}.UserMesh")
        rig_conflict = bpy.data.objects.new(key_light["objectName"], rig_conflict_mesh)
        factory_scene.collection.objects.link(rig_conflict)
        call_next_expect_failure(
            f"Cannot replace existing object: {key_light['objectName']}"
        )
        assert session.active_index == ACTION_INDEX["snowman.lighting.scene"]
        assert len(session.receipts) == session.active_index + 1
        assert bpy.data.objects.get(fill_light["objectName"]) is None
        assert bpy.data.objects.get(camera["objectName"]) is None
        assert bpy.data.lights.get(key_light["dataName"]) is None
        assert bpy.data.lights.get(fill_light["dataName"]) is None
        assert bpy.data.cameras.get(camera["dataName"]) is None
        remove_object_and_data(rig_conflict)

        execute_through(session, "snowman.lighting.rig")

        # A user object linked into the owned collection must never enter the
        # isolated render. Render preflight rejects it without creating a file.
        registry = build_resource_registry(session.receipts)
        render_collection = resolve_resource(registry["snowman.collection"])
        intruder_mesh = bpy.data.meshes.new("UserRenderIntruder.Mesh")
        intruder = bpy.data.objects.new("UserRenderIntruder", intruder_mesh)
        render_collection.objects.link(intruder)
        call_next_expect_failure(
            "OperatingLine collection contains an untracked object or child collection"
        )
        assert session.active_index == ACTION_INDEX["snowman.lighting.rig"]
        assert len(session.receipts) == session.active_index + 1
        assert find_artifact(session.receipts, "snowman.render.preview") is None
        remove_object_and_data(intruder)

        # A host without a supported Eevee samples property must fail before
        # touching render settings instead of silently ignoring the plan value.
        render_scene = resolve_resource(registry["snowman.render.scene"])
        render_settings_before = (
            render_scene.render.engine,
            render_scene.render.resolution_x,
            render_scene.render.resolution_y,
            render_scene.render.resolution_percentage,
            render_scene.frame_current,
            render_scene.render.image_settings.file_format,
            render_scene.render.filepath,
            render_scene.eevee.taa_render_samples,
        )
        original_samples_attribute = render_actions._eevee_samples_attribute

        def reject_missing_samples_capability(_scene):
            raise RuntimeError(
                "This Blender build does not expose a supported Eevee sample setting"
            )

        render_actions._eevee_samples_attribute = reject_missing_samples_capability
        try:
            call_next_expect_failure(
                "This Blender build does not expose a supported Eevee sample setting"
            )
        finally:
            render_actions._eevee_samples_attribute = original_samples_attribute
        assert session.active_index == ACTION_INDEX["snowman.lighting.rig"]
        assert len(session.receipts) == session.active_index + 1
        assert find_artifact(session.receipts, "snowman.render.preview") is None
        assert (
            render_scene.render.engine,
            render_scene.render.resolution_x,
            render_scene.render.resolution_y,
            render_scene.render.resolution_percentage,
            render_scene.frame_current,
            render_scene.render.image_settings.file_format,
            render_scene.render.filepath,
            render_scene.eevee.taa_render_samples,
        ) == render_settings_before

        execute_through(session, ACTION_STEPS[-1]["id"])

        assert len(session.receipts) == len(ACTION_STEPS)
        assert operating_line.get_companion().last_report["phase"] == "completed"
        registry = build_resource_registry(session.receipts)

        render_arguments = ACTION_BY_ID["snowman.render.preview"]["action"]["arguments"]
        artifact = find_artifact(session.receipts, render_arguments["renderId"])
        assert artifact is not None
        artifact_path = Path(artifact.path)
        assert artifact_path.parent == Path(
            os.environ["OPERATINGLINE_RENDER_OUTPUT_DIR"]
        ).resolve()
        png = artifact_path.read_bytes()
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        assert int.from_bytes(png[16:20], "big") == render_arguments["resolutionX"]
        assert int.from_bytes(png[20:24], "big") == render_arguments["resolutionY"]
        assert (artifact.width, artifact.height) == (
            render_arguments["resolutionX"],
            render_arguments["resolutionY"],
        )

        render_scene = resolve_resource(registry["snowman.render.scene"])
        render_collection = resolve_resource(registry["snowman.collection"])
        render_world = resolve_resource(registry["snowman.render.world"])
        active_camera = resolve_resource(registry["snowman.camera.preview"])
        assert tuple(render_scene.collection.children) == (render_collection,)
        assert render_scene.world is render_world
        assert render_scene.camera is active_camera
        assert render_scene.eevee.taa_render_samples == render_arguments["samples"]
        assert render_scene.frame_current == render_arguments["frame"]
        assert factory_objects["Cube"].name not in render_scene.objects
        assert all(obj.get(OWNER_KEY) == OWNER_VALUE for obj in render_scene.objects)

        armature_arguments = ACTION_BY_ID["snowman.animation.rig"]["action"][
            "arguments"
        ]
        animation_arguments = ACTION_BY_ID["snowman.animation.pose"]["action"][
            "arguments"
        ]
        armature = resolve_resource(registry[armature_arguments["armatureId"]])
        animation = resolve_resource(registry[animation_arguments["actionId"]])
        assert armature.type == "ARMATURE"
        assert armature.animation_data.action is animation
        assert tuple(animation.frame_range) == (1.0, 40.0)
        assert {bone.name for bone in armature.data.bones} == {
            item["boneName"] for item in armature_arguments["bones"]
        }
        for binding in armature_arguments["bindings"]:
            target = resolve_resource(registry[binding["targetId"]])
            assert target.parent is armature
            assert target.parent_bone == binding["boneName"]

        light_objects = [
            resolve_resource(registry[logical_id])
            for logical_id in ("snowman.light.key", "snowman.light.fill")
        ]
        assert all(obj.type == "LIGHT" and obj.data.type == "AREA" for obj in light_objects)
        assert all(obj.name in render_collection.objects for obj in light_objects)

        expected_materials = {
            "snowman.body.lower": "snowman.material.snow",
            "snowman.face.nose": "snowman.material.carrot",
            "snowman.face.eye.left": "snowman.material.coal",
            "snowman.arm.left": "snowman.material.wood",
            "snowman.ground": "snowman.material.ground",
        }
        for object_id, material_id in expected_materials.items():
            obj = resolve_resource(registry[object_id])
            material = resolve_resource(registry[material_id])
            assert tuple(slot.material for slot in obj.material_slots) == (material,)

        for name, pointer in factory_object_pointers.items():
            assert_pointer(bpy.data.objects.get(name), pointer, name)
            assert_pointer(
                bpy.data.objects[name].data,
                factory_data_pointers[name],
                f"{name}.data",
            )
        assert_pointer(
            bpy.data.scenes.get(factory_scene.name),
            factory_scene_pointer,
            "factory scene",
        )

        # Compare-and-restore refuses to overwrite a user edit and preserves the
        # complete receipt/index state so Back can be retried after resolution.
        render_scene.render.resolution_x = render_arguments["resolutionX"] + 1
        call_back_expect_failure(
            "Cannot rollback modified resource: "
            "snowman.render.scene.render.resolution_x"
        )
        assert session.active_index == len(ACTION_STEPS) - 1
        assert len(session.receipts) == len(ACTION_STEPS)
        assert artifact_path.is_file()
        assert render_scene.render.resolution_y == render_arguments["resolutionY"]
        assert operating_line.get_companion().last_report["transition"] == "error"
        render_scene.render.resolution_x = render_arguments["resolutionX"]

        # Full reverse traversal removes the artifact and every owned datablock.
        for expected_index in reversed(range(len(ACTION_STEPS))):
            assert bpy.ops.operating_line.back() == {"FINISHED"}
            assert session.active_index == expected_index - 1
            assert len(session.receipts) == expected_index

        assert session.receipts == {}
        assert session.active_index == -1
        assert not artifact_path.exists()
        assert owned_resources() == []
        for name, pointer in factory_object_pointers.items():
            assert_pointer(bpy.data.objects.get(name), pointer, name)
            assert_pointer(
                bpy.data.objects[name].data,
                factory_data_pointers[name],
                f"{name}.data",
            )
        assert_pointer(
            bpy.data.scenes.get(factory_scene.name),
            factory_scene_pointer,
            "factory scene",
        )

        # Editing a generated keyframe changes the recorded Action signature.
        # Back must preserve that user edit and retain the animation receipt.
        session.start()
        execute_through(session, "snowman.animation.pose")
        registry = build_resource_registry(session.receipts)
        wave_action = resolve_resource(registry["snowman.animation.wave"])
        edited_point = action_fcurves(wave_action)[0].keyframe_points[0]
        original_interpolation = edited_point.interpolation
        edited_point.interpolation = "LINEAR"
        call_back_expect_failure(
            "Cannot rollback modified resource: "
            "snowman.animation.wave.action_keyframes"
        )
        assert session.active_index == ACTION_INDEX["snowman.animation.pose"]
        assert resolve_resource(registry["snowman.animation.wave"]) is wave_action
        edited_point.interpolation = original_interpolation
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        session.reset()
        assert owned_resources() == []

        # An owned Action assigned to a user object is an external reference.
        # Back retains the complete animation receipt until that link is removed.
        session.start()
        execute_through(session, "snowman.animation.pose")
        registry = build_resource_registry(session.receipts)
        wave_action = resolve_resource(registry["snowman.animation.wave"])
        factory_cube = factory_objects["Cube"]
        factory_cube.animation_data_create().action = wave_action
        animation_index = session.active_index
        animation_receipts = dict(session.receipts)
        call_back_expect_failure(
            "Cannot rollback externally used action: snowman.animation.wave"
        )
        assert session.active_index == animation_index
        assert dict(session.receipts) == animation_receipts
        assert factory_cube.animation_data.action is wave_action
        factory_cube.animation_data_clear()
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        session.reset()
        assert owned_resources() == []

        # A material used by an object outside the walkthrough is user-owned
        # state. Back must make no changes and retain the receipt until that
        # external reference is removed.
        session.start()
        execute_through(session, "snowman.materials.snow")
        registry = build_resource_registry(session.receipts)
        snow_material = resolve_resource(registry["snowman.material.snow"])
        factory_cube = factory_objects["Cube"]
        factory_cube.data.materials.append(snow_material)
        material_index = session.active_index
        material_receipts = dict(session.receipts)
        call_back_expect_failure(
            "Cannot rollback externally used material: snowman.material.snow"
        )
        assert session.active_index == material_index
        assert dict(session.receipts) == material_receipts
        assert tuple(factory_cube.data.materials) == (
            *factory_cube_materials,
            snow_material,
        )
        factory_cube.data.materials.pop(index=len(factory_cube.data.materials) - 1)
        assert tuple(factory_cube.data.materials) == factory_cube_materials
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        session.reset()
        assert session.active_index == -1
        assert session.receipts == {}
        assert owned_resources() == []

        # A copied object sharing an owned mesh keeps that mesh alive. The
        # rollback preflight must reject the whole step before deleting either
        # the original object or its data.
        session.start()
        execute_through(session, "snowman.model.body_lower")
        registry = build_resource_registry(session.receipts)
        lower_body = resolve_resource(registry["snowman.body.lower"])
        lower_mesh = resolve_resource(registry["snowman.body.lower.mesh"])
        external_link = bpy.data.collections.new("UserExternalObjectLink")
        factory_scene.collection.children.link(external_link)
        external_link.objects.link(lower_body)
        lower_index = session.active_index
        lower_receipts = dict(session.receipts)
        call_back_expect_failure(
            "Cannot rollback modified resource: "
            "snowman.body.lower.users_collection"
        )
        assert session.active_index == lower_index
        assert dict(session.receipts) == lower_receipts
        assert lower_body in tuple(external_link.objects)
        external_link.objects.unlink(lower_body)
        bpy.data.collections.remove(external_link)

        shared_copy = lower_body.copy()
        shared_copy.name = "UserSharedLowerBody"
        factory_scene.collection.objects.link(shared_copy)
        call_back_expect_failure(
            "Cannot rollback externally used data: snowman.body.lower.mesh"
        )
        assert session.active_index == lower_index
        assert dict(session.receipts) == lower_receipts
        assert resolve_resource(registry["snowman.body.lower"]) is lower_body
        assert resolve_resource(registry["snowman.body.lower.mesh"]) is lower_mesh
        assert shared_copy.data is lower_mesh
        bpy.data.objects.remove(shared_copy, do_unlink=True)
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        session.reset()
        assert owned_resources() == []

        # Deleting an owned object manually is already a partial compensation,
        # not an unresolvable conflict. Back removes the remaining mesh receipt
        # resources and can continue to the start.
        session.start()
        execute_through(session, "snowman.model.body_lower")
        registry = build_resource_registry(session.receipts)
        lower_body = resolve_resource(registry["snowman.body.lower"])
        lower_mesh = resolve_resource(registry["snowman.body.lower.mesh"])
        lower_mesh_name = lower_mesh.name
        bpy.data.objects.remove(lower_body, do_unlink=True)
        assert lower_mesh.users == 0
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert bpy.data.meshes.get(lower_mesh_name) is None
        session.reset()
        assert owned_resources() == []

        # A Collection can be moved from one Scene root to another without
        # changing its users count. Rollback compares the exact parent identity
        # and must not mistake an equal-count external relink for the original.
        session.start()
        execute_through(session, "snowman.scene.ground")
        registry = build_resource_registry(session.receipts)
        managed_collection = resolve_resource(registry["snowman.collection"])
        external_parent_scene = bpy.data.scenes.new("UserExternalParentScene")
        factory_scene.collection.children.unlink(managed_collection)
        external_parent_scene.collection.children.link(managed_collection)
        assert managed_collection.users == 1
        ground_receipt = session.receipts["snowman.scene.ground"]
        call_back_expect_failure(
            "Cannot rollback externally linked collection: snowman.collection"
        )
        assert session.active_index == 0
        assert session.receipts["snowman.scene.ground"] is ground_receipt
        assert tuple(external_parent_scene.collection.children) == (
            managed_collection,
        )
        external_parent_scene.collection.children.unlink(managed_collection)
        factory_scene.collection.children.link(managed_collection)
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        bpy.data.scenes.remove(external_parent_scene)
        assert session.active_index == -1
        assert session.receipts == {}
        assert owned_resources() == []

        # Child collections are outside the managed collection receipt. Back
        # keeps the ground step intact instead of silently orphaning the child.
        session.start()
        execute_through(session, "snowman.scene.ground")
        registry = build_resource_registry(session.receipts)
        managed_collection = resolve_resource(registry["snowman.collection"])
        child_collection = bpy.data.collections.new("UserChildCollection")
        managed_collection.children.link(child_collection)
        ground_receipt = session.receipts["snowman.scene.ground"]
        call_back_expect_failure(
            "Cannot rollback collection with external contents: snowman.collection"
        )
        assert session.active_index == 0
        assert session.receipts["snowman.scene.ground"] is ground_receipt
        assert managed_collection.children.get(child_collection.name) is child_collection

        # Disabling the extension must not fail or discard the retained receipt.
        # Re-enabling in the same Blender process lets the user resolve the
        # conflict and retry Back safely.
        operating_line.unregister()
        assert operating_line.get_session() is session
        assert session.receipts["snowman.scene.ground"] is ground_receipt
        operating_line.register()
        assert operating_line.get_session() is session
        bpy.data.collections.remove(child_collection)
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert session.active_index == -1
        assert session.receipts == {}
        assert owned_resources() == []
    finally:
        operating_line.unregister()

    assert owned_resources() == []
    print(
        f"OperatingLine complete snowman test passed: {len(ACTION_STEPS)} steps, "
        "320x320 PNG, full rollback"
    )


if __name__ == "__main__":
    main()
