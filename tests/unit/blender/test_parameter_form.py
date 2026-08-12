"""Pure Python coverage for catalog-derived revision parameter forms."""

from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_parameter_form_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

domain = import_module(f"{PACKAGE_NAME}.domain")
parameter_form = import_module(f"{PACKAGE_NAME}.application.parameter_form")

ActionSpec = domain.ActionSpec
action_parameter_fields = parameter_form.action_parameter_fields


class ParameterFormTests(unittest.TestCase):
    def test_derives_scalar_and_vector_controls_in_catalog_order(self) -> None:
        action = ActionSpec(
            adapter_id="blender",
            name="blender.mesh.create_cube",
            arguments={
                "resourceId": "form.cube",
                "objectName": "OperatingLine.FormCube",
                "size": 2.0,
                "location": [1.0, 2.0, 3.0],
            },
        )

        fields = action_parameter_fields(action, {"size": 2.5})

        self.assertEqual(
            tuple((field.name, field.kind) for field in fields),
            (
                ("resourceId", "string"),
                ("objectName", "string"),
                ("size", "number"),
                ("location", "number_vector"),
            ),
        )
        self.assertEqual(fields[2].original_value, 2.0)
        self.assertEqual(fields[2].value, 2.5)
        self.assertEqual(fields[2].minimum, 0.0001)
        self.assertEqual(fields[3].vector_length, 3)

    def test_marks_nested_records_read_only_and_exposes_enums(self) -> None:
        render = ActionSpec(
            adapter_id="blender",
            name="blender.render_scene.create",
            arguments={
                "sceneId": "form.scene",
                "sceneName": "OperatingLine.FormScene",
                "worldId": "form.world",
                "worldName": "OperatingLine.FormWorld",
                "collectionId": "snowman.collection",
                "backgroundColor": [0.05, 0.05, 0.05, 1.0],
                "strength": 0.8,
            },
        )
        render_fields = {field.name: field for field in action_parameter_fields(render)}
        self.assertEqual(render_fields["backgroundColor"].vector_length, 4)
        self.assertEqual(render_fields["strength"].kind, "number")

        pose = ActionSpec(
            adapter_id="blender",
            name="blender.animation.create_pose_keyframes",
            arguments={
                "actionId": "form.action",
                "actionName": "OperatingLine.FormAction",
                "armatureId": "form.rig",
                "interpolation": "LINEAR",
                "extrapolation": "CONSTANT",
                "keyframes": [
                    {
                        "frame": 1,
                        "poses": [
                            {
                                "boneName": "OperatingLine.Root",
                                "rotationEuler": [0.0, 0.0, 0.0],
                            }
                        ],
                    },
                    {
                        "frame": 12,
                        "poses": [
                            {
                                "boneName": "OperatingLine.Root",
                                "rotationEuler": [0.0, 0.0, 0.2],
                            }
                        ],
                    },
                ],
            },
        )
        pose_fields = {field.name: field for field in action_parameter_fields(pose)}
        self.assertEqual(pose_fields["interpolation"].kind, "enum")
        self.assertIn("LINEAR", pose_fields["interpolation"].enum_values)

        skin = ActionSpec(
            adapter_id="blender",
            name="blender.rig.bind_skin_weights",
            arguments={
                "targetId": "form.mesh",
                "armatureId": "form.rig",
                "modifierId": "form.skin",
                "modifierName": "OperatingLine.FormSkin",
                "preserveVolume": True,
                "weights": [
                    {
                        "vertexIndex": 0,
                        "influences": [
                            {"boneName": "OperatingLine.Root", "weight": 1.0}
                        ],
                    }
                ],
            },
        )
        skin_fields = {field.name: field for field in action_parameter_fields(skin)}
        self.assertFalse(skin_fields["weights"].editable)
        self.assertEqual(skin_fields["weights"].kind, "structured")


if __name__ == "__main__":
    unittest.main()
