"""Tests for receipt-bound Geometry Nodes native RNA target resolution."""

from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_guided_native_targeting_test"

package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = package
presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
presentation.__path__ = [str(PACKAGE_ROOT / "presentation")]
sys.modules[presentation.__name__] = presentation
module = import_module(f"{PACKAGE_NAME}.presentation.guided_native_targeting")


def _fixture(*, with_receipt: bool = True):
    sockets = [
        SimpleNamespace(identifier="Geometry"),
        SimpleNamespace(identifier="Translation"),
        SimpleNamespace(identifier="Rotation"),
        SimpleNamespace(identifier="Scale"),
    ]
    transform = SimpleNamespace(
        bl_idname="GeometryNodeTransform",
        inputs=sockets,
    )
    tree = SimpleNamespace(
        name="OperatingLine.Geometry",
        bl_idname="GeometryNodeTree",
        nodes=[transform],
    )
    action = SimpleNamespace(
        name="blender.geometry_nodes.create_transform",
        arguments={
            "nodeGroupId": "geometry.node_group",
            "nodeGroupName": "OperatingLine.Geometry",
        },
    )
    step = SimpleNamespace(id="geometry-step", action=action)
    identity = SimpleNamespace(
        resource_type="NODE_GROUP",
        logical_id="geometry.node_group",
        display_name="OperatingLine.Geometry",
        receipt_token="receipt-1",
        step_id=step.id,
        action_name=action.name,
    )
    receipt = SimpleNamespace(
        receipt_id="receipt-1",
        step_id=step.id,
        action_name=action.name,
        created=(identity,),
    )
    session = SimpleNamespace(receipts={step.id: receipt} if with_receipt else {})
    window_region = SimpleNamespace(type="WINDOW")
    context = SimpleNamespace(
        region=SimpleNamespace(type="UI"),
        area=SimpleNamespace(regions=[SimpleNamespace(type="HEADER"), window_region]),
        space_data=SimpleNamespace(edit_tree=tree),
    )
    return session, step, context, identity, tree, sockets, window_region


class GuidedNativeTargetingTests(unittest.TestCase):
    def test_light_trails_target_table_matches_actual_rna_write_order(self) -> None:
        targets = module._SOCKET_TARGETS[
            "blender.geometry_nodes.create_light_trails"
        ]

        self.assertEqual(
            targets["tileLength"],
            (
                (
                    "OperatingLine Half Tile Line",
                    "GeometryNodeCurvePrimitiveLine",
                    "Start",
                    (0,),
                    ("X",),
                ),
            ),
        )
        self.assertEqual(
            tuple(target[2] for target in targets["trailCount"]),
            ("Count", "Start Location"),
        )
        self.assertEqual(
            tuple(target[2] for target in targets["trailSpacing"]),
            ("Start Location", "Offset"),
        )
        self.assertEqual(
            tuple(target[2] for target in targets["tileRepeatCount"]),
            ("Count", "Start Location"),
        )

    def test_resolves_exact_receipt_bound_socket_and_window_region(self) -> None:
        session, step, context, identity, tree, sockets, window_region = _fixture()

        target = module.resolve_guided_geometry_native_target(
            session,
            step,
            context,
            "translation",
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertTrue(target.ready)
        self.assertIs(target.region, window_region)
        self.assertIs(target.node, tree.nodes[0])
        self.assertIs(target.data, sockets[1])
        self.assertEqual(target.property_name, "default_value")
        self.assertEqual(target.component_indexes, (0, 1, 2))
        self.assertEqual(target.component_labels, ("X", "Y", "Z"))

    def test_requires_managed_receipt_before_native_targeting(self) -> None:
        session, step, context, _identity, _tree, _sockets, _region = _fixture(
            with_receipt=False
        )

        target = module.resolve_guided_geometry_native_target(
            session,
            step,
            context,
            "scale",
            resolve_resource=lambda _identity: None,
        )

        self.assertEqual(target.status, "receipt_unavailable")
        self.assertFalse(target.ready)

    def test_rejects_another_open_node_tree(self) -> None:
        session, step, context, identity, tree, _sockets, _region = _fixture()
        context.space_data.edit_tree = SimpleNamespace()

        target = module.resolve_guided_geometry_native_target(
            session,
            step,
            context,
            "rotation",
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertEqual(target.status, "wrong_editor")

    def test_fails_closed_for_ambiguous_transform_nodes(self) -> None:
        session, step, context, identity, tree, _sockets, _region = _fixture()
        tree.nodes.append(
            SimpleNamespace(bl_idname="GeometryNodeTransform", inputs=[])
        )

        target = module.resolve_guided_geometry_native_target(
            session,
            step,
            context,
            "translation",
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertEqual(target.status, "target_ambiguous")

    def test_resolves_exact_named_light_trails_socket_and_component(self) -> None:
        start_location = SimpleNamespace(identifier="Start Location")
        offset = SimpleNamespace(identifier="Offset")
        rows = SimpleNamespace(
            name="OperatingLine Trail Rows",
            bl_idname="GeometryNodeMeshLine",
            inputs=[SimpleNamespace(identifier="Count"), start_location, offset],
        )
        tree = SimpleNamespace(
            name="OperatingLine.LightTrails",
            bl_idname="GeometryNodeTree",
            nodes=[rows],
        )
        action = SimpleNamespace(
            name="blender.geometry_nodes.create_light_trails",
            arguments={
                "nodeGroupId": "light-trails.node-group",
                "nodeGroupName": tree.name,
            },
        )
        step = SimpleNamespace(id="light-trails-step", action=action)
        identity = SimpleNamespace(
            resource_type="NODE_GROUP",
            logical_id="light-trails.node-group",
            display_name=tree.name,
            receipt_token="receipt-light-trails",
            step_id=step.id,
            action_name=action.name,
        )
        receipt = SimpleNamespace(
            receipt_id="receipt-light-trails",
            step_id=step.id,
            action_name=action.name,
            created=(identity,),
        )
        window_region = SimpleNamespace(type="WINDOW")
        context = SimpleNamespace(
            region=SimpleNamespace(type="UI"),
            area=SimpleNamespace(regions=[window_region]),
            space_data=SimpleNamespace(edit_tree=tree),
        )

        target = module.resolve_guided_geometry_native_target(
            SimpleNamespace(receipts={step.id: receipt}),
            step,
            context,
            "trailSpacing",
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertTrue(target.ready)
        self.assertIs(target.node, rows)
        self.assertIs(target.data, start_location)
        self.assertEqual(target.component_indexes, (1,))
        self.assertEqual(target.component_labels, ("Y",))

        second_target = module.resolve_guided_geometry_native_target(
            SimpleNamespace(receipts={step.id: receipt}),
            step,
            context,
            "trailSpacing",
            write_order=2,
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertTrue(second_target.ready)
        self.assertIs(second_target.node, rows)
        self.assertIs(second_target.data, offset)
        self.assertEqual(second_target.component_indexes, (1,))
        self.assertEqual(second_target.component_labels, ("Y",))

    def test_rejects_write_order_outside_exact_target_set(self) -> None:
        session, step, context, identity, tree, _sockets, _region = _fixture()

        target = module.resolve_guided_geometry_native_target(
            session,
            step,
            context,
            "translation",
            write_order=2,
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertEqual(target.status, "invalid_binding")

    def test_light_trails_target_fails_closed_for_wrong_named_node_type(self) -> None:
        session, step, context, identity, tree, _sockets, _region = _fixture()
        step.action.name = "blender.geometry_nodes.create_light_trails"
        step.action.arguments = {
            "nodeGroupId": identity.logical_id,
            "nodeGroupName": tree.name,
        }
        identity.action_name = step.action.name
        session.receipts[step.id].action_name = step.action.name
        tree.nodes = [
            SimpleNamespace(
                name="OperatingLine Trail Rows",
                bl_idname="ShaderNodeMath",
                inputs=[SimpleNamespace(identifier="Offset")],
            )
        ]

        target = module.resolve_guided_geometry_native_target(
            session,
            step,
            context,
            "trailSpacing",
            resolve_resource=lambda candidate: tree if candidate is identity else None,
        )

        self.assertEqual(target.status, "target_ambiguous")


if __name__ == "__main__":
    unittest.main()
