"""Pure Python tests for allowlisted native-menu guidance state."""

from importlib import import_module
import sys
import unittest
from pathlib import Path
from types import ModuleType


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_menu_guidance_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

application = import_module(f"{PACKAGE_NAME}.application")
domain = import_module(f"{PACKAGE_NAME}.domain")

GuidanceState = application.GuidanceState
MenuGuidanceRole = application.MenuGuidanceRole
MenuGuidanceTracker = application.MenuGuidanceTracker
InteractionPathKind = application.InteractionPathKind
ActionSpec = domain.ActionSpec
TaskNode = domain.TaskNode


def action_step(
    *,
    step_id: str = "snowman.model.body_lower",
    action_name: str = "blender.mesh.create_uv_sphere",
    operator_id: str = "mesh.primitive_uv_sphere_add",
    menu_path: tuple[str, ...] = ("Add", "Mesh", "UV Sphere"),
) -> TaskNode:
    return TaskNode(
        id=step_id,
        number="1.2.1",
        title="Create the lower body",
        order=1,
        action=ActionSpec(
            adapter_id="blender",
            name=action_name,
            arguments={},
        ),
        anchors=(
            {
                "kind": "operator",
                "operatorId": operator_id,
                "menuPath": list(menu_path),
            },
        ),
    )


class MenuGuidanceTrackerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tracker = MenuGuidanceTracker()
        self.step = action_step()

    def test_exposes_a_four_microstep_path_without_changing_plan_state(self) -> None:
        snapshot = self.tracker.snapshot(self.step)

        self.assertIsNotNone(snapshot)
        assert snapshot is not None
        self.assertEqual(snapshot.step_id, self.step.id)
        self.assertEqual(
            snapshot.recipe_id,
            "blender.mesh.create_uv_sphere.native",
        )
        self.assertEqual(snapshot.catalog_version, "1.14.0")
        self.assertEqual(snapshot.path_kind, InteractionPathKind.NATIVE)
        self.assertTrue(snapshot.native)
        self.assertEqual(snapshot.operator_id, "mesh.primitive_uv_sphere_add")
        self.assertEqual(
            tuple(item.label for item in snapshot.items),
            ("Layout", "Add", "Mesh", "UV Sphere"),
        )
        self.assertEqual(
            tuple(item.role for item in snapshot.items),
            (
                MenuGuidanceRole.CURRENT,
                MenuGuidanceRole.NEXT,
                MenuGuidanceRole.LOCKED,
                MenuGuidanceRole.LOCKED,
            ),
        )
        self.assertEqual(snapshot.items[0].state, GuidanceState.COMPLETED)
        self.assertEqual(snapshot.items[1].state, GuidanceState.NEXT)
        self.assertEqual(snapshot.collapsed_ordinals("Add"), (2, 3, 4))
        self.assertEqual(snapshot.collapsed_ordinals("Mesh"), (3, 4))

    def test_reveals_add_then_mesh_without_marking_the_leaf_complete(self) -> None:
        self.assertTrue(self.tracker.reveal(self.step, "Add"))
        add_snapshot = self.tracker.snapshot(self.step)
        assert add_snapshot is not None
        self.assertEqual(
            tuple(item.role for item in add_snapshot.items),
            (
                MenuGuidanceRole.PREVIOUS,
                MenuGuidanceRole.CURRENT,
                MenuGuidanceRole.NEXT,
                MenuGuidanceRole.LOCKED,
            ),
        )
        self.assertEqual(add_snapshot.items[0].state, GuidanceState.BACK)
        self.assertEqual(add_snapshot.items[1].state, GuidanceState.COMPLETED)

        self.assertTrue(self.tracker.reveal(self.step, "Mesh"))
        mesh_snapshot = self.tracker.snapshot(self.step)
        assert mesh_snapshot is not None
        self.assertEqual(
            tuple(item.role for item in mesh_snapshot.items),
            (
                MenuGuidanceRole.COMPLETED,
                MenuGuidanceRole.PREVIOUS,
                MenuGuidanceRole.CURRENT,
                MenuGuidanceRole.NEXT,
            ),
        )
        self.assertTrue(mesh_snapshot.accepts("mesh.primitive_uv_sphere_add"))
        self.assertFalse(mesh_snapshot.accepts("mesh.primitive_ico_sphere_add"))

    def test_resets_progress_when_the_next_leaf_changes(self) -> None:
        self.tracker.reveal(self.step, "Mesh")
        replacement = action_step(step_id="snowman.model.body_upper")

        snapshot = self.tracker.snapshot(replacement)

        assert snapshot is not None
        self.assertEqual(snapshot.step_id, replacement.id)
        self.assertEqual(snapshot.revealed_depth, 1)
        self.assertEqual(snapshot.items[0].role, MenuGuidanceRole.CURRENT)
        self.assertEqual(snapshot.items[1].role, MenuGuidanceRole.NEXT)

    def test_rejects_stale_reveal_but_uses_the_action_recipe_not_plan_anchor(self) -> None:
        stale = action_step(step_id="stale")
        self.tracker.snapshot(self.step)

        self.assertFalse(self.tracker.reveal(stale, "Add"))
        mismatched_anchor = self.tracker.snapshot(
            action_step(operator_id="mesh.primitive_ico_sphere_add")
        )
        assert mismatched_anchor is not None
        self.assertEqual(
            mismatched_anchor.operator_id,
            "mesh.primitive_uv_sphere_add",
        )
        mismatched_path = self.tracker.snapshot(
            action_step(menu_path=("Add", "Mesh", "Ico Sphere"))
        )
        assert mismatched_path is not None
        self.assertEqual(mismatched_path.items[-1].label, "UV Sphere")
        self.assertIsNone(
            self.tracker.snapshot(
                action_step(action_name="blender.unknown.action")
            )
        )

    def test_supports_each_allowlisted_single_primitive_path(self) -> None:
        plane = action_step(
            action_name="blender.mesh.create_plane",
            operator_id="mesh.primitive_plane_add",
            menu_path=("Add", "Mesh", "Plane"),
        )
        plane_snapshot = self.tracker.snapshot(plane)
        assert plane_snapshot is not None
        self.assertEqual(plane_snapshot.items[-1].label, "Plane")
        self.assertTrue(plane_snapshot.accepts("mesh.primitive_plane_add"))

        for action_name, operator_id, label in (
            (
                "blender.mesh.create_icosphere",
                "mesh.primitive_ico_sphere_add",
                "Ico Sphere",
            ),
            ("blender.mesh.create_cube", "mesh.primitive_cube_add", "Cube"),
            ("blender.mesh.create_cone", "mesh.primitive_cone_add", "Cone"),
            (
                "blender.mesh.create_cylinder",
                "mesh.primitive_cylinder_add",
                "Cylinder",
            ),
            (
                "blender.mesh.create_torus",
                "mesh.primitive_torus_add",
                "Torus",
            ),
        ):
            primitive = action_step(
                action_name=action_name,
                operator_id="model.authored.operator.is.ignored",
                menu_path=("model", "authored", "path"),
            )
            primitive_snapshot = self.tracker.snapshot(primitive)
            assert primitive_snapshot is not None
            self.assertEqual(primitive_snapshot.items[-1].label, label)
            self.assertTrue(primitive_snapshot.accepts(operator_id))
            wrong_operator = (
                "mesh.primitive_cube_add"
                if operator_id != "mesh.primitive_cube_add"
                else "mesh.primitive_ico_sphere_add"
            )
            self.assertFalse(primitive_snapshot.accepts(wrong_operator))

    def test_marks_semantic_paths_locked_and_refuses_native_execution(self) -> None:
        semantic = action_step(
            action_name="blender.material.create_and_assign",
            operator_id="material.new",
            menu_path=("Material Properties", "New", "Surface"),
        )
        semantic_snapshot = self.tracker.snapshot(semantic)
        assert semantic_snapshot is not None
        self.assertFalse(semantic_snapshot.native)
        self.assertEqual(semantic_snapshot.path_kind, InteractionPathKind.SEMANTIC)
        self.assertEqual(
            tuple(item.label for item in semantic_snapshot.items),
            ("Shading", "Material", "New", "Surface"),
        )
        self.assertTrue(
            all(
                item.role is MenuGuidanceRole.LOCKED
                for item in semantic_snapshot.items
            )
        )
        self.assertFalse(semantic_snapshot.accepts("material.new"))
        self.assertFalse(self.tracker.reveal(semantic, "Material"))


if __name__ == "__main__":
    unittest.main()
