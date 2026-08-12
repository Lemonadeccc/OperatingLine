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

        self.assertEqual(catalog.catalog_version, "1.4.0")
        self.assertEqual(catalog.action_catalog_version, "1.7.0")
        self.assertEqual(
            catalog.host_version_range,
            ">=4.5.0 <4.6.0 || >=5.1.0 <5.2.0",
        )
        self.assertEqual(len(catalog.recipes), 15)
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

    def test_rejects_broken_execution_and_action_coverage(self) -> None:
        raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
        broken_execution = deepcopy(raw)
        broken_execution["recipes"][0]["guidance"]["execution"]["operatorId"] = (
            "mesh.primitive_ico_sphere_add"
        )
        missing_recipe = deepcopy(raw)
        missing_recipe["recipes"].pop()

        with TemporaryDirectory() as directory:
            directory_path = Path(directory)
            broken_path = directory_path / "broken.json"
            missing_path = directory_path / "missing.json"
            broken_path.write_text(json.dumps(broken_execution), encoding="utf-8")
            missing_path.write_text(json.dumps(missing_recipe), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "bind its operator target exactly"):
                load_interaction_catalog(broken_path, ACTION_CATALOG_PATH)
            with self.assertRaisesRegex(ValueError, "action coverage mismatch"):
                load_interaction_catalog(missing_path, ACTION_CATALOG_PATH)


if __name__ == "__main__":
    unittest.main()
