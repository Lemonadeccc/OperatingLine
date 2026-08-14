"""Pure Python contract tests for the bundled Blender InteractionCatalog."""

from copy import deepcopy
from importlib import import_module
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
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
    def test_binds_all_actions_and_marks_only_verified_paths_native(self) -> None:
        catalog = BUNDLED_INTERACTION_CATALOG

        self.assertEqual(catalog.catalog_version, "1.10.0")
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
