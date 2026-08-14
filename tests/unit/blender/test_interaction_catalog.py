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
load_interaction_catalog = catalog_module.load_interaction_catalog


class InteractionCatalogTests(unittest.TestCase):
    def _load_raw(self, raw: dict) -> object:
        with TemporaryDirectory() as directory:
            path = Path(directory) / "interaction-catalog.json"
            path.write_text(json.dumps(raw), encoding="utf-8")
            return load_interaction_catalog(path, ACTION_CATALOG_PATH)

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

    def test_binds_all_actions_and_marks_only_verified_paths_native(self) -> None:
        catalog = BUNDLED_INTERACTION_CATALOG

        self.assertEqual(catalog.catalog_version, "1.17.0")
        self.assertEqual(catalog.action_catalog_version, "1.12.0")
        self.assertEqual(
            catalog.host_version_range,
            ">=4.5.0 <4.6.0 || >=5.1.0 <5.2.0",
        )
        self.assertEqual(len(catalog.recipes), 22)
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
            15,
        )
        sphere = next(
            recipe
            for recipe in catalog.recipes
            if recipe.action_name == "blender.mesh.create_uv_sphere"
        )
        self.assertIsNotNone(sphere.procedure_materialization)
        assert sphere.procedure_materialization is not None
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
            "unavailable",
        )
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
        self.assertEqual(
            icosphere.procedure_materialization.shortcut.availability,
            "unavailable",
        )
        self.assertEqual(
            icosphere.procedure_materialization.mcp.availability,
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
        self.assertEqual(
            (
                plane.procedure_materialization.shortcut.availability,
                plane.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertEqual(
            (
                plane.procedure_materialization.mcp.availability,
                plane.procedure_materialization.mcp.reason,
            ),
            ("unavailable", "No approved action-level MCP tool is available."),
        )
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
        self.assertEqual(
            (
                cube.procedure_materialization.shortcut.availability,
                cube.procedure_materialization.shortcut.reason,
            ),
            ("unavailable", "No verified shortcut procedure is available."),
        )
        self.assertEqual(
            (
                cube.procedure_materialization.mcp.availability,
                cube.procedure_materialization.mcp.reason,
            ),
            ("unavailable", "No approved action-level MCP tool is available."),
        )
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
        self.assertEqual(
            (
                cone.procedure_materialization.mcp.availability,
                cone.procedure_materialization.mcp.reason,
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
        self.assertEqual(
            (
                torus.procedure_materialization.mcp.availability,
                torus.procedure_materialization.mcp.reason,
            ),
            ("unavailable", "No approved action-level MCP tool is available."),
        )
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
                    "blender.mesh.create_torus",
                }
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
        legacy = load_interaction_catalog(legacy_path, ACTION_CATALOG_PATH)

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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)
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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)
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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

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
        frozen = load_interaction_catalog(frozen_path, ACTION_CATALOG_PATH)

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


if __name__ == "__main__":
    unittest.main()
