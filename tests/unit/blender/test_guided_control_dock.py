"""Unit coverage for the OperatingLine-owned Geometry Nodes control dock."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
    / "presentation"
    / "guided_control_dock.py"
)
SPEC = spec_from_file_location("operating_line_guided_control_dock_test", MODULE_PATH)
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class _Layout:
    def __init__(self, events=None):
        self.events = events if events is not None else []

    def box(self):
        return _Layout(self.events)

    def row(self, **_kwargs):
        return _Layout(self.events)

    def label(self, *, text, **_kwargs):
        self.events.append(("label", text))

    def operator(self, operator_id, *, text, **_kwargs):
        target = SimpleNamespace()
        self.events.append(("operator", operator_id, text, target))
        return target


def _operation(
    ordinal,
    operation_id,
    label,
    *,
    parameter_name=None,
    value=None,
    connection=None,
):
    parameters = ()
    if parameter_name is not None:
        parameters = (
            SimpleNamespace(
                name=parameter_name,
                value=value,
                display_value=str(value),
                resolved=True,
            ),
        )
    return SimpleNamespace(
        ordinal=ordinal,
        operation_id=operation_id,
        label=label,
        parameters=parameters,
        connection=connection,
    )


def _fixture():
    step = SimpleNamespace(
        id="geometry.transform",
        action=SimpleNamespace(name=MODULE.TRANSFORM_GEOMETRY_ACTION_NAME),
    )
    operations = (
        _operation(1, "workspace", "Geometry Nodes"),
        _operation(
            5,
            "translation",
            "Set Translation",
            parameter_name="translation",
            value=[1, 2, 3],
        ),
        _operation(
            6,
            "rotation",
            "Set Rotation",
            parameter_name="rotation",
            value=[0.1, 0.2, 0.3],
        ),
        _operation(
            7,
            "scale",
            "Set Scale",
            parameter_name="scale",
            value=[1.5, 1.5, 1.5],
        ),
        _operation(
            9,
            "connect-input",
            "Connect input",
            connection=SimpleNamespace(
                from_node="NodeGroupInput",
                from_socket="Geometry",
                to_node="GeometryNodeTransform",
                to_socket="Geometry",
            ),
        ),
        _operation(
            10,
            "connect-output",
            "Connect output",
            connection=SimpleNamespace(
                from_node="GeometryNodeTransform",
                from_socket="Geometry",
                to_node="NodeGroupOutput",
                to_socket="Geometry",
            ),
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.TRANSFORM_GEOMETRY_RECIPE_ID,
        cursor_token="cursor-token",
        focused_ordinal=5,
        operations=operations,
    )
    return step, snapshot


def _light_trails_fixture(*, focused_ordinal=5):
    step = SimpleNamespace(
        id="geometry.light-trails",
        action=SimpleNamespace(name=MODULE.LIGHT_TRAILS_ACTION_NAME),
    )
    scalar_values = (
        (5, "tileLength", 20.0),
        (7, "pointsPerTrail", 48),
        (9, "trailCount", 12),
        (10, "trailSpacing", 0.22),
        (15, "noiseScale", 0.4),
        (16, "noiseDetail", 3.0),
        (17, "noiseRoughness", 0.55),
        (18, "noiseSeed", 7.0),
        (21, "height", 1.8),
        (27, "profileSides", 4),
        (28, "profileRadius", 0.025),
        (31, "tileRepeatCount", 3),
    )
    scalar_operations = tuple(
        _operation(
            ordinal,
            f"projection.{name}",
            f"Set {name}",
            parameter_name=name,
            value=value,
        )
        for ordinal, name, value in scalar_values
    )
    structure_operations = tuple(
        _operation(ordinal, operation_id, label)
        for ordinal, operation_id, label in (
            (2, "semantic.new_geometry_modifier", "Create Geometry Nodes modifier"),
            (3, "node.light_trails.group_input", "Create group input"),
            (4, "node.light_trails.half_tile_line", "Create half-tile line"),
            (6, "node.light_trails.trail_resolution", "Create trail resolution"),
            (8, "node.light_trails.trail_rows", "Create trail rows"),
            (11, "node.light_trails.trail_instances", "Create trail instances"),
            (12, "node.light_trails.realize_trails", "Create realize trails"),
            (13, "node.light_trails.trail_position", "Create trail position"),
            (14, "node.light_trails.terrain_noise", "Create terrain noise"),
            (19, "node.light_trails.center_noise", "Create center noise"),
            (20, "node.light_trails.scale_height", "Create scale height"),
            (22, "node.light_trails.z_offset", "Create Z offset"),
            (23, "node.light_trails.displace_trails", "Create displace trails"),
            (24, "node.light_trails.mirror_half_tile", "Create mirror half tile"),
            (25, "node.light_trails.mirrored_tile", "Create mirrored tile"),
            (26, "node.light_trails.trail_profile", "Create trail profile"),
            (29, "node.light_trails.curve_to_mesh", "Create curve to mesh"),
            (30, "node.light_trails.loop_tiles", "Create loop tiles"),
            (32, "node.light_trails.tile_instances", "Create tile instances"),
            (33, "node.light_trails.realize_tiles", "Create realize tiles"),
            (34, "node.light_trails.group_output", "Create group output"),
        )
    )
    operations = tuple(
        sorted(
            (*scalar_operations, *structure_operations),
            key=lambda operation: operation.ordinal,
        )
    ) + (
        _operation(
            53,
            "semantic.connect_light_trails.realize_to_output",
            "Connect Realize Tiles to Group Output",
            connection=SimpleNamespace(
                from_node="node-name:OperatingLine Realize Tiles",
                from_socket="Geometry",
                to_node="node-name:OperatingLine Output",
                to_socket="Geometry",
            ),
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.LIGHT_TRAILS_RECIPE_ID,
        cursor_token="light-trails-cursor",
        focused_ordinal=focused_ordinal,
        operations=operations,
    )
    step.action.arguments = {
        "modifierName": "OperatingLine.LightTrails",
        "nodeGroupName": "OperatingLine.LightTrailsNodes",
        **{name: value for _ordinal, name, value in scalar_values},
    }
    return step, snapshot


def _pose_animation_fixture(*, focused_ordinal=7):
    keyframes = [
        {
            "frame": 1,
            "poses": [
                {
                    "boneName": "Root",
                    "rotationEuler": [0.0, 0.0, 0.25],
                    "location": [1.0, 2.0, 3.0],
                    "scale": [1.0, 1.0, 1.0],
                }
            ],
        }
    ]
    step = SimpleNamespace(
        id="animation.pose",
        action=SimpleNamespace(
            name=MODULE.POSE_ANIMATION_ACTION_NAME,
            arguments={
                "armatureId": "rig.hero",
                "actionId": "action.hero",
                "actionName": "HeroPose",
                "keyframes": keyframes,
                "interpolation": "LINEAR",
                "extrapolation": "CONSTANT",
            },
        ),
    )
    operations = (
        _operation(
            1,
            "workspace.animation",
            "Open Animation workspace",
            parameter_name="armatureId",
            value="rig.hero",
        ),
        _operation(
            4,
            "semantic.create_pose_action",
            "Create Pose Action",
        ),
        _operation(
            5,
            "projection.semantic.pose_animation.action_name",
            "Set Action name",
            parameter_name="actionName",
            value="HeroPose",
        ),
        _operation(
            7,
            "projection.semantic.pose_animation.keyframes",
            "Set keyframes",
            parameter_name="keyframes",
            value=keyframes,
        ),
        _operation(
            9,
            "projection.semantic.pose_animation.interpolation",
            "Set interpolation",
            parameter_name="interpolation",
            value="LINEAR",
        ),
        _operation(
            11,
            "projection.semantic.pose_animation.extrapolation",
            "Set extrapolation",
            parameter_name="extrapolation",
            value="CONSTANT",
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.POSE_ANIMATION_RECIPE_ID,
        cursor_token="pose-cursor",
        focused_ordinal=focused_ordinal,
        operations=operations,
    )
    return step, snapshot


def _armature_fixture(*, focused_ordinal=6):
    bones = [
        {
            "boneName": "OperatingLine.Root",
            "head": [0.0, 0.0, 0.0],
            "tail": [0.0, 0.0, 1.0],
            "parentName": None,
        },
        {
            "boneName": "OperatingLine.Tip",
            "head": [0.0, 0.0, 1.0],
            "tail": [0.25, 0.0, 2.0],
            "parentName": "OperatingLine.Root",
        },
    ]
    bindings = [
        {"targetId": "snowman.eye.left", "boneName": "OperatingLine.Tip"}
    ]
    step = SimpleNamespace(
        id="rig.armature",
        action=SimpleNamespace(
            name=MODULE.ARMATURE_ACTION_NAME,
            arguments={
                "armatureId": "rig.hero",
                "objectName": "OperatingLine.HeroRig",
                "dataName": "OperatingLine.HeroRigData",
                "collectionId": "snowman.collection",
                "bones": bones,
                "bindings": bindings,
            },
        ),
    )
    operations = (
        _operation(1, "workspace.layout", "Open Layout workspace"),
        _operation(2, "menu.add_armature", "Create Armature"),
        _operation(
            3,
            "projection.semantic.armature.object_name",
            "Set Object name",
            parameter_name="objectName",
            value="OperatingLine.HeroRig",
        ),
        _operation(
            4,
            "projection.semantic.armature.data_name",
            "Set Data name",
            parameter_name="dataName",
            value="OperatingLine.HeroRigData",
        ),
        _operation(
            6,
            "projection.semantic.armature.bones",
            "Set bones",
            parameter_name="bones",
            value=bones,
        ),
        _operation(
            8,
            "projection.semantic.armature.bindings",
            "Set bindings",
            parameter_name="bindings",
            value=bindings,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.ARMATURE_RECIPE_ID,
        cursor_token="armature-cursor",
        focused_ordinal=focused_ordinal,
        operations=operations,
    )
    return step, snapshot


def _skin_weights_fixture(*, focused_ordinal=5):
    weights = [
        {
            "vertexIndex": 0,
            "influences": [{"boneName": "OperatingLine.Root", "weight": 1.0}],
        }
    ]
    step = SimpleNamespace(
        id="rig.skin-weights",
        action=SimpleNamespace(
            name=MODULE.SKIN_WEIGHTS_ACTION_NAME,
            arguments={
                "targetId": "skin.target",
                "armatureId": "skin.armature",
                "modifierId": "skin.modifier",
                "modifierName": "OperatingLine.SkinArmature",
                "preserveVolume": True,
                "weights": weights,
            },
        ),
    )
    operations = (
        _operation(1, "workspace.layout", "Open Layout workspace"),
        _operation(
            5,
            "projection.semantic.skin_weights.weights",
            "Assign normalized weights",
            parameter_name="weights",
            value=weights,
        ),
        _operation(
            7,
            "projection.semantic.skin_weights.preserve_volume",
            "Set Preserve Volume",
            parameter_name="preserveVolume",
            value=True,
        ),
        _operation(
            8,
            "projection.semantic.skin_weights.modifier_name",
            "Set Modifier name",
            parameter_name="modifierName",
            value="OperatingLine.SkinArmature",
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.SKIN_WEIGHTS_RECIPE_ID,
        cursor_token="skin-weights-cursor",
        focused_ordinal=focused_ordinal,
        operations=operations,
    )
    return step, snapshot


def _solidify_fixture(*, focused_ordinal=3):
    arguments = {
        "targetId": "mesh.shell",
        "modifierId": "modifier.solidify",
        "modifierName": "OperatingLine.Shell",
        "thickness": 0.125,
        "offset": -0.25,
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="modifier.solidify",
        action=SimpleNamespace(
            name=MODULE.SOLIDIFY_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.SOLIDIFY_RECIPE_ID,
        cursor_token="solidify-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "modifierId"),
            ),
            operation(2, "panel.modifier_properties", "Open Modifiers"),
            operation(3, "control.add_modifier", "Add Solidify Modifier"),
            operation(
                4,
                "semantic.solidify_parameters",
                "Configure Solidify",
                ("modifierName", "thickness", "offset"),
            ),
        ),
    )
    return step, snapshot


def _bevel_modifier_fixture(*, focused_ordinal=3):
    arguments = {
        "targetId": "mesh.beveled",
        "modifierId": "modifier.bevel",
        "modifierName": "OperatingLine.Bevel",
        "width": 0.25,
        "segments": 3,
        "angleLimit": 1.0471975511965976,
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="modifier.bevel",
        action=SimpleNamespace(
            name=MODULE.BEVEL_MODIFIER_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.BEVEL_MODIFIER_RECIPE_ID,
        cursor_token="bevel-modifier-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "modifierId"),
            ),
            operation(2, "panel.modifier_properties", "Open Modifiers"),
            operation(3, "control.add_modifier", "Add Bevel Modifier"),
            operation(
                4,
                "semantic.bevel_parameters",
                "Configure Bevel Modifier",
                ("modifierName", "width", "segments", "angleLimit"),
            ),
        ),
    )
    return step, snapshot


def _single_material_fixture(*, focused_ordinal=3):
    arguments = {
        "materialId": "material.snow",
        "materialName": "OperatingLine.Snow",
        "baseColor": [0.82, 0.9, 1.0, 1.0],
        "roughness": 0.35,
        "metallic": 0.1,
        "targets": ["mesh.head", "mesh.body"],
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="materials.snow",
        action=SimpleNamespace(
            name=MODULE.SINGLE_MATERIAL_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.SINGLE_MATERIAL_RECIPE_ID,
        cursor_token="single-material-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.shading",
                "Open Shading workspace",
                ("materialId",),
            ),
            operation(2, "panel.material_properties", "Open Material Properties"),
            operation(3, "control.new_material", "Create New Material"),
            operation(
                4,
                "semantic.principled_surface",
                "Configure Principled Surface",
                ("materialName", "baseColor", "roughness", "metallic", "targets"),
            ),
        ),
    )
    return step, snapshot


def _material_palette_fixture(*, focused_ordinal=3):
    materials = [
        {
            "materialId": "material.snow",
            "materialName": "OperatingLine.Snow",
            "baseColor": [0.82, 0.9, 1.0, 1.0],
            "roughness": 0.35,
            "metallic": 0.1,
            "targets": ["mesh.head", "mesh.body"],
        },
        {
            "materialId": "material.coal",
            "materialName": "OperatingLine.Coal",
            "baseColor": [0.02, 0.025, 0.03, 1.0],
            "roughness": 0.6,
            "metallic": 0.0,
            "targets": ["mesh.eye.left"],
        },
    ]
    arguments = {"materials": materials}

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="materials.palette",
        action=SimpleNamespace(
            name=MODULE.MATERIAL_PALETTE_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.MATERIAL_PALETTE_RECIPE_ID,
        cursor_token="material-palette-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(1, "workspace.shading", "Open Shading workspace"),
            operation(2, "panel.material_properties", "Open Material Properties"),
            operation(
                3,
                "semantic.palette_entries",
                "Review Palette Entries",
                ("materials",),
            ),
            operation(4, "semantic.assign_targets", "Assign Palette Targets"),
        ),
    )
    return step, snapshot


def _subdivision_surface_fixture(*, focused_ordinal=3):
    arguments = {
        "targetId": "mesh.body",
        "modifierId": "modifier.subdivision-surface",
        "modifierName": "OperatingLine.Body.Subdivision",
        "viewportLevel": 2,
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="modifier.subdivision-surface",
        action=SimpleNamespace(
            name=MODULE.SUBDIVISION_SURFACE_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.SUBDIVISION_SURFACE_RECIPE_ID,
        cursor_token="subdivision-surface-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "modifierId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "operator.subdivision_set", "Add Subdivision Surface"),
            operation(
                4,
                "semantic.subdivision_surface_contract",
                "Configure Subdivision Surface",
                ("modifierName", "viewportLevel"),
            ),
        ),
    )
    return step, snapshot


def _mirror_fixture(*, focused_ordinal=6):
    arguments = {
        "targetId": "mesh.half-shell",
        "modifierId": "modifier.mirror",
        "modifierName": "OperatingLine.Mirror",
        "axis": "Y",
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="modifier.mirror",
        action=SimpleNamespace(
            name=MODULE.MIRROR_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.MIRROR_RECIPE_ID,
        cursor_token="mirror-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "modifierId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "panel.modifier_properties", "Open Modifiers"),
            operation(4, "control.add_modifier", "Open Add Modifier"),
            operation(5, "category.generate", "Open Generate"),
            operation(6, "modifier.mirror", "Add Mirror Modifier"),
            operation(
                7,
                "semantic.mirror_contract",
                "Configure Mirror",
                ("modifierName", "axis"),
            ),
        ),
    )
    return step, snapshot


def _edit_bevel_fixture(*, focused_ordinal=5):
    arguments = {
        "targetId": "mesh.bevel-target",
        "resultMeshId": "mesh.bevel-result",
        "resultMeshName": "OperatingLine.BevelResult.Mesh",
        "width": 0.125,
        "segments": 3,
        "profile": 0.6,
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="mesh.edit-bevel",
        action=SimpleNamespace(
            name=MODULE.EDIT_BEVEL_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.EDIT_BEVEL_RECIPE_ID,
        cursor_token="edit-bevel-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "resultMeshId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "mode.edit_mesh", "Enter Edit Mode"),
            operation(4, "menu.edge", "Open Edge menu"),
            operation(
                5,
                "operator.bevel_edges",
                "Apply Bevel Edges",
                ("width", "segments", "profile"),
            ),
            operation(
                6,
                "semantic.managed_bevel_edges_contract",
                "Publish Managed Bevel Result",
                ("resultMeshName",),
            ),
        ),
    )
    return step, snapshot


def _edit_inset_fixture(*, focused_ordinal=5):
    arguments = {
        "targetId": "mesh.inset-target",
        "resultMeshId": "mesh.inset-result",
        "resultMeshName": "OperatingLine.InsetResult.Mesh",
        "thickness": 0.125,
        "depth": 0.05,
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="mesh.edit-inset",
        action=SimpleNamespace(
            name=MODULE.EDIT_INSET_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.EDIT_INSET_RECIPE_ID,
        cursor_token="edit-inset-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "resultMeshId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "mode.edit_mesh", "Enter Edit Mode"),
            operation(4, "menu.face", "Open Face menu"),
            operation(
                5,
                "operator.inset_faces",
                "Apply Individual Inset Faces",
                ("thickness", "depth"),
            ),
            operation(
                6,
                "semantic.managed_inset_faces_contract",
                "Publish Managed Inset Result",
                ("resultMeshName",),
            ),
        ),
    )
    return step, snapshot


def _edit_triangulate_fixture(*, focused_ordinal=5):
    arguments = {
        "targetId": "mesh.triangulate-target",
        "resultMeshId": "mesh.triangulate-result",
        "resultMeshName": "OperatingLine.TriangulateResult.Mesh",
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="mesh.edit-triangulate",
        action=SimpleNamespace(
            name=MODULE.EDIT_TRIANGULATE_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.EDIT_TRIANGULATE_RECIPE_ID,
        cursor_token="edit-triangulate-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "resultMeshId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "mode.edit_mesh", "Enter Edit Mode"),
            operation(4, "menu.face", "Open Face menu"),
            operation(
                5,
                "operator.triangulate_faces",
                "Apply Triangulate Faces",
            ),
            operation(
                6,
                "semantic.managed_triangulate_contract",
                "Publish Managed Triangulate Result",
                ("resultMeshName",),
            ),
        ),
    )
    return step, snapshot


def _edit_extrude_region_fixture(*, focused_ordinal=5):
    arguments = {
        "targetId": "mesh.extrude-target",
        "resultMeshId": "mesh.extrude-result",
        "resultMeshName": "OperatingLine.ExtrudeResult.Mesh",
        "polygonIndices": [1, 2],
        "translation": [0.0, 0.0, 1.25],
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="mesh.edit-extrude-region",
        action=SimpleNamespace(
            name=MODULE.EDIT_EXTRUDE_REGION_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.EDIT_EXTRUDE_REGION_RECIPE_ID,
        cursor_token="edit-extrude-region-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "resultMeshId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "mode.edit_mesh", "Enter Edit Mode"),
            operation(
                4,
                "semantic.select_face_region",
                "Select accepted face region",
                ("polygonIndices",),
            ),
            operation(
                5,
                "operator.extrude_region_move",
                "Extrude and translate region",
                ("translation",),
            ),
            operation(
                6,
                "semantic.managed_extrude_region_contract",
                "Publish Managed Extrude Result",
                ("resultMeshName",),
            ),
        ),
    )
    return step, snapshot


def _edit_poke_fixture(*, focused_ordinal=5):
    arguments = {
        "targetId": "mesh.poke-target",
        "resultMeshId": "mesh.poke-result",
        "resultMeshName": "OperatingLine.PokeResult.Mesh",
        "offset": 0.2,
    }

    def operation(ordinal, operation_id, label, parameter_names=()):
        return SimpleNamespace(
            ordinal=ordinal,
            operation_id=operation_id,
            label=label,
            parameters=tuple(
                SimpleNamespace(
                    name=name,
                    value=arguments[name],
                    display_value=str(arguments[name]),
                    resolved=True,
                )
                for name in parameter_names
            ),
            connection=None,
        )

    step = SimpleNamespace(
        id="mesh.edit-poke",
        action=SimpleNamespace(
            name=MODULE.EDIT_POKE_ACTION_NAME,
            arguments=arguments,
        ),
    )
    snapshot = SimpleNamespace(
        step_id=step.id,
        recipe_id=MODULE.EDIT_POKE_RECIPE_ID,
        cursor_token="edit-poke-cursor",
        focused_ordinal=focused_ordinal,
        operations=(
            operation(
                1,
                "workspace.layout",
                "Open Layout workspace",
                ("targetId", "resultMeshId"),
            ),
            operation(2, "semantic.select_owned_mesh", "Select owned mesh"),
            operation(3, "mode.edit_mesh", "Enter Edit Mode"),
            operation(4, "menu.face", "Open Face menu"),
            operation(
                5,
                "operator.poke_faces",
                "Apply Poke Faces",
                ("offset",),
            ),
            operation(
                6,
                "semantic.managed_poke_faces_contract",
                "Publish Managed Poke Result",
                ("resultMeshName",),
            ),
        ),
    )
    return step, snapshot


class GuidedControlDockTests(unittest.TestCase):
    def test_resolves_three_vectors_and_two_connection_proxies(self):
        step, snapshot = _fixture()

        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertEqual(
            tuple(control.argument_name for control in model.vectors),
            ("translation", "rotation", "scale"),
        )
        self.assertEqual(model.vectors[0].value, (1.0, 2.0, 3.0))
        self.assertEqual(
            tuple(control.ordinal for control in model.connections),
            (9, 10),
        )
        self.assertEqual(
            model.connections[0].connection_text,
            "NodeGroupInput.Geometry → GeometryNodeTransform.Geometry",
        )

    def test_draws_owned_editors_operation_controls_and_atomic_fallback(self):
        step, snapshot = _fixture()
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        operators = tuple(event for event in layout.events if event[0] == "operator")
        self.assertIn("GUIDED CONTROL · OperatingLine-owned", labels)
        for label in (
            "05.01  X",
            "05.02  Y",
            "05.03  Z",
            "Accepted 1",
            "Accepted 2",
            "Accepted 3",
        ):
            self.assertIn(label, labels)
        self.assertEqual(
            sum(
                event[1] == "operating_line.edit_guided_geometry_parameter"
                for event in operators
            ),
            3,
        )
        self.assertEqual(
            sum(
                event[1] == "operating_line.execute_guided_geometry_operation"
                for event in operators
            ),
            3,
        )
        self.assertEqual(
            sum(
                event[1] == "operating_line.execute_guided_geometry_leaf"
                for event in operators
            ),
            1,
        )
        connection_proxy = next(
            event for event in operators if event[2].startswith("09  Execute:")
        )
        self.assertEqual(connection_proxy[3].step_id, step.id)
        self.assertEqual(connection_proxy[3].cursor_token, "cursor-token")

    def test_fail_closes_for_non_reviewed_recipe(self):
        step, snapshot = _fixture()
        snapshot.recipe_id = "another.recipe"

        self.assertIsNone(MODULE.guided_control_dock_model(step, snapshot))

    def test_draws_component_level_exact_native_controls_when_capability_is_ready(self):
        step, snapshot = _fixture()
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
            native_targeting_supported=True,
            receipt_available=True,
        )

        native = tuple(
            event
            for event in layout.events
            if event[0] == "operator"
            and event[1] == "operating_line.highlight_guided_geometry_parameter"
        )
        self.assertEqual(len(native), 9)
        self.assertEqual(
            tuple(event[2] for event in native[:3]),
            ("EXACT NATIVE", "EXACT NATIVE", "EXACT NATIVE"),
        )
        self.assertEqual(native[0][3].operation_id, "translation")
        self.assertEqual(native[0][3].ordinal, 5)
        self.assertEqual(native[0][3].component_index, 0)

    def test_resolves_twelve_light_trails_scalar_controls_with_local_operation_execution(self):
        step, snapshot = _light_trails_fixture()

        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(len(model.scalars), 12)
        self.assertEqual(model.scalars[0].argument_name, "tileLength")
        self.assertEqual(model.scalars[0].component_index, 0)
        self.assertEqual(model.scalars[3].argument_name, "trailSpacing")
        self.assertEqual(model.scalars[3].component_index, 1)
        self.assertEqual(len(model.scalars[2].writes), 2)
        self.assertEqual(
            tuple(write.socket_identifier for write in model.scalars[2].writes),
            ("Count", "Start Location"),
        )
        self.assertEqual(model.scalars[3].writes[0].projected_value, -1.21)
        self.assertEqual(model.scalars[-1].writes[1].projected_value, -20.0)
        self.assertEqual(len(model.initializations), 9)
        self.assertEqual(
            sum(len(control.writes) for control in model.initializations),
            39,
        )
        self.assertEqual(len(model.structures), 20)
        self.assertEqual(
            sum(len(control.writes) for control in model.structures),
            22,
        )
        self.assertEqual(len(model.resources), 1)
        self.assertEqual(len(model.resources[0].writes), 3)

    def test_draws_light_trails_editors_and_local_operation_executor(self):
        step, snapshot = _light_trails_fixture()
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
            native_targeting_supported=True,
            receipt_available=True,
        )

        operators = tuple(event for event in layout.events if event[0] == "operator")
        self.assertEqual(
            sum(
                event[1] == "operating_line.edit_guided_geometry_parameter"
                for event in operators
            ),
            12,
        )
        self.assertEqual(
            sum(
                event[1] == "operating_line.highlight_guided_geometry_parameter"
                for event in operators
            ),
            15,
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn(
            "09.01  OperatingLine Trail Rows · Count.Value",
            labels,
        )
        self.assertIn(
            "09.02  OperatingLine Trail Rows · Start Location.Y",
            labels,
        )
        native = tuple(
            event
            for event in operators
            if event[1] == "operating_line.highlight_guided_geometry_parameter"
        )
        trail_count_native = tuple(
            event for event in native if event[3].argument_name == "trailCount"
        )
        self.assertEqual(
            tuple(event[3].write_order for event in trail_count_native),
            (1, 2),
        )
        self.assertEqual(
            sum(
                event[1] == "operating_line.execute_guided_geometry_operation"
                for event in operators
            ),
            2,
        )
        self.assertEqual(
            sum(
                event[1] == "operating_line.execute_guided_geometry_leaf"
                for event in operators
            ),
            1,
        )

    def test_shows_light_trails_connection_as_executable_operation(self):
        step, snapshot = _light_trails_fixture(focused_ordinal=53)
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        operators = tuple(event for event in layout.events if event[0] == "operator")
        self.assertTrue(
            any(
                event[1] == "operating_line.execute_guided_geometry_operation"
                and event[2].startswith("53  Execute:")
                for event in operators
            )
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn(
            "node-name:OperatingLine Realize Tiles.Geometry → "
            "node-name:OperatingLine Output.Geometry",
            labels,
        )
        self.assertIn(
            "53.01  LINK RNA · node-name:OperatingLine Realize Tiles.Geometry → "
            "node-name:OperatingLine Output.Geometry",
            labels,
        )

    def test_draws_focused_light_trails_initialization_write_sequence(self):
        step, snapshot = _light_trails_fixture(focused_ordinal=24)
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("24  INITIAL RNA · Create mirror half tile", labels)
        self.assertIn(
            "24.01  OperatingLine Mirror Half Tile · Scale.X",
            labels,
        )
        self.assertIn(
            "24.02  OperatingLine Mirror Half Tile · Scale.Y",
            labels,
        )
        self.assertIn(
            "24.03  OperatingLine Mirror Half Tile · Scale.Z",
            labels,
        )

        step, snapshot = _light_trails_fixture(focused_ordinal=30)
        layout = _Layout()
        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("30.06  OperatingLine Loop Tiles · Offset.X", labels)
        self.assertIn("Assigned 20", labels)

    def test_draws_interface_before_node_structure_sequence(self):
        step, snapshot = _light_trails_fixture(focused_ordinal=3)
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("03  STRUCTURE RNA · Create group input", labels)
        self.assertIn(
            "03.01  INTERFACE RNA · INPUT Geometry (NodeSocketGeometry)",
            labels,
        )
        self.assertIn(
            "03.02  NODE RNA · OperatingLine Input (NodeGroupInput)",
            labels,
        )

    def test_draws_base_resource_mutation_sequence(self):
        step, snapshot = _light_trails_fixture(focused_ordinal=2)
        layout = _Layout()

        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("02  RESOURCE RNA · Create Geometry Nodes modifier", labels)
        self.assertIn(
            "02.01  NODE GROUP RNA · OperatingLine.LightTrailsNodes (GeometryNodeTree)",
            labels,
        )
        self.assertIn(
            "02.02  MODIFIER RNA · OperatingLine.LightTrails (NODES)",
            labels,
        )
        self.assertIn(
            "02.03  BIND RNA · OperatingLine.LightTrails → OperatingLine.LightTrailsNodes",
            labels,
        )

    def test_shows_pose_parameters_and_enables_sparse_operation_execution(self):
        step, snapshot = _pose_animation_fixture()
        layout = _Layout()

        model = MODULE.guided_control_dock_model(step, snapshot)
        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "armatureId",
                "actionName",
                "keyframes",
                "interpolation",
                "extrapolation",
            ),
        )
        self.assertEqual(len(model.keyframe_insertions), 1)
        self.assertEqual(len(model.keyframe_insertions[0].writes), 3)
        self.assertEqual(
            tuple(write.data_path for write in model.keyframe_insertions[0].writes),
            ("rotation_euler", "location", "scale"),
        )
        self.assertEqual(len(model.animation_properties), 2)
        self.assertEqual(len(model.animation_properties[0].writes), 9)
        self.assertEqual(len(model.animation_properties[1].writes), 9)
        self.assertEqual(len(model.action_resources), 2)
        self.assertEqual(len(model.action_resources[0].writes), 2)
        self.assertEqual(len(model.action_resources[1].writes), 1)
        operators = tuple(event for event in layout.events if event[0] == "operator")
        self.assertTrue(
            any(
                event[1] == "operating_line.execute_guided_geometry_operation"
                for event in operators
            )
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("07  KEYFRAME RNA · Set keyframes", labels)
        self.assertIn("07.01  Root · rotation_euler · Frame 1", labels)
        self.assertIn("07.02  Root · location · Frame 1", labels)
        self.assertIn("07.03  Root · scale · Frame 1", labels)
        self.assertIn("Accepted 0, 0, 0.25", labels)

    def test_draws_pose_action_create_bind_and_name_rna_sequences(self):
        create_step, create_snapshot = _pose_animation_fixture(focused_ordinal=4)
        create_layout = _Layout()
        MODULE.draw_guided_control_dock(
            create_layout,
            create_step,
            create_snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        create_labels = tuple(
            event[1] for event in create_layout.events if event[0] == "label"
        )
        self.assertIn("04  ACTION RESOURCE RNA · Create Pose Action", create_labels)
        self.assertIn(
            "04.01  ACTION RNA · action.hero (managed pending Action)",
            create_labels,
        )
        self.assertIn("04.02  BIND RNA · rig.hero → action.hero", create_labels)

        name_step, name_snapshot = _pose_animation_fixture(focused_ordinal=5)
        name_layout = _Layout()
        MODULE.draw_guided_control_dock(
            name_layout,
            name_step,
            name_snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        name_labels = tuple(
            event[1] for event in name_layout.events if event[0] == "label"
        )
        self.assertIn("05  ACTION RESOURCE RNA · Set Action name", name_labels)
        self.assertIn(
            "05.01  NAME RNA · managed pending Action → HeroPose",
            name_labels,
        )

    def test_draws_pose_interpolation_and_extrapolation_rna_sequences(self):
        interpolation_step, interpolation_snapshot = _pose_animation_fixture(
            focused_ordinal=9
        )
        interpolation_layout = _Layout()
        MODULE.draw_guided_control_dock(
            interpolation_layout,
            interpolation_step,
            interpolation_snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        interpolation_labels = tuple(
            event[1] for event in interpolation_layout.events if event[0] == "label"
        )
        self.assertIn("09  ANIMATION RNA · Set interpolation", interpolation_labels)
        self.assertIn(
            "09.01  Root · rotation_euler[0] · Frame 1 · Interpolation = LINEAR",
            interpolation_labels,
        )

        extrapolation_step, extrapolation_snapshot = _pose_animation_fixture(
            focused_ordinal=11
        )
        extrapolation_layout = _Layout()
        MODULE.draw_guided_control_dock(
            extrapolation_layout,
            extrapolation_step,
            extrapolation_snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        extrapolation_labels = tuple(
            event[1] for event in extrapolation_layout.events if event[0] == "label"
        )
        self.assertIn("11  ANIMATION RNA · Set extrapolation", extrapolation_labels)
        self.assertIn(
            "11.01  Root · rotation_euler[0] · Extrapolation = CONSTANT",
            extrapolation_labels,
        )

    def test_shows_armature_parameters_in_operation_order(self):
        step, snapshot = _armature_fixture()
        layout = _Layout()

        model = MODULE.guided_control_dock_model(step, snapshot)
        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "objectName",
                "dataName",
                "bones",
                "bindings",
            ),
        )
        self.assertEqual(len(model.resources), 5)
        self.assertEqual(len(model.resources[3].writes), 5)
        self.assertTrue(
            any(
                event[1] == "operating_line.execute_guided_geometry_operation"
                for event in layout.events
                if event[0] == "operator"
            )
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("06  BONE RNA · Set bones", labels)
        self.assertIn(
            "06.01  EDIT BONE RNA · OperatingLine.Root · (0, 0, 0) → (0, 0, 1) · Deform Off",
            labels,
        )
        self.assertIn(
            "06.03  PARENT RNA · OperatingLine.Tip → OperatingLine.Root",
            labels,
        )
        self.assertIn(
            "06.05  POSE BONE RNA · OperatingLine.Tip · Rotation Mode = XYZ",
            labels,
        )

    def test_draws_armature_resource_name_and_binding_rna_sequences(self):
        expected = {
            2: (
                "02  ARMATURE RESOURCE RNA · Create Armature",
                "02.01  ARMATURE DATA RNA · rig.hero.data (managed pending)",
                "02.03  COLLECTION LINK RNA · rig.hero → snowman.collection",
            ),
            3: (
                "03  ARMATURE RESOURCE RNA · Set Object name",
                "03.01  OBJECT NAME RNA · managed pending → OperatingLine.HeroRig",
            ),
            4: (
                "04  ARMATURE RESOURCE RNA · Set Data name",
                "04.01  DATA NAME RNA · managed pending → OperatingLine.HeroRigData",
            ),
            8: (
                "08  BINDING RNA · Set bindings",
                "08.01  RIGID BIND RNA · snowman.eye.left → rig.hero/OperatingLine.Tip · World preserved",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _armature_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_skin_weights_parameters_in_operation_order(self):
        step, snapshot = _skin_weights_fixture()
        layout = _Layout()

        model = MODULE.guided_control_dock_model(step, snapshot)
        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("weights", "preserveVolume", "modifierName"),
        )
        self.assertEqual(len(model.resources), 3)
        self.assertEqual(len(model.resources[0].writes), 3)
        self.assertTrue(
            any(
                event[1] == "operating_line.execute_guided_geometry_operation"
                for event in layout.events
                if event[0] == "operator"
            )
        )

    def test_draws_skin_weight_and_modifier_rna_sequences(self):
        expected = {
            5: (
                "05  SKIN WEIGHT RNA · Assign normalized weights",
                "05.01  BONE DEFORM RNA · skin.armature/OperatingLine.Root · Deform = On",
                "05.02  VERTEX GROUP RNA · skin.target/OperatingLine.Root (VertexGroup)",
                "05.03  WEIGHT RNA · skin.target[0] → OperatingLine.Root = 1 (REPLACE)",
            ),
            7: (
                "07  SKIN MODIFIER RNA · Set Preserve Volume",
                "07.01  ARMATURE MODIFIER RNA · skin.target/skin.modifier (ARMATURE; managed pending)",
                "07.02  OBJECT BIND RNA · skin.modifier → skin.armature",
                "07.05  PROPERTY RNA · use_deform_preserve_volume = On",
            ),
            8: (
                "08  SKIN MODIFIER RNA · Set Modifier name",
                "08.01  MODIFIER NAME RNA · managed pending → OperatingLine.SkinArmature",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _skin_weights_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_solidify_parameters_and_exact_rna_sequences(self):
        step, snapshot = _solidify_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("targetId", "modifierId", "modifierName", "thickness", "offset"),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 1)
        self.assertEqual(len(model.resources[1].writes), 26)

        expected = {
            3: (
                "03  SOLIDIFY RESOURCE RNA · Add Solidify Modifier",
                "03.01  SOLIDIFY MODIFIER RNA · mesh.shell/modifier.solidify (SOLIDIFY; managed pending)",
            ),
            4: (
                "04  SOLIDIFY PROPERTY RNA · Configure Solidify",
                "04.01  MODIFIER NAME RNA · managed pending → OperatingLine.Shell",
                "04.02  PROPERTY RNA · solidify_mode = EXTRUDE",
                "04.03  PROPERTY RNA · thickness = 0.125",
                "04.07  PROPERTY RNA · offset = -0.25",
                "04.16  PROPERTY RNA · use_even_offset = On",
                "04.26  PROPERTY RNA · bevel_convex = 0",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _solidify_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_bevel_modifier_parameters_and_exact_rna_sequences(self):
        step, snapshot = _bevel_modifier_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "targetId",
                "modifierId",
                "modifierName",
                "width",
                "segments",
                "angleLimit",
            ),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 1)
        self.assertEqual(len(model.resources[1].writes), 5)

        expected = {
            3: (
                "03  BEVEL MODIFIER RESOURCE RNA · Add Bevel Modifier",
                "03.01  BEVEL MODIFIER RNA · mesh.beveled/modifier.bevel (BEVEL; managed pending)",
            ),
            4: (
                "04  BEVEL MODIFIER PROPERTY RNA · Configure Bevel Modifier",
                "04.01  MODIFIER NAME RNA · managed pending → OperatingLine.Bevel",
                "04.02  PROPERTY RNA · width = 0.25",
                "04.03  PROPERTY RNA · segments = 3",
                "04.04  PROPERTY RNA · limit_method = ANGLE",
                "04.05  PROPERTY RNA · angle_limit = 1.0471975511965976",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _bevel_modifier_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_single_material_parameters_and_exact_rna_sequences(self):
        step, snapshot = _single_material_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "materialId",
                "materialName",
                "baseColor",
                "roughness",
                "metallic",
                "targets",
            ),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 2)
        self.assertEqual(len(model.resources[1].writes), 15)

        expected = {
            3: (
                "03  MATERIAL RESOURCE RNA · Create New Material",
                "03.01  MATERIAL RNA · material.snow (managed pending)",
                "03.02  MATERIAL RNA · use_nodes = On",
            ),
            4: (
                "04  MATERIAL SURFACE AND ASSIGNMENT RNA · Configure Principled Surface",
                "04.01  MATERIAL NAME RNA · managed pending → OperatingLine.Snow",
                "04.02  MATERIAL RNA · diffuse_color.R = 0.82",
                "04.06  MATERIAL RNA · roughness = 0.35",
                "04.08  PRINCIPLED RNA · Base Color.R = 0.82",
                "04.12  PRINCIPLED RNA · Roughness = 0.35",
                "04.14  MATERIAL SLOT RNA · mesh.head → material.snow",
                "04.15  MATERIAL SLOT RNA · mesh.body → material.snow",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _single_material_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_material_palette_array_and_global_rna_sequence(self):
        step, snapshot = _material_palette_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("materials",),
        )
        self.assertEqual(len(model.resources), 1)
        self.assertEqual(len(model.resources[0].writes), 31)

        step, snapshot = _material_palette_fixture(focused_ordinal=3)
        layout = _Layout()
        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        self.assertIn("03  materials", labels)
        self.assertTrue(
            any(
                "'materialId': 'material.snow'" in label
                and "'materialId': 'material.coal'" in label
                for label in labels
            )
        )

        step, snapshot = _material_palette_fixture(focused_ordinal=4)
        layout = _Layout()
        MODULE.draw_guided_control_dock(
            layout,
            step,
            snapshot,
            lambda target, text, **_kwargs: target.label(text=text),
        )
        labels = tuple(event[1] for event in layout.events if event[0] == "label")
        for label in (
            "04  MATERIAL PALETTE RNA · Assign Palette Targets",
            "04.01  PALETTE 01 · MATERIAL RNA · material.snow / OperatingLine.Snow (create)",
            "04.02  PALETTE 01 · MATERIAL RNA · use_nodes = On",
            "04.03  PALETTE 01 · MATERIAL RNA · diffuse_color.R = 0.82",
            "04.07  PALETTE 01 · MATERIAL RNA · roughness = 0.35",
            "04.09  PALETTE 01 · PRINCIPLED RNA · Base Color.R = 0.82",
            "04.15  PALETTE 01 · MATERIAL SLOT RNA · mesh.head → material.snow",
            "04.16  PALETTE 01 · MATERIAL SLOT RNA · mesh.body → material.snow",
            "04.17  PALETTE 02 · MATERIAL RNA · material.coal / OperatingLine.Coal (create)",
            "04.23  PALETTE 02 · MATERIAL RNA · roughness = 0.6",
            "04.31  PALETTE 02 · MATERIAL SLOT RNA · mesh.eye.left → material.coal",
        ):
            self.assertIn(label, labels)

    def test_shows_subdivision_surface_parameters_and_exact_rna_sequences(self):
        step, snapshot = _subdivision_surface_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("targetId", "modifierId", "modifierName", "viewportLevel"),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 1)
        self.assertEqual(len(model.resources[1].writes), 15)

        expected = {
            3: (
                "03  SUBDIVISION SURFACE RESOURCE RNA · Add Subdivision Surface",
                "03.01  SUBDIVISION SURFACE MODIFIER RNA · mesh.body/modifier.subdivision-surface (SUBSURF; managed pending)",
            ),
            4: (
                "04  SUBDIVISION SURFACE PROPERTY RNA · Configure Subdivision Surface",
                "04.01  MODIFIER NAME RNA · managed pending → OperatingLine.Body.Subdivision",
                "04.02  PROPERTY RNA · subdivision_type = CATMULL_CLARK",
                "04.03  PROPERTY RNA · levels = 2",
                "04.06  PROPERTY RNA · show_only_control_edges = On",
                "04.08  PROPERTY RNA · use_limit_surface = On",
                "04.15  PROPERTY RNA · show_on_cage = Off",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _subdivision_surface_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_mirror_axis_and_exact_component_rna_sequences(self):
        step, snapshot = _mirror_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("targetId", "modifierId", "modifierName", "axis"),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 1)
        self.assertEqual(len(model.resources[1].writes), 28)

        expected = {
            6: (
                "06  MIRROR RESOURCE RNA · Add Mirror Modifier",
                "06.01  MIRROR MODIFIER RNA · mesh.half-shell/modifier.mirror (MIRROR; managed pending)",
            ),
            7: (
                "07  MIRROR PROPERTY RNA · Configure Mirror",
                "07.01  MODIFIER NAME RNA · managed pending → OperatingLine.Mirror",
                "07.02  PROPERTY RNA · use_axis[X] = Off",
                "07.03  PROPERTY RNA · use_axis[Y] = On",
                "07.04  PROPERTY RNA · use_axis[Z] = Off",
                "07.13  PROPERTY RNA · merge_threshold = 0.001",
                "07.15  PROPERTY RNA · mirror_object = None",
                "07.28  PROPERTY RNA · use_apply_on_spline = Off",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _mirror_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_edit_bevel_parameters_and_exact_mesh_write_sequences(self):
        step, snapshot = _edit_bevel_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "targetId",
                "resultMeshId",
                "width",
                "segments",
                "profile",
                "resultMeshName",
            ),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 5)
        self.assertEqual(len(model.resources[1].writes), 2)

        expected = {
            5: (
                "05  EDIT BEVEL MESH RNA · Apply Bevel Edges",
                "05.01  MESH RNA · mesh.bevel-target → mesh.bevel-result (managed pending copy)",
                "05.02  BEVEL PARAMETER · width = 0.125",
                "05.03  BEVEL PARAMETER · segments = 3",
                "05.04  BEVEL PARAMETER · profile = 0.6",
                "05.05  BMESH WRITE · selected edges → managed result mesh",
            ),
            6: (
                "06  EDIT BEVEL CONTRACT RNA · Publish Managed Bevel Result",
                "06.01  MESH NAME RNA · managed pending → OperatingLine.BevelResult.Mesh",
                "06.02  OBJECT DATA RNA · mesh.bevel-target → mesh.bevel-result",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _edit_bevel_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_edit_inset_parameters_and_exact_mesh_write_sequences(self):
        step, snapshot = _edit_inset_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "targetId",
                "resultMeshId",
                "thickness",
                "depth",
                "resultMeshName",
            ),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 4)
        self.assertEqual(len(model.resources[1].writes), 2)

        expected = {
            5: (
                "05  EDIT INSET MESH RNA · Apply Individual Inset Faces",
                "05.01  MESH RNA · mesh.inset-target → mesh.inset-result (managed pending copy)",
                "05.02  INSET PARAMETER · thickness = 0.125",
                "05.03  INSET PARAMETER · depth = 0.05",
                "05.04  BMESH WRITE · all faces → individual inset result mesh",
            ),
            6: (
                "06  EDIT INSET CONTRACT RNA · Publish Managed Inset Result",
                "06.01  MESH NAME RNA · managed pending → OperatingLine.InsetResult.Mesh",
                "06.02  OBJECT DATA RNA · mesh.inset-target → mesh.inset-result",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _edit_inset_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_edit_triangulate_parameters_and_exact_mesh_write_sequences(self):
        step, snapshot = _edit_triangulate_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("targetId", "resultMeshId", "resultMeshName"),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 2)
        self.assertEqual(len(model.resources[1].writes), 2)

        expected = {
            5: (
                "05  EDIT TRIANGULATE MESH RNA · Apply Triangulate Faces",
                "05.01  MESH RNA · mesh.triangulate-target → mesh.triangulate-result (managed pending copy)",
                "05.02  BMESH WRITE · all faces → fixed triangle-only result mesh",
            ),
            6: (
                "06  EDIT TRIANGULATE CONTRACT RNA · Publish Managed Triangulate Result",
                "06.01  MESH NAME RNA · managed pending → OperatingLine.TriangulateResult.Mesh",
                "06.02  OBJECT DATA RNA · mesh.triangulate-target → mesh.triangulate-result",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _edit_triangulate_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_edit_extrude_region_parameters_and_exact_mesh_write_sequences(self):
        step, snapshot = _edit_extrude_region_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            (
                "targetId",
                "resultMeshId",
                "polygonIndices",
                "translation",
                "resultMeshName",
            ),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 3)
        self.assertEqual(len(model.resources[1].writes), 2)

        expected = {
            5: (
                "05  EDIT EXTRUDE REGION MESH RNA · Extrude and translate region",
                "05.01  MESH RNA · mesh.extrude-target → mesh.extrude-result (managed pending copy)",
                "05.02  TRANSLATE PARAMETER · [0, 0, 1.25]",
                "05.03  BMESH WRITE · accepted face region → managed extrusion result mesh",
            ),
            6: (
                "06  EDIT EXTRUDE REGION CONTRACT RNA · Publish Managed Extrude Result",
                "06.01  MESH NAME RNA · managed pending → OperatingLine.ExtrudeResult.Mesh",
                "06.02  OBJECT DATA RNA · mesh.extrude-target → mesh.extrude-result",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _edit_extrude_region_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)

    def test_shows_edit_poke_parameters_and_exact_mesh_write_sequences(self):
        step, snapshot = _edit_poke_fixture()
        model = MODULE.guided_control_dock_model(step, snapshot)

        self.assertIsNotNone(model)
        self.assertTrue(model.operation_execution_available)
        self.assertEqual(
            tuple(control.argument_name for control in model.values),
            ("targetId", "resultMeshId", "offset", "resultMeshName"),
        )
        self.assertEqual(len(model.resources), 2)
        self.assertEqual(len(model.resources[0].writes), 3)
        self.assertEqual(len(model.resources[1].writes), 2)

        expected = {
            5: (
                "05  EDIT POKE MESH RNA · Apply Poke Faces",
                "05.01  MESH RNA · mesh.poke-target → mesh.poke-result (managed pending copy)",
                "05.02  POKE PARAMETER · offset = 0.2",
                "05.03  BMESH WRITE · all faces → triangle-only poke result mesh",
            ),
            6: (
                "06  EDIT POKE CONTRACT RNA · Publish Managed Poke Result",
                "06.01  MESH NAME RNA · managed pending → OperatingLine.PokeResult.Mesh",
                "06.02  OBJECT DATA RNA · mesh.poke-target → mesh.poke-result",
            ),
        }
        for ordinal, expected_labels in expected.items():
            step, snapshot = _edit_poke_fixture(focused_ordinal=ordinal)
            layout = _Layout()
            MODULE.draw_guided_control_dock(
                layout,
                step,
                snapshot,
                lambda target, text, **_kwargs: target.label(text=text),
            )
            labels = tuple(
                event[1] for event in layout.events if event[0] == "label"
            )
            for label in expected_labels:
                self.assertIn(label, labels)


if __name__ == "__main__":
    unittest.main()
