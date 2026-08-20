"""Pure Python contract tests for the bundled Blender InteractionCatalog."""

from copy import deepcopy
import hashlib
from importlib import import_module
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from typing import Callable
import unittest
from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_interaction_catalog_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

catalog_module = import_module(f"{PACKAGE_NAME}.application.interaction_catalog")

BUNDLED_INTERACTION_CATALOG = catalog_module.BUNDLED_INTERACTION_CATALOG
InteractionPathKind = catalog_module.InteractionPathKind
RESOURCE_PATH = catalog_module.RESOURCE_PATH
ACTION_CATALOG_PATH = catalog_module.ACTION_CATALOG_PATH
FROZEN_ACTION_CATALOG_112_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "catalog"
    / "v1"
    / "action-catalog-1.12.0.json"
)
FROZEN_ACTION_CATALOG_113_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "catalog"
    / "v1"
    / "action-catalog-1.13.0.json"
)
FROZEN_ACTION_CATALOG_114_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "catalog"
    / "v1"
    / "action-catalog-1.14.0.json"
)
FROZEN_ACTION_CATALOG_115_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "catalog"
    / "v1"
    / "action-catalog-1.15.0.json"
)
FROZEN_ACTION_CATALOG_116_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "catalog"
    / "v1"
    / "action-catalog-1.16.0.json"
)
load_interaction_catalog = catalog_module.load_interaction_catalog
parse_mcp_materialization = catalog_module._parse_mcp_materialization


class InteractionCatalogTests(unittest.TestCase):
    def _load_raw(self, raw: dict) -> object:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "interaction-catalog.json"
            path.write_text(json.dumps(raw), encoding="utf-8")
            return load_interaction_catalog(path, ACTION_CATALOG_PATH)

    def _load_raw_with_action_catalog(
        self, raw: dict, action_catalog: dict
    ) -> object:
        with TemporaryDirectory() as directory:
            directory_path = Path(directory)
            interaction_path = directory_path / "interaction-catalog.json"
            action_path = directory_path / "action-catalog.json"
            interaction_path.write_text(json.dumps(raw), encoding="utf-8")
            action_path.write_text(json.dumps(action_catalog), encoding="utf-8")
            return load_interaction_catalog(interaction_path, action_path)

    def _ordered_parameter_catalog(self) -> dict:
        raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        recipe = raw["recipes"][0]
        execution_step_id = recipe["guidance"]["execution"]["stepId"]
        recipe["procedureMaterialization"]["menu"] = {
            "availability": "available",
            "source": "guidance.native_path",
            "semanticBinding": "all_leaf_operations",
            "parameterBinding": "ordered_parameter_operations",
            "operatorParameters": [
                {
                    "name": "resource_id",
                    "source": {
                        "kind": "action_argument",
                        "argumentName": "resourceId",
                        "transform": "identity",
                    },
                },
                {
                    "name": "object_name",
                    "source": {
                        "kind": "action_argument",
                        "argumentName": "objectName",
                        "transform": "identity",
                    },
                },
                {
                    "name": "location",
                    "source": {
                        "kind": "action_argument",
                        "argumentName": "location",
                        "transform": "identity",
                    },
                },
            ],
            "controlOperations": {
                "insertAfterStepId": execution_step_id,
                "operations": [
                    {
                        "id": "control.radius",
                        "label": "Radius control",
                        "target": {
                            "kind": "control",
                            "hostId": "VIEW3D_OT_adjust_last_operation.radius",
                        },
                        "path": ["Adjust Last Operation", "Radius"],
                        "parameters": [
                            {
                                "name": "scale",
                                "source": {
                                    "kind": "action_argument",
                                    "argumentName": "radius",
                                    "transform": "uniform_vector3",
                                },
                            },
                            {
                                "name": "enabled",
                                "source": {"kind": "literal", "value": True},
                            },
                        ],
                    }
                ],
            },
            "omittedActionArguments": [],
        }
        return raw

    def _ordered_shortcut_catalog(self) -> dict:
        return json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))

    def _semantic_materialization(self, raw: dict) -> dict:
        recipe = next(
            item
            for item in raw["recipes"]
            if item["actionName"] == "blender.mesh.create_uv_sphere"
        )
        return recipe["procedureMaterialization"]["semantic"]

    def _operator_property_shortcut_catalog(self) -> dict:
        raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        recipe = next(
            item
            for item in raw["recipes"]
            if item["actionName"] == "blender.mesh.create_icosphere"
        )
        operator_id = recipe["guidance"]["execution"]["operatorId"]
        recipe["procedureMaterialization"]["shortcut"] = {
            "availability": "available",
            "source": "catalog.ordered_shortcut_operations",
            "semanticBinding": "all_leaf_operations",
            "parameterBinding": "ordered_parameter_operations",
            "projection": "candidate_only",
            "preconditions": [
                {"kind": "workspace", "label": "Workspace", "value": "Layout"},
                {"kind": "editor", "label": "Editor", "value": "VIEW_3D"},
                {"kind": "mode", "label": "Mode", "value": "OBJECT"},
                {"kind": "keymap", "label": "Keymap", "value": "Blender"},
                {
                    "kind": "scene_state",
                    "label": "3D Cursor",
                    "value": "World origin",
                },
                {
                    "kind": "scene_state",
                    "label": "Transform Orientation",
                    "value": "GLOBAL",
                },
            ],
            "operations": [
                {
                    "kind": "key_input",
                    "id": "shortcut.add_icosphere",
                    "label": "Add Icosphere",
                    "keyMode": "chord",
                    "keys": ["SHIFT", "A"],
                    "selectionPath": ["Mesh", "Ico Sphere"],
                    "parameters": [],
                },
                {
                    "kind": "key_input",
                    "id": "shortcut.open_adjust_last_operation",
                    "label": "Open Adjust Last Operation",
                    "keyMode": "sequence",
                    "keys": ["F9"],
                    "parameters": [],
                    "opensSurface": {
                        "kind": "adjust_last_operation",
                        "hostId": "screen.redo_last",
                        "sourceOperationId": "shortcut.add_icosphere",
                        "expectedOperatorId": operator_id,
                    },
                },
                {
                    "kind": "operator_property_update",
                    "id": "shortcut.set_subdivisions",
                    "label": "Set Subdivisions",
                    "surfaceOperationId": "shortcut.open_adjust_last_operation",
                    "target": {
                        "kind": "control",
                        "hostId": "mesh.primitive_ico_sphere_add.subdivisions",
                    },
                    "path": ["Adjust Last Operation", "Subdivisions"],
                    "parameters": [
                        {
                            "name": "value",
                            "source": {
                                "kind": "action_argument",
                                "argumentName": "subdivisions",
                                "transform": "identity",
                            },
                        }
                    ],
                },
                {
                    "kind": "operator_property_update",
                    "id": "shortcut.set_radius",
                    "label": "Set Radius",
                    "surfaceOperationId": "shortcut.open_adjust_last_operation",
                    "target": {
                        "kind": "control",
                        "hostId": "mesh.primitive_ico_sphere_add.radius",
                    },
                    "path": ["Adjust Last Operation", "Radius"],
                    "parameters": [
                        {
                            "name": "value",
                            "source": {
                                "kind": "action_argument",
                                "argumentName": "radius",
                                "transform": "identity",
                            },
                        }
                    ],
                },
                {
                    "kind": "key_input",
                    "id": "shortcut.close_adjust_last_operation",
                    "label": "Confirm Adjust Last Operation",
                    "keyMode": "sequence",
                    "keys": ["ENTER"],
                    "parameters": [],
                    "closesSurfaceOperationId": (
                        "shortcut.open_adjust_last_operation"
                    ),
                },
                *[
                    {
                        "kind": "key_input",
                        "id": f"shortcut.move_{axis}",
                        "label": f"Move {axis.upper()}",
                        "keyMode": "sequence",
                        "keys": ["G", axis.upper(), "VALUE", "ENTER"],
                        "parameters": [
                            {
                                "name": "value",
                                "source": {
                                    "kind": "action_argument",
                                    "argumentName": "location",
                                    "transform": f"vector3_{axis}",
                                },
                            }
                        ],
                    }
                    for axis in ("x", "y", "z")
                ],
                {
                    "kind": "key_input",
                    "id": "shortcut.rename",
                    "label": "Rename",
                    "keyMode": "sequence",
                    "keys": ["F2", "VALUE", "ENTER"],
                    "parameters": [
                        {
                            "name": "value",
                            "source": {
                                "kind": "action_argument",
                                "argumentName": "objectName",
                                "transform": "identity",
                            },
                        }
                    ],
                },
            ],
            "omittedActionArguments": [
                {"argumentName": "resourceId", "reason": "No shortcut input."}
            ],
        }
        return raw

    def test_binds_all_actions_and_marks_only_verified_paths_native(self) -> None:
        catalog = BUNDLED_INTERACTION_CATALOG

        self.assertEqual(catalog.catalog_version, "1.37.0")
        self.assertEqual(catalog.action_catalog_version, "1.22.0")
        self.assertEqual(
            catalog.host_version_range,
            ">=4.5.0 <4.6.0 || >=5.1.0 <5.2.0",
        )
        self.assertEqual(len(catalog.recipes), 27)
        native = tuple(
            recipe.action_name
            for recipe in catalog.recipes
            if recipe.guidance.kind is InteractionPathKind.NATIVE
        )
        self.assertEqual(
            native,
            (
                "blender.mesh.create_uv_sphere",
                "blender.mesh.create_icosphere",
                "blender.mesh.create_plane",
                "blender.mesh.create_cube",
                "blender.mesh.create_cone",
                "blender.mesh.create_cylinder",
                "blender.mesh.create_torus",
            ),
        )
        self.assertTrue(
            all(
                recipe.guidance.reason
                for recipe in catalog.recipes
                if recipe.guidance.kind is InteractionPathKind.SEMANTIC
            )
        )
        self.assertEqual(
            sum(
                recipe.guidance.kind is InteractionPathKind.SEMANTIC
                for recipe in catalog.recipes
            ),
            20,
        )
        subdivision_surface = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name
            == "blender.modifier.add_subdivision_surface"
        )
        self.assertIsNotNone(subdivision_surface.procedure_materialization)
        assert subdivision_surface.procedure_materialization is not None
        self.assertEqual(
            tuple(
                (
                    step.intent,
                    step.target_kind,
                    step.target_id,
                )
                for step in subdivision_surface.guidance.steps
            ),
            (
                ("navigate", "workspace", "Layout"),
                (
                    "configure",
                    "semantic",
                    "operatingline.blender.owned_mesh",
                ),
                ("execute", "operator", "object.subdivision_set"),
                (
                    "configure",
                    "semantic",
                    "operatingline.blender.subdivision_surface_modifier",
                ),
            ),
        )
        subdivision_materialization = (
            subdivision_surface.procedure_materialization
        )
        self.assertEqual(
            subdivision_materialization.menu.availability, "unavailable"
        )
        subdivision_shortcut = subdivision_materialization.shortcut
        self.assertEqual(
            (
                subdivision_shortcut.availability,
                subdivision_shortcut.source,
                subdivision_shortcut.semantic_binding,
                subdivision_shortcut.parameter_binding,
                subdivision_shortcut.projection,
            ),
            (
                "available",
                "catalog.ordered_shortcut_operations",
                "all_leaf_operations",
                "ordered_parameter_operations",
                "candidate_only",
            ),
        )
        assert subdivision_shortcut.preconditions is not None
        self.assertEqual(
            tuple(
                (item.kind, item.label, item.value)
                for item in subdivision_shortcut.preconditions
            ),
            (
                ("workspace", "Workspace", "Layout"),
                ("editor", "Editor", "VIEW_3D"),
                ("mode", "Mode", "OBJECT"),
                (
                    "selection",
                    "Active Target",
                    "Exactly one accepted target Mesh object is active and selected",
                ),
                ("keymap", "Keymap", "Blender"),
                ("modal_state", "Modal UI", "None"),
                (
                    "scene_state",
                    "Modifier Type",
                    "No existing SUBSURF modifier",
                ),
                (
                    "scene_state",
                    "Modifier Stack",
                    "Existing modifier stack matches accepted tracked state",
                ),
                (
                    "scene_state",
                    "Topology Bounds",
                    "Evaluated and projected topology are within managed bounds",
                ),
            ),
        )
        assert subdivision_shortcut.shortcut_operations is not None
        subdivision_operations = subdivision_shortcut.shortcut_operations
        self.assertEqual(
            tuple(operation.id for operation in subdivision_operations),
            (
                "shortcut.add_subdivision_surface_level_one",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_viewport_level",
                "shortcut.close_adjust_last_operation",
            ),
        )
        add_level_one = subdivision_operations[0]
        self.assertEqual((add_level_one.kind, add_level_one.keys), ("key_input", ("CTRL", "1")))
        self.assertEqual(
            tuple(
                (parameter.name, parameter.source.kind, parameter.source.value)
                for parameter in add_level_one.parameters
            ),
            (
                ("level", "literal", 1),
                ("relative", "literal", False),
                ("ensure_modifier", "literal", True),
            ),
        )
        opener = subdivision_operations[1]
        assert opener.opens_surface is not None
        self.assertEqual(
            (
                opener.keys,
                opener.opens_surface.source_operation_id,
                opener.opens_surface.expected_operator_id,
            ),
            (
                ("F9",),
                "shortcut.add_subdivision_surface_level_one",
                "object.subdivision_set",
            ),
        )
        viewport_level = subdivision_operations[2]
        self.assertEqual(
            (
                viewport_level.kind,
                viewport_level.target_id,
                viewport_level.path,
                viewport_level.parameters[0].source.argument_name,
            ),
            (
                "operator_property_update",
                "object.subdivision_set.level",
                ("Adjust Last Operation", "Level"),
                "viewportLevel",
            ),
        )
        self.assertEqual(
            subdivision_operations[3].closes_surface_operation_id,
            "shortcut.open_adjust_last_operation",
        )
        assert subdivision_shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                item.argument_name
                for item in subdivision_shortcut.omitted_action_arguments
            ),
            ("targetId", "modifierId", "modifierName"),
        )
        self.assertEqual(
            subdivision_materialization.mcp.availability, "unavailable"
        )
        mirror = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.modifier.add_mirror"
        )
        self.assertEqual(
            tuple(step.label for step in mirror.guidance.steps),
            (
                "Layout",
                "Owned Mesh",
                "Modifiers",
                "Add Modifier",
                "Generate",
                "Mirror",
                "Managed Mirror Contract",
            ),
        )
        self.assertEqual(
            tuple(
                (step.target_kind, step.target_id)
                for step in mirror.guidance.steps
            ),
            (
                ("workspace", "Layout"),
                ("semantic", "operatingline.blender.owned_mesh"),
                ("panel", "PROPERTIES_MODIFIER"),
                ("menu", "OBJECT_MT_modifier_add"),
                ("menu", "OBJECT_MT_modifier_add_generate"),
                ("operator", "object.modifier_add"),
                ("semantic", "operatingline.blender.mirror_modifier"),
            ),
        )
        self.assertIn("type=MIRROR", mirror.guidance.reason)
        self.assertEqual(
            mirror.guidance.manual_reference,
            "https://docs.blender.org/manual/en/4.5/modeling/modifiers/generate/mirror.html",
        )
        self.assertIsNotNone(mirror.procedure_materialization)
        assert mirror.procedure_materialization is not None
        self.assertEqual(
            (
                mirror.procedure_materialization.menu.availability,
                mirror.procedure_materialization.shortcut.availability,
                mirror.procedure_materialization.mcp.availability,
            ),
            ("unavailable", "unavailable", "unavailable"),
        )
        self.assertIn(
            "Shift+A", mirror.procedure_materialization.shortcut.reason
        )
        sphere = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_uv_sphere"
        )
        self.assertIsNotNone(sphere.procedure_materialization)
        assert sphere.procedure_materialization is not None
        semantic = sphere.procedure_materialization.semantic
        self.assertIsNotNone(semantic)
        assert semantic is not None
        self.assertEqual(
            semantic.source, "catalog.semantic_parameter_projections"
        )
        self.assertEqual(
            tuple(
                (
                    projection.id,
                    projection.semantic_action,
                    tuple(
                        (segment.kind, segment.name, segment.index)
                        for segment in projection.path
                    ),
                    projection.action_argument,
                    projection.transform,
                )
                for projection in semantic.projections
            ),
            (
                (
                    "projection.semantic.transform.location",
                    "set_object_transform",
                    (("field", "location", None),),
                    "location",
                    "identity",
                ),
                (
                    "projection.semantic.transform.scale",
                    "set_object_transform",
                    (("field", "scale", None),),
                    "radius",
                    "uniform_vector3",
                ),
                (
                    "projection.semantic.rename.name",
                    "rename_object",
                    (("field", "name", None),),
                    "objectName",
                    "identity",
                ),
            ),
        )
        self.assertEqual(
            tuple(
                omission.argument_name
                for omission in semantic.omitted_action_arguments
            ),
            ("resourceId",),
        )
        self.assertEqual(
            sphere.procedure_materialization.menu.availability,
            "available",
        )
        self.assertEqual(
            sphere.procedure_materialization.menu.source,
            "guidance.native_path",
        )
        menu = sphere.procedure_materialization.menu
        self.assertEqual(menu.parameter_binding, "ordered_parameter_operations")
        assert menu.operator_parameters is not None
        self.assertEqual(
            tuple(item.name for item in menu.operator_parameters), ("radius",)
        )
        assert menu.control_operations is not None
        self.assertEqual(
            menu.control_operations.insert_after_step_id, "operator.uv_sphere"
        )
        self.assertEqual(
            tuple(item.id for item in menu.control_operations.operations),
            ("control.location", "control.scale", "control.object_name"),
        )
        assert menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(item.argument_name for item in menu.omitted_action_arguments),
            ("resourceId",),
        )
        shortcut = sphere.procedure_materialization.shortcut
        self.assertEqual(shortcut.availability, "available")
        self.assertEqual(shortcut.source, "catalog.ordered_shortcut_operations")
        self.assertEqual(shortcut.semantic_binding, "all_leaf_operations")
        self.assertEqual(shortcut.parameter_binding, "ordered_parameter_operations")
        self.assertEqual(shortcut.projection, "candidate_only")
        assert shortcut.preconditions is not None
        self.assertTrue(
            {"workspace", "editor", "mode", "keymap", "scene_state"}
            <= {precondition.kind for precondition in shortcut.preconditions}
        )
        assert shortcut.shortcut_operations is not None
        self.assertEqual(
            tuple(operation.id for operation in shortcut.shortcut_operations),
            (
                "shortcut.add_uv_sphere",
                "shortcut.move_x",
                "shortcut.move_y",
                "shortcut.move_z",
                "shortcut.scale",
                "shortcut.rename",
            ),
        )
        self.assertEqual(shortcut.shortcut_operations[0].key_mode, "chord")
        self.assertFalse(hasattr(shortcut.shortcut_operations[0], "kind"))
        self.assertEqual(shortcut.shortcut_operations[0].keys, ("SHIFT", "A"))
        self.assertEqual(
            shortcut.shortcut_operations[0].selection_path,
            ("Mesh", "UV Sphere"),
        )
        self.assertEqual(
            tuple(
                operation.parameters[0].source.transform
                for operation in shortcut.shortcut_operations[1:4]
            ),
            ("vector3_x", "vector3_y", "vector3_z"),
        )
        assert shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(item.argument_name for item in shortcut.omitted_action_arguments),
            ("resourceId",),
        )
        self.assertEqual(
            sphere.procedure_materialization.mcp.availability,
            "available",
        )
        mcp = sphere.procedure_materialization.mcp
        self.assertEqual(mcp.source, "catalog.action_level_mcp")
        self.assertEqual(mcp.semantic_binding, "all_leaf_operations")
        self.assertEqual(mcp.parameter_binding, "accepted_action_arguments")
        self.assertEqual(mcp.server_name, "operating-line")
        self.assertEqual(mcp.tool_name, "operatingline.blender.action.execute")
        self.assertEqual(mcp.authorization, "accepted_replay_next_step")
        self.assertEqual(mcp.result_binding, "companion_state_report")
        icosphere = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_icosphere"
        )
        self.assertIsNotNone(icosphere.procedure_materialization)
        assert icosphere.procedure_materialization is not None
        icosphere_menu = icosphere.procedure_materialization.menu
        self.assertEqual(icosphere_menu.availability, "available")
        self.assertEqual(
            icosphere_menu.parameter_binding,
            "ordered_parameter_operations",
        )
        assert icosphere_menu.operator_parameters is not None
        self.assertEqual(
            tuple(parameter.name for parameter in icosphere_menu.operator_parameters),
            ("subdivisions", "radius"),
        )
        self.assertEqual(
            tuple(
                (
                    parameter.source.argument_name,
                    parameter.source.transform,
                )
                for parameter in icosphere_menu.operator_parameters
            ),
            (("subdivisions", "identity"), ("radius", "identity")),
        )
        assert icosphere_menu.control_operations is not None
        self.assertEqual(
            icosphere_menu.control_operations.insert_after_step_id,
            "operator.icosphere",
        )
        self.assertEqual(
            tuple(
                operation.id
                for operation in icosphere_menu.control_operations.operations
            ),
            ("control.location", "control.object_name"),
        )
        self.assertEqual(
            tuple(
                (
                    operation.parameters[0].name,
                    operation.parameters[0].source.argument_name,
                    operation.parameters[0].source.transform,
                )
                for operation in icosphere_menu.control_operations.operations
            ),
            (
                ("value", "location", "identity"),
                ("value", "objectName", "identity"),
            ),
        )
        assert icosphere_menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                omission.argument_name
                for omission in icosphere_menu.omitted_action_arguments
            ),
            ("resourceId",),
        )
        icosphere_shortcut = icosphere.procedure_materialization.shortcut
        self.assertEqual(icosphere_shortcut.availability, "available")
        self.assertEqual(
            icosphere_shortcut.source, "catalog.ordered_shortcut_operations"
        )
        self.assertEqual(icosphere_shortcut.semantic_binding, "all_leaf_operations")
        self.assertEqual(
            icosphere_shortcut.parameter_binding, "ordered_parameter_operations"
        )
        self.assertEqual(icosphere_shortcut.projection, "candidate_only")
        assert icosphere_shortcut.preconditions is not None
        self.assertEqual(
            tuple(item.kind for item in icosphere_shortcut.preconditions),
            (
                "workspace",
                "editor",
                "mode",
                "keymap",
                "scene_state",
                "scene_state",
            ),
        )
        assert icosphere_shortcut.shortcut_operations is not None
        self.assertEqual(
            tuple(item.id for item in icosphere_shortcut.shortcut_operations),
            (
                "shortcut.add_icosphere",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_subdivisions",
                "shortcut.set_radius",
                "shortcut.close_adjust_last_operation",
                "shortcut.move_x",
                "shortcut.move_y",
                "shortcut.move_z",
                "shortcut.rename",
            ),
        )
        opener = icosphere_shortcut.shortcut_operations[1]
        self.assertEqual(opener.kind, "key_input")
        self.assertEqual(opener.keys, ("F9",))
        assert opener.opens_surface is not None
        self.assertEqual(opener.opens_surface.host_id, "screen.redo_last")
        self.assertEqual(
            opener.opens_surface.source_operation_id, "shortcut.add_icosphere"
        )
        self.assertEqual(
            opener.opens_surface.expected_operator_id,
            "mesh.primitive_ico_sphere_add",
        )
        self.assertEqual(
            tuple(
                (
                    operation.kind,
                    operation.surface_operation_id,
                    operation.target_id,
                    operation.path,
                    operation.parameters[0].source.argument_name,
                )
                for operation in icosphere_shortcut.shortcut_operations[2:4]
            ),
            (
                (
                    "operator_property_update",
                    "shortcut.open_adjust_last_operation",
                    "mesh.primitive_ico_sphere_add.subdivisions",
                    ("Adjust Last Operation", "Subdivisions"),
                    "subdivisions",
                ),
                (
                    "operator_property_update",
                    "shortcut.open_adjust_last_operation",
                    "mesh.primitive_ico_sphere_add.radius",
                    ("Adjust Last Operation", "Radius"),
                    "radius",
                ),
            ),
        )
        closer = icosphere_shortcut.shortcut_operations[4]
        self.assertEqual(closer.keys, ("ENTER",))
        self.assertEqual(
            closer.closes_surface_operation_id,
            "shortcut.open_adjust_last_operation",
        )
        self.assertEqual(
            tuple(operation.keys for operation in icosphere_shortcut.shortcut_operations[5:]),
            (
                ("G", "X", "VALUE", "ENTER"),
                ("G", "Y", "VALUE", "ENTER"),
                ("G", "Z", "VALUE", "ENTER"),
                ("F2", "VALUE", "ENTER"),
            ),
        )
        assert icosphere_shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(item.argument_name for item in icosphere_shortcut.omitted_action_arguments),
            ("resourceId",),
        )
        self.assertEqual(icosphere.procedure_materialization.mcp, mcp)
        subdivide = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.edit_subdivide"
        )
        self.assertEqual(subdivide.guidance.kind, InteractionPathKind.SEMANTIC)
        self.assertIsNotNone(subdivide.procedure_materialization)
        assert subdivide.procedure_materialization is not None
        self.assertEqual(
            subdivide.procedure_materialization.menu.availability,
            "unavailable",
        )
        subdivide_shortcut = subdivide.procedure_materialization.shortcut
        self.assertEqual(
            (
                subdivide_shortcut.availability,
                subdivide_shortcut.source,
                subdivide_shortcut.semantic_binding,
                subdivide_shortcut.parameter_binding,
                subdivide_shortcut.projection,
            ),
            (
                "available",
                "catalog.ordered_shortcut_operations",
                "all_leaf_operations",
                "ordered_parameter_operations",
                "candidate_only",
            ),
        )
        assert subdivide_shortcut.preconditions is not None
        self.assertEqual(
            tuple(item.kind for item in subdivide_shortcut.preconditions),
            (
                "workspace",
                "editor",
                "mode",
                "selection",
                "keymap",
                "modal_state",
                "scene_state",
                "scene_state",
                "scene_state",
            ),
        )
        assert subdivide_shortcut.shortcut_operations is not None
        self.assertEqual(
            tuple(item.id for item in subdivide_shortcut.shortcut_operations),
            (
                "shortcut.enter_edit_mode",
                "shortcut.select_all_mesh_elements",
                "shortcut.search_subdivide",
                "shortcut.execute_subdivide",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_number_of_cuts",
                "shortcut.set_smoothness",
                "shortcut.close_adjust_last_operation",
                "shortcut.return_to_object_mode",
            ),
        )
        self.assertEqual(
            tuple(item.keys for item in subdivide_shortcut.shortcut_operations[:5]),
            (("TAB",), ("A",), ("F3",), ("ENTER",), ("F9",)),
        )
        self.assertEqual(
            subdivide_shortcut.shortcut_operations[2].selection_path,
            ("Subdivide",),
        )
        self.assertEqual(
            (
                subdivide_shortcut.shortcut_operations[2].parameters[0].name,
                subdivide_shortcut.shortcut_operations[2].parameters[0].source.kind,
                subdivide_shortcut.shortcut_operations[2].parameters[0].source.value,
            ),
            ("query", "literal", "subdivide"),
        )
        subdivide_opener = subdivide_shortcut.shortcut_operations[4]
        assert subdivide_opener.opens_surface is not None
        self.assertEqual(
            (
                subdivide_opener.opens_surface.source_operation_id,
                subdivide_opener.opens_surface.expected_operator_id,
            ),
            ("shortcut.execute_subdivide", "mesh.subdivide"),
        )
        self.assertEqual(
            tuple(
                (
                    operation.target_id,
                    operation.parameters[0].source.argument_name,
                )
                for operation in subdivide_shortcut.shortcut_operations[5:7]
            ),
            (
                ("mesh.subdivide.number_cuts", "cuts"),
                ("mesh.subdivide.smoothness", "smooth"),
            ),
        )
        assert subdivide_shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                item.argument_name
                for item in subdivide_shortcut.omitted_action_arguments
            ),
            ("targetId", "resultMeshId", "resultMeshName"),
        )
        self.assertEqual(
            subdivide.procedure_materialization.mcp.availability,
            "unavailable",
        )
        plane = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_plane"
        )
        self.assertIsNotNone(plane.procedure_materialization)
        assert plane.procedure_materialization is not None
        plane_menu = plane.procedure_materialization.menu
        self.assertEqual(plane_menu.availability, "available")
        self.assertEqual(plane_menu.source, "guidance.native_path")
        self.assertEqual(plane_menu.semantic_binding, "all_leaf_operations")
        self.assertEqual(
            plane_menu.parameter_binding, "ordered_parameter_operations"
        )
        assert plane_menu.operator_parameters is not None
        self.assertEqual(len(plane_menu.operator_parameters), 1)
        plane_size = plane_menu.operator_parameters[0]
        self.assertEqual(
            (
                plane_size.name,
                plane_size.source.argument_name,
                plane_size.source.transform,
            ),
            ("size", "size", "identity"),
        )
        assert plane_menu.control_operations is not None
        self.assertEqual(
            plane_menu.control_operations.insert_after_step_id, "operator.plane"
        )
        self.assertEqual(
            tuple(
                (
                    operation.id,
                    operation.path,
                    operation.parameters[0].name,
                    operation.parameters[0].source.argument_name,
                    operation.parameters[0].source.transform,
                )
                for operation in plane_menu.control_operations.operations
            ),
            (
                (
                    "control.location",
                    ("Sidebar", "Item", "Transform", "Location"),
                    "value",
                    "location",
                    "identity",
                ),
                (
                    "control.object_name",
                    ("Outliner", "Object Name"),
                    "value",
                    "objectName",
                    "identity",
                ),
            ),
        )
        assert plane_menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                (omission.argument_name, omission.reason)
                for omission in plane_menu.omitted_action_arguments
            ),
            (
                (
                    "resourceId",
                    "The logical resource identifier has no user-facing Blender control.",
                ),
            ),
        )
        plane_shortcut = plane.procedure_materialization.shortcut
        self.assertEqual(plane_shortcut.availability, "available")
        self.assertEqual(
            (
                plane_shortcut.source,
                plane_shortcut.semantic_binding,
                plane_shortcut.parameter_binding,
                plane_shortcut.projection,
            ),
            (
                "catalog.ordered_shortcut_operations",
                "all_leaf_operations",
                "ordered_parameter_operations",
                "candidate_only",
            ),
        )
        assert plane_shortcut.preconditions is not None
        self.assertEqual(
            tuple(
                (precondition.kind, precondition.label, precondition.value)
                for precondition in plane_shortcut.preconditions
            ),
            (
                ("workspace", "Workspace", "Layout"),
                ("editor", "Editor", "VIEW_3D"),
                ("mode", "Mode", "OBJECT"),
                ("keymap", "Keymap", "Blender"),
                ("scene_state", "3D Cursor", "[0,0,0]"),
                ("scene_state", "Transform Orientation", "GLOBAL"),
            ),
        )
        assert plane_shortcut.shortcut_operations is not None
        self.assertEqual(
            tuple(
                (operation.id, operation.key_mode, operation.keys)
                for operation in plane_shortcut.shortcut_operations
            ),
            (
                ("shortcut.add_plane", "chord", ("SHIFT", "A")),
                ("shortcut.move_x", "sequence", ("G", "X")),
                ("shortcut.move_y", "sequence", ("G", "Y")),
                ("shortcut.move_z", "sequence", ("G", "Z")),
                ("shortcut.scale", "sequence", ("S",)),
                ("shortcut.rename", "sequence", ("F2",)),
            ),
        )
        plane_add = plane_shortcut.shortcut_operations[0]
        self.assertEqual(plane_add.selection_path, ("Mesh", "Plane"))
        self.assertEqual(
            tuple(
                (parameter.name, parameter.source.kind, parameter.source.value)
                for parameter in plane_add.parameters
            ),
            (
                ("size", "literal", 2),
                ("location", "literal", [0, 0, 0]),
            ),
        )
        self.assertEqual(
            tuple(
                (
                    operation.parameters[0].name,
                    operation.parameters[0].source.argument_name,
                    operation.parameters[0].source.transform,
                    operation.parameters[1].name,
                    operation.parameters[1].source.value,
                )
                for operation in plane_shortcut.shortcut_operations[1:4]
            ),
            (
                ("value", "location", "vector3_x", "confirm", "ENTER"),
                ("value", "location", "vector3_y", "confirm", "ENTER"),
                ("value", "location", "vector3_z", "confirm", "ENTER"),
            ),
        )
        plane_scale = plane_shortcut.shortcut_operations[4]
        self.assertEqual(
            (
                plane_scale.parameters[0].name,
                plane_scale.parameters[0].source.argument_name,
                plane_scale.parameters[0].source.transform,
                plane_scale.parameters[1].name,
                plane_scale.parameters[1].source.value,
            ),
            ("value", "size", "divide_by_two", "confirm", "ENTER"),
        )
        plane_rename = plane_shortcut.shortcut_operations[5]
        self.assertEqual(
            (
                plane_rename.parameters[0].name,
                plane_rename.parameters[0].source.argument_name,
                plane_rename.parameters[0].source.transform,
                plane_rename.parameters[1].name,
                plane_rename.parameters[1].source.value,
            ),
            ("text", "objectName", "identity", "confirm", "ENTER"),
        )
        assert plane_shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                (omission.argument_name, omission.reason)
                for omission in plane_shortcut.omitted_action_arguments
            ),
            (
                (
                    "resourceId",
                    "The logical resource identifier has no user-facing Blender shortcut input.",
                ),
            ),
        )
        self.assertEqual(plane.procedure_materialization.mcp, mcp)
        cube = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_cube"
        )
        self.assertIsNotNone(cube.procedure_materialization)
        assert cube.procedure_materialization is not None
        cube_menu = cube.procedure_materialization.menu
        self.assertEqual(cube_menu.availability, "available")
        self.assertEqual(cube_menu.source, "guidance.native_path")
        self.assertEqual(cube_menu.semantic_binding, "all_leaf_operations")
        self.assertEqual(
            cube_menu.parameter_binding, "ordered_parameter_operations"
        )
        assert cube_menu.operator_parameters is not None
        self.assertEqual(len(cube_menu.operator_parameters), 1)
        cube_size = cube_menu.operator_parameters[0]
        self.assertEqual(
            (cube_size.name, cube_size.source.argument_name, cube_size.source.transform),
            ("size", "size", "identity"),
        )
        assert cube_menu.control_operations is not None
        self.assertEqual(
            cube_menu.control_operations.insert_after_step_id, "operator.cube"
        )
        self.assertEqual(
            tuple(
                (
                    operation.id,
                    operation.path,
                    operation.parameters[0].name,
                    operation.parameters[0].source.argument_name,
                    operation.parameters[0].source.transform,
                )
                for operation in cube_menu.control_operations.operations
            ),
            (
                (
                    "control.location",
                    ("Sidebar", "Item", "Transform", "Location"),
                    "value",
                    "location",
                    "identity",
                ),
                (
                    "control.object_name",
                    ("Outliner", "Object Name"),
                    "value",
                    "objectName",
                    "identity",
                ),
            ),
        )
        assert cube_menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                (omission.argument_name, omission.reason)
                for omission in cube_menu.omitted_action_arguments
            ),
            (
                (
                    "resourceId",
                    "The logical resource identifier has no user-facing Blender control.",
                ),
            ),
        )
        cube_shortcut = cube.procedure_materialization.shortcut
        self.assertEqual(cube_shortcut.availability, "available")
        assert cube_shortcut.shortcut_operations is not None
        self.assertEqual(
            tuple(
                (operation.id, operation.key_mode, operation.keys)
                for operation in cube_shortcut.shortcut_operations
            ),
            (
                ("shortcut.add_cube", "chord", ("SHIFT", "A")),
                ("shortcut.move_x", "sequence", ("G", "X")),
                ("shortcut.move_y", "sequence", ("G", "Y")),
                ("shortcut.move_z", "sequence", ("G", "Z")),
                ("shortcut.scale", "sequence", ("S",)),
                ("shortcut.rename", "sequence", ("F2",)),
            ),
        )
        cube_scale_source = cube_shortcut.shortcut_operations[4].parameters[0].source
        self.assertEqual(
            (
                cube_scale_source.argument_name,
                cube_scale_source.transform,
            ),
            ("size", "divide_by_two"),
        )
        self.assertEqual(cube.procedure_materialization.mcp, mcp)
        cone = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_cone"
        )
        self.assertIsNotNone(cone.procedure_materialization)
        assert cone.procedure_materialization is not None
        cone_menu = cone.procedure_materialization.menu
        self.assertEqual(cone_menu.availability, "available")
        self.assertEqual(cone_menu.source, "guidance.native_path")
        self.assertEqual(cone_menu.semantic_binding, "all_leaf_operations")
        self.assertEqual(
            cone_menu.parameter_binding, "ordered_parameter_operations"
        )
        assert cone_menu.operator_parameters is not None
        self.assertEqual(
            tuple(parameter.name for parameter in cone_menu.operator_parameters),
            (
                "vertices",
                "radius1",
                "radius2",
                "depth",
                "end_fill_type",
                "calc_uvs",
                "enter_editmode",
                "align",
                "location",
                "rotation",
                "scale",
            ),
        )
        self.assertEqual(
            tuple(
                parameter.source.value
                for parameter in cone_menu.operator_parameters
                if parameter.source.kind == "literal"
            ),
            (32, "NGON", False, False, "WORLD", [0, 0, 0], [1, 1, 1]),
        )
        self.assertEqual(
            tuple(
                (
                    parameter.name,
                    parameter.source.argument_name,
                    parameter.source.transform,
                )
                for parameter in cone_menu.operator_parameters
                if parameter.source.kind == "action_argument"
            ),
            (
                ("radius1", "radiusStart", "identity"),
                ("radius2", "radiusEnd", "identity"),
            ),
        )
        self.assertEqual(
            tuple(
                (
                    parameter.name,
                    parameter.source.derivation,
                    parameter.source.start_argument_name,
                    parameter.source.end_argument_name,
                    parameter.source.output,
                )
                for parameter in cone_menu.operator_parameters
                if parameter.source.kind == "derived_action_arguments"
            ),
            (
                ("depth", "segment_frame", "start", "end", "distance"),
                (
                    "rotation",
                    "segment_frame",
                    "start",
                    "end",
                    "rotation_euler_xyz_align_z",
                ),
            ),
        )
        assert cone_menu.control_operations is not None
        self.assertEqual(
            cone_menu.control_operations.insert_after_step_id, "operator.cone"
        )
        self.assertEqual(
            tuple(
                (operation.id, operation.path)
                for operation in cone_menu.control_operations.operations
            ),
            (
                (
                    "control.location",
                    ("Sidebar", "Item", "Transform", "Location"),
                ),
                ("control.object_name", ("Outliner", "Object Name")),
            ),
        )
        cone_location_source = cone_menu.control_operations.operations[0].parameters[
            0
        ].source
        self.assertEqual(
            (
                cone_location_source.derivation,
                cone_location_source.start_argument_name,
                cone_location_source.end_argument_name,
                cone_location_source.output,
            ),
            ("segment_frame", "start", "end", "midpoint"),
        )
        cone_name_source = cone_menu.control_operations.operations[1].parameters[
            0
        ].source
        self.assertEqual(
            (cone_name_source.argument_name, cone_name_source.transform),
            ("objectName", "identity"),
        )
        assert cone_menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                (omission.argument_name, omission.reason)
                for omission in cone_menu.omitted_action_arguments
            ),
            (
                (
                    "resourceId",
                    "The logical resource identifier has no user-facing Blender control.",
                ),
            ),
        )
        self.assertEqual(
            (
                cone.procedure_materialization.shortcut.availability,
                cone.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertEqual(cone.procedure_materialization.mcp, mcp)
        cylinder = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_cylinder"
        )
        self.assertIsNotNone(cylinder.procedure_materialization)
        assert cylinder.procedure_materialization is not None
        cylinder_menu = cylinder.procedure_materialization.menu
        self.assertEqual(cylinder_menu.availability, "available")
        self.assertEqual(cylinder_menu.source, "guidance.native_path")
        self.assertEqual(cylinder_menu.semantic_binding, "all_leaf_operations")
        self.assertEqual(
            cylinder_menu.parameter_binding, "ordered_parameter_operations"
        )
        assert cylinder_menu.operator_parameters is not None
        self.assertEqual(
            tuple(parameter.name for parameter in cylinder_menu.operator_parameters),
            (
                "vertices",
                "radius",
                "depth",
                "end_fill_type",
                "calc_uvs",
                "enter_editmode",
                "align",
                "location",
                "rotation",
                "scale",
            ),
        )
        self.assertEqual(
            tuple(
                parameter.source.value
                for parameter in cylinder_menu.operator_parameters
                if parameter.source.kind == "literal"
            ),
            (32, "NGON", False, False, "WORLD", [0, 0, 0], [1, 1, 1]),
        )
        self.assertEqual(
            tuple(
                (
                    parameter.name,
                    parameter.source.argument_name,
                    parameter.source.transform,
                )
                for parameter in cylinder_menu.operator_parameters
                if parameter.source.kind == "action_argument"
            ),
            (("radius", "radius", "identity"),),
        )
        self.assertEqual(
            tuple(
                (
                    parameter.name,
                    parameter.source.derivation,
                    parameter.source.start_argument_name,
                    parameter.source.end_argument_name,
                    parameter.source.output,
                )
                for parameter in cylinder_menu.operator_parameters
                if parameter.source.kind == "derived_action_arguments"
            ),
            (
                ("depth", "segment_frame", "start", "end", "distance"),
                (
                    "rotation",
                    "segment_frame",
                    "start",
                    "end",
                    "rotation_euler_xyz_align_z",
                ),
            ),
        )
        assert cylinder_menu.control_operations is not None
        self.assertEqual(
            cylinder_menu.control_operations.insert_after_step_id,
            "operator.cylinder",
        )
        self.assertEqual(
            tuple(
                (operation.id, operation.path)
                for operation in cylinder_menu.control_operations.operations
            ),
            (
                (
                    "control.location",
                    ("Sidebar", "Item", "Transform", "Location"),
                ),
                ("control.object_name", ("Outliner", "Object Name")),
            ),
        )
        cylinder_location_source = (
            cylinder_menu.control_operations.operations[0].parameters[0].source
        )
        self.assertEqual(
            (
                cylinder_location_source.derivation,
                cylinder_location_source.start_argument_name,
                cylinder_location_source.end_argument_name,
                cylinder_location_source.output,
            ),
            ("segment_frame", "start", "end", "midpoint"),
        )
        cylinder_name_source = (
            cylinder_menu.control_operations.operations[1].parameters[0].source
        )
        self.assertEqual(
            (cylinder_name_source.argument_name, cylinder_name_source.transform),
            ("objectName", "identity"),
        )
        assert cylinder_menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                (omission.argument_name, omission.reason)
                for omission in cylinder_menu.omitted_action_arguments
            ),
            (
                (
                    "resourceId",
                    "The logical resource identifier has no user-facing Blender control.",
                ),
            ),
        )
        self.assertEqual(
            (
                cylinder.procedure_materialization.shortcut.availability,
                cylinder.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertEqual(
            (
                cylinder.procedure_materialization.mcp.availability,
                cylinder.procedure_materialization.mcp.reason,
            ),
            ("unavailable", "No approved action-level MCP tool is available."),
        )
        torus = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_torus"
        )
        self.assertIsNotNone(torus.procedure_materialization)
        assert torus.procedure_materialization is not None
        torus_menu = torus.procedure_materialization.menu
        self.assertEqual(torus_menu.availability, "available")
        self.assertEqual(torus_menu.source, "guidance.native_path")
        self.assertEqual(torus_menu.semantic_binding, "all_leaf_operations")
        self.assertEqual(
            torus_menu.parameter_binding, "ordered_parameter_operations"
        )
        assert torus_menu.operator_parameters is not None
        self.assertEqual(
            tuple(
                (
                    parameter.name,
                    parameter.source.argument_name,
                    parameter.source.transform,
                )
                for parameter in torus_menu.operator_parameters
            ),
            (
                ("major_segments", "majorSegments", "identity"),
                ("minor_segments", "minorSegments", "identity"),
                ("mode", None, None),
                ("major_radius", "majorRadius", "identity"),
                ("minor_radius", "minorRadius", "identity"),
            ),
        )
        mode = torus_menu.operator_parameters[2]
        self.assertEqual(mode.source.value, "MAJOR_MINOR")
        assert torus_menu.control_operations is not None
        self.assertEqual(
            torus_menu.control_operations.insert_after_step_id, "operator.torus"
        )
        self.assertEqual(
            tuple(
                (
                    operation.id,
                    operation.path,
                    operation.parameters[0].name,
                    operation.parameters[0].source.argument_name,
                    operation.parameters[0].source.transform,
                )
                for operation in torus_menu.control_operations.operations
            ),
            (
                (
                    "control.location",
                    ("Sidebar", "Item", "Transform", "Location"),
                    "value",
                    "location",
                    "identity",
                ),
                (
                    "control.object_name",
                    ("Outliner", "Object Name"),
                    "value",
                    "objectName",
                    "identity",
                ),
            ),
        )
        assert torus_menu.omitted_action_arguments is not None
        self.assertEqual(
            tuple(
                (omission.argument_name, omission.reason)
                for omission in torus_menu.omitted_action_arguments
            ),
            (
                (
                    "resourceId",
                    "The logical resource identifier has no user-facing Blender control.",
                ),
            ),
        )
        self.assertEqual(
            (
                torus.procedure_materialization.shortcut.availability,
                torus.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertEqual(torus.procedure_materialization.mcp, mcp)
        self.assertTrue(
            all(
                recipe.procedure_materialization is None
                for recipe in catalog.recipes
                if recipe.action_name
                not in {
                    "blender.mesh.create_uv_sphere",
                    "blender.mesh.create_icosphere",
                    "blender.mesh.create_plane",
                    "blender.mesh.create_cube",
                    "blender.mesh.create_cone",
                    "blender.mesh.create_cylinder",
                    "blender.mesh.create_torus",
                    "blender.mesh.edit_subdivide",
                    "blender.mesh.edit_bevel_edges",
                    "blender.mesh.edit_inset_faces",
                    "blender.mesh.edit_poke_faces",
                    "blender.modifier.add_subdivision_surface",
                    "blender.modifier.add_mirror",
                }
            )
        )

    def test_exposes_candidate_only_bevel_edges_shortcut_with_exact_modal_source(self) -> None:
        recipe = next(
            recipe
            for recipe in BUNDLED_INTERACTION_CATALOG.recipes
            if recipe.action_name == "blender.mesh.edit_bevel_edges"
        )
        self.assertEqual(
            tuple(
                (step.intent, step.target_kind, step.target_id)
                for step in recipe.guidance.steps
            ),
            (
                ("navigate", "workspace", "Layout"),
                ("configure", "semantic", "operatingline.blender.owned_mesh"),
                ("navigate", "mode", "EDIT_MESH"),
                ("navigate", "menu", "VIEW3D_MT_edit_mesh_edges"),
                ("execute", "operator", "mesh.bevel"),
                (
                    "configure",
                    "semantic",
                    "operatingline.blender.managed_bevel_edges",
                ),
            ),
        )
        self.assertEqual(
            sum(
                step.intent == "execute" and step.target_kind == "operator"
                for step in recipe.guidance.steps
            ),
            1,
        )
        assert recipe.procedure_materialization is not None
        materialization = recipe.procedure_materialization
        self.assertEqual(materialization.menu.availability, "unavailable")
        self.assertEqual(materialization.mcp.availability, "unavailable")
        shortcut = materialization.shortcut
        self.assertEqual(
            (
                shortcut.availability,
                shortcut.source,
                shortcut.semantic_binding,
                shortcut.parameter_binding,
                shortcut.projection,
            ),
            (
                "available",
                "catalog.ordered_shortcut_operations",
                "all_leaf_operations",
                "ordered_parameter_operations",
                "candidate_only",
            ),
        )
        assert shortcut.preconditions is not None
        self.assertEqual(len(shortcut.preconditions), 10)
        assert shortcut.shortcut_operations is not None
        operations = shortcut.shortcut_operations
        self.assertEqual(
            tuple(operation.id for operation in operations),
            (
                "shortcut.enter_edit_mode",
                "shortcut.select_edge_mode",
                "shortcut.select_all_edges",
                "shortcut.bevel_edges",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_bevel_width",
                "shortcut.set_bevel_segments",
                "shortcut.set_bevel_profile",
                "shortcut.close_adjust_last_operation",
                "shortcut.return_to_object_mode",
            ),
        )
        source = operations[3]
        self.assertEqual((source.key_mode, source.keys), ("chord", ("CTRL", "B")))
        self.assertEqual(
            tuple((parameter.name, parameter.source.value) for parameter in source.parameters),
            (
                ("offset_type", "OFFSET"),
                ("offset", 0),
                ("profile_type", "SUPERELLIPSE"),
                ("segments", 1),
                ("profile", 0.5),
                ("affect", "EDGES"),
                ("clamp_overlap", False),
                ("loop_slide", True),
                ("mark_seam", False),
                ("mark_sharp", False),
                ("material", -1),
                ("harden_normals", False),
                ("face_strength_mode", "NONE"),
                ("miter_outer", "SHARP"),
                ("miter_inner", "SHARP"),
                ("spread", 0.1),
                ("vmesh_method", "ADJ"),
                ("release_confirm", False),
                ("confirm", "ENTER"),
            ),
        )
        opener = operations[4]
        assert opener.opens_surface is not None
        self.assertEqual(
            (
                opener.keys,
                opener.opens_surface.source_operation_id,
                opener.opens_surface.expected_operator_id,
            ),
            (("F9",), "shortcut.bevel_edges", "mesh.bevel"),
        )
        self.assertEqual(
            tuple(
                (
                    operation.target_id,
                    operation.path,
                    operation.parameters[0].source.argument_name,
                )
                for operation in operations[5:8]
            ),
            (
                ("mesh.bevel.offset", ("Adjust Last Operation", "Width"), "width"),
                (
                    "mesh.bevel.segments",
                    ("Adjust Last Operation", "Segments"),
                    "segments",
                ),
                (
                    "mesh.bevel.profile",
                    ("Adjust Last Operation", "Profile Shape"),
                    "profile",
                ),
            ),
        )
        self.assertEqual(
            operations[8].closes_surface_operation_id,
            "shortcut.open_adjust_last_operation",
        )
        self.assertEqual(operations[9].keys, ("TAB",))
        assert shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(item.argument_name for item in shortcut.omitted_action_arguments),
            ("targetId", "resultMeshId", "resultMeshName"),
        )

    def test_exposes_candidate_only_individual_inset_faces_shortcut(self) -> None:
        recipe = next(
            recipe
            for recipe in BUNDLED_INTERACTION_CATALOG.recipes
            if recipe.action_name == "blender.mesh.edit_inset_faces"
        )
        self.assertEqual(
            tuple(
                (step.intent, step.target_kind, step.target_id)
                for step in recipe.guidance.steps
            ),
            (
                ("navigate", "workspace", "Layout"),
                ("configure", "semantic", "operatingline.blender.owned_mesh"),
                ("navigate", "mode", "EDIT_MESH"),
                ("navigate", "menu", "VIEW3D_MT_edit_mesh_faces"),
                ("execute", "operator", "mesh.inset"),
                (
                    "configure",
                    "semantic",
                    "operatingline.blender.managed_inset_faces",
                ),
            ),
        )
        assert recipe.procedure_materialization is not None
        materialization = recipe.procedure_materialization
        self.assertEqual(materialization.menu.availability, "unavailable")
        self.assertEqual(materialization.mcp.availability, "unavailable")
        shortcut = materialization.shortcut
        self.assertEqual(
            (shortcut.availability, shortcut.projection),
            ("available", "candidate_only"),
        )
        assert shortcut.shortcut_operations is not None
        operations = shortcut.shortcut_operations
        self.assertEqual(
            tuple(operation.id for operation in operations),
            (
                "shortcut.enter_edit_mode",
                "shortcut.select_face_mode",
                "shortcut.select_all_faces",
                "shortcut.inset_faces",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_inset_thickness",
                "shortcut.set_inset_depth",
                "shortcut.set_inset_individual",
                "shortcut.close_adjust_last_operation",
                "shortcut.return_to_object_mode",
            ),
        )
        source = operations[3]
        self.assertEqual((source.key_mode, source.keys), ("sequence", ("I",)))
        self.assertEqual(
            tuple((parameter.name, parameter.source.value) for parameter in source.parameters),
            (
                ("use_boundary", True),
                ("use_even_offset", True),
                ("use_relative_offset", False),
                ("use_edge_rail", False),
                ("thickness", 0),
                ("depth", 0),
                ("use_outset", False),
                ("use_select_inset", False),
                ("use_individual", False),
                ("use_interpolate", True),
                ("release_confirm", False),
                ("confirm", "ENTER"),
            ),
        )
        opener = operations[4]
        assert opener.opens_surface is not None
        self.assertEqual(
            (
                opener.keys,
                opener.opens_surface.source_operation_id,
                opener.opens_surface.expected_operator_id,
            ),
            (("F9",), "shortcut.inset_faces", "mesh.inset"),
        )
        self.assertEqual(
            tuple(
                (
                    operation.target_id,
                    operation.parameters[0].source.argument_name,
                    operation.parameters[0].source.value,
                )
                for operation in operations[5:8]
            ),
            (
                ("mesh.inset.thickness", "thickness", None),
                ("mesh.inset.depth", "depth", None),
                ("mesh.inset.use_individual", None, True),
            ),
        )
        assert shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(item.argument_name for item in shortcut.omitted_action_arguments),
            ("targetId", "resultMeshId", "resultMeshName"),
        )

    def test_exposes_candidate_only_poke_faces_shortcut(self) -> None:
        recipe = next(
            recipe
            for recipe in BUNDLED_INTERACTION_CATALOG.recipes
            if recipe.action_name == "blender.mesh.edit_poke_faces"
        )
        self.assertEqual(
            tuple(
                (step.intent, step.target_kind, step.target_id)
                for step in recipe.guidance.steps
            ),
            (
                ("navigate", "workspace", "Layout"),
                ("configure", "semantic", "operatingline.blender.owned_mesh"),
                ("navigate", "mode", "EDIT_MESH"),
                ("navigate", "menu", "VIEW3D_MT_edit_mesh_faces"),
                ("execute", "operator", "mesh.poke"),
                (
                    "configure",
                    "semantic",
                    "operatingline.blender.managed_poke_faces",
                ),
            ),
        )
        assert recipe.guidance.reason is not None
        self.assertIn("UI MEDIAN_WEIGHTED", recipe.guidance.reason)
        self.assertIn("managed BMesh MEAN_WEIGHTED", recipe.guidance.reason)
        assert recipe.procedure_materialization is not None
        materialization = recipe.procedure_materialization
        self.assertEqual(materialization.menu.availability, "unavailable")
        self.assertEqual(materialization.mcp.availability, "unavailable")
        shortcut = materialization.shortcut
        self.assertEqual(
            (shortcut.availability, shortcut.projection),
            ("available", "candidate_only"),
        )
        assert shortcut.shortcut_operations is not None
        operations = shortcut.shortcut_operations
        self.assertEqual(
            tuple(operation.id for operation in operations),
            (
                "shortcut.enter_edit_mode",
                "shortcut.select_face_mode",
                "shortcut.select_all_faces",
                "shortcut.open_operator_search",
                "shortcut.execute_poke_faces",
                "shortcut.open_adjust_last_operation",
                "shortcut.set_poke_offset",
                "shortcut.close_adjust_last_operation",
                "shortcut.return_to_object_mode",
            ),
        )
        search = operations[3]
        self.assertEqual((search.keys, search.selection_path), (("F3",), ("Poke Faces",)))
        self.assertEqual(
            tuple((parameter.name, parameter.source.value) for parameter in search.parameters),
            (("query", "poke faces"),),
        )
        execute = operations[4]
        self.assertEqual(
            tuple((parameter.name, parameter.source.value) for parameter in execute.parameters),
            (
                ("offset", 0),
                ("use_relative_offset", False),
                ("center_mode", "MEDIAN_WEIGHTED"),
            ),
        )
        opener = operations[5]
        assert opener.opens_surface is not None
        self.assertEqual(
            (
                opener.keys,
                opener.opens_surface.source_operation_id,
                opener.opens_surface.expected_operator_id,
            ),
            (("F9",), "shortcut.execute_poke_faces", "mesh.poke"),
        )
        offset = operations[6]
        self.assertEqual(
            (
                offset.target_id,
                offset.path,
                offset.parameters[0].source.argument_name,
            ),
            ("mesh.poke.offset", ("Adjust Last Operation", "Offset"), "offset"),
        )
        self.assertEqual(
            operations[7].closes_surface_operation_id,
            "shortcut.open_adjust_last_operation",
        )
        self.assertEqual(operations[8].keys, ("TAB",))
        assert shortcut.omitted_action_arguments is not None
        self.assertEqual(
            tuple(item.argument_name for item in shortcut.omitted_action_arguments),
            ("targetId", "resultMeshId", "resultMeshName"),
        )

    def test_loads_byte_frozen_single_action_level_mcp_catalog(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.34.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "38a01825bc709f4db0df18dcc822c02596bb6001d536092880b562ba27791796",
        )
        self.assertEqual(frozen.catalog_version, "1.34.0")
        self.assertEqual(
            tuple(
                recipe.action_name
                for recipe in frozen.recipes
                if recipe.procedure_materialization is not None
                and recipe.procedure_materialization.mcp.availability == "available"
            ),
            ("blender.mesh.create_uv_sphere",),
        )

    def test_loads_byte_frozen_four_action_level_mcp_catalog(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.35.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "0b2a1216412bef2db3ce23baa56758f6ffa4e8023b1ec0dafbd65a935f0391f6",
        )
        self.assertEqual(frozen.catalog_version, "1.35.0")
        self.assertEqual(
            tuple(
                recipe.action_name
                for recipe in frozen.recipes
                if recipe.procedure_materialization is not None
                and recipe.procedure_materialization.mcp.availability == "available"
            ),
            (
                "blender.mesh.create_uv_sphere",
                "blender.mesh.create_icosphere",
                "blender.mesh.create_plane",
                "blender.mesh.create_cube",
            ),
        )

    def test_loads_byte_frozen_torus_action_level_mcp_catalog(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.36.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "24050fafa64d05b7339a2af3e4a0b5d6d90f6b76f3be8cf55dbc342653b4b763",
        )
        self.assertEqual(frozen.catalog_version, "1.36.0")
        self.assertEqual(
            tuple(
                recipe.action_name
                for recipe in frozen.recipes
                if recipe.procedure_materialization is not None
                and recipe.procedure_materialization.mcp.availability == "available"
            ),
            (
                "blender.mesh.create_uv_sphere",
                "blender.mesh.create_icosphere",
                "blender.mesh.create_plane",
                "blender.mesh.create_cube",
                "blender.mesh.create_torus",
            ),
        )

    def test_loads_byte_frozen_subdivision_surface_catalog_without_bevel_edges(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.23.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_113_PATH
        )
        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "6f875d895fc0ea7c8aab9c01c612e9eaf20f3958f7804231e061b2076696b8d5",
        )
        self.assertEqual(frozen.catalog_version, "1.23.0")
        self.assertEqual(frozen.action_catalog_version, "1.13.0")
        self.assertFalse(
            any(
                recipe.action_name == "blender.mesh.edit_bevel_edges"
                for recipe in frozen.recipes
            )
        )

    def test_loads_byte_frozen_bevel_catalog_without_inset_faces(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.24.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_114_PATH
        )
        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "769404cc6f8f7d80f248892320eb857b28ad37d4d7b2e246160a9f7ac116c2f7",
        )
        self.assertEqual(frozen.catalog_version, "1.24.0")
        self.assertEqual(frozen.action_catalog_version, "1.14.0")
        self.assertTrue(
            any(
                recipe.action_name == "blender.mesh.edit_bevel_edges"
                for recipe in frozen.recipes
            )
        )
        self.assertFalse(
            any(
                recipe.action_name == "blender.mesh.edit_inset_faces"
                for recipe in frozen.recipes
            )
        )

    def test_loads_byte_frozen_inset_catalog_without_poke_faces(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.25.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_115_PATH
        )
        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "e24008348de4ac90585eb32a4aa5d484bd6cde2aa9cb1d0dbec3fae11d54af88",
        )
        self.assertEqual(frozen.catalog_version, "1.25.0")
        self.assertEqual(frozen.action_catalog_version, "1.15.0")
        self.assertTrue(
            any(
                recipe.action_name == "blender.mesh.edit_inset_faces"
                for recipe in frozen.recipes
            )
        )
        self.assertFalse(
            any(
                recipe.action_name == "blender.mesh.edit_poke_faces"
                for recipe in frozen.recipes
            )
        )

    def test_loads_byte_frozen_poke_catalog_without_mirror_modifier(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.26.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_116_PATH
        )
        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "8ea27f1162b32d9d542c8b417a26f14cfb9ed7b8c7fa624af65b143e16c481fc",
        )
        self.assertEqual(frozen.catalog_version, "1.26.0")
        self.assertEqual(frozen.action_catalog_version, "1.16.0")
        self.assertTrue(
            any(
                recipe.action_name == "blender.mesh.edit_poke_faces"
                for recipe in frozen.recipes
            )
        )
        self.assertFalse(
            any(
                recipe.action_name == "blender.modifier.add_mirror"
                for recipe in frozen.recipes
            )
        )

    def test_loads_legacy_catalog_without_materialization_declarations(self) -> None:
        legacy_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.9.0.json"
        )
        legacy = load_interaction_catalog(
            legacy_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(legacy.catalog_version, "1.9.0")
        self.assertTrue(
            all(recipe.procedure_materialization is None for recipe in legacy.recipes)
        )

    def test_loads_frozen_accepted_action_arguments_without_ordered_fields(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.10.0.json"
        )
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )
        materialization = frozen.recipes[0].procedure_materialization
        assert materialization is not None
        menu = materialization.menu

        self.assertEqual(menu.parameter_binding, "accepted_action_arguments")
        self.assertIsNone(menu.operator_parameters)
        self.assertIsNone(menu.control_operations)
        self.assertIsNone(menu.omitted_action_arguments)

    def test_loads_frozen_ordered_menu_without_shortcut_operations(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.11.0.json"
        )
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )
        materialization = frozen.recipes[0].procedure_materialization
        assert materialization is not None

        self.assertEqual(
            materialization.menu.parameter_binding,
            "ordered_parameter_operations",
        )
        self.assertEqual(materialization.shortcut.availability, "unavailable")
        self.assertIsNone(materialization.shortcut.shortcut_operations)

    def test_loads_frozen_shortcut_catalog_without_icosphere_materialization(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.12.0.json"
        )
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(frozen.catalog_version, "1.12.0")
        sphere_materialization = frozen.recipes[0].procedure_materialization
        assert sphere_materialization is not None
        self.assertEqual(sphere_materialization.shortcut.availability, "available")
        self.assertIsNone(frozen.recipes[1].procedure_materialization)

    def test_loads_byte_frozen_icosphere_catalog_without_cube_materialization(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.13.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "1c97dfa118715546eafe3709624469de97edbc22a20102a80c8710f0b46b10dc",
        )
        self.assertEqual(frozen.catalog_version, "1.13.0")
        icosphere = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_icosphere"
        )
        cube = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_cube"
        )
        self.assertIsNotNone(icosphere.procedure_materialization)
        self.assertIsNone(cube.procedure_materialization)

    def test_loads_byte_frozen_cube_catalog_without_plane_materialization(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.14.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "bcdd69b9b1f345d6e4c27ff2e316c4d44cb931355ab01f4e7f7a013022439746",
        )
        self.assertEqual(frozen.catalog_version, "1.14.0")
        plane = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_plane"
        )
        cube = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_cube"
        )
        self.assertIsNone(plane.procedure_materialization)
        self.assertIsNotNone(cube.procedure_materialization)

    def test_loads_byte_frozen_plane_catalog_without_torus_materialization(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.15.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "a4d799f155eb58cf53d1ccc8689fc4b4b55cc87739ea2d1d54a8f03d1050e0d6",
        )
        self.assertEqual(frozen.catalog_version, "1.15.0")
        plane = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_plane"
        )
        torus = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_torus"
        )
        self.assertIsNotNone(plane.procedure_materialization)
        self.assertIsNone(torus.procedure_materialization)

    def test_loads_byte_frozen_torus_catalog_without_cone_materialization(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.16.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "68945039a55f0cfef011d0472383e6f2e4809b181ca6def547cd78ff5660854f",
        )
        self.assertEqual(frozen.catalog_version, "1.16.0")
        torus = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_torus"
        )
        cone = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_cone"
        )
        self.assertIsNotNone(torus.procedure_materialization)
        self.assertIsNone(cone.procedure_materialization)

    def test_loads_byte_frozen_cone_catalog_without_cylinder_materialization(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.17.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "7dac53c0ff399a54e91b460b91caf5354824827ad4d801b3fb24e016d665d132",
        )
        self.assertEqual(frozen.catalog_version, "1.17.0")
        cone = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_cone"
        )
        cylinder = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_cylinder"
        )
        self.assertIsNotNone(cone.procedure_materialization)
        self.assertIsNone(cylinder.procedure_materialization)

    def test_loads_byte_frozen_cylinder_catalog_without_cube_shortcut(self) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.18.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "f34350f6dbd3edc53360e933281457ab7d12db29a3a81311eae66470a48ff735",
        )
        self.assertEqual(frozen.catalog_version, "1.18.0")
        cube = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_cube"
        )
        assert cube.procedure_materialization is not None
        self.assertEqual(
            cube.procedure_materialization.shortcut.availability,
            "unavailable",
        )
        self.assertIsNone(
            cube.procedure_materialization.shortcut.shortcut_operations
        )

    def test_loads_byte_frozen_cube_shortcut_catalog_without_plane_shortcut(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.19.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "7e1d454fcf36bbf52e76583bd15cb4e95c44791d644df8b8e5c1cf75cd12e1d0",
        )
        self.assertEqual(frozen.catalog_version, "1.19.0")
        plane = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_plane"
        )
        assert plane.procedure_materialization is not None
        self.assertEqual(
            (
                plane.procedure_materialization.shortcut.availability,
                plane.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertIsNone(
            plane.procedure_materialization.shortcut.shortcut_operations
        )

    def test_loads_byte_frozen_plane_shortcut_catalog_without_icosphere_shortcut(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.20.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "71c16e634e28f2318652495aa0019350c55ed9a4a193c29102a94e995015134d",
        )
        self.assertEqual(frozen.catalog_version, "1.20.0")
        icosphere = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.create_icosphere"
        )
        assert icosphere.procedure_materialization is not None
        self.assertEqual(
            (
                icosphere.procedure_materialization.shortcut.availability,
                icosphere.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertIsNone(
            icosphere.procedure_materialization.shortcut.shortcut_operations
        )

    def test_loads_byte_frozen_icosphere_shortcut_catalog_without_subdivide_shortcut(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.21.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "f1a47b2903f6d15f0a9fef76f9f30e4e399d4bca98c9f9473c3e920c9df6583c",
        )
        self.assertEqual(frozen.catalog_version, "1.21.0")
        subdivide = next(
            recipe
            for recipe in frozen.recipes
            if recipe.action_name == "blender.mesh.edit_subdivide"
        )
        self.assertIsNone(subdivide.procedure_materialization)

    def test_loads_byte_frozen_subdivide_catalog_without_subdivision_surface(
        self,
    ) -> None:
        frozen_path = (
            REPO_ROOT
            / "adapters"
            / "blender"
            / "catalog"
            / "v1"
            / "interaction-catalog-1.22.0.json"
        )
        frozen_bytes = frozen_path.read_bytes()
        frozen = load_interaction_catalog(
            frozen_path, FROZEN_ACTION_CATALOG_112_PATH
        )

        self.assertEqual(
            hashlib.sha256(frozen_bytes).hexdigest(),
            "ec46a98ffea8230cb9d6133355b98e02763c4a58878c22631c5b3e08bea6b99e",
        )
        self.assertEqual(frozen.catalog_version, "1.22.0")
        self.assertEqual(frozen.action_catalog_version, "1.12.0")
        self.assertFalse(
            any(
                recipe.action_name
                == "blender.modifier.add_subdivision_surface"
                for recipe in frozen.recipes
            )
        )

    def test_parses_ordered_operator_and_post_execution_control_operations(self) -> None:
        catalog = self._load_raw(self._ordered_parameter_catalog())
        menu = catalog.recipes[0].procedure_materialization.menu

        self.assertEqual(menu.parameter_binding, "ordered_parameter_operations")
        assert menu.control_operations is not None
        self.assertEqual(
            menu.control_operations.insert_after_step_id, "operator.uv_sphere"
        )
        assert menu.operator_parameters is not None
        self.assertEqual(
            tuple(parameter.name for parameter in menu.operator_parameters),
            ("resource_id", "object_name", "location"),
        )
        self.assertEqual(len(menu.control_operations.operations), 1)
        control = menu.control_operations.operations[0]
        self.assertEqual(control.id, "control.radius")
        self.assertEqual(control.path, ("Adjust Last Operation", "Radius"))
        self.assertEqual(control.parameters[0].source.argument_name, "radius")
        self.assertEqual(control.parameters[0].source.transform, "uniform_vector3")
        self.assertEqual(control.parameters[1].source.value, True)
        self.assertEqual(menu.omitted_action_arguments, ())

    def test_rejects_malformed_segment_frame_derivations(self) -> None:
        def cone_menu(raw: dict) -> dict:
            recipe = next(
                item
                for item in raw["recipes"]
                if item["actionName"] == "blender.mesh.create_cone"
            )
            return recipe["procedureMaterialization"]["menu"]

        def derived_sources(menu: dict) -> list[dict]:
            parameters = list(menu["operatorParameters"])
            parameters.extend(
                parameter
                for operation in menu["controlOperations"]["operations"]
                for parameter in operation["parameters"]
            )
            return [
                parameter["source"]
                for parameter in parameters
                if parameter["source"]["kind"] == "derived_action_arguments"
            ]

        same_endpoint = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        same_endpoint_sources = derived_sources(cone_menu(same_endpoint))
        same_endpoint_sources[0]["endArgumentName"] = "start"
        with self.assertRaisesRegex(
            ValueError, "segment frame arguments must differ"
        ):
            self._load_raw(same_endpoint)

        unsupported_derivation = json.loads(
            RESOURCE_PATH.read_text(encoding="utf-8")
        )
        unsupported_sources = derived_sources(cone_menu(unsupported_derivation))
        unsupported_sources[0]["derivation"] = "arbitrary_expression"
        with self.assertRaisesRegex(ValueError, "unsupported derivation"):
            self._load_raw(unsupported_derivation)

        missing_output = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        missing_menu = cone_menu(missing_output)
        missing_location = missing_menu["controlOperations"]["operations"][0]
        missing_location["parameters"][0]["source"] = {
            "kind": "literal",
            "value": [0, 0, 0],
        }
        with self.assertRaisesRegex(
            ValueError,
            "output coverage mismatch; missing: midpoint; unknown: none",
        ):
            self._load_raw(missing_output)

        duplicate_output = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        duplicate_sources = derived_sources(cone_menu(duplicate_output))
        duplicate_sources[1]["output"] = "distance"
        with self.assertRaisesRegex(
            ValueError, "maps output distance more than once"
        ):
            self._load_raw(duplicate_output)

        reversed_pair = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        reversed_sources = derived_sources(cone_menu(reversed_pair))
        reversed_sources[2]["startArgumentName"] = "end"
        reversed_sources[2]["endArgumentName"] = "start"
        with self.assertRaisesRegex(
            ValueError, "participates in more than one segment frame"
        ):
            self._load_raw(reversed_pair)

        direct_mix = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        direct_menu = cone_menu(direct_mix)
        direct_menu["operatorParameters"].append(
            {
                "name": "start_again",
                "source": {
                    "kind": "action_argument",
                    "argumentName": "start",
                    "transform": "identity",
                },
            }
        )
        with self.assertRaisesRegex(
            ValueError, "cannot mix direct and segment-frame mappings"
        ):
            self._load_raw(direct_mix)

        omitted_endpoint = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        cone_menu(omitted_endpoint)["omittedActionArguments"].append(
            {"argumentName": "end", "reason": "Invalid overlap."}
        )
        with self.assertRaisesRegex(
            ValueError, "both maps and omits action argument end"
        ):
            self._load_raw(omitted_endpoint)

    def test_rejects_malformed_ordered_parameter_operations(self) -> None:
        cases: list[tuple[str, Callable[[dict, dict], None], str]] = [
            (
                "wrong insertion point",
                lambda menu, recipe: menu["controlOperations"].__setitem__(
                    "insertAfterStepId", recipe["guidance"]["steps"][0]["id"]
                ),
                "insertAfterStepId must equal the execution step",
            ),
            (
                "duplicate guidance id",
                lambda menu, recipe: menu["controlOperations"]["operations"][
                    0
                ].__setitem__("id", recipe["guidance"]["steps"][0]["id"]),
                "duplicate operation id",
            ),
            (
                "invalid control target",
                lambda menu, _recipe: menu["controlOperations"]["operations"][0][
                    "target"
                ].__setitem__("kind", "operator"),
                "target kind must be control",
            ),
            (
                "duplicate parameter name",
                lambda menu, _recipe: menu["controlOperations"]["operations"][0][
                    "parameters"
                ][1].__setitem__("name", "scale"),
                "duplicate parameter name scale",
            ),
            (
                "empty control parameters",
                lambda menu, _recipe: menu["controlOperations"]["operations"][
                    0
                ].__setitem__("parameters", []),
                "must be a non-empty array",
            ),
            (
                "empty control operations",
                lambda menu, _recipe: menu["controlOperations"].__setitem__(
                    "operations", []
                ),
                "controlOperations must be a non-empty array",
            ),
            (
                "missing action coverage",
                lambda menu, _recipe: menu["operatorParameters"].pop(),
                "action coverage mismatch; missing: location",
            ),
            (
                "mapped and omitted",
                lambda menu, _recipe: menu["omittedActionArguments"].append(
                    {"argumentName": "radius", "reason": "Not surfaced."}
                ),
                "both maps and omits action argument radius",
            ),
            (
                "duplicate mapped argument",
                lambda menu, _recipe: menu["operatorParameters"].append(
                    {
                        "name": "radius_again",
                        "source": {
                            "kind": "action_argument",
                            "argumentName": "radius",
                            "transform": "identity",
                        },
                    }
                ),
                "maps action argument radius more than once",
            ),
            (
                "unknown omitted argument",
                lambda menu, _recipe: menu["omittedActionArguments"].append(
                    {"argumentName": "unknown", "reason": "Not in the action."}
                ),
                "action coverage mismatch; missing: none; unknown: unknown",
            ),
            (
                "uniform vector from array",
                lambda menu, _recipe: menu["operatorParameters"][2][
                    "source"
                ].__setitem__("transform", "uniform_vector3"),
                "uniform_vector3 source location must have a numeric action schema",
            ),
            (
                "divide by two from array",
                lambda menu, _recipe: menu["operatorParameters"][2][
                    "source"
                ].__setitem__("transform", "divide_by_two"),
                "divide_by_two source location must have a numeric action schema",
            ),
            (
                "unknown closed transform",
                lambda menu, _recipe: menu["operatorParameters"][0][
                    "source"
                ].__setitem__("transform", "divide_by_three"),
                "unsupported transform",
            ),
        ]

        for name, mutate, message in cases:
            with self.subTest(name=name):
                raw = self._ordered_parameter_catalog()
                recipe = raw["recipes"][0]
                menu = recipe["procedureMaterialization"]["menu"]
                mutate(menu, recipe)
                with self.assertRaisesRegex(ValueError, message):
                    self._load_raw(raw)

        duplicate_omission = self._ordered_parameter_catalog()
        duplicate_menu = duplicate_omission["recipes"][0][
            "procedureMaterialization"
        ]["menu"]
        duplicate_menu["operatorParameters"].pop(0)
        duplicate_menu["omittedActionArguments"] = [
            {
                "argumentName": "resourceId",
                "reason": "The logical resource identifier is not displayed.",
            },
            {
                "argumentName": "resourceId",
                "reason": "The logical resource identifier is not displayed.",
            },
        ]
        with self.assertRaisesRegex(ValueError, "duplicate argument resourceId"):
            self._load_raw(duplicate_omission)

    def test_rejects_reserved_parameter_assignment_names(self) -> None:
        for reserved_name in ("__proto__", "prototype", "constructor"):
            for location in ("operator", "control"):
                with self.subTest(name=reserved_name, location=location):
                    raw = self._ordered_parameter_catalog()
                    menu = raw["recipes"][0]["procedureMaterialization"]["menu"]
                    if location == "operator":
                        parameter = menu["operatorParameters"][0]
                    else:
                        parameter = menu["controlOperations"]["operations"][0][
                            "parameters"
                        ][0]
                    parameter["name"] = reserved_name

                    with self.assertRaisesRegex(
                        ValueError, f"reserved parameter name {reserved_name}"
                    ):
                        self._load_raw(raw)

        for non_portable_name in ("not portable", "9radius", "radius/value"):
            with self.subTest(name=non_portable_name):
                raw = self._ordered_parameter_catalog()
                raw["recipes"][0]["procedureMaterialization"]["menu"][
                    "operatorParameters"
                ][0]["name"] = non_portable_name

                with self.assertRaisesRegex(ValueError, "non-portable parameter name"):
                    self._load_raw(raw)

    def test_rejects_malformed_ordered_shortcut_operations(self) -> None:
        cases: list[tuple[str, Callable[[dict], None], str]] = [
            (
                "unsupported source",
                lambda shortcut: shortcut.__setitem__("source", "guidance.native_path"),
                "shortcut has unsupported source",
            ),
            (
                "non-candidate projection",
                lambda shortcut: shortcut.__setitem__("projection", "verified"),
                "projection must be candidate_only",
            ),
            (
                "missing keymap precondition",
                lambda shortcut: shortcut.__setitem__(
                    "preconditions",
                    [
                        item
                        for item in shortcut["preconditions"]
                        if item["kind"] != "keymap"
                    ],
                ),
                "missing required kinds: keymap",
            ),
            (
                "unknown precondition kind",
                lambda shortcut: shortcut["preconditions"][0].__setitem__(
                    "kind", "window"
                ),
                "has unknown kind window",
            ),
            (
                "duplicate singleton precondition",
                lambda shortcut: shortcut["preconditions"].append(
                    {
                        "kind": "workspace",
                        "label": "Alternate workspace",
                        "value": "Modeling",
                    }
                ),
                "must declare exactly one precondition for workspace",
            ),
            (
                "duplicate labeled precondition",
                lambda shortcut: shortcut["preconditions"].append(
                    deepcopy(shortcut["preconditions"][4])
                ),
                "contains duplicate precondition scene_state:3D Cursor",
            ),
            (
                "empty operations",
                lambda shortcut: shortcut.__setitem__("operations", []),
                "shortcut operations must be a non-empty array",
            ),
            (
                "duplicate operation id",
                lambda shortcut: shortcut["operations"][1].__setitem__(
                    "id", shortcut["operations"][0]["id"]
                ),
                "duplicate operation id",
            ),
            (
                "duplicate operation label",
                lambda shortcut: shortcut["operations"][1].__setitem__(
                    "label", shortcut["operations"][0]["label"]
                ),
                "duplicate operation label",
            ),
            (
                "unsupported key mode",
                lambda shortcut: shortcut["operations"][0].__setitem__(
                    "keyMode", "hold"
                ),
                "unsupported keyMode",
            ),
            (
                "empty keys",
                lambda shortcut: shortcut["operations"][0].__setitem__("keys", []),
                "keys must be a non-empty array",
            ),
            (
                "empty selection path",
                lambda shortcut: shortcut["operations"][0].__setitem__(
                    "selectionPath", []
                ),
                "selectionPath must be a non-empty array",
            ),
            (
                "empty parameters",
                lambda shortcut: shortcut["operations"][0].__setitem__(
                    "parameters", []
                ),
                "must be a non-empty array",
            ),
            (
                "missing vector component",
                lambda shortcut: shortcut["operations"].pop(3),
                "must map vector3 components x, y, and z exactly once",
            ),
            (
                "duplicate vector component",
                lambda shortcut: shortcut["operations"][3]["parameters"][0][
                    "source"
                ].__setitem__("transform", "vector3_x"),
                "maps action argument location vector3_x more than once",
            ),
            (
                "whole and component mapping",
                lambda shortcut: shortcut["operations"][4]["parameters"].append(
                    {
                        "name": "location",
                        "source": {
                            "kind": "action_argument",
                            "argumentName": "location",
                            "transform": "identity",
                        },
                    }
                ),
                "mixes whole and component mappings",
            ),
            (
                "missing shortcut action coverage",
                lambda shortcut: shortcut["operations"].pop(),
                "shortcut ordered parameter action coverage mismatch; "
                "missing: objectName",
            ),
            (
                "mapped and omitted action argument",
                lambda shortcut: shortcut["omittedActionArguments"].append(
                    {
                        "argumentName": "radius",
                        "reason": "Invalid overlap.",
                    }
                ),
                "both maps and omits action argument radius",
            ),
            (
                "unknown omitted action argument",
                lambda shortcut: shortcut["omittedActionArguments"][0].__setitem__(
                    "argumentName", "missing"
                ),
                "shortcut ordered parameter action coverage mismatch; "
                "missing: resourceId; unknown: missing",
            ),
            (
                "duplicate omitted action argument",
                lambda shortcut: shortcut["omittedActionArguments"].append(
                    deepcopy(shortcut["omittedActionArguments"][0])
                ),
                "duplicate argument resourceId",
            ),
            (
                "uncovered action argument",
                lambda shortcut: shortcut.__setitem__("omittedActionArguments", []),
                "shortcut ordered parameter action coverage mismatch; "
                "missing: resourceId",
            ),
        ]

        for name, mutate, message in cases:
            with self.subTest(name=name):
                raw = self._ordered_shortcut_catalog()
                shortcut = raw["recipes"][0]["procedureMaterialization"]["shortcut"]
                mutate(shortcut)
                with self.assertRaisesRegex(ValueError, message):
                    self._load_raw(raw)

        invalid_vector_source = self._ordered_shortcut_catalog()
        invalid_shortcut = invalid_vector_source["recipes"][0][
            "procedureMaterialization"
        ]["shortcut"]
        for operation in invalid_shortcut["operations"][1:4]:
            operation["parameters"][0]["source"]["argumentName"] = "radius"
        invalid_shortcut["operations"][4]["parameters"][0]["source"] = {
            "kind": "literal",
            "value": 1,
        }
        invalid_shortcut["omittedActionArguments"].append(
            {
                "argumentName": "location",
                "reason": "Replaced only to exercise the invalid component schema.",
            }
        )
        with self.assertRaisesRegex(
            ValueError, "must have a fixed-length numeric vector3 action schema"
        ):
            self._load_raw(invalid_vector_source)

    def test_loads_operator_property_shortcut_operations(self) -> None:
        catalog = self._load_raw(self._operator_property_shortcut_catalog())
        recipe = catalog.recipe_for("blender.mesh.create_icosphere")
        self.assertIsNotNone(recipe)
        assert recipe is not None
        assert recipe.procedure_materialization is not None
        operations = recipe.procedure_materialization.shortcut.shortcut_operations
        assert operations is not None

        opener = operations[1]
        self.assertEqual(opener.kind, "key_input")
        self.assertEqual(opener.keys, ("F9",))
        self.assertEqual(opener.parameters, ())
        self.assertIsNotNone(opener.opens_surface)
        assert opener.opens_surface is not None
        self.assertEqual(opener.opens_surface.kind, "adjust_last_operation")
        self.assertEqual(opener.opens_surface.host_id, "screen.redo_last")
        self.assertEqual(
            opener.opens_surface.source_operation_id,
            "shortcut.add_icosphere",
        )
        self.assertEqual(
            opener.opens_surface.expected_operator_id,
            "mesh.primitive_ico_sphere_add",
        )

        subdivisions = operations[2]
        self.assertEqual(subdivisions.kind, "operator_property_update")
        self.assertEqual(
            subdivisions.surface_operation_id,
            "shortcut.open_adjust_last_operation",
        )
        self.assertEqual(
            subdivisions.target_id,
            "mesh.primitive_ico_sphere_add.subdivisions",
        )
        self.assertEqual(
            subdivisions.path,
            ("Adjust Last Operation", "Subdivisions"),
        )
        self.assertEqual(len(subdivisions.parameters), 1)
        self.assertEqual(subdivisions.parameters[0].name, "value")

        closer = operations[4]
        self.assertEqual(closer.keys, ("ENTER",))
        self.assertEqual(
            closer.closes_surface_operation_id,
            "shortcut.open_adjust_last_operation",
        )

    def test_binds_operator_property_surface_to_semantic_execute_operator(self) -> None:
        raw = self._operator_property_shortcut_catalog()
        recipe = next(
            item
            for item in raw["recipes"]
            if item["actionName"] == "blender.mesh.create_icosphere"
        )
        recipe["guidance"] = {
            "kind": "semantic_path",
            "steps": [
                {
                    "id": "semantic.select_target",
                    "order": 1,
                    "label": "Selected Target",
                    "intent": "configure",
                    "target": {
                        "kind": "semantic",
                        "hostId": "operatingline.blender.selected_target",
                    },
                },
                {
                    "id": "operator.icosphere",
                    "order": 2,
                    "label": "Ico Sphere",
                    "intent": "execute",
                    "target": {
                        "kind": "operator",
                        "hostId": "mesh.primitive_ico_sphere_add",
                    },
                },
            ],
            "reason": "The candidate UI operation is not the managed action executor.",
        }
        recipe["procedureMaterialization"]["menu"] = {
            "availability": "unavailable",
            "reason": "Semantic guidance cannot materialize an executable menu track.",
        }

        loaded = self._load_raw(raw)
        loaded_recipe = next(
            item
            for item in loaded.recipes
            if item.action_name == "blender.mesh.create_icosphere"
        )
        self.assertEqual(loaded_recipe.guidance.kind, InteractionPathKind.SEMANTIC)

        recipe["guidance"]["steps"].append(
            {
                "id": "operator.second_execute",
                "order": 3,
                "label": "Second Execute Operator",
                "intent": "execute",
                "target": {
                    "kind": "operator",
                    "hostId": "mesh.primitive_uv_sphere_add",
                },
            }
        )
        with self.assertRaisesRegex(
            ValueError,
            "expectedOperatorId must match guidance execution operator",
        ):
            self._load_raw(raw)
        recipe["guidance"]["steps"].pop()

        recipe["guidance"]["steps"][1]["intent"] = "configure"
        with self.assertRaisesRegex(
            ValueError,
            "expectedOperatorId must match guidance execution operator",
        ):
            self._load_raw(raw)

    def test_rejects_invalid_operator_property_shortcut_state(self) -> None:
        def operations(raw: dict) -> list[dict]:
            recipe = next(
                item
                for item in raw["recipes"]
                if item["actionName"] == "blender.mesh.create_icosphere"
            )
            return recipe["procedureMaterialization"]["shortcut"]["operations"]

        cases: list[tuple[str, Callable[[list[dict]], None], str]] = [
            (
                "wrong opener host",
                lambda items: items[1]["opensSurface"].__setitem__(
                    "hostId", "wm.call_menu"
                ),
                "hostId must be screen.redo_last",
            ),
            (
                "wrong expected operator",
                lambda items: items[1]["opensSurface"].__setitem__(
                    "expectedOperatorId", "mesh.primitive_uv_sphere_add"
                ),
                "expectedOperatorId must match guidance execution operator",
            ),
            (
                "non-adjacent source",
                lambda items: items[1]["opensSurface"].__setitem__(
                    "sourceOperationId", "shortcut.rename"
                ),
                "F9 opener must immediately follow its source operation",
            ),
            (
                "wrong opener key",
                lambda items: items[1].__setitem__("keys", ["F8"]),
                "opener must be parameterless sequence F9",
            ),
            (
                "opener action parameter",
                lambda items: items[1]["parameters"].append(
                    {
                        "name": "value",
                        "source": {"kind": "literal", "value": 1},
                    }
                ),
                "opener must be parameterless sequence F9",
            ),
            (
                "property before opener",
                lambda items: items.__setitem__(slice(1, 3), [items[2], items[1]]),
                "references no open surface",
            ),
            (
                "wrong surface reference",
                lambda items: items[2].__setitem__(
                    "surfaceOperationId", "shortcut.missing_surface"
                ),
                "references the wrong open surface",
            ),
            (
                "empty control target",
                lambda items: items[2]["target"].__setitem__("hostId", ""),
                "target hostId must be a non-empty string",
            ),
            (
                "wrong control target kind",
                lambda items: items[2]["target"].__setitem__("kind", "operator"),
                "target kind must be control",
            ),
            (
                "wrong property operator target",
                lambda items: items[2]["target"].__setitem__(
                    "hostId", "mesh.primitive_uv_sphere_add.subdivisions"
                ),
                "target must belong to operator mesh.primitive_ico_sphere_add",
            ),
            (
                "empty property target suffix",
                lambda items: items[2]["target"].__setitem__(
                    "hostId", "mesh.primitive_ico_sphere_add."
                ),
                "target must belong to operator mesh.primitive_ico_sphere_add",
            ),
            (
                "empty property path",
                lambda items: items[2].__setitem__("path", []),
                "path must be a non-empty array",
            ),
            (
                "wrong assignment name",
                lambda items: items[2]["parameters"][0].__setitem__(
                    "name", "subdivisions"
                ),
                "must assign exactly one value parameter",
            ),
            (
                "multiple assignments",
                lambda items: items[2]["parameters"].append(
                    {"name": "other", "source": {"kind": "literal", "value": 1}}
                ),
                "must assign exactly one value parameter",
            ),
            (
                "duplicate property target",
                lambda items: items[3]["target"].__setitem__(
                    "hostId", items[2]["target"]["hostId"]
                ),
                "operator property update repeats target",
            ),
            (
                "duplicate property action argument",
                lambda items: items[3]["parameters"][0]["source"].__setitem__(
                    "argumentName", "subdivisions"
                ),
                "shortcut ordered parameter action coverage mismatch; missing: radius",
            ),
            (
                "mismatched close",
                lambda items: items[4].__setitem__(
                    "closesSurfaceOperationId", "shortcut.missing_surface"
                ),
                "closes no matching surface",
            ),
            (
                "wrong close key",
                lambda items: items[4].__setitem__("keys", ["ESC"]),
                "surface closer must be parameterless sequence ENTER",
            ),
            (
                "property chain interruption",
                lambda items: items.insert(
                    3,
                    {
                        "kind": "key_input",
                        "id": "shortcut.interrupt",
                        "label": "Interrupt",
                        "keyMode": "sequence",
                        "keys": ["TAB"],
                        "parameters": [],
                    },
                ),
                "open surface must be followed only by property updates",
            ),
            (
                "opener also closes",
                lambda items: items[1].__setitem__(
                    "closesSurfaceOperationId",
                    "shortcut.open_adjust_last_operation",
                ),
                "cannot both open and close a surface",
            ),
        ]

        for name, mutate, message in cases:
            with self.subTest(name=name):
                raw = self._operator_property_shortcut_catalog()
                mutate(operations(raw))
                with self.assertRaisesRegex(ValueError, message):
                    self._load_raw(raw)

        unclosed = self._operator_property_shortcut_catalog()
        del operations(unclosed)[4:]
        with self.assertRaisesRegex(ValueError, "leaves an opened surface unclosed"):
            self._load_raw(unclosed)

    def test_rejects_malformed_semantic_parameter_projections(self) -> None:
        def duplicate_projection_id(semantic: dict) -> None:
            semantic["projections"].append(deepcopy(semantic["projections"][0]))

        def duplicate_projection_target(semantic: dict) -> None:
            duplicate = deepcopy(semantic["projections"][0])
            duplicate["id"] = "projection.semantic.duplicate_target"
            semantic["projections"].append(duplicate)

        cases: list[tuple[str, Callable[[dict], None], str]] = [
            (
                "unknown semantic field",
                lambda semantic: semantic.__setitem__("unknown", True),
                "contains unknown field unknown",
            ),
            (
                "unsupported source",
                lambda semantic: semantic.__setitem__("source", "guidance.native_path"),
                "semantic materialization has unsupported source",
            ),
            (
                "empty projections",
                lambda semantic: semantic.__setitem__("projections", []),
                "projections must be a non-empty array",
            ),
            (
                "unknown projection field",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "unknown", True
                ),
                "projection contains unknown field unknown",
            ),
            (
                "unsafe path field",
                lambda semantic: semantic["projections"][0]["path"][0].__setitem__(
                    "name", "__proto__"
                ),
                "contains unsafe field __proto__",
            ),
            (
                "boolean path index",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "path", [{"kind": "index", "index": True}]
                ),
                "index must be an integer from 0 to 1000000",
            ),
            (
                "oversized path index",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "path", [{"kind": "index", "index": 1_000_001}]
                ),
                "index must be an integer from 0 to 1000000",
            ),
            (
                "unsupported transform",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "transform", "multiply_by_two"
                ),
                "contains unsupported transform multiply_by_two",
            ),
            (
                "duplicate projection id",
                duplicate_projection_id,
                "contains duplicate projection id",
            ),
            (
                "duplicate semantic target",
                duplicate_projection_target,
                "contains duplicate semantic target",
            ),
            (
                "existing path prefixes new path",
                lambda semantic: semantic["projections"][1].__setitem__(
                    "path",
                    [
                        {"kind": "field", "name": "location"},
                        {"kind": "field", "name": "x"},
                    ],
                ),
                "contains overlapping semantic target paths",
            ),
            (
                "new path prefixes existing path",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "path",
                    [
                        {"kind": "field", "name": "scale"},
                        {"kind": "field", "name": "x"},
                    ],
                ),
                "contains overlapping semantic target paths",
            ),
            (
                "unknown mapped action argument",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "actionArgument", "unknown"
                ),
                "semantic ordered parameter action coverage mismatch;.*unknown: unknown",
            ),
            (
                "unmapped action argument",
                lambda semantic: semantic["projections"].pop(),
                "semantic ordered parameter action coverage mismatch; missing: objectName",
            ),
            (
                "mapped and omitted action argument",
                lambda semantic: semantic["omittedActionArguments"].append(
                    {"argumentName": "location", "reason": "Incorrect overlap."}
                ),
                "both maps and omits action argument location",
            ),
            (
                "numeric transform from vector argument",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "transform", "uniform_vector3"
                ),
                "uniform_vector3 source location must have a numeric action schema",
            ),
            (
                "incomplete vector component mapping",
                lambda semantic: semantic["projections"][0].__setitem__(
                    "transform", "vector3_x"
                ),
                "must map vector3 components x, y, and z exactly once",
            ),
            (
                "unknown omitted action argument",
                lambda semantic: semantic["omittedActionArguments"].append(
                    {"argumentName": "unknown", "reason": "Not in the action."}
                ),
                "semantic ordered parameter action coverage mismatch;.*unknown: unknown",
            ),
            (
                "unknown omitted argument field",
                lambda semantic: semantic["omittedActionArguments"][0].__setitem__(
                    "unknown", True
                ),
                "omittedActionArguments entry contains unknown field unknown",
            ),
        ]

        for name, mutate, message in cases:
            with self.subTest(name=name):
                raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
                mutate(self._semantic_materialization(raw))
                with self.assertRaisesRegex(ValueError, message):
                    self._load_raw(raw)

    def test_rejects_unprojectable_semantic_identity_action_schemas(self) -> None:
        invalid_schemas = {
            "object": {"type": "object", "properties": {}},
            "non-numeric array": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 3,
            },
            "unbounded array": {
                "type": "array",
                "items": {"type": "number"},
            },
            "empty array": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 0,
                "maxItems": 4,
            },
            "oversized array": {
                "type": "array",
                "items": {"type": "number"},
                "minItems": 1,
                "maxItems": 5,
            },
        }

        for name, invalid_schema in invalid_schemas.items():
            with self.subTest(name=name):
                raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
                action_catalog = json.loads(
                    ACTION_CATALOG_PATH.read_text(encoding="utf-8")
                )
                action = next(
                    item
                    for item in action_catalog["actions"]
                    if item["name"] == "blender.mesh.create_uv_sphere"
                )
                action["argumentsSchema"]["properties"]["location"] = invalid_schema

                with self.assertRaisesRegex(
                    ValueError,
                    "semantic identity source location must have a scalar or "
                    "bounded one-to-four-item numeric array action schema",
                ):
                    self._load_raw_with_action_catalog(raw, action_catalog)

    def test_rejects_non_finite_numbers_in_nested_literal_values(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                raw = self._ordered_parameter_catalog()
                literal = raw["recipes"][0]["procedureMaterialization"]["menu"][
                    "controlOperations"
                ]["operations"][0]["parameters"][1]["source"]
                literal["value"] = {"nested": [value]}

                with self.assertRaisesRegex(ValueError, "non-finite number"):
                    self._load_raw(raw)

    def test_rejects_non_finite_numbers_in_action_catalog(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value), TemporaryDirectory() as directory:
                action_catalog = json.loads(
                    ACTION_CATALOG_PATH.read_text(encoding="utf-8")
                )
                action_catalog["actions"][0]["argumentsSchema"]["nonFinite"] = {
                    "nested": [value]
                }
                action_catalog_path = Path(directory) / "action-catalog.json"
                action_catalog_path.write_text(
                    json.dumps(action_catalog), encoding="utf-8"
                )

                with self.assertRaisesRegex(ValueError, "non-finite number"):
                    load_interaction_catalog(RESOURCE_PATH, action_catalog_path)

    def test_rejects_broken_execution_and_action_coverage(self) -> None:
        raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        broken_execution = deepcopy(raw)
        broken_execution["recipes"][0]["guidance"]["execution"]["operatorId"] = (
            "mesh.primitive_ico_sphere_add"
        )
        missing_recipe = deepcopy(raw)
        missing_recipe["recipes"].pop()
        semantic_materialization = deepcopy(raw)
        semantic_materialization["recipes"][0]["guidance"] = deepcopy(
            semantic_materialization["recipes"][-1]["guidance"]
        )
        available_shortcut = deepcopy(raw)
        available_shortcut["recipes"][0]["procedureMaterialization"]["shortcut"] = {
            "availability": "unknown",
            "reason": "Unsupported",
        }
        unsupported_menu_target = deepcopy(raw)
        unsupported_menu_target["recipes"][0]["guidance"]["steps"][0]["target"] = {
            "kind": "panel",
            "hostId": "VIEW3D_PT_example",
        }

        with TemporaryDirectory() as directory:
            directory_path = Path(directory)
            broken_path = directory_path / "broken.json"
            missing_path = directory_path / "missing.json"
            semantic_path = directory_path / "semantic.json"
            shortcut_path = directory_path / "shortcut.json"
            unsupported_target_path = directory_path / "unsupported-target.json"
            broken_path.write_text(json.dumps(broken_execution), encoding="utf-8")
            missing_path.write_text(json.dumps(missing_recipe), encoding="utf-8")
            semantic_path.write_text(
                json.dumps(semantic_materialization), encoding="utf-8"
            )
            shortcut_path.write_text(json.dumps(available_shortcut), encoding="utf-8")
            unsupported_target_path.write_text(
                json.dumps(unsupported_menu_target), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "bind its operator target exactly"):
                load_interaction_catalog(broken_path, ACTION_CATALOG_PATH)
            with self.assertRaisesRegex(ValueError, "action coverage mismatch"):
                load_interaction_catalog(missing_path, ACTION_CATALOG_PATH)
            with self.assertRaisesRegex(
                ValueError,
                "available menu materialization requires native_path guidance",
            ):
                load_interaction_catalog(semantic_path, ACTION_CATALOG_PATH)
            with self.assertRaisesRegex(
                ValueError,
                "shortcut has unknown availability",
            ):
                load_interaction_catalog(shortcut_path, ACTION_CATALOG_PATH)
            with self.assertRaisesRegex(
                ValueError,
                "available menu materialization cannot represent panel targets",
            ):
                load_interaction_catalog(unsupported_target_path, ACTION_CATALOG_PATH)

    def test_rejects_unapproved_action_level_mcp_declarations(self) -> None:
        raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        for field, value in (
            ("toolName", "evil.execute_python"),
            ("authorization", "none"),
            ("serverName", "untrusted"),
        ):
            with self.subTest(field=field):
                forged = deepcopy(raw)
                forged["recipes"][0]["procedureMaterialization"]["mcp"][field] = value
                with self.assertRaisesRegex(ValueError, f"unsupported {field}"):
                    self._load_raw(forged)

        extra = deepcopy(raw)
        extra["recipes"][0]["procedureMaterialization"]["mcp"][
            "arguments"
        ] = {"python": "import bpy"}
        with self.assertRaisesRegex(ValueError, "unknown field arguments"):
            self._load_raw(extra)

    def test_action_level_mcp_allowlist_is_exactly_seven_native_primitives(
        self,
    ) -> None:
        raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        available_mcp = deepcopy(
            next(
                recipe
                for recipe in raw["recipes"]
                if recipe["actionName"] == "blender.mesh.create_uv_sphere"
            )["procedureMaterialization"]["mcp"]
        )
        approved_actions = (
            "blender.mesh.create_uv_sphere",
            "blender.mesh.create_icosphere",
            "blender.mesh.create_cube",
            "blender.mesh.create_plane",
            "blender.mesh.create_torus",
            "blender.mesh.create_cone",
            "blender.mesh.create_cylinder",
        )

        for action_name in approved_actions:
            with self.subTest(action_name=action_name):
                forged = deepcopy(raw)
                recipe = next(
                    item
                    for item in forged["recipes"]
                    if item["actionName"] == action_name
                )
                recipe["procedureMaterialization"]["mcp"] = deepcopy(
                    available_mcp
                )
                self._load_raw(forged)

        for recipe_id in (
            "blender.mesh.create_primitive_batch.semantic",
            "blender.mesh.edit_subdivide.semantic",
            "blender.mesh.create_monkey.native",
        ):
            with self.subTest(recipe_id=recipe_id):
                with self.assertRaisesRegex(
                    ValueError, "approved primitive recipes"
                ):
                    parse_mcp_materialization(available_mcp, recipe_id)

        mismatched = deepcopy(raw)
        uv_sphere = next(
            item
            for item in mismatched["recipes"]
            if item["actionName"] == "blender.mesh.create_uv_sphere"
        )
        cube = next(
            item
            for item in mismatched["recipes"]
            if item["actionName"] == "blender.mesh.create_cube"
        )
        uv_sphere["id"], cube["id"] = cube["id"], uv_sphere["id"]
        with self.assertRaisesRegex(ValueError, "must bind its exact"):
            self._load_raw(mismatched)


if __name__ == "__main__":
    unittest.main()
