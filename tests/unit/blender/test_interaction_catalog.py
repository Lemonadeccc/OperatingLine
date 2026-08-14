"""Pure Python contract tests for the bundled Blender InteractionCatalog."""

from copy import deepcopy
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

    def test_binds_all_actions_and_marks_only_verified_paths_native(self) -> None:
        catalog = BUNDLED_INTERACTION_CATALOG

        self.assertEqual(catalog.catalog_version, "1.11.0")
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
        sphere = catalog.recipes[0]
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
        self.assertEqual(
            sphere.procedure_materialization.shortcut.availability,
            "unavailable",
        )
        self.assertEqual(
            sphere.procedure_materialization.mcp.availability,
            "unavailable",
        )
        self.assertTrue(
            all(
                recipe.procedure_materialization is None
                for recipe in catalog.recipes[1:]
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
            "availability": "available",
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
                "shortcut availability must be unavailable",
            ):
                load_interaction_catalog(shortcut_path, ACTION_CATALOG_PATH)
            with self.assertRaisesRegex(
                ValueError,
                "available menu materialization cannot represent panel targets",
            ):
                load_interaction_catalog(unsupported_target_path, ACTION_CATALOG_PATH)


if __name__ == "__main__":
    unittest.main()
