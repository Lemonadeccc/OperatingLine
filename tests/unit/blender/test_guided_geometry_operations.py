"""Pure-Python contracts for operation-level Transform Geometry execution."""

from dataclasses import dataclass
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import ast
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = (
    REPO_ROOT
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
    / "infrastructure"
    / "guided_geometry_operations.py"
)
SPEC = spec_from_file_location("operating_line_guided_geometry_operations_test", MODULE_PATH)
MODULE = module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


@dataclass(frozen=True)
class _Receipt:
    receipt_id: str
    step_id: str
    action_name: str
    created: tuple = ()
    mutations: tuple = ()
    artifacts: tuple = ()
    anchor: object | None = None


@dataclass(frozen=True)
class _Identity:
    resource_type: str
    logical_id: str


class _Modifiers(list):
    def get(self, name):
        return next((modifier for modifier in self if modifier.name == name), None)


class _Pointer:
    def __init__(self, pointer):
        self._pointer = pointer

    def as_pointer(self):
        return self._pointer


class _Collection(list):
    def remove(self, value):
        super().remove(value)


class _FaultingNode:
    bl_idname = "NodeGroupInput"

    def __init__(self):
        self.name = ""
        self._location = (0.0, 0.0)

    @property
    def location(self):
        return self._location

    @location.setter
    def location(self, value):
        self._location = tuple(value)
        raise RuntimeError("injected location failure")


class _FaultingNodes(_Collection):
    def new(self, _node_type):
        node = _FaultingNode()
        self.append(node)
        return node


class _FakeInterface:
    def __init__(self):
        self.items_tree = _Collection()

    def new_socket(self, *, name, in_out, socket_type):
        socket = SimpleNamespace(
            name=name,
            in_out=in_out,
            socket_type=socket_type,
            item_type="SOCKET",
            identifier=f"{in_out.lower()}-geometry",
        )
        self.items_tree.append(socket)
        return socket

    def remove(self, socket):
        self.items_tree.remove(socket)


class _FaultingVector(list):
    def __init__(self, owner, values):
        super().__init__(values)
        self.owner = owner

    def __setitem__(self, index, value):
        super().__setitem__(index, value)
        if self.owner.fail_next_write:
            self.owner.fail_next_write = False
            raise RuntimeError("injected parameter failure after write")


class _FaultingVectorSocket:
    identifier = "Translation"

    def __init__(self):
        self.fail_next_write = True
        self._value = _FaultingVector(self, MODULE._DEFAULT_TRANSLATION)

    @property
    def default_value(self):
        return self._value

    @default_value.setter
    def default_value(self, value):
        self._value = _FaultingVector(self, value)


class _VectorSocket:
    identifier = "Translation"

    def __init__(self, value):
        self.default_value = list(value)


class _FaultingLinks(_Collection):
    def new(self, from_socket, to_socket):
        link = SimpleNamespace(
            from_node=from_socket.node,
            from_socket=from_socket,
            to_node=to_socket.node,
            to_socket=to_socket,
        )
        self.append(link)
        raise RuntimeError("injected link failure after creation")


class _FaultingRemoveLinks(_Collection):
    def __init__(self, values):
        super().__init__(values)
        self.fail_next_remove = True

    def new(self, from_socket, to_socket):
        self.append(
            SimpleNamespace(
                from_node=from_socket.node,
                from_socket=from_socket,
                to_node=to_socket.node,
                to_socket=to_socket,
            )
        )

    def remove(self, value):
        super().remove(value)
        if self.fail_next_remove:
            self.fail_next_remove = False
            raise RuntimeError("injected link failure after removal")


def _fixture():
    target_identity = _Identity("OBJECT", "target")
    mesh_identity = _Identity("MESH", "mesh")
    mesh = _Pointer(202)
    target = _Pointer(101)
    target.type = "MESH"
    target.data = mesh
    target.modifiers = _Modifiers()
    registry = {"target": target_identity, "mesh": mesh_identity}
    resolved = {target_identity: target, mesh_identity: mesh}

    def make_receipt(receipt_id, step_id, action_name, created, mutations, artifacts, anchor):
        return _Receipt(
            receipt_id,
            step_id,
            action_name,
            tuple(created),
            tuple(mutations),
            tuple(artifacts),
            anchor,
        )

    deps = SimpleNamespace(
        ModifierState=type("ModifierState", (), {}),
        MutationRecord=lambda *args: args,
        build_resource_registry=lambda _receipts: registry,
        ensure_logical_ids_available=lambda *_args: None,
        ensure_modifier_id_available=lambda *_args: None,
        ensure_name_available=lambda *_args: None,
        ensure_receipts_intact=lambda *_args: None,
        make_receipt=make_receipt,
        node_tree_signature=lambda tree: tree.signature,
        owned_resource=lambda values, logical_id, resource_type: (
            values[logical_id],
            resolved[values[logical_id]],
        ),
        rebind_receipts_after_native_restore=lambda receipts: dict(receipts),
        resolve_resource=lambda identity: resolved.get(identity),
        rollback_partial=lambda *_args: None,
        rollback_receipt=lambda *_args, **_kwargs: None,
        snapshot_modifier=lambda *_args, **_kwargs: None,
        tag_resource=lambda *_args, **_kwargs: None,
    )
    bpy = SimpleNamespace(data=SimpleNamespace(node_groups=[]))
    definition = SimpleNamespace(
        target_id="target",
        modifier_id="modifier",
        modifier_name="OperatingLine.Transform",
        node_group_id="node-group",
        node_group_name="OperatingLine.TransformGraph",
        translation=(1.0, 2.0, 3.0),
        rotation=(0.1, 0.2, 0.3),
        scale=(1.5, 1.5, 1.5),
    )
    return deps, bpy, definition, target


class GuidedGeometryOperationTests(unittest.TestCase):
    def test_prepared_stage_probe_requires_exact_fingerprint_and_absent_resources(self):
        deps, bpy, definition, target = _fixture()
        with patch.object(MODULE, "_dependencies", return_value=deps), patch.object(
            MODULE, "_bpy", return_value=bpy
        ):
            result = MODULE.execute_transform_geometry_operation(
                operation_ordinal=1,
                receipt_id="leaf-receipt",
                step_id="geometry-step",
                action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                receipts={},
                definition=definition,
            )

            self.assertTrue(
                MODULE.verify_transform_geometry_stage(
                    receipt_id="leaf-receipt",
                    step_id="geometry-step",
                    action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                    receipts={},
                    definition=definition,
                    completed_operations=(1,),
                    expected_fingerprint=result.after_fingerprint,
                    partial_receipt=None,
                    rebind_after_native_restore=True,
                )
            )

            target.modifiers.append(
                SimpleNamespace(
                    name=definition.modifier_name,
                    type="NODES",
                    node_group=None,
                )
            )
            with self.assertRaisesRegex(RuntimeError, "base resources"):
                MODULE.verify_transform_geometry_stage(
                    receipt_id="leaf-receipt",
                    step_id="geometry-step",
                    action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                    receipts={},
                    definition=definition,
                    completed_operations=(1,),
                    expected_fingerprint=result.after_fingerprint,
                    partial_receipt=None,
                )

    def test_operation_01_attests_only_resource_preflight_and_preserves_receipt_id(self):
        deps, bpy, definition, _target = _fixture()
        with patch.object(MODULE, "_dependencies", return_value=deps), patch.object(
            MODULE, "_bpy", return_value=bpy
        ):
            result = MODULE.execute_transform_geometry_operation(
                operation_ordinal=1,
                receipt_id="caller-transaction-id",
                step_id="transform-step",
                action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                receipts={"target-step": object()},
                definition=definition,
            )

        self.assertEqual(result.receipt.receipt_id, "caller-transaction-id")
        self.assertEqual(result.transaction.completed_operations, (1,))
        self.assertEqual(result.receipt.created, ())
        self.assertEqual(result.receipt.mutations, ())
        self.assertEqual(result.before_fingerprint, result.after_fingerprint)
        self.assertTrue(result.observation["satisfied"])
        self.assertFalse(result.observation["details"]["mutating"])
        self.assertEqual(result.observation["details"]["operationOrdinal"], 1)
        self.assertEqual(
            result.observation["details"]["operationId"],
            "semantic.preflight_transform_geometry_resources",
        )
        evidence = result.observation["details"]["evidence"]
        self.assertTrue(evidence["preconditionsValidated"])
        self.assertEqual(
            evidence["preflightKind"], "managed_transform_geometry_resources"
        )
        self.assertEqual(evidence["preflightTargetId"], definition.target_id)
        self.assertNotIn("workspace", evidence)
        self.assertNotIn("workspace", result.observation["details"]["operationId"])

    def test_operation_02_cannot_skip_operation_01(self):
        deps, bpy, definition, _target = _fixture()
        with patch.object(MODULE, "_dependencies", return_value=deps), patch.object(
            MODULE, "_bpy", return_value=bpy
        ):
            with self.assertRaisesRegex(RuntimeError, "operation 01"):
                MODULE.execute_transform_geometry_operation(
                    operation_ordinal=2,
                    receipt_id="caller-transaction-id",
                    step_id="transform-step",
                    action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                    receipts={"target-step": object()},
                    definition=definition,
                )

    def test_inverse_refuses_non_lifo_operation_before_touching_blender(self):
        transaction = MODULE.GuidedGeometryTransaction(
            _Receipt(
                "caller-transaction-id",
                "transform-step",
                MODULE.TRANSFORM_GEOMETRY_ACTION,
            ),
            (1, 2, 3),
            "fingerprint",
            "definition-fingerprint",
        )
        with self.assertRaisesRegex(RuntimeError, "latest operation"):
            MODULE.inverse_transform_geometry_operation(
                operation_ordinal=2,
                receipt_id="caller-transaction-id",
                step_id="transform-step",
                action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                receipts={},
                definition=SimpleNamespace(),
                transaction=transaction,
            )

    def test_external_target_change_fails_closed_before_operation_02(self):
        deps, bpy, definition, target = _fixture()
        with patch.object(MODULE, "_dependencies", return_value=deps), patch.object(
            MODULE, "_bpy", return_value=bpy
        ):
            first = MODULE.execute_transform_geometry_operation(
                operation_ordinal=1,
                receipt_id="caller-transaction-id",
                step_id="transform-step",
                action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                receipts={"target-step": object()},
                definition=definition,
            )
            external_modifier = _Pointer(303)
            external_modifier.name = "External"
            external_modifier.type = "BEVEL"
            external_modifier.node_group = None
            target.modifiers.append(external_modifier)
            with self.assertRaisesRegex(RuntimeError, "outside the transaction"):
                MODULE.execute_transform_geometry_operation(
                    operation_ordinal=2,
                    receipt_id="caller-transaction-id",
                    step_id="transform-step",
                    action_name=MODULE.TRANSFORM_GEOMETRY_ACTION,
                    receipts={"target-step": object()},
                    definition=definition,
                    transaction=first.transaction,
                )

    def test_forward_surface_has_all_eleven_explicit_operation_branches(self):
        tree = ast.parse(MODULE_PATH.read_text(encoding="utf-8"))
        source = MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("operation_ordinal == 1", source)
        self.assertIn("operation_ordinal == 2", source)
        for ordinal in range(3, 11):
            self.assertIn(f"operation == {ordinal}", source)
        self.assertIn("operation_ordinal <= 10", source)
        self.assertIn("operation_ordinal == 11", source)
        calls = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        self.assertNotIn("new_receipt_id", calls)

    def test_node_creation_property_failure_removes_node_and_interface(self):
        node_group = SimpleNamespace(
            nodes=_FaultingNodes(),
            interface=_FakeInterface(),
        )

        with self.assertRaisesRegex(RuntimeError, "location failure"):
            MODULE._add_interface_and_node(
                node_group,
                "INPUT",
                "NodeGroupInput",
                "OperatingLine Input",
                (-320.0, 0.0),
            )

        self.assertEqual(node_group.nodes, [])
        self.assertEqual(node_group.interface.items_tree, [])

    def test_parameter_failure_after_write_is_compensated_to_exact_before_value(self):
        socket = _FaultingVectorSocket()
        transform = SimpleNamespace(inputs=(socket,))
        node_group = SimpleNamespace(nodes={MODULE._TRANSFORM_NODE_NAME: transform})
        target = object()
        deps = object()
        before = "before"

        def validate(_node_group, stage, _definition):
            expected = MODULE._DEFAULT_TRANSLATION if stage == 4 else definition.translation
            if tuple(socket.default_value) != tuple(expected):
                raise RuntimeError("wrong stage")

        def fingerprint(_target, _node_group, _deps):
            return (
                before
                if tuple(socket.default_value) == MODULE._DEFAULT_TRANSLATION
                else "changed"
            )

        try:
            MODULE._apply_forward(5, node_group, definition := _fixture()[2])
        except Exception as error:
            with patch.object(MODULE, "_validate_stage", side_effect=validate), patch.object(
                MODULE, "_fingerprint", side_effect=fingerprint
            ):
                MODULE._recover_transition_or_raise(
                    operation=5,
                    direction="forward",
                    target=target,
                    node_group=node_group,
                    definition=definition,
                    deps=deps,
                    expected_stage=4,
                    expected_fingerprint=before,
                    compensate=MODULE._apply_inverse,
                    original_error=error,
                )
        else:
            self.fail("The injected parameter write must fail")

        self.assertEqual(tuple(socket.default_value), MODULE._DEFAULT_TRANSLATION)

    def test_parameter_operation_writes_xyz_components_and_emits_exact_rna_evidence(self):
        definition = _fixture()[2]
        socket = _VectorSocket(MODULE._DEFAULT_TRANSLATION)
        transform = SimpleNamespace(inputs=(socket,))
        node_group = SimpleNamespace(nodes={MODULE._TRANSFORM_NODE_NAME: transform})

        writes = MODULE._apply_forward(5, node_group, definition)

        self.assertEqual(tuple(socket.default_value), definition.translation)
        self.assertEqual(len(writes), 3)
        for index, (write, label, value) in enumerate(
            zip(writes, ("X", "Y", "Z"), definition.translation, strict=True)
        ):
            self.assertEqual(write["order"], index + 1)
            self.assertEqual(write["componentIndex"], index)
            self.assertEqual(write["componentLabel"], label)
            self.assertEqual(write["executionMethod"], "blender_rna_property_write")
            self.assertEqual(
                write["mcpTool"],
                "operatingline.blender.geometry-nodes.transform.execute-next",
            )
            self.assertEqual(
                write["sourceOperationId"],
                "projection.semantic.transform_geometry.translation",
            )
            self.assertEqual(write["semanticAction"], "node.transform_geometry")
            self.assertEqual(write["actionArgument"], "translation")
            self.assertEqual(write["nodeGroupId"], definition.node_group_id)
            self.assertEqual(write["nodeGroupName"], definition.node_group_name)
            self.assertEqual(write["nodeName"], MODULE._TRANSFORM_NODE_NAME)
            self.assertEqual(write["nodeType"], "GeometryNodeTransform")
            self.assertEqual(write["socketIdentifier"], "Translation")
            self.assertEqual(write["propertyName"], "default_value")
            self.assertEqual(write["beforeValue"], 0.0)
            self.assertEqual(write["acceptedValue"], value)
            self.assertEqual(write["observedValue"], value)
            self.assertEqual(
                write["uiPath"],
                [
                    "Geometry Nodes",
                    definition.node_group_name,
                    MODULE._TRANSFORM_NODE_NAME,
                    "Translation",
                    label,
                ],
            )

    def test_link_failure_after_creation_is_compensated_to_no_link(self):
        input_node = SimpleNamespace(name=MODULE._INPUT_NODE_NAME)
        transform = SimpleNamespace(name=MODULE._TRANSFORM_NODE_NAME)
        from_socket = SimpleNamespace(identifier="input-geometry", node=input_node)
        to_socket = SimpleNamespace(identifier="Geometry", node=transform)
        input_node.outputs = (from_socket,)
        transform.inputs = (to_socket,)
        nodes = {
            MODULE._INPUT_NODE_NAME: input_node,
            MODULE._TRANSFORM_NODE_NAME: transform,
        }
        interface = SimpleNamespace(
            items_tree=(
                SimpleNamespace(
                    item_type="SOCKET",
                    name="Geometry",
                    in_out="INPUT",
                    socket_type="NodeSocketGeometry",
                    identifier="input-geometry",
                ),
            )
        )
        node_group = SimpleNamespace(
            nodes=nodes,
            interface=interface,
            links=_FaultingLinks(),
        )
        before = "before"

        def validate(_node_group, stage, _definition):
            expected_count = 0 if stage == 8 else 1
            if len(node_group.links) != expected_count:
                raise RuntimeError("wrong link stage")

        def fingerprint(_target, _node_group, _deps):
            return before if not node_group.links else "changed"

        try:
            MODULE._apply_forward(9, node_group, definition := _fixture()[2])
        except Exception as error:
            with patch.object(MODULE, "_validate_stage", side_effect=validate), patch.object(
                MODULE, "_fingerprint", side_effect=fingerprint
            ):
                MODULE._recover_transition_or_raise(
                    operation=9,
                    direction="forward",
                    target=object(),
                    node_group=node_group,
                    definition=definition,
                    deps=object(),
                    expected_stage=8,
                    expected_fingerprint=before,
                    compensate=MODULE._apply_inverse,
                    original_error=error,
                )
        else:
            self.fail("The injected link creation must fail")

        self.assertEqual(node_group.links, [])

    def test_inverse_link_failure_after_removal_restores_exact_link(self):
        input_node = SimpleNamespace(name=MODULE._INPUT_NODE_NAME)
        transform = SimpleNamespace(name=MODULE._TRANSFORM_NODE_NAME)
        from_socket = SimpleNamespace(identifier="input-geometry", node=input_node)
        to_socket = SimpleNamespace(identifier="Geometry", node=transform)
        input_node.outputs = (from_socket,)
        transform.inputs = (to_socket,)
        existing = SimpleNamespace(
            from_node=input_node,
            from_socket=from_socket,
            to_node=transform,
            to_socket=to_socket,
        )
        node_group = SimpleNamespace(
            nodes={
                MODULE._INPUT_NODE_NAME: input_node,
                MODULE._TRANSFORM_NODE_NAME: transform,
            },
            interface=SimpleNamespace(
                items_tree=(
                    SimpleNamespace(
                        item_type="SOCKET",
                        name="Geometry",
                        in_out="INPUT",
                        socket_type="NodeSocketGeometry",
                        identifier="input-geometry",
                    ),
                )
            ),
            links=_FaultingRemoveLinks((existing,)),
        )
        before = "before"

        def validate(_node_group, stage, _definition):
            expected_count = 1 if stage == 9 else 0
            if len(node_group.links) != expected_count:
                raise RuntimeError("wrong link stage")

        def fingerprint(_target, _node_group, _deps):
            return before if len(node_group.links) == 1 else "changed"

        try:
            MODULE._apply_inverse(9, node_group, definition := _fixture()[2])
        except Exception as error:
            with patch.object(MODULE, "_validate_stage", side_effect=validate), patch.object(
                MODULE, "_fingerprint", side_effect=fingerprint
            ):
                MODULE._recover_transition_or_raise(
                    operation=9,
                    direction="inverse",
                    target=object(),
                    node_group=node_group,
                    definition=definition,
                    deps=object(),
                    expected_stage=9,
                    expected_fingerprint=before,
                    compensate=MODULE._apply_forward,
                    original_error=error,
                )
        else:
            self.fail("The injected link removal must fail")

        self.assertEqual(len(node_group.links), 1)

    def test_failed_compensation_raises_explicit_atomicity_error(self):
        with patch.object(MODULE, "_validate_stage", side_effect=RuntimeError("changed")):
            with self.assertRaisesRegex(
                MODULE.GuidedGeometryAtomicityError,
                "prior Blender state could not be restored",
            ):
                MODULE._recover_transition_or_raise(
                    operation=4,
                    direction="inverse",
                    target=object(),
                    node_group=object(),
                    definition=object(),
                    deps=object(),
                    expected_stage=4,
                    expected_fingerprint="before",
                    compensate=lambda *_args: (_ for _ in ()).throw(
                        RuntimeError("recovery failed")
                    ),
                    original_error=RuntimeError("primary failure"),
                )


if __name__ == "__main__":
    unittest.main()
