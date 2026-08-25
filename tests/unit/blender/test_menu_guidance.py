"""Pure Python tests for allowlisted native-menu guidance state."""

from importlib import import_module
from dataclasses import replace
import math
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
LeafOperationEvidence = application.LeafOperationEvidence
LeafTargetTrust = application.LeafTargetTrust
InteractionPathKind = application.InteractionPathKind
BUNDLED_INTERACTION_CATALOG = application.BUNDLED_INTERACTION_CATALOG
ActionSpec = domain.ActionSpec
ExecutionTrackOverrideSpec = domain.ExecutionTrackOverrideSpec
CandidateMenuProjectionSpec = domain.CandidateMenuProjectionSpec
TaskNode = domain.TaskNode


def candidate_projection() -> CandidateMenuProjectionSpec:
    definitions = (
        ("workspace", "Layout", "Use Layout Workspace", {}),
        ("semantic", "operatingline.blender.accepted_active_mesh", "Use Accepted Active Mesh", {}),
        ("control", "VIEW3D_HT_header.mode", "Choose Edit Mode", {"value": "EDIT"}),
        ("menu", "VIEW3D_MT_select_edit_mesh", "Open Select Menu", {}),
        ("operator", "mesh.select_all", "Select All Mesh Elements", {"action": "SELECT"}),
        ("menu", "VIEW3D_MT_edit_mesh_edges", "Open Edge Menu", {}),
        ("operator", "mesh.subdivide", "Choose Subdivide", {}),
        ("operator", "screen.redo_last", "Open Adjust Last Operation", {}),
        ("control", "mesh.subdivide.number_cuts", "Set Number of Cuts", {"value": 3}),
        ("control", "mesh.subdivide.smoothness", "Set Smoothness", {"value": 0.25}),
        ("control", "VIEW3D_HT_header.mode", "Return to Object Mode", {"value": "OBJECT"}),
    )
    return CandidateMenuProjectionSpec(
        projection="candidate_only",
        interaction_catalog_version="1.50.0",
        id="blender.mesh.edit_subdivide.menu-candidate",
        modality="menu",
        equivalence="not_equivalent_to_managed_action",
        execution_authority="none",
        title="Subdivide through native Edit Mode menus",
        reason="Native UI mutates the active mesh in place.",
        preconditions=({"kind": "workspace", "label": "Workspace", "value": "Layout"},),
        operations=tuple(
            {
                "id": f"candidate.operation_{index:02d}",
                "order": index,
                "semanticRefs": ["subdivide"],
                "description": label,
                "evidenceRefs": [],
                "intent": "execute" if host_id == "mesh.subdivide" else "configure",
                "target": {"kind": kind, "hostId": host_id},
                "path": [label],
                "parameters": parameters,
            }
            for index, (kind, host_id, label, parameters) in enumerate(definitions, start=1)
        ),
        omitted_action_arguments=(
            {"argumentName": "resultMeshId", "reason": "No replacement is created."},
        ),
    )


def action_step(
    *,
    step_id: str = "snowman.model.body_lower",
    action_name: str = "blender.mesh.create_uv_sphere",
    operator_id: str = "mesh.primitive_uv_sphere_add",
    menu_path: tuple[str, ...] = ("Add", "Mesh", "UV Sphere"),
    arguments: dict[str, object] | None = None,
    execution_track_override=None,
) -> TaskNode:
    if arguments is None:
        arguments = {
            "resourceId": "snowman.body.lower",
            "objectName": "OperatingLine.Snowman.BodyLower",
            "radius": 1.75,
            "location": [0, 0, -1.5],
        }
    return TaskNode(
        id=step_id,
        number="1.2.1",
        title="Create the lower body",
        order=1,
        action=ActionSpec(
            adapter_id="blender",
            name=action_name,
            arguments=arguments,
        ),
        anchors=(
            {
                "kind": "operator",
                "operatorId": operator_id,
                "menuPath": list(menu_path),
            },
        ),
        execution_track_override=execution_track_override,
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
        self.assertEqual(snapshot.catalog_version, "1.69.0")
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

    def test_exposes_leaf_local_operations_with_ordered_resolved_controls(self) -> None:
        snapshot = self.tracker.snapshot(self.step)

        assert snapshot is not None
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            ("01", "02", "03", "04", "05", "06", "07"),
        )
        self.assertEqual(
            tuple(operation.label for operation in snapshot.operations),
            (
                "Layout",
                "Add",
                "Mesh",
                "UV Sphere",
                "Location",
                "Scale",
                "Object Name",
            ),
        )
        location, scale, object_name = snapshot.operations[4:]
        operator_parameter = snapshot.operations[3].parameters[0]
        self.assertEqual(operator_parameter.name, "radius")
        self.assertEqual(operator_parameter.value, 1)
        self.assertEqual(operator_parameter.display_value, "1")
        self.assertEqual(location.path, ("Sidebar", "Item", "Transform", "Location"))
        self.assertEqual(location.parameters[0].value, [0, 0, -1.5])
        self.assertEqual(location.parameters[0].display_value, "[0, 0, -1.5]")
        self.assertEqual(scale.parameters[0].value, [1.75, 1.75, 1.75])
        self.assertEqual(scale.parameters[0].display_value, "[1.75, 1.75, 1.75]")
        self.assertEqual(
            object_name.parameters[0].value,
            "OperatingLine.Snowman.BodyLower",
        )
        self.assertEqual(
            object_name.parameters[0].display_value,
            '"OperatingLine.Snowman.BodyLower"',
        )
        self.assertTrue(all(operation.native for operation in snapshot.operations[:4]))
        self.assertTrue(all(not operation.reference for operation in snapshot.operations[:4]))
        self.assertTrue(all(operation.reference for operation in snapshot.operations[4:]))
        self.assertTrue(all(not operation.native for operation in snapshot.operations[4:]))
        self.assertEqual(location.role, MenuGuidanceRole.LOCKED)
        self.assertEqual(location.state, GuidanceState.LOCKED)

    def test_marks_missing_control_values_unresolved_instead_of_guessing(self) -> None:
        snapshot = self.tracker.snapshot(action_step(arguments={}))

        assert snapshot is not None
        parameters = tuple(
            operation.parameters[0] for operation in snapshot.operations[4:]
        )
        self.assertTrue(all(not parameter.resolved for parameter in parameters))
        self.assertEqual(
            tuple(parameter.reason for parameter in parameters),
            (
                "missing action argument 'location'",
                "missing action argument 'radius'",
                "missing action argument 'objectName'",
            ),
        )
        self.assertTrue(
            all(parameter.display_value.startswith("Unresolved (") for parameter in parameters)
        )

    def test_keeps_multiple_operator_parameters_on_the_execution_click_in_order(self) -> None:
        snapshot = self.tracker.snapshot(
            action_step(
                action_name="blender.mesh.create_icosphere",
                arguments={
                    "resourceId": "detail.eye",
                    "objectName": "OperatingLine.Detail.Eye",
                    "subdivisions": 4,
                    "radius": 0.35,
                    "location": [1.2, 0, 2.4],
                },
            )
        )

        assert snapshot is not None
        execution = snapshot.operations[3]
        self.assertEqual(execution.label, "Ico Sphere")
        self.assertEqual(
            tuple(parameter.name for parameter in execution.parameters),
            ("subdivisions", "radius"),
        )
        self.assertEqual(
            tuple(parameter.value for parameter in execution.parameters),
            (4, 0.35),
        )
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            ("01", "02", "03", "04", "05", "06"),
        )
        self.assertEqual(
            tuple(operation.label for operation in snapshot.operations[4:]),
            ("Location", "Object Name"),
        )

    def test_derives_vertical_segment_parameters_with_canonical_positive_zero(self) -> None:
        snapshot = self.tracker.snapshot(
            action_step(
                action_name="blender.mesh.create_cone",
                arguments={
                    "resourceId": "detail.vertical",
                    "objectName": "OperatingLine.Detail.Vertical",
                    "radiusStart": 0.4,
                    "radiusEnd": 0.1,
                    "start": [-0.0, -0.0, -1],
                    "end": [-0.0, -0.0, 2],
                },
            )
        )

        assert snapshot is not None
        operator_parameters = {
            parameter.name: parameter for parameter in snapshot.operations[3].parameters
        }
        self.assertEqual(operator_parameters["depth"].value, 3.0)
        self.assertEqual(operator_parameters["rotation"].value, [0.0, 0.0, 0.0])
        midpoint = snapshot.operations[4].parameters[0]
        self.assertEqual(midpoint.value, [0.0, 0.0, 0.5])
        for value in (*operator_parameters["rotation"].value, *midpoint.value[:2]):
            self.assertEqual(math.copysign(1.0, value), 1.0)

    def test_derives_general_segment_parameters_with_typescript_parity(self) -> None:
        snapshot = self.tracker.snapshot(
            action_step(
                action_name="blender.mesh.create_cone",
                arguments={
                    "resourceId": "detail.diagonal",
                    "objectName": "OperatingLine.Detail.Diagonal",
                    "radiusStart": 0.4,
                    "radiusEnd": 0.1,
                    "start": [1, 2, 3],
                    "end": [4, 6, 15],
                },
            )
        )

        assert snapshot is not None
        operator_parameters = {
            parameter.name: parameter for parameter in snapshot.operations[3].parameters
        }
        self.assertEqual(operator_parameters["depth"].value, 13.0)
        rotation = operator_parameters["rotation"].value
        self.assertEqual(rotation[0], 0.0)
        self.assertAlmostEqual(rotation[1], math.atan2(5, 12))
        self.assertAlmostEqual(rotation[2], math.atan2(4, 3))
        self.assertEqual(snapshot.operations[4].parameters[0].value, [2.5, 4.0, 9.0])

    def test_marks_invalid_segment_frames_unresolved_with_an_explicit_reason(self) -> None:
        for end, expected_reason in (
            (
                [0, 0, 0],
                "segment frame requires distinct finite endpoints with nonzero distance",
            ),
            (
                [0, 0, float("inf")],
                "segment frame endpoints must be finite numeric vector3 values",
            ),
        ):
            with self.subTest(end=end):
                snapshot = self.tracker.snapshot(
                    action_step(
                        action_name="blender.mesh.create_cone",
                        arguments={
                            "resourceId": "detail.invalid",
                            "objectName": "OperatingLine.Detail.Invalid",
                            "radiusStart": 0.4,
                            "radiusEnd": 0.1,
                            "start": [0, 0, 0],
                            "end": end,
                        },
                    )
                )
                assert snapshot is not None
                operator_parameters = {
                    parameter.name: parameter
                    for parameter in snapshot.operations[3].parameters
                }
                self.assertFalse(operator_parameters["depth"].resolved)
                self.assertEqual(operator_parameters["depth"].reason, expected_reason)
                self.assertFalse(operator_parameters["rotation"].resolved)
                self.assertEqual(operator_parameters["rotation"].reason, expected_reason)

    def test_rejects_an_operator_parameter_insertion_point_not_in_the_path(self) -> None:
        recipe = BUNDLED_INTERACTION_CATALOG.recipe_for(
            "blender.mesh.create_uv_sphere"
        )
        assert recipe is not None
        materialization = recipe.procedure_materialization
        assert materialization is not None
        controls = materialization.menu.control_operations
        assert controls is not None
        invalid_menu = replace(
            materialization.menu,
            control_operations=replace(
                controls,
                insert_after_step_id="operator.missing",
            ),
        )
        invalid_recipe = replace(
            recipe,
            procedure_materialization=replace(materialization, menu=invalid_menu),
        )
        invalid_catalog = replace(
            BUNDLED_INTERACTION_CATALOG,
            recipes=tuple(
                invalid_recipe if candidate.id == recipe.id else candidate
                for candidate in BUNDLED_INTERACTION_CATALOG.recipes
            ),
        )

        with self.assertRaisesRegex(
            ValueError,
            "insertion step 'operator.missing' does not identify exactly one",
        ):
            MenuGuidanceTracker(invalid_catalog).snapshot(self.step)

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

    def test_leaf_navigation_moves_focus_without_faking_menu_reveal(self) -> None:
        initial = self.tracker.snapshot(self.step)
        assert initial is not None
        self.assertEqual(initial.focused_ordinal, 1)
        self.assertFalse(initial.can_focus_back)
        self.assertTrue(initial.can_focus_next)

        self.assertTrue(
            self.tracker.focus_next(
                self.step,
                initial.focused_operation.operation_id,
                initial.focused_ordinal,
                initial.cursor_token,
            )
        )
        focused = self.tracker.snapshot(self.step)
        assert focused is not None
        self.assertEqual(focused.focused_ordinal, 2)
        self.assertEqual(focused.revealed_depth, 1)
        self.assertEqual(focused.items[0].role, MenuGuidanceRole.CURRENT)
        self.assertEqual(focused.items[1].role, MenuGuidanceRole.NEXT)
        self.assertEqual(focused.operations[0].role, MenuGuidanceRole.PREVIOUS)
        self.assertEqual(focused.operations[1].role, MenuGuidanceRole.CURRENT)
        self.assertFalse(
            self.tracker.focus_next(
                self.step,
                initial.focused_operation.operation_id,
                initial.focused_ordinal,
                initial.cursor_token,
            )
        )

        self.assertTrue(
            self.tracker.focus_back(
                self.step,
                focused.focused_operation.operation_id,
                focused.focused_ordinal,
                focused.cursor_token,
            )
        )
        restored = self.tracker.snapshot(self.step)
        assert restored is not None
        self.assertEqual(restored.focused_ordinal, 1)
        self.assertTrue(
            self.tracker.retry_focus(
                self.step,
                restored.focused_operation.operation_id,
                restored.focused_ordinal,
                restored.cursor_token,
            )
        )
        retried = self.tracker.snapshot(self.step)
        assert retried is not None
        self.assertEqual(retried.focused_ordinal, 1)
        self.assertEqual(retried.retry_serial, 1)

    def test_reference_instructions_remain_unverified_when_browsed(self) -> None:
        snapshot = self.tracker.snapshot(self.step)
        assert snapshot is not None
        while snapshot.focused_ordinal < 5:
            self.assertTrue(
                self.tracker.focus_next(
                    self.step,
                    snapshot.focused_operation.operation_id,
                    snapshot.focused_ordinal,
                    snapshot.cursor_token,
                )
            )
            snapshot = self.tracker.snapshot(self.step)
            assert snapshot is not None

        self.assertEqual(snapshot.focused_ordinal, 5)
        self.assertTrue(snapshot.focused_operation.reference)
        self.assertEqual(
            snapshot.focused_operation.evidence,
            LeafOperationEvidence.NONE,
        )
        self.assertNotIn(
            MenuGuidanceRole.COMPLETED,
            tuple(operation.role for operation in snapshot.operations),
        )
        self.assertEqual(snapshot.revealed_depth, 1)

    def test_real_menu_reveal_records_evidence_separately_from_focus(self) -> None:
        self.assertTrue(self.tracker.reveal(self.step, "Add"))
        self.assertTrue(self.tracker.reveal(self.step, "Mesh"))
        snapshot = self.tracker.snapshot(self.step)
        assert snapshot is not None
        self.assertEqual(snapshot.focused_ordinal, 3)
        self.assertEqual(snapshot.revealed_depth, 3)
        self.assertEqual(
            tuple(operation.evidence for operation in snapshot.operations[:3]),
            (LeafOperationEvidence.REVEALED,) * 3,
        )
        self.assertEqual(
            snapshot.operations[3].evidence,
            LeafOperationEvidence.NONE,
        )

        self.assertTrue(
            self.tracker.focus_next(
                self.step,
                snapshot.focused_operation.operation_id,
                snapshot.focused_ordinal,
                snapshot.cursor_token,
            )
        )
        browsed = self.tracker.snapshot(self.step)
        assert browsed is not None
        self.assertEqual(browsed.focused_ordinal, 4)
        self.assertEqual(browsed.revealed_depth, 3)
        self.assertEqual(
            browsed.operations[3].evidence,
            LeafOperationEvidence.NONE,
        )

    def test_resets_progress_when_the_next_leaf_changes(self) -> None:
        self.tracker.reveal(self.step, "Mesh")
        replacement = action_step(step_id="snowman.model.body_upper")

        snapshot = self.tracker.snapshot(replacement)

        assert snapshot is not None
        self.assertEqual(snapshot.step_id, replacement.id)
        self.assertEqual(snapshot.revealed_depth, 1)
        self.assertEqual(snapshot.items[0].role, MenuGuidanceRole.CURRENT)
        self.assertEqual(snapshot.items[1].role, MenuGuidanceRole.NEXT)
        self.assertEqual(
            tuple(operation.ordinal for operation in snapshot.operations),
            (1, 2, 3, 4, 5, 6, 7),
        )

    def test_resets_instruction_focus_for_a_new_leaf_instance_with_same_content(self) -> None:
        snapshot = self.tracker.snapshot(self.step)
        assert snapshot is not None
        self.assertTrue(
            self.tracker.focus_next(
                self.step,
                snapshot.focused_operation.operation_id,
                snapshot.focused_ordinal,
                snapshot.cursor_token,
            )
        )
        replacement = action_step()

        reset = self.tracker.snapshot(replacement)

        assert reset is not None
        self.assertEqual(reset.focused_ordinal, 1)
        self.assertEqual(reset.revealed_depth, 1)
        self.assertEqual(reset.retry_serial, 0)

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

    def test_fail_closes_local_menu_guidance_for_any_selected_track_override(self) -> None:
        self.tracker.reveal(self.step, "Mesh")

        for kind in ("shortcut", "menu"):
            with self.subTest(kind=kind):
                override = ExecutionTrackOverrideSpec(
                    kind="procedure_tree_selected_track",
                    interaction_catalog_version="1.46.0",
                    interaction_catalog_content_sha256="a" * 64,
                    recipe_id="blender.mesh.create_uv_sphere.native",
                    modality=kind,
                    track_id=f"test.{kind}.track",
                    track_content_sha256="b" * 64,
                    proof_execution_content_sha256="c" * 64,
                )
                self.assertIsNone(
                    self.tracker.snapshot(
                        action_step(execution_track_override=override)
                    )
                )
                self.assertFalse(
                    self.tracker.reveal(
                        action_step(execution_track_override=override),
                        "Add",
                    )
                )

        reset_snapshot = self.tracker.snapshot(self.step)
        assert reset_snapshot is not None
        self.assertEqual(reset_snapshot.revealed_depth, 1)

    def test_candidate_projection_is_the_sole_source_and_never_accepts_execution(self) -> None:
        step = TaskNode(
            id="edit.subdivide",
            number="1.1",
            title="Subdivide",
            order=1,
            action=ActionSpec(
                adapter_id="blender",
                name="blender.mesh.create_uv_sphere",
                arguments={"radius": 99},
            ),
            candidate_menu_projection=candidate_projection(),
        )

        snapshot = self.tracker.snapshot(step)

        assert snapshot is not None
        self.assertTrue(snapshot.candidate_only)
        self.assertFalse(snapshot.managed_equivalent)
        self.assertFalse(snapshot.native)
        self.assertFalse(snapshot.accepts("mesh.subdivide"))
        self.assertEqual(snapshot.recipe_id, "blender.mesh.edit_subdivide.menu-candidate")
        self.assertEqual(len(snapshot.operations), 11)
        self.assertEqual(snapshot.operations[8].parameters[0].value, 3)
        self.assertEqual(snapshot.operations[9].parameters[0].value, 0.25)
        self.assertEqual(
            tuple(operation.target_id for operation in snapshot.operations if operation.native),
            (
                "VIEW3D_MT_select_edit_mesh",
                "mesh.select_all",
                "VIEW3D_MT_edit_mesh_edges",
                "mesh.subdivide",
            ),
        )
        self.assertFalse(self.tracker.reveal(step, "Select"))

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

    def test_single_material_parameters_follow_the_exact_four_operation_mcp_order(
        self,
    ) -> None:
        arguments = {
            "materialId": "tutorial.material.snow",
            "materialName": "OperatingLine.Snow",
            "targets": ["tutorial.head", "tutorial.body"],
            "baseColor": [0.82, 0.9, 1.0, 1.0],
            "roughness": 0.35,
            "metallic": 0.1,
        }
        material = action_step(
            step_id="materials.snow",
            action_name="blender.material.create_and_assign",
            arguments=arguments,
        )

        snapshot = self.tracker.snapshot(material)

        assert snapshot is not None
        self.assertEqual(snapshot.catalog_version, "1.69.0")
        self.assertEqual(
            tuple(operation.operation_id for operation in snapshot.operations),
            (
                "workspace.shading",
                "panel.material_properties",
                "control.new_material",
                "semantic.principled_surface",
            ),
        )
        self.assertEqual(
            tuple(parameter.name for parameter in snapshot.operations[0].parameters),
            ("materialId",),
        )
        self.assertEqual(snapshot.operations[0].parameters[0].value, arguments["materialId"])
        self.assertEqual(snapshot.operations[1].parameters, ())
        self.assertEqual(snapshot.operations[2].parameters, ())
        self.assertEqual(
            tuple(parameter.name for parameter in snapshot.operations[3].parameters),
            ("materialName", "baseColor", "roughness", "metallic", "targets"),
        )
        self.assertEqual(
            tuple(parameter.value for parameter in snapshot.operations[3].parameters),
            (
                arguments["materialName"],
                arguments["baseColor"],
                arguments["roughness"],
                arguments["metallic"],
                arguments["targets"],
            ),
        )

        inset = action_step(
            action_name="blender.mesh.edit_inset_faces",
            operator_id="mesh.inset",
            menu_path=("Face", "Inset Faces"),
        )
        inset_snapshot = self.tracker.snapshot(inset)
        assert inset_snapshot is not None
        self.assertEqual(inset_snapshot.path_kind, InteractionPathKind.SEMANTIC)
        self.assertEqual(
            tuple(item.label for item in inset_snapshot.items),
            (
                "Layout",
                "Owned Mesh",
                "Edit Mode",
                "Face",
                "Inset Faces",
                "Managed Individual Inset Faces Contract",
            ),
        )
        self.assertTrue(
            all(item.role is MenuGuidanceRole.LOCKED for item in inset_snapshot.items)
        )
        self.assertFalse(inset_snapshot.accepts("mesh.inset"))

        poke = action_step(
            action_name="blender.mesh.edit_poke_faces",
            operator_id="mesh.poke",
            menu_path=("Face", "Poke Faces"),
        )
        poke_snapshot = self.tracker.snapshot(poke)
        assert poke_snapshot is not None
        self.assertEqual(poke_snapshot.path_kind, InteractionPathKind.SEMANTIC)
        self.assertEqual(
            tuple(item.label for item in poke_snapshot.items),
            (
                "Layout",
                "Owned Mesh",
                "Edit Mode",
                "Face",
                "Poke Faces",
                "Managed Poke Contract",
            ),
        )
        self.assertTrue(
            all(item.role is MenuGuidanceRole.LOCKED for item in poke_snapshot.items)
        )
        self.assertFalse(poke_snapshot.accepts("mesh.poke"))

    def test_geometry_node_leaf_numbers_nodes_socket_values_and_links_in_order(self) -> None:
        geometry = action_step(
            action_name="blender.geometry_nodes.create_transform",
            arguments={
                "targetId": "visual.geometry.target",
                "modifierId": "visual.geometry.modifier",
                "modifierName": "OperatingLine.VisualGeometryModifier",
                "nodeGroupId": "visual.geometry.node_group",
                "nodeGroupName": "OperatingLine.VisualGeometryNodes",
                "translation": [1, 2, 3],
                "rotation": [0, 0, 0.5],
                "scale": [1.25, 1.25, 1.25],
            },
        )

        snapshot = self.tracker.snapshot(geometry)

        assert snapshot is not None
        self.assertEqual(snapshot.path_kind, InteractionPathKind.SEMANTIC)
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            tuple(f"{ordinal:02d}" for ordinal in range(1, 12)),
        )
        self.assertEqual(
            tuple(operation.label for operation in snapshot.operations),
            (
                "Validate Transform Geometry Preconditions",
                "New Modifier",
                "Add Group Input",
                "Add Transform Geometry",
                "Set Translation",
                "Set Rotation",
                "Set Scale",
                "Add Group Output",
                "Connect Group Input Geometry to Transform Geometry",
                "Connect Transform Geometry to Group Output Geometry",
                "Verify Links",
            ),
        )
        translation, rotation, scale = snapshot.operations[4:7]
        self.assertEqual(
            tuple(operation.target_kind for operation in (translation, rotation, scale)),
            ("socket", "socket", "socket"),
        )
        self.assertEqual(
            tuple(
                operation.parameters[0].name
                for operation in (translation, rotation, scale)
            ),
            ("translation", "rotation", "scale"),
        )
        self.assertEqual(
            tuple(
                operation.parameters[0].value
                for operation in (translation, rotation, scale)
            ),
            ([1, 2, 3], [0, 0, 0.5], [1.25, 1.25, 1.25]),
        )
        self.assertEqual(
            tuple(
                operation.container_operation_id
                for operation in (translation, rotation, scale)
            ),
            ("node.transform_geometry",) * 3,
        )
        self.assertEqual(
            tuple(
                operation.container_target_id
                for operation in (translation, rotation, scale)
            ),
            ("GeometryNodeTransform",) * 3,
        )
        self.assertEqual(
            translation.path,
            (
                "Validate Transform Geometry Preconditions",
                "New Modifier",
                "Add Group Input",
                "Add Transform Geometry",
                "Translation",
            ),
        )
        input_link, output_link = snapshot.operations[8:10]
        self.assertEqual(
            (
                input_link.connection.from_node,
                input_link.connection.from_socket,
                input_link.connection.to_node,
                input_link.connection.to_socket,
            ),
            ("NodeGroupInput", "Geometry", "GeometryNodeTransform", "Geometry"),
        )
        self.assertEqual(
            (
                output_link.connection.from_node,
                output_link.connection.from_socket,
                output_link.connection.to_node,
                output_link.connection.to_socket,
            ),
            ("GeometryNodeTransform", "Geometry", "NodeGroupOutput", "Geometry"),
        )
        self.assertTrue(all(operation.reference for operation in snapshot.operations))
        self.assertEqual(
            tuple(operation.target_trust for operation in snapshot.operations),
            (
                LeafTargetTrust.REFERENCE_ONLY,
                LeafTargetTrust.REFERENCE_ONLY,
                LeafTargetTrust.CONTAINER_CAPABLE,
                LeafTargetTrust.CONTAINER_CAPABLE,
                LeafTargetTrust.GUIDED_CONTROL,
                LeafTargetTrust.GUIDED_CONTROL,
                LeafTargetTrust.GUIDED_CONTROL,
                LeafTargetTrust.CONTAINER_CAPABLE,
                LeafTargetTrust.GUIDED_CONTROL,
                LeafTargetTrust.GUIDED_CONTROL,
                LeafTargetTrust.REFERENCE_ONLY,
            ),
        )
        self.assertTrue(
            all(operation.uses_guided_control for operation in snapshot.operations[4:7])
        )
        self.assertTrue(
            all(
                operation.evidence is LeafOperationEvidence.NONE
                for operation in snapshot.operations
            )
        )

    def test_light_trails_numbers_named_nodes_and_exact_values_in_execution_order(self) -> None:
        light_trails = action_step(
            step_id="geometry.light_trails",
            action_name="blender.geometry_nodes.create_light_trails",
            arguments={
                "targetId": "visual.light_trails.target",
                "modifierId": "visual.light_trails.modifier",
                "modifierName": "OperatingLine.VisualLightTrailsModifier",
                "nodeGroupId": "visual.light_trails.node_group",
                "nodeGroupName": "OperatingLine.VisualLightTrailsNodes",
                "trailCount": 12,
                "pointsPerTrail": 48,
                "tileLength": 20.0,
                "trailSpacing": 0.22,
                "noiseScale": 0.4,
                "noiseDetail": 3.0,
                "noiseRoughness": 0.55,
                "noiseSeed": 7.0,
                "height": 1.8,
                "profileSides": 4,
                "profileRadius": 0.025,
                "tileRepeatCount": 3,
            },
        )

        snapshot = self.tracker.snapshot(light_trails)

        assert snapshot is not None
        self.assertEqual(snapshot.catalog_version, "1.69.0")
        self.assertEqual(len(snapshot.items), 42)
        self.assertEqual(len(snapshot.operations), 54)
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            tuple(f"{ordinal:02d}" for ordinal in range(1, 55)),
        )
        named_nodes = tuple(
            operation
            for operation in snapshot.operations
            if operation.target_kind == "node"
        )
        self.assertEqual(len(named_nodes), 20)
        self.assertTrue(
            all(
                operation.target_id.startswith("node-name:OperatingLine ")
                and operation.target_trust is LeafTargetTrust.CONTAINER_CAPABLE
                for operation in named_nodes
            )
        )
        parameters = {
            operation.parameters[0].name: operation
            for operation in snapshot.operations
            if len(operation.parameters) == 1
        }
        self.assertEqual(parameters["tileLength"].parameters[0].value, 20.0)
        self.assertEqual(parameters["pointsPerTrail"].parameters[0].value, 48)
        self.assertEqual(parameters["trailCount"].parameters[0].value, 12)
        self.assertEqual(parameters["noiseSeed"].parameters[0].value, 7.0)
        self.assertEqual(parameters["tileRepeatCount"].parameters[0].value, 3)
        self.assertEqual(
            parameters["profileRadius"].container_target_id,
            "node-name:OperatingLine Trail Profile",
        )
        self.assertTrue(
            all(
                operation.target_trust is LeafTargetTrust.GUIDED_CONTROL
                for operation in parameters.values()
            )
        )
        connections = tuple(
            operation
            for operation in snapshot.operations
            if operation.connection is not None
        )
        self.assertEqual(len(connections), 19)
        self.assertEqual(
            (
                connections[0].connection.from_node,
                connections[0].connection.from_socket,
                connections[0].connection.to_node,
                connections[0].connection.to_socket,
            ),
            (
                "node-name:OperatingLine Half Tile Line",
                "Curve",
                "node-name:OperatingLine Trail Resolution",
                "Curve",
            ),
        )
        self.assertEqual(
            (
                connections[-1].connection.from_node,
                connections[-1].connection.to_node,
            ),
            (
                "node-name:OperatingLine Realize Tiles",
                "node-name:OperatingLine Output",
            ),
        )

    def test_pose_animation_numbers_structured_keyframes_after_their_exact_steps(
        self,
    ) -> None:
        keyframes = [
            {
                "frame": 1,
                "poses": [
                    {
                        "boneName": "OperatingLine.Root",
                        "rotationEuler": [0.0, 0.0, 0.0],
                    },
                    {
                        "boneName": "OperatingLine.Tip",
                        "rotationQuaternion": [1.0, 0.0, 0.0, 0.0],
                    },
                ],
            },
            {
                "frame": 20,
                "poses": [
                    {
                        "boneName": "OperatingLine.Root",
                        "rotationEuler": [0.0, 0.25, 0.0],
                    },
                    {
                        "boneName": "OperatingLine.Tip",
                        "rotationQuaternion": [
                            0.955336489125606,
                            0.0,
                            0.29552020666134,
                            0.0,
                        ],
                    },
                ],
            },
        ]
        pose_animation = action_step(
            step_id="animation.pose",
            action_name="blender.animation.create_pose_keyframes",
            arguments={
                "actionId": "visual.pose.action",
                "actionName": "OperatingLine.VisualPoseAction",
                "armatureId": "visual.pose.rig",
                "keyframes": keyframes,
                "interpolation": "LINEAR",
                "extrapolation": "CONSTANT",
            },
        )

        snapshot = self.tracker.snapshot(pose_animation)

        assert snapshot is not None
        self.assertEqual(snapshot.catalog_version, "1.69.0")
        self.assertEqual(len(snapshot.items), 8)
        self.assertEqual(len(snapshot.operations), 12)
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            tuple(f"{ordinal:02d}" for ordinal in range(1, 13)),
        )
        parameters = {
            operation.parameters[0].name: operation
            for operation in snapshot.operations
            if len(operation.parameters) == 1
        }
        self.assertEqual(parameters["actionName"].parameters[0].value, "OperatingLine.VisualPoseAction")
        self.assertEqual(parameters["keyframes"].parameters[0].value, keyframes)
        self.assertEqual(parameters["interpolation"].parameters[0].value, "LINEAR")
        self.assertEqual(parameters["extrapolation"].parameters[0].value, "CONSTANT")
        self.assertLess(
            next(
                index
                for index, operation in enumerate(snapshot.operations)
                if operation.operation_id == "operator.insert_keyframe"
            ),
            next(
                index
                for index, operation in enumerate(snapshot.operations)
                if operation.parameters
                and operation.parameters[0].name == "keyframes"
            ),
        )

    def test_armature_numbers_names_bones_and_bindings_at_their_exact_operations(
        self,
    ) -> None:
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
        armature = action_step(
            step_id="rig.armature",
            action_name="blender.rig.create_armature",
            arguments={
                "armatureId": "visual.armature.rig",
                "objectName": "OperatingLine.VisualArmatureRig",
                "dataName": "OperatingLine.VisualArmatureRigData",
                "collectionId": "snowman.collection",
                "bones": bones,
                "bindings": bindings,
            },
        )

        snapshot = self.tracker.snapshot(armature)

        assert snapshot is not None
        self.assertEqual(snapshot.catalog_version, "1.69.0")
        self.assertEqual(len(snapshot.operations), 9)
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            tuple(f"{ordinal:02d}" for ordinal in range(1, 10)),
        )
        self.assertEqual(
            tuple(parameter.name for parameter in snapshot.operations[0].parameters),
            ("armatureId", "collectionId"),
        )
        self.assertEqual(
            tuple(parameter.value for parameter in snapshot.operations[0].parameters),
            ("visual.armature.rig", "snowman.collection"),
        )
        self.assertEqual(snapshot.operations[2].parameters[0].value, "OperatingLine.VisualArmatureRig")
        self.assertEqual(snapshot.operations[3].parameters[0].value, "OperatingLine.VisualArmatureRigData")
        self.assertEqual(snapshot.operations[5].parameters[0].value, bones)
        self.assertEqual(snapshot.operations[7].parameters[0].value, bindings)
        self.assertTrue(
            all(
                snapshot.operations[index].uses_guided_control
                for index in (2, 3, 5, 7)
            )
        )
        self.assertEqual(
            tuple(operation.operation_id for operation in snapshot.operations),
            (
                "workspace.layout",
                "menu.add_armature",
                "projection.semantic.armature.object_name",
                "projection.semantic.armature.data_name",
                "mode.edit_bones",
                "projection.semantic.armature.bones",
                "semantic.rigid_parent",
                "projection.semantic.armature.bindings",
                "semantic.verify_armature",
            ),
        )

    def test_skin_weights_numbers_values_and_modifier_name_at_exact_operations(
        self,
    ) -> None:
        weights = [
            {
                "vertexIndex": 0,
                "influences": [
                    {"boneName": "OperatingLine.Root", "weight": 1.0}
                ],
            },
            {
                "vertexIndex": 1,
                "influences": [
                    {"boneName": "OperatingLine.Tip", "weight": 1.0}
                ],
            },
        ]
        skin_weights = action_step(
            step_id="rig.skin-weights",
            action_name="blender.rig.bind_skin_weights",
            arguments={
                "targetId": "visual.skin.target",
                "armatureId": "visual.skin.rig",
                "modifierId": "visual.skin.modifier",
                "modifierName": "OperatingLine.VisualSkinArmature",
                "preserveVolume": True,
                "weights": weights,
            },
        )

        snapshot = self.tracker.snapshot(skin_weights)

        assert snapshot is not None
        self.assertEqual(snapshot.catalog_version, "1.69.0")
        self.assertEqual(len(snapshot.operations), 9)
        self.assertEqual(
            tuple(operation.ordinal_label for operation in snapshot.operations),
            tuple(f"{ordinal:02d}" for ordinal in range(1, 10)),
        )
        self.assertEqual(
            tuple(parameter.name for parameter in snapshot.operations[0].parameters),
            ("targetId", "armatureId", "modifierId"),
        )
        self.assertEqual(
            tuple(parameter.value for parameter in snapshot.operations[0].parameters),
            ("visual.skin.target", "visual.skin.rig", "visual.skin.modifier"),
        )
        self.assertEqual(snapshot.operations[4].parameters[0].value, weights)
        self.assertIs(snapshot.operations[6].parameters[0].value, True)
        self.assertEqual(
            snapshot.operations[7].parameters[0].value,
            "OperatingLine.VisualSkinArmature",
        )
        self.assertTrue(
            all(
                snapshot.operations[index].uses_guided_control
                for index in (4, 6, 7)
            )
        )
        self.assertEqual(
            tuple(operation.operation_id for operation in snapshot.operations),
            (
                "workspace.layout",
                "panel.object_data",
                "mode.weight_paint",
                "semantic.normalized_weights",
                "projection.semantic.skin_weights.weights",
                "semantic.armature_modifier",
                "projection.semantic.skin_weights.preserve_volume",
                "projection.semantic.skin_weights.modifier_name",
                "semantic.verify_skin_weights",
            ),
        )


if __name__ == "__main__":
    unittest.main()
