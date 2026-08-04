"""Pure Python tests for deterministic Blender guidance state."""

from importlib import import_module
import sys
import unittest
import uuid
from pathlib import Path
from types import ModuleType, SimpleNamespace


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_guidance_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

application = import_module(f"{PACKAGE_NAME}.application")
domain = import_module(f"{PACKAGE_NAME}.domain")
visual_theme = import_module(f"{PACKAGE_NAME}.visual_theme")
GuidanceState = application.GuidanceState
DemoSession = application.DemoSession
RevisionLineage = application.RevisionLineage
lineage_from_proposal = application.lineage_from_proposal
new_revision_thread = application.new_revision_thread
node_state = application.node_state
relevant_steps = application.relevant_steps
step_state = application.step_state
validate_plan_diff = application.validate_plan_diff
ActionSpec = domain.ActionSpec
TaskNode = domain.TaskNode
STATE_COLORS = visual_theme.STATE_COLORS
STATE_SYMBOLS = visual_theme.STATE_SYMBOLS


def action_node(node_id: str, number: str, order: int) -> TaskNode:
    return TaskNode(
        id=node_id,
        number=number,
        title=node_id,
        order=order,
        action=ActionSpec("test", f"run_{node_id}", {}),
    )


class GuidanceStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.steps = tuple(
            action_node(f"step-{index}", f"1.{index + 1}", index)
            for index in range(6)
        )
        self.session = SimpleNamespace(steps=self.steps, active_index=-1)

    def test_initial_state_has_only_a_next_step(self) -> None:
        self.assertEqual(step_state(self.session, 0), GuidanceState.NEXT)
        self.assertEqual(step_state(self.session, 1), GuidanceState.LOCKED)
        self.assertEqual(
            tuple((item.index, item.state) for item in relevant_steps(self.session)),
            ((0, GuidanceState.NEXT),),
        )

    def test_active_step_is_back_and_window_preserves_execution_order(self) -> None:
        self.session.active_index = 3

        self.assertEqual(step_state(self.session, self.steps[2]), GuidanceState.COMPLETED)
        self.assertEqual(step_state(self.session, self.steps[3]), GuidanceState.BACK)
        self.assertEqual(step_state(self.session, self.steps[4]), GuidanceState.NEXT)
        self.assertEqual(step_state(self.session, self.steps[5]), GuidanceState.LOCKED)
        self.assertEqual(
            tuple((item.index, item.state) for item in relevant_steps(self.session)),
            (
                (1, GuidanceState.COMPLETED),
                (2, GuidanceState.COMPLETED),
                (3, GuidanceState.BACK),
                (4, GuidanceState.NEXT),
            ),
        )

    def test_completed_plan_keeps_latest_completed_steps_and_back_target(self) -> None:
        self.session.active_index = len(self.steps) - 1

        self.assertEqual(
            tuple((item.index, item.state) for item in relevant_steps(self.session)),
            (
                (2, GuidanceState.COMPLETED),
                (3, GuidanceState.COMPLETED),
                (4, GuidanceState.COMPLETED),
                (5, GuidanceState.BACK),
            ),
        )

    def test_group_state_tracks_back_next_completed_and_locked_descendants(self) -> None:
        first_group = TaskNode(
            id="first-group",
            number="1.1",
            title="First",
            order=0,
            children=self.steps[:3],
        )
        second_group = TaskNode(
            id="second-group",
            number="1.2",
            title="Second",
            order=1,
            children=self.steps[3:],
        )
        root = TaskNode(
            id="root",
            number="1",
            title="Root",
            order=0,
            children=(first_group, second_group),
        )

        self.assertEqual(node_state(self.session, root), GuidanceState.NEXT)
        self.assertEqual(node_state(self.session, second_group), GuidanceState.LOCKED)

        self.session.active_index = 2
        self.assertEqual(node_state(self.session, first_group), GuidanceState.BACK)
        self.assertEqual(node_state(self.session, second_group), GuidanceState.NEXT)
        self.assertEqual(node_state(self.session, root), GuidanceState.BACK)

        self.session.active_index = 3
        self.assertEqual(node_state(self.session, first_group), GuidanceState.COMPLETED)
        self.assertEqual(node_state(self.session, second_group), GuidanceState.BACK)

    def test_invalid_session_indices_and_limits_fail_loudly(self) -> None:
        self.session.active_index = len(self.steps)
        with self.assertRaisesRegex(ValueError, "active_index"):
            relevant_steps(self.session)

        self.session.active_index = -1
        with self.assertRaisesRegex(ValueError, "positive"):
            relevant_steps(self.session, limit=0)
        with self.assertRaisesRegex(ValueError, "not part"):
            step_state(self.session, len(self.steps))

    def test_every_state_has_a_distinct_color_and_text_symbol(self) -> None:
        self.assertEqual(set(STATE_COLORS), set(GuidanceState))
        self.assertEqual(set(STATE_SYMBOLS), set(GuidanceState))
        self.assertEqual(len(set(STATE_COLORS.values())), len(GuidanceState))
        self.assertEqual(len(set(STATE_SYMBOLS.values())), len(GuidanceState))
        self.assertEqual(STATE_SYMBOLS[GuidanceState.BACK], "BACK")
        self.assertEqual(STATE_SYMBOLS[GuidanceState.NEXT], "NEXT")

    def test_session_indexes_stable_nodes_and_isolates_source_plan_copies(self) -> None:
        root = TaskNode(
            id="root",
            number="1",
            title="Root",
            order=0,
            children=(self.steps[0],),
        )
        source_plan = {
            "id": "revision-base",
            "revision": 7,
            "steps": [{"id": "root"}, {"id": self.steps[0].id}],
        }
        session = DemoSession(
            root,
            {},
            plan_id="revision-base",
            revision=7,
            source_plan=source_plan,
        )

        self.assertIs(session.find_node(self.steps[0].id), self.steps[0])
        first_copy = session.source_plan_copy()
        first_copy["revision"] = 99
        self.assertEqual(session.source_plan_copy()["revision"], 7)
        with self.assertRaisesRegex(ValueError, "identity"):
            DemoSession(
                root,
                {},
                plan_id="revision-base",
                revision=8,
                source_plan=source_plan,
            )

    def test_revision_lineage_advances_without_reusing_request_identity(self) -> None:
        first_request_id = str(uuid.uuid4())
        first_thread = new_revision_thread(first_request_id, None)
        self.assertEqual(
            first_thread,
            {
                "threadId": first_request_id,
                "turn": 1,
                "parentRequestId": None,
            },
        )
        lineage = lineage_from_proposal(
            {
                "revisionRequestId": first_request_id,
                "revisionThread": first_thread,
            }
        )
        self.assertEqual(
            lineage,
            RevisionLineage(first_request_id, 1, first_request_id),
        )
        second_request_id = str(uuid.uuid4())
        self.assertEqual(
            new_revision_thread(second_request_id, lineage),
            {
                "threadId": first_request_id,
                "turn": 2,
                "parentRequestId": first_request_id,
            },
        )

    def test_plan_diff_validation_preserves_exact_parameter_values(self) -> None:
        plan = {"id": "snowman", "revision": 2}
        diff = {
            "basePlan": {"id": "snowman", "revision": 1},
            "targetPlan": plan,
            "summary": {
                "planFields": 0,
                "addedSteps": 0,
                "removedSteps": 0,
                "updatedSteps": 1,
                "movedSteps": 0,
            },
            "planChanges": [],
            "stepChanges": [
                {
                    "kind": "updated",
                    "stepId": "snowman.model.head",
                    "before": {
                        "stepId": "snowman.model.head",
                        "nodeNumber": "1.2.3",
                        "parentId": "snowman.model",
                        "order": 3,
                        "title": "Create the head",
                    },
                    "after": {
                        "stepId": "snowman.model.head",
                        "nodeNumber": "1.2.3",
                        "parentId": "snowman.model",
                        "order": 3,
                        "title": "Create the larger head",
                    },
                    "changes": [
                        {
                            "field": "action",
                            "before": {"arguments": {"radius": 0.85}},
                            "after": {"arguments": {"radius": 0.93}},
                        }
                    ],
                }
            ],
        }
        validated = validate_plan_diff(diff, plan)
        self.assertEqual(
            validated["stepChanges"][0]["changes"][0]["after"]["arguments"][
                "radius"
            ],
            0.93,
        )
        invalid = {**diff, "summary": {**diff["summary"], "updatedSteps": 0}}
        with self.assertRaisesRegex(ValueError, "summary is inconsistent"):
            validate_plan_diff(invalid, plan)


if __name__ == "__main__":
    unittest.main()
