"""Pure-Python contracts for the 54-step Light Trails executor."""

from dataclasses import dataclass
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_guided_light_trails_operations_test"

package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = package
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure

geometry_path = PACKAGE_ROOT / "infrastructure" / "guided_geometry_operations.py"
geometry_spec = spec_from_file_location(
    f"{PACKAGE_NAME}.infrastructure.guided_geometry_operations",
    geometry_path,
)
GEOMETRY_MODULE = module_from_spec(geometry_spec)
sys.modules[geometry_spec.name] = GEOMETRY_MODULE
geometry_spec.loader.exec_module(GEOMETRY_MODULE)

MODULE_PATH = (
    PACKAGE_ROOT / "infrastructure" / "guided_light_trails_operations.py"
)
SPEC = spec_from_file_location(
    f"{PACKAGE_NAME}.infrastructure.guided_light_trails_operations",
    MODULE_PATH,
)
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

    def make_receipt(
        receipt_id,
        step_id,
        action_name,
        created,
        mutations,
        artifacts,
        anchor,
    ):
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
        node_tree_semantic_signature=lambda tree: tree.signature,
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
        modifier_name="OperatingLine.LightTrails",
        node_group_id="node-group",
        node_group_name="OperatingLine.LightTrailsGraph",
        trail_count=12,
        points_per_trail=48,
        tile_length=20.0,
        trail_spacing=0.22,
        noise_scale=0.4,
        noise_detail=3.0,
        noise_roughness=0.55,
        noise_seed=7.0,
        height=1.8,
        profile_sides=4,
        profile_radius=0.025,
        tile_repeat_count=3,
    )
    return deps, bpy, definition, target


class GuidedLightTrailsOperationTests(unittest.TestCase):
    def test_catalog_materializes_one_unique_id_for_all_54_operations(self):
        operation_ids = MODULE.LIGHT_TRAILS_OPERATION_IDS

        self.assertEqual(len(operation_ids), 54)
        self.assertEqual(len(set(operation_ids)), 54)
        self.assertEqual(operation_ids[0], "workspace.geometry_nodes")
        self.assertEqual(operation_ids[-1], "semantic.verify_no_bake")
        self.assertEqual(len(MODULE._NODE_OPERATIONS), 20)
        self.assertEqual(len(MODULE._LINK_OPERATIONS), 19)
        parameter_ordinals = {5, 7, 9, 10, 15, 16, 17, 18, 21, 27, 28, 31}
        self.assertEqual(
            set(range(3, 54)),
            set(MODULE._NODE_OPERATIONS)
            | set(MODULE._LINK_OPERATIONS)
            | parameter_ordinals,
        )

    def test_operation_01_is_receipt_bound_non_mutating_preflight(self):
        deps, bpy, definition, _target = _fixture()
        with patch.object(MODULE, "_dependencies", return_value=deps), patch.object(
            MODULE, "_bpy", return_value=bpy
        ):
            result = MODULE.execute_light_trails_operation(
                operation_ordinal=1,
                receipt_id="caller-transaction-id",
                step_id="light-trails-step",
                action_name=MODULE.LIGHT_TRAILS_ACTION,
                receipts={"target-step": object()},
                definition=definition,
            )

        self.assertEqual(result.receipt.receipt_id, "caller-transaction-id")
        self.assertEqual(result.transaction.completed_operations, (1,))
        self.assertEqual(result.receipt.created, ())
        self.assertEqual(result.receipt.mutations, ())
        self.assertEqual(result.before_fingerprint, result.after_fingerprint)
        self.assertFalse(result.observation["details"]["mutating"])
        self.assertEqual(
            result.observation["details"]["operationId"],
            MODULE.LIGHT_TRAILS_OPERATION_IDS[0],
        )
        evidence = result.observation["details"]["evidence"]
        self.assertTrue(evidence["preconditionsValidated"])
        self.assertEqual(evidence["nodeCount"], 0)
        self.assertTrue(evidence["noBakeNodes"])
        self.assertEqual(evidence["rnaControlWrites"], [])
        self.assertEqual(evidence["rnaInitializationWrites"], [])
        self.assertEqual(evidence["rnaLinkCreations"], [])
        self.assertEqual(evidence["rnaStructureCreations"], [])
        self.assertEqual(evidence["rnaResourceMutations"], [])

    def test_operation_02_cannot_skip_preflight(self):
        deps, bpy, definition, _target = _fixture()
        with patch.object(MODULE, "_dependencies", return_value=deps), patch.object(
            MODULE, "_bpy", return_value=bpy
        ):
            with self.assertRaisesRegex(RuntimeError, "operation 01"):
                MODULE.execute_light_trails_operation(
                    operation_ordinal=2,
                    receipt_id="caller-transaction-id",
                    step_id="light-trails-step",
                    action_name=MODULE.LIGHT_TRAILS_ACTION,
                    receipts={"target-step": object()},
                    definition=definition,
                )

    def test_inverse_refuses_non_lifo_operation_before_touching_blender(self):
        transaction = MODULE.GuidedGeometryTransaction(
            _Receipt(
                "caller-transaction-id",
                "light-trails-step",
                MODULE.LIGHT_TRAILS_ACTION,
            ),
            (1, 2, 3),
            "fingerprint",
            "definition-fingerprint",
        )

        with self.assertRaisesRegex(RuntimeError, "latest operation"):
            MODULE.inverse_light_trails_operation(
                operation_ordinal=2,
                receipt_id="caller-transaction-id",
                step_id="light-trails-step",
                action_name=MODULE.LIGHT_TRAILS_ACTION,
                receipts={},
                definition=SimpleNamespace(),
                transaction=transaction,
            )

    def test_socket_resolution_prefers_stable_identifier_over_duplicate_name(self):
        sockets = (
            SimpleNamespace(identifier="Value", name="Value"),
            SimpleNamespace(identifier="Value_001", name="Value"),
        )

        self.assertIs(MODULE._socket(sockets, "Value"), sockets[0])
        self.assertIs(MODULE._socket(sockets, "Value_001"), sockets[1])

    def test_link_keys_use_interface_name_and_builtin_identifier(self):
        group_output = SimpleNamespace(bl_idname="NodeGroupOutput")
        math_node = SimpleNamespace(bl_idname="ShaderNodeMath")
        interface_socket = SimpleNamespace(name="Geometry", identifier="Socket_1")
        second_value = SimpleNamespace(name="Value", identifier="Value_001")

        self.assertEqual(
            MODULE._socket_key(group_output, interface_socket), "Geometry"
        )
        self.assertEqual(MODULE._socket_key(math_node, second_value), "Value_001")

    def test_parameter_placement_helpers_center_rows_and_tiles(self):
        self.assertEqual(MODULE._rows_start(12, 0.22), (0.0, -1.21, 0.0))
        self.assertEqual(MODULE._tiles_start(3, 20.0), (-20.0, 0.0, 0.0))

    def test_rna_control_write_records_scalar_and_projected_vector_component(self):
        definition = _fixture()[2]
        node = SimpleNamespace(
            name="OperatingLine Trail Rows",
            bl_idname="GeometryNodeMeshLine",
        )
        count = SimpleNamespace(identifier="Count", default_value=1)
        start = SimpleNamespace(
            identifier="Start Location", default_value=[0.0, 0.0, 0.0]
        )

        scalar = MODULE._write_rna_control(
            count,
            order=1,
            operation=9,
            definition=definition,
            node=node,
            semantic_action="node.light_trails.trail_rows",
            action_argument="trailCount",
            accepted_value=definition.trail_count,
            projected_value=definition.trail_count,
            projection="identity",
        )
        component = MODULE._write_rna_control(
            start,
            order=2,
            operation=9,
            definition=definition,
            node=node,
            semantic_action="node.light_trails.trail_rows",
            action_argument="trailCount",
            accepted_value=definition.trail_count,
            projected_value=MODULE._rows_start(definition.trail_count, 1.0)[1],
            projection="centered_rows_y_from_count",
            component_index=1,
        )

        self.assertEqual(count.default_value, definition.trail_count)
        self.assertEqual(start.default_value, [0.0, -5.5, 0.0])
        self.assertEqual(scalar["valueKind"], "scalar")
        self.assertIsNone(scalar["componentIndex"])
        self.assertEqual(scalar["uiPath"][-1], "Value")
        self.assertEqual(component["order"], 2)
        self.assertEqual(component["sourceOperationId"], MODULE.LIGHT_TRAILS_OPERATION_IDS[8])
        self.assertEqual(component["valueKind"], "vector_component")
        self.assertEqual(component["componentIndex"], 1)
        self.assertEqual(component["componentLabel"], "Y")
        self.assertEqual(component["acceptedValue"], 12)
        self.assertEqual(component["projectedValue"], -5.5)
        self.assertEqual(component["observedValue"], -5.5)
        self.assertEqual(
            component["uiPath"],
            [
                "Geometry Nodes",
                definition.node_group_name,
                node.name,
                "Start Location",
                "Y",
            ],
        )

    def test_definition_fingerprint_covers_every_accepted_parameter(self):
        _deps, _bpy, definition, _target = _fixture()
        baseline = MODULE._definition_fingerprint(definition)
        fields = (
            "target_id",
            "modifier_id",
            "modifier_name",
            "node_group_id",
            "node_group_name",
            "trail_count",
            "points_per_trail",
            "tile_length",
            "trail_spacing",
            "noise_scale",
            "noise_detail",
            "noise_roughness",
            "noise_seed",
            "height",
            "profile_sides",
            "profile_radius",
            "tile_repeat_count",
        )
        for field in fields:
            values = vars(definition).copy()
            current = values[field]
            values[field] = f"{current}.changed" if isinstance(current, str) else current + 1
            with self.subTest(field=field):
                self.assertNotEqual(
                    MODULE._definition_fingerprint(SimpleNamespace(**values)),
                    baseline,
                )

    def test_failed_compensation_raises_explicit_atomicity_error(self):
        with patch.object(MODULE, "_validate_stage", side_effect=RuntimeError("changed")):
            with self.assertRaisesRegex(
                MODULE.GuidedGeometryAtomicityError,
                "prior Blender state could not be restored",
            ):
                MODULE._recover_transition_or_raise(
                    operation=15,
                    direction="forward",
                    target=object(),
                    node_group=object(),
                    definition=object(),
                    deps=object(),
                    expected_stage=14,
                    expected_fingerprint="before",
                    compensate=lambda *_args: (_ for _ in ()).throw(
                        RuntimeError("recovery failed")
                    ),
                    original_error=RuntimeError("primary failure"),
                )


if __name__ == "__main__":
    unittest.main()
