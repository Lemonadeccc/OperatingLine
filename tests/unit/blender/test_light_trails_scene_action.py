"""Source-level safety contract for the bounded light-trails lookdev action."""

import ast
from pathlib import Path
import unittest

SOURCE_PATH = (
    Path(__file__).parents[3]
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
    / "infrastructure"
    / "snowman_actions"
    / "light_trails_scene.py"
)


def _source() -> str:
    return SOURCE_PATH.read_text(encoding="utf-8")


class LightTrailsSceneActionTests(unittest.TestCase):
    def test_exposes_bounded_validator_and_executor(self) -> None:
        module = ast.parse(_source())
        functions = {
            node.name for node in module.body if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("validate_light_trails_scene", functions)
        self.assertIn("execute_light_trails_scene", functions)

    def test_never_invokes_bake_render_or_export(self) -> None:
        source = _source()
        forbidden = (
            "bpy.ops.render",
            "bpy.ops.wm.save_as_mainfile",
            "bpy.ops.wm.save_mainfile",
            "GeometryNodeBake",
            "GeometryNodeSimulationInput",
            "GeometryNodeSimulationOutput",
            "bpy.ops.export",
        )
        self.assertTrue(all(token not in source for token in forbidden))

    def test_requires_the_complete_parameter_surface(self) -> None:
        module = ast.parse(_source())
        fields_assignment = next(
            node
            for node in module.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name) and target.id == "_FIELDS"
                for target in node.targets
            )
        )
        self.assertIsInstance(fields_assignment.value, ast.Set)
        fields = {
            element.value
            for element in fields_assignment.value.elts
            if isinstance(element, ast.Constant) and isinstance(element.value, str)
        }
        self.assertEqual(
            fields,
            {
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
            },
        )
