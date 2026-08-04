"""Conservative cleanup of an untouched Blender factory-startup scene."""

import math

import bpy

from .snowman_actions.node_access import find_unique_input, find_unique_node


_FACTORY_OBJECTS = {
    "Cube": {
        "type": "MESH",
        "location": (0.0, 0.0, 0.0),
        "rotation": (0.0, 0.0, 0.0),
    },
    "Camera": {
        "type": "CAMERA",
        "location": (7.358891, -6.925791, 4.958309),
        "rotation": (1.109319, 0.0, 0.814928),
    },
    "Light": {
        "type": "LIGHT",
        "location": (4.076245, 1.005454, 5.903862),
        "rotation": (0.650328, 0.055217, 1.866391),
    },
}
_FACTORY_CUBE_VERTICES = {
    (x, y, z) for x in (-1.0, 1.0) for y in (-1.0, 1.0) for z in (-1.0, 1.0)
}


def _matches_vector(actual, expected) -> bool:
    return all(
        math.isclose(actual_value, expected_value, abs_tol=1e-5)
        for actual_value, expected_value in zip(actual, expected)
    )


def _matches_factory_object(
    obj: bpy.types.Object,
    expected: dict,
    default_collection: bpy.types.Collection,
) -> bool:
    if obj.type != expected["type"] or obj.data is None or obj.data.name != obj.name:
        return False
    if not _matches_vector(obj.location, expected["location"]):
        return False
    if not _matches_vector(obj.rotation_euler, expected["rotation"]):
        return False
    if not _matches_vector(obj.scale, (1.0, 1.0, 1.0)):
        return False
    if len(obj.users_collection) != 1 or obj.users_collection[0] != default_collection:
        return False
    if (
        obj.parent is not None
        or obj.animation_data is not None
        or len(obj.modifiers) != 0
        or len(obj.constraints) != 0
        or list(obj.keys())
        or list(obj.data.keys())
    ):
        return False
    if obj.name == "Cube":
        mesh = obj.data
        return (
            isinstance(mesh, bpy.types.Mesh)
            and len(mesh.vertices) == 8
            and len(mesh.edges) == 12
            and len(mesh.polygons) == 6
            and {tuple(vertex.co) for vertex in mesh.vertices}
            == _FACTORY_CUBE_VERTICES
            and mesh.shape_keys is None
            and len(mesh.uv_layers) == 1
            and mesh.uv_layers[0].name == "UVMap"
            and _matches_factory_material(mesh)
        )
    if obj.name == "Camera":
        camera = obj.data
        return (
            isinstance(camera, bpy.types.Camera)
            and camera.type == "PERSP"
            and math.isclose(camera.lens, 50.0, abs_tol=1e-5)
            and math.isclose(camera.sensor_width, 36.0, abs_tol=1e-5)
            and math.isclose(camera.sensor_height, 24.0, abs_tol=1e-5)
            and math.isclose(camera.shift_x, 0.0, abs_tol=1e-5)
            and math.isclose(camera.shift_y, 0.0, abs_tol=1e-5)
            and math.isclose(camera.clip_start, 0.1, abs_tol=1e-5)
            and math.isclose(camera.clip_end, 100.0, abs_tol=1e-5)
            and math.isclose(camera.display_size, 1.0, abs_tol=1e-5)
        )
    if obj.name == "Light":
        light = obj.data
        return (
            isinstance(light, bpy.types.Light)
            and light.type == "POINT"
            and math.isclose(light.energy, 1000.0, abs_tol=1e-5)
            and _matches_vector(light.color, (1.0, 1.0, 1.0))
            and math.isclose(light.shadow_soft_size, 0.1, abs_tol=1e-5)
        )
    return True


def _matches_factory_material(mesh: bpy.types.Mesh) -> bool:
    if len(mesh.materials) != 1:
        return False
    material = mesh.materials[0]
    if material is None or material.name != "Material" or not material.use_nodes:
        return False
    if list(material.keys()) or material.node_tree is None:
        return False
    principled = find_unique_node(
        material.node_tree,
        "ShaderNodeBsdfPrincipled",
    )
    output = find_unique_node(
        material.node_tree,
        "ShaderNodeOutputMaterial",
    )
    if principled is None or output is None:
        return False
    base_color = find_unique_input(principled, "Base Color")
    metallic = find_unique_input(principled, "Metallic")
    roughness = find_unique_input(principled, "Roughness")
    if base_color is None or metallic is None or roughness is None:
        return False
    node_types = {node.bl_idname for node in material.node_tree.nodes}
    return (
        _matches_vector(material.diffuse_color, (0.8, 0.8, 0.8, 1.0))
        and math.isclose(material.metallic, 0.0, abs_tol=1e-5)
        and math.isclose(material.roughness, 0.5, abs_tol=1e-5)
        and _matches_vector(base_color.default_value, (0.8, 0.8, 0.8, 1.0))
        and math.isclose(metallic.default_value, 0.0, abs_tol=1e-5)
        and math.isclose(roughness.default_value, 0.5, abs_tol=1e-5)
        and node_types == {"ShaderNodeOutputMaterial", "ShaderNodeBsdfPrincipled"}
        and len(material.node_tree.nodes) == 2
        and len(material.node_tree.links) == 1
    )


def remove_factory_startup_objects(scene: bpy.types.Scene) -> bool:
    """Remove only the jointly recognized, untouched factory-startup trio.

    The three-object signature is deliberately atomic. If a user has edited or
    replaced any member, or the scene contains any additional object, nothing
    is removed.
    """

    if {obj.name for obj in scene.objects} != set(_FACTORY_OBJECTS):
        return False
    default_collection = scene.collection.children.get("Collection")
    if default_collection is None:
        return False
    objects = {name: scene.objects.get(name) for name in _FACTORY_OBJECTS}
    if any(obj is None for obj in objects.values()):
        return False
    if not all(
        _matches_factory_object(objects[name], expected, default_collection)
        for name, expected in _FACTORY_OBJECTS.items()
    ):
        return False

    for obj in objects.values():
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Camera):
                bpy.data.cameras.remove(data)
            elif isinstance(data, bpy.types.Light):
                bpy.data.lights.remove(data)
    return True
