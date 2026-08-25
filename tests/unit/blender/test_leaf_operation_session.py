"""Pure Python contract tests for leaf-local operation transactions."""

from importlib import import_module
from dataclasses import replace
from pathlib import Path
from types import ModuleType
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_leaf_operation_session_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

application = import_module(f"{PACKAGE_NAME}.application")
domain = import_module(f"{PACKAGE_NAME}.domain")

ActionReceipt = application.ActionReceipt
DemoSession = application.DemoSession
ObservationGateError = application.ObservationGateError
ActionSpec = domain.ActionSpec
ObservationPolicySpec = domain.ObservationPolicySpec
TaskNode = domain.TaskNode

OPERATION_IDS = tuple(f"transform-geometry-{ordinal:02d}" for ordinal in range(1, 12))
POSE_OPERATION_IDS = (
    "workspace.animation",
    "editor.action",
    "mode.pose",
    "semantic.create_pose_action",
    "projection.semantic.pose_animation.action_name",
    "operator.insert_keyframe",
    "projection.semantic.pose_animation.keyframes",
    "control.pose_interpolation",
    "projection.semantic.pose_animation.interpolation",
    "control.pose_extrapolation",
    "projection.semantic.pose_animation.extrapolation",
    "semantic.verify_pose_animation",
)
ARMATURE_OPERATION_IDS = (
    "workspace.layout",
    "menu.add_armature",
    "projection.semantic.armature.object_name",
    "projection.semantic.armature.data_name",
    "mode.edit_bones",
    "projection.semantic.armature.bones",
    "semantic.rigid_parent",
    "projection.semantic.armature.bindings",
    "semantic.verify_armature",
)
SKIN_WEIGHTS_OPERATION_IDS = (
    "workspace.layout",
    "panel.object_data",
    "mode.weight_paint",
    "semantic.normalized_weights",
    "projection.semantic.skin_weights.weights",
    "semantic.armature_modifier",
    "projection.semantic.skin_weights.preserve_volume",
    "projection.semantic.skin_weights.modifier_name",
    "semantic.verify_skin_weights",
)


def passed_observation(run, ordinal: int, before: str, after: str):
    return {
        "kind": "guided_geometry_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": "forward",
            "operationId": OPERATION_IDS[ordinal - 1],
            "operationOrdinal": ordinal,
            "mutating": 2 <= ordinal <= 10,
            "receiptId": run.leaf_receipt_id,
            "runId": run.run_id,
            "stepId": run.step_id,
            "actionName": run.action_name,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(range(1, ordinal + 1)),
                "preconditionsValidated": ordinal == 1,
                "completeGraph": ordinal == len(run.operation_ids),
            },
        },
    }


def passed_pose_observation(run, ordinal: int, before: str, after: str):
    return {
        "kind": "guided_pose_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": "forward",
            "operationId": POSE_OPERATION_IDS[ordinal - 1],
            "operationOrdinal": ordinal,
            "mutating": ordinal in {4, 5, 7, 9, 11},
            "receiptId": run.leaf_receipt_id,
            "runId": run.run_id,
            "stepId": run.step_id,
            "actionName": run.action_name,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(range(1, ordinal + 1)),
                "preconditionsValidated": ordinal == 1,
                "completeAnimation": ordinal == len(run.operation_ids),
            },
        },
    }


def passed_armature_observation(run, ordinal: int, before: str, after: str):
    return {
        "kind": "guided_armature_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": "forward",
            "operationId": ARMATURE_OPERATION_IDS[ordinal - 1],
            "operationOrdinal": ordinal,
            "mutating": ordinal in {2, 3, 4, 6, 8},
            "receiptId": run.leaf_receipt_id,
            "runId": run.run_id,
            "stepId": run.step_id,
            "actionName": run.action_name,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(range(1, ordinal + 1)),
                "preconditionsValidated": ordinal == 1,
                "completeArmature": ordinal == len(run.operation_ids),
            },
        },
    }


def passed_skin_weights_observation(run, ordinal: int, before: str, after: str):
    return {
        "kind": "guided_skin_weights_operation",
        "satisfied": True,
        "details": {
            "status": "passed",
            "direction": "forward",
            "operationId": SKIN_WEIGHTS_OPERATION_IDS[ordinal - 1],
            "operationOrdinal": ordinal,
            "mutating": ordinal in {5, 7, 8},
            "receiptId": run.leaf_receipt_id,
            "runId": run.run_id,
            "stepId": run.step_id,
            "actionName": run.action_name,
            "recipeId": run.recipe_id,
            "catalogVersion": run.catalog_version,
            "beforeFingerprintSha256": before,
            "afterFingerprintSha256": after,
            "evidence": {
                "completedOperations": list(range(1, ordinal + 1)),
                "preconditionsValidated": ordinal == 1,
                "completeSkinWeights": ordinal == len(run.operation_ids),
            },
        },
    }


class LeafOperationSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rollback_calls: list[ActionReceipt] = []
        self.step = self._step("geometry-step", 0)
        self.other_step = self._step("other-step", 1)
        self.session = self._session((self.step, self.other_step))
        self.session.start()

    @staticmethod
    def _step(
        step_id: str,
        order: int,
        *,
        observation_policy: ObservationPolicySpec | None = None,
    ) -> TaskNode:
        return TaskNode(
            id=step_id,
            number=f"1.{order + 1}",
            title=step_id,
            order=order,
            action=ActionSpec("test", "blender.geometry_nodes.create_transform", {}),
            expected_observations=(
                ({"kind": "geometry_nodes_ready", "parameters": {}},)
                if observation_policy is not None
                else ()
            ),
            observation_policy=observation_policy,
        )

    def _session(
        self,
        steps: tuple[TaskNode, ...],
        *,
        evaluator=None,
    ) -> DemoSession:
        root = TaskNode(
            id="root",
            number="1",
            title="Root",
            order=0,
            children=steps,
        )

        def execute(_receipts):
            step = steps[0]
            return ActionReceipt("atomic-receipt", step.id, step.action.name)

        def rollback(receipt):
            self.rollback_calls.append(receipt)

        return DemoSession(
            root,
            {step.id: (execute, rollback) for step in steps},
            observation_evaluator=evaluator,
        )

    def _begin(self):
        return self.session.begin_leaf_operation_run(
            self.step,
            recipe_id="geometry-nodes-transform",
            catalog_version="1.0.0",
            operation_ids=OPERATION_IDS,
        )

    @staticmethod
    def _partial(run, step) -> ActionReceipt:
        return ActionReceipt(run.leaf_receipt_id, step.id, step.action.name)

    def _record(self, run, ordinal: int, partial: ActionReceipt | None):
        before = f"{ordinal - 1:064x}"
        after = f"{ordinal:064x}"
        return self.session.record_leaf_operation(
            self.step,
            run_id=run.run_id,
            operation_id=OPERATION_IDS[ordinal - 1],
            ordinal=ordinal,
            before_sha256=before,
            after_sha256=after,
            observation=passed_observation(run, ordinal, before, after),
            partial_action_receipt=partial,
        )

    def _record_all(self):
        run = self._begin()
        run = self._record(run, 1, None)
        partial = self._partial(run, self.step)
        for ordinal in range(2, len(OPERATION_IDS) + 1):
            run = self._record(run, ordinal, partial)
        return run, partial

    def test_begin_is_idempotent_only_for_the_same_catalog_binding(self) -> None:
        run = self._begin()

        repeated = self._begin()

        self.assertIs(repeated, run)
        with self.assertRaisesRegex(ValueError, "binding changed"):
            self.session.begin_leaf_operation_run(
                self.step,
                recipe_id="geometry-nodes-transform",
                catalog_version="1.0.1",
                operation_ids=OPERATION_IDS,
            )

    def test_only_one_leaf_operation_run_can_be_pending(self) -> None:
        self._begin()
        self.session.active_index = 0

        with self.assertRaisesRegex(ValueError, "Another leaf operation transaction"):
            self.session.begin_leaf_operation_run(
                self.other_step,
                recipe_id="other-recipe",
                catalog_version="1.0.0",
                operation_ids=("other-01",),
            )

    def test_navigation_operation_records_no_partial_action_receipt(self) -> None:
        run = self._begin()

        updated = self._record(run, 1, None)

        self.assertIsNone(updated.partial_action_receipt)
        self.assertEqual(updated.next_ordinal, 2)
        self.assertEqual(updated.operation_receipts[0].operation_id, OPERATION_IDS[0])

    def test_navigation_operation_rejects_a_scene_receipt(self) -> None:
        run = self._begin()

        with self.assertRaisesRegex(ValueError, "navigation precondition"):
            self._record(run, 1, self._partial(run, self.step))

    def test_operation_order_fails_closed_before_recording_evidence(self) -> None:
        run = self._begin()

        with self.assertRaisesRegex(ValueError, "catalog order"):
            self._record(run, 2, self._partial(run, self.step))

        self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_operation_id_must_match_its_catalog_ordinal(self) -> None:
        run = self._begin()

        with self.assertRaisesRegex(ValueError, "does not match its ordinal"):
            self.session.record_leaf_operation(
                self.step,
                run_id=run.run_id,
                operation_id=OPERATION_IDS[1],
                ordinal=1,
                before_sha256="0" * 64,
                after_sha256="1" * 64,
                observation=passed_observation(run, 1, "0" * 64, "1" * 64),
                partial_action_receipt=None,
            )

    def test_stale_run_id_fails_closed(self) -> None:
        run = self._begin()

        with self.assertRaisesRegex(ValueError, "unavailable or stale"):
            self.session.record_leaf_operation(
                self.step,
                run_id="stale-run",
                operation_id=OPERATION_IDS[0],
                ordinal=1,
                before_sha256="0" * 64,
                after_sha256="1" * 64,
                observation=passed_observation(run, 1, "0" * 64, "1" * 64),
                partial_action_receipt=None,
            )

        self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_operation_observation_must_match_the_exact_receipt_transition(self) -> None:
        run = self._begin()
        before = "0" * 64
        after = "1" * 64
        valid = passed_observation(run, 1, before, after)
        mismatches = {
            "status": "failed",
            "direction": "inverse",
            "operationId": OPERATION_IDS[1],
            "operationOrdinal": 2,
            "mutating": True,
            "receiptId": "wrong-receipt",
            "runId": "wrong-run",
            "stepId": "wrong-step",
            "actionName": "wrong-action",
            "recipeId": "wrong-recipe",
            "catalogVersion": "9.9.9",
            "beforeFingerprintSha256": "a" * 64,
            "afterFingerprintSha256": "b" * 64,
        }

        for field, value in mismatches.items():
            with self.subTest(field=field):
                observation = {
                    **valid,
                    "details": {**valid["details"], field: value},
                }
                with self.assertRaisesRegex(ValueError, "does not match its receipt"):
                    self.session.record_leaf_operation(
                        self.step,
                        run_id=run.run_id,
                        operation_id=OPERATION_IDS[0],
                        ordinal=1,
                        before_sha256=before,
                        after_sha256=after,
                        observation=observation,
                        partial_action_receipt=None,
                    )
                self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_operation_observation_rejects_self_asserted_schema_and_evidence(self) -> None:
        run = self._begin()
        before = "0" * 64
        after = "1" * 64
        valid = passed_observation(run, 1, before, after)
        for label, observation in (
            ("kind", {**valid, "kind": "leaf_operation_ready"}),
            (
                "extra detail",
                {**valid, "details": {**valid["details"], "trusted": True}},
            ),
            (
                "evidence",
                {
                    **valid,
                    "details": {
                        **valid["details"],
                        "evidence": {
                            **valid["details"]["evidence"],
                            "completedOperations": [],
                        },
                    },
                },
            ),
        ):
            with self.subTest(label=label):
                with self.assertRaisesRegex(ValueError, "observation"):
                    self.session.record_leaf_operation(
                        self.step,
                        run_id=run.run_id,
                        operation_id=OPERATION_IDS[0],
                        ordinal=1,
                        before_sha256=before,
                        after_sha256=after,
                        observation=observation,
                        partial_action_receipt=None,
                    )
                self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_session_binds_executor_observation_to_the_current_run(self) -> None:
        run = self._begin()
        observation = passed_observation(run, 1, "0" * 64, "1" * 64)
        for key in ("runId", "recipeId", "catalogVersion"):
            del observation["details"][key]

        recorded = self.session.record_leaf_operation(
            self.step,
            run_id=run.run_id,
            operation_id=OPERATION_IDS[0],
            ordinal=1,
            before_sha256="0" * 64,
            after_sha256="1" * 64,
            observation=observation,
            partial_action_receipt=None,
        )

        details = recorded.operation_receipts[0].observation["details"]
        self.assertEqual(details["runId"], run.run_id)
        self.assertEqual(details["recipeId"], run.recipe_id)
        self.assertEqual(details["catalogVersion"], run.catalog_version)

    def test_mutating_operations_require_the_transaction_receipt_identity(self) -> None:
        run = self._record(self._begin(), 1, None)
        wrong = ActionReceipt("wrong-receipt", self.step.id, self.step.action.name)

        with self.assertRaisesRegex(ValueError, "does not match the transaction"):
            self._record(run, 2, wrong)

        partial = self._partial(run, self.step)
        updated = self._record(run, 2, partial)
        self.assertIs(updated.partial_action_receipt, partial)

    def test_pose_animation_keeps_the_first_three_operations_receipt_free(self) -> None:
        pose_step = TaskNode(
            id="pose-step",
            number="1.1",
            title="Pose",
            order=0,
            action=ActionSpec(
                "test", "blender.animation.create_pose_keyframes", {}
            ),
        )
        pose_session = self._session((pose_step,))
        pose_session.start()
        run = pose_session.begin_leaf_operation_run(
            pose_step,
            recipe_id="blender.animation.create_pose_keyframes.semantic",
            catalog_version="1.56.0",
            operation_ids=POSE_OPERATION_IDS,
        )
        fingerprint = "0" * 64
        for ordinal in (1, 2, 3):
            run = pose_session.record_leaf_operation(
                pose_step,
                run_id=run.run_id,
                operation_id=POSE_OPERATION_IDS[ordinal - 1],
                ordinal=ordinal,
                before_sha256=fingerprint,
                after_sha256=fingerprint,
                observation=passed_pose_observation(
                    run, ordinal, fingerprint, fingerprint
                ),
                partial_action_receipt=None,
            )
            self.assertIsNone(run.partial_action_receipt)

        mutated = "4" * 64
        partial = ActionReceipt(
            run.leaf_receipt_id, pose_step.id, pose_step.action.name
        )
        run = pose_session.record_leaf_operation(
            pose_step,
            run_id=run.run_id,
            operation_id=POSE_OPERATION_IDS[3],
            ordinal=4,
            before_sha256=fingerprint,
            after_sha256=mutated,
            observation=passed_pose_observation(run, 4, fingerprint, mutated),
            partial_action_receipt=partial,
        )
        self.assertIs(run.partial_action_receipt, partial)

        rewound = pose_session.rewind_leaf_operation(
            pose_step,
            run_id=run.run_id,
            operation_id=POSE_OPERATION_IDS[3],
            ordinal=4,
            partial_action_receipt=None,
        )
        self.assertIsNotNone(rewound)
        self.assertEqual(rewound.next_ordinal, 4)
        self.assertIsNone(rewound.partial_action_receipt)

    def test_armature_requires_its_receipt_starting_at_operation_two(self) -> None:
        armature_step = TaskNode(
            id="armature-step",
            number="1.1",
            title="Armature",
            order=0,
            action=ActionSpec("test", "blender.rig.create_armature", {}),
        )
        armature_session = self._session((armature_step,))
        armature_session.start()
        run = armature_session.begin_leaf_operation_run(
            armature_step,
            recipe_id="blender.rig.create_armature.semantic",
            catalog_version="1.57.0",
            operation_ids=ARMATURE_OPERATION_IDS,
        )
        before = "0" * 64
        run = armature_session.record_leaf_operation(
            armature_step,
            run_id=run.run_id,
            operation_id=ARMATURE_OPERATION_IDS[0],
            ordinal=1,
            before_sha256=before,
            after_sha256=before,
            observation=passed_armature_observation(run, 1, before, before),
            partial_action_receipt=None,
        )
        self.assertIsNone(run.partial_action_receipt)

        after = "2" * 64
        partial = ActionReceipt(
            run.leaf_receipt_id,
            armature_step.id,
            armature_step.action.name,
        )
        run = armature_session.record_leaf_operation(
            armature_step,
            run_id=run.run_id,
            operation_id=ARMATURE_OPERATION_IDS[1],
            ordinal=2,
            before_sha256=before,
            after_sha256=after,
            observation=passed_armature_observation(run, 2, before, after),
            partial_action_receipt=partial,
        )
        self.assertIs(run.partial_action_receipt, partial)

    def test_skin_weights_requires_its_receipt_starting_at_operation_five(self) -> None:
        skin_step = TaskNode(
            id="skin-step",
            number="1.1",
            title="Skin Weights",
            order=0,
            action=ActionSpec("test", "blender.rig.bind_skin_weights", {}),
        )
        skin_session = self._session((skin_step,))
        skin_session.start()
        run = skin_session.begin_leaf_operation_run(
            skin_step,
            recipe_id="blender.rig.bind_skin_weights.semantic",
            catalog_version="1.58.0",
            operation_ids=SKIN_WEIGHTS_OPERATION_IDS,
        )
        fingerprint = "0" * 64
        for ordinal in range(1, 5):
            run = skin_session.record_leaf_operation(
                skin_step,
                run_id=run.run_id,
                operation_id=SKIN_WEIGHTS_OPERATION_IDS[ordinal - 1],
                ordinal=ordinal,
                before_sha256=fingerprint,
                after_sha256=fingerprint,
                observation=passed_skin_weights_observation(
                    run, ordinal, fingerprint, fingerprint
                ),
                partial_action_receipt=None,
            )
            self.assertIsNone(run.partial_action_receipt)

        after = "5" * 64
        partial = ActionReceipt(
            run.leaf_receipt_id,
            skin_step.id,
            skin_step.action.name,
        )
        run = skin_session.record_leaf_operation(
            skin_step,
            run_id=run.run_id,
            operation_id=SKIN_WEIGHTS_OPERATION_IDS[4],
            ordinal=5,
            before_sha256=fingerprint,
            after_sha256=after,
            observation=passed_skin_weights_observation(run, 5, fingerprint, after),
            partial_action_receipt=partial,
        )
        self.assertIs(run.partial_action_receipt, partial)

    def test_rewind_rejects_any_operation_except_the_latest(self) -> None:
        run = self._record(self._begin(), 1, None)
        partial = self._partial(run, self.step)
        run = self._record(run, 2, partial)
        run = self._record(run, 3, partial)

        with self.assertRaisesRegex(ValueError, "Only the latest"):
            self.session.rewind_leaf_operation(
                self.step,
                run_id=run.run_id,
                operation_id=OPERATION_IDS[1],
                ordinal=2,
                partial_action_receipt=None,
            )

        self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_rewind_updates_the_cursor_and_partial_receipt_in_lifo_order(self) -> None:
        run = self._record(self._begin(), 1, None)
        partial = self._partial(run, self.step)
        run = self._record(run, 2, partial)
        run = self._record(run, 3, partial)

        rewound = self.session.rewind_leaf_operation(
            self.step,
            run_id=run.run_id,
            operation_id=OPERATION_IDS[2],
            ordinal=3,
            partial_action_receipt=partial,
        )

        self.assertIsNotNone(rewound)
        self.assertEqual(rewound.next_ordinal, 3)
        self.assertEqual(len(rewound.operation_receipts), 2)
        self.assertIs(rewound.partial_action_receipt, partial)

    def test_snapshot_restore_recovers_the_pending_operation_cursor(self) -> None:
        run = self._record(self._begin(), 1, None)
        checkpoint = self.session.snapshot_state()
        partial = self._partial(run, self.step)
        self._record(run, 2, partial)

        self.session.restore_state(checkpoint)

        restored = self.session.pending_leaf_operation_run
        self.assertIsNotNone(restored)
        self.assertEqual(restored.next_ordinal, 2)
        self.assertEqual(len(restored.operation_receipts), 1)
        self.assertIsNone(restored.partial_action_receipt)

    def test_trusted_replay_rebases_only_fingerprints_evidence_and_partial_identity(self) -> None:
        run = self._record(self._begin(), 1, None)
        partial = self._partial(run, self.step)
        run = self._record(run, 2, partial)
        run = self._record(run, 3, partial)
        checkpoint = self.session.snapshot_state()
        replayed_receipts = []
        previous = run.operation_receipts[0].before_sha256
        for receipt in run.operation_receipts:
            after = f"{receipt.ordinal + 20:064x}"
            replayed_receipts.append(
                replace(
                    receipt,
                    before_sha256=previous,
                    after_sha256=after,
                    observation=passed_observation(
                        run,
                        receipt.ordinal,
                        previous,
                        after,
                    ),
                )
            )
            previous = after
        replayed = replace(
            run,
            operation_receipts=tuple(replayed_receipts),
            partial_action_receipt=ActionReceipt(
                partial.receipt_id,
                partial.step_id,
                partial.action_name,
            ),
        )

        rebased = self.session.rebase_leaf_operation_replay(
            checkpoint,
            step_id=self.step.id,
            original_run=run,
            replayed_run=replayed,
        )
        self.session.restore_state(rebased)

        restored = self.session.pending_leaf_operation_run
        self.assertIsNotNone(restored)
        self.assertEqual(restored.operation_receipts, tuple(replayed_receipts))
        self.assertEqual(restored.run_id, run.run_id)
        self.assertEqual(restored.binding_sha256, run.binding_sha256)

    def test_trusted_replay_rejects_run_or_logical_effect_changes(self) -> None:
        run = self._record(self._begin(), 1, None)
        partial = self._partial(run, self.step)
        run = self._record(run, 2, partial)
        checkpoint = self.session.snapshot_state()

        for label, replayed in (
            ("run", replace(run, run_id="forged-run")),
            (
                "effects",
                replace(
                    run,
                    partial_action_receipt=replace(partial, anchor="forged-anchor"),
                ),
            ),
        ):
            with self.subTest(label=label):
                with self.assertRaisesRegex(ValueError, "Trusted leaf replay"):
                    self.session.rebase_leaf_operation_replay(
                        checkpoint,
                        step_id=self.step.id,
                        original_run=run,
                        replayed_run=replayed,
                    )

    def test_snapshot_restore_rejects_forged_leaf_run_identity(self) -> None:
        run = self._record(self._begin(), 1, None)
        checkpoint = self.session.snapshot_state()

        for label, forged in (
            ("binding", replace(run, binding_sha256="f" * 64)),
            ("status", replace(run, status="forged")),
            (
                "receipt identity",
                replace(
                    run,
                    operation_receipts=(
                        replace(run.operation_receipts[0], step_id="wrong-step"),
                    ),
                ),
            ),
        ):
            with self.subTest(label=label):
                forged_checkpoint = replace(
                    checkpoint,
                    leaf_operation_runs=((self.step.id, forged),),
                )
                with self.assertRaises(ValueError):
                    self.session.restore_state(forged_checkpoint)
                self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_restore_override_rejects_a_fully_self_consistent_forged_run(self) -> None:
        run = self._record(self._begin(), 1, None)
        checkpoint = self.session.snapshot_state()
        forged_run_id = "forged-run"
        forged_receipt_id = "forged-receipt"
        forged_observation = passed_observation(
            replace(
                run,
                run_id=forged_run_id,
                leaf_receipt_id=forged_receipt_id,
            ),
            1,
            "0" * 64,
            f"{1:064x}",
        )
        forged_receipt = replace(
            run.operation_receipts[0],
            run_id=forged_run_id,
            observation=forged_observation,
        )
        forged = replace(
            run,
            run_id=forged_run_id,
            leaf_receipt_id=forged_receipt_id,
            operation_receipts=(forged_receipt,),
        )

        with self.assertRaisesRegex(ValueError, "logical checkpoint state"):
            self.session.restore_state(
                checkpoint,
                leaf_operation_runs={self.step.id: forged},
            )

        self.assertEqual(self.session.pending_leaf_operation_run, run)

    def test_snapshot_observation_isolated_and_restore_rejects_tampered_override(self) -> None:
        run = self._record(self._begin(), 1, None)
        checkpoint = self.session.snapshot_state()
        snapshot_run = dict(checkpoint.leaf_operation_runs)[self.step.id]
        snapshot_run.operation_receipts[0].observation["details"]["status"] = "tampered"

        self.assertEqual(
            self.session.pending_leaf_operation_run.operation_receipts[0]
            .observation["details"]["status"],
            "passed",
        )
        with self.assertRaisesRegex(ValueError, "observation"):
            self.session.restore_state(checkpoint)

    def test_snapshot_restore_rejects_completed_leaf_with_wrong_formal_receipt(self) -> None:
        run, _partial = self._record_all()
        self.session.complete_leaf_operation_run(self.step, run_id=run.run_id)
        checkpoint = self.session.snapshot_state()
        wrong = ActionReceipt("wrong-receipt", self.step.id, self.step.action.name)

        with self.assertRaisesRegex(ValueError, "invalid formal receipt"):
            self.session.restore_state(
                checkpoint,
                receipts={self.step.id: wrong},
            )

    def test_pending_run_blocks_atomic_next_and_global_back(self) -> None:
        self._begin()

        with self.assertRaisesRegex(ValueError, "before atomic Next"):
            self.session.next()
        with self.assertRaisesRegex(ValueError, "Operation Back or Abort"):
            self.session.back()

        self.assertEqual(self.session.active_index, -1)

    def test_abort_uses_the_action_rollback_for_the_partial_receipt(self) -> None:
        run = self._record(self._begin(), 1, None)
        partial = self._partial(run, self.step)
        self._record(run, 2, partial)

        aborted = self.session.abort_leaf_operation_run()

        self.assertIs(aborted, self.step)
        self.assertEqual(self.rollback_calls, [partial])
        self.assertIsNone(self.session.pending_leaf_operation_run)

    def test_final_operation_promotes_one_formal_receipt_and_advances_progress(self) -> None:
        run, partial = self._record_all()

        completed = self.session.complete_leaf_operation_run(
            self.step,
            run_id=run.run_id,
        )

        self.assertEqual(completed.status, "completed")
        self.assertIsNone(completed.partial_action_receipt)
        self.assertIs(self.session.receipts[self.step.id], partial)
        self.assertEqual(self.session.active_index, 0)
        self.assertIsNone(self.session.pending_leaf_operation_run)

    def test_global_back_removes_a_completed_leaf_operation_run(self) -> None:
        run, _partial = self._record_all()
        self.session.complete_leaf_operation_run(self.step, run_id=run.run_id)

        backed = self.session.back()

        self.assertIs(backed, self.step)
        self.assertNotIn(self.step.id, self.session.receipts)
        self.assertNotIn(self.step.id, self.session.leaf_operation_runs)
        self.assertEqual(self.session.active_index, -1)

    def test_failed_success_gate_rolls_back_the_partial_receipt(self) -> None:
        policy = ObservationPolicySpec("success_gate", "rollback_step")
        gated_step = self._step("gated-step", 0, observation_policy=policy)
        session = self._session(
            (gated_step,),
            evaluator=lambda _expectations, _receipts: [
                {
                    "kind": "geometry_nodes_ready",
                    "satisfied": False,
                    "details": {},
                }
            ],
        )
        session.start()
        run = session.begin_leaf_operation_run(
            gated_step,
            recipe_id="geometry-nodes-transform",
            catalog_version="1.0.0",
            operation_ids=OPERATION_IDS,
        )
        run = session.record_leaf_operation(
            gated_step,
            run_id=run.run_id,
            operation_id=OPERATION_IDS[0],
            ordinal=1,
            before_sha256="0" * 64,
            after_sha256=f"{1:064x}",
            observation=passed_observation(run, 1, "0" * 64, f"{1:064x}"),
            partial_action_receipt=None,
        )
        partial = self._partial(run, gated_step)
        for ordinal in range(2, len(OPERATION_IDS) + 1):
            run = session.record_leaf_operation(
                gated_step,
                run_id=run.run_id,
                operation_id=OPERATION_IDS[ordinal - 1],
                ordinal=ordinal,
                before_sha256=f"{ordinal - 1:064x}",
                after_sha256=f"{ordinal:064x}",
                observation=passed_observation(
                    run,
                    ordinal,
                    f"{ordinal - 1:064x}",
                    f"{ordinal:064x}",
                ),
                partial_action_receipt=partial,
            )

        with self.assertRaises(ObservationGateError) as caught:
            session.complete_leaf_operation_run(gated_step, run_id=run.run_id)

        self.assertEqual(caught.exception.gate.status, "failed_rolled_back")
        self.assertEqual(self.rollback_calls, [partial])
        self.assertEqual(session.active_index, -1)
        self.assertEqual(session.receipts, {})
        self.assertEqual(session.leaf_operation_runs, {})


if __name__ == "__main__":
    unittest.main()
