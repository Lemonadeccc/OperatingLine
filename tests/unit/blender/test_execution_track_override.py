"""Focused coverage for proof-bound Guide 1.6 execution-track overrides."""

from importlib import import_module
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_execution_track_override_test"

operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

domain = import_module(f"{PACKAGE_NAME}.domain")


def execution_track_override() -> dict:
    return {
        "kind": "interaction_catalog_proof",
        "interactionCatalogVersion": "1.42.0",
        "interactionCatalogContentSha256": "a" * 64,
        "recipeId": "blender.mesh.create_uv_sphere.native",
        "modality": "menu",
        "trackId": "menu.layout.add.mesh.uv_sphere",
        "trackContentSha256": "b" * 64,
        "proofExecutionContentSha256": "c" * 64,
    }


def plan_with_override() -> dict:
    return {
        "protocolVersion": "1.6.0",
        "rootStepId": "step",
        "steps": [
            {
                "id": "step",
                "parentId": None,
                "order": 0,
                "dependsOn": [],
                "title": "Create sphere",
                "action": {
                    "adapterId": "blender",
                    "name": "blender.mesh.create_uv_sphere",
                    "arguments": {},
                },
                "anchors": [],
                "expectedObservations": [],
                "executionTrackOverride": execution_track_override(),
            }
        ],
    }


class ExecutionTrackOverrideParsingTests(unittest.TestCase):
    def test_preserves_strict_proof_binding_on_action_leaf(self) -> None:
        root = domain.load_task_tree_data(plan_with_override())

        override = root.execution_track_override
        self.assertIsNotNone(override)
        assert override is not None
        self.assertEqual(override.kind, "interaction_catalog_proof")
        self.assertEqual(override.interaction_catalog_version, "1.42.0")
        self.assertEqual(override.interaction_catalog_content_sha256, "a" * 64)
        self.assertEqual(override.recipe_id, "blender.mesh.create_uv_sphere.native")
        self.assertEqual(override.modality, "menu")
        self.assertEqual(override.track_id, "menu.layout.add.mesh.uv_sphere")
        self.assertEqual(override.track_content_sha256, "b" * 64)
        self.assertEqual(override.proof_execution_content_sha256, "c" * 64)

    def test_rejects_override_before_protocol_1_6(self) -> None:
        plan = plan_with_override()
        plan["protocolVersion"] = "1.5.0"

        with self.assertRaisesRegex(ValueError, "require guide protocol 1.6"):
            domain.load_task_tree_data(plan)

    def test_rejects_override_on_non_action_step(self) -> None:
        plan = plan_with_override()
        plan["steps"][0]["action"] = None

        with self.assertRaisesRegex(ValueError, "Only executable steps"):
            domain.load_task_tree_data(plan)

    def test_rejects_unknown_fields_and_invalid_proof_hashes(self) -> None:
        extra = plan_with_override()
        extra["steps"][0]["executionTrackOverride"]["trajectory"] = []
        invalid_hash = plan_with_override()
        invalid_hash["steps"][0]["executionTrackOverride"][
            "trackContentSha256"
        ] = "not-a-hash"

        for plan in (extra, invalid_hash):
            with self.subTest(plan=plan):
                with self.assertRaisesRegex(ValueError, "Invalid executionTrackOverride"):
                    domain.load_task_tree_data(plan)

    def test_guide_1_6_retains_bounded_retry_support(self) -> None:
        plan = plan_with_override()
        step = plan["steps"][0]
        step.pop("executionTrackOverride")
        step["expectedObservations"] = [{"kind": "test_ready", "parameters": {}}]
        step["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "rollback_step",
            "retryPolicy": {"mode": "automatic_bounded", "maxAttempts": 2},
        }

        parsed = domain.load_task_tree_data(plan)

        self.assertEqual(parsed.observation_policy.retry_mode, "automatic_bounded")
        self.assertEqual(parsed.observation_policy.max_attempts, 2)


class _Operator:
    def __init__(self) -> None:
        self.reports: list[tuple[set[str], str]] = []

    def report(self, level: set[str], message: str) -> None:
        self.reports.append((level, message))


class _Session:
    def __init__(self, step) -> None:
        self.active_index = -1
        self.steps = (step,)
        self.next_calls = 0
        self.observation_blocked = False
        self.observation_gate = None
        self.started = False
        self.active_step = None
        self.completed_steps = ()

    def next(self, _attempt: int):
        self.next_calls += 1
        raise AssertionError("override must not reach session.next")


class _Companion:
    proposed_plan = None
    shortcut_mutation_blocked = False
    connected = True
    execution_track_preflight_message = ""
    execution_track_preflight_status = None
    execution_track_preflight_request = None

    def __init__(self) -> None:
        self.reports: list[tuple[str, object, str | None]] = []

    def report(self, transition: str, *, step=None, error=None, **_kwargs) -> None:
        self.reports.append((transition, step, error))


def _load_operators(session: _Session, companion: _Companion, history_calls: list[str]):
    fake_bpy = ModuleType("bpy")
    fake_bpy.types = SimpleNamespace(Operator=object, Panel=object)
    fake_bpy.props = SimpleNamespace(
        StringProperty=lambda **_kwargs: None,
        IntProperty=lambda **_kwargs: None,
        BoolProperty=lambda **_kwargs: None,
        FloatProperty=lambda **_kwargs: None,
        EnumProperty=lambda **_kwargs: None,
        FloatVectorProperty=lambda **_kwargs: None,
    )
    sys.modules["bpy"] = fake_bpy

    application = ModuleType(f"{PACKAGE_NAME}.application")
    application.__path__ = [str(PACKAGE_ROOT / "application")]
    application.ObservationGateError = type("ObservationGateError", (Exception,), {})
    sys.modules[application.__name__] = application
    provider_handoff = ModuleType(f"{PACKAGE_NAME}.application.provider_handoff")
    provider_handoff.PROVIDER_AUTHORITY_UNAVAILABLE = "unavailable"
    sys.modules[provider_handoff.__name__] = provider_handoff

    infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")

    def prepare(*_args):
        history_calls.append("prepare")

    infrastructure.prepare_native_history = prepare
    infrastructure.cancel_native_history = lambda: history_calls.append("cancel")
    infrastructure.commit_native_history = lambda *_args: history_calls.append("commit")
    infrastructure.prepared_native_history_changed = lambda *_args: False
    infrastructure.disable_overlay = lambda *_args: None
    infrastructure.enable_overlay = lambda *_args: None
    infrastructure.overlay_enabled = lambda: False
    infrastructure.remove_factory_startup_objects = lambda *_args: False
    sys.modules[infrastructure.__name__] = infrastructure

    presentation = ModuleType(f"{PACKAGE_NAME}.presentation")
    presentation.__path__ = [str(PACKAGE_ROOT / "presentation")]
    sys.modules[presentation.__name__] = presentation
    native_guidance = ModuleType(f"{PACKAGE_NAME}.presentation.native_menu_guidance")
    for name in (
        "disable_native_menu_guidance",
        "enable_native_menu_guidance",
        "guided_menu_action_matches",
        "interaction_guidance_snapshot",
        "native_menu_snapshot",
        "refresh_native_menu_guidance",
    ):
        setattr(native_guidance, name, lambda *_args, **_kwargs: None)
    sys.modules[native_guidance.__name__] = native_guidance

    operating_line.get_session = lambda: session
    operating_line.get_companion = lambda: companion
    sys.modules.pop(f"{PACKAGE_NAME}.presentation.operators", None)
    return import_module(f"{PACKAGE_NAME}.presentation.operators")


class _Layout:
    def __init__(self) -> None:
        self.enabled = True
        self.alert = False
        self.rows: list[_Layout] = []
        self.boxes: list[_Layout] = []
        self.labels: list[str] = []

    def row(self, **_kwargs):
        child = _Layout()
        self.rows.append(child)
        return child

    def box(self):
        child = _Layout()
        self.boxes.append(child)
        return child

    def operator(self, *_args, **_kwargs):
        return SimpleNamespace()

    def label(self, *, text: str, **_kwargs) -> None:
        self.labels.append(text)


def _load_panel():
    application = sys.modules[f"{PACKAGE_NAME}.application"]
    application.GuidanceState = SimpleNamespace(BACK="back", NEXT="next")
    application.node_state = lambda *_args: None
    infrastructure = sys.modules[f"{PACKAGE_NAME}.infrastructure"]
    infrastructure.native_history_error = lambda: ""
    visual_theme = ModuleType(f"{PACKAGE_NAME}.visual_theme")
    visual_theme.STATE_ICONS = {"back": "BACK", "next": "NEXT"}
    visual_theme.STATE_SYMBOLS = {}
    sys.modules[visual_theme.__name__] = visual_theme
    revision_workspace = ModuleType(
        f"{PACKAGE_NAME}.presentation.revision_workspace"
    )
    revision_workspace.draw_revision_workspace = lambda *_args, **_kwargs: None
    revision_workspace.draw_wrapped_text = lambda *_args, **_kwargs: None
    sys.modules[revision_workspace.__name__] = revision_workspace
    sys.modules.pop(f"{PACKAGE_NAME}.presentation.panel", None)
    return import_module(f"{PACKAGE_NAME}.presentation.panel")


class ExecutionTrackOverrideOperatorTests(unittest.TestCase):
    def test_next_fails_before_history_or_session_mutation(self) -> None:
        step = domain.load_task_tree_data(plan_with_override())
        session = _Session(step)
        companion = _Companion()
        history_calls: list[str] = []
        operators = _load_operators(session, companion, history_calls)
        operator = _Operator()

        result = operators._execute_next(operator, SimpleNamespace())

        self.assertEqual(result, {"CANCELLED"})
        self.assertEqual(history_calls, [])
        self.assertEqual(session.next_calls, 0)
        self.assertEqual(
            companion.reports,
            [("error", step, "execution_track_executor_unavailable")],
        )
        self.assertEqual(
            operator.reports,
            [
                (
                    {"ERROR"},
                    "The selected menu or shortcut execution track has no available executor",
                )
            ],
        )

    def test_panel_locks_next_and_identifies_missing_executor(self) -> None:
        step = domain.load_task_tree_data(plan_with_override())
        session = _Session(step)
        companion = _Companion()
        _load_operators(session, companion, [])
        panel = _load_panel()
        layout = _Layout()

        panel._draw_walkthrough_controls(
            layout,
            session,
            companion,
            proposal_pending=False,
            history_error="",
        )
        panel._draw_guidance_status(layout, session)

        controls = layout.rows[1]
        forward = controls.rows[1]
        self.assertFalse(forward.enabled)
        self.assertIn(
            "Next 01  Locked: execution track executor unavailable",
            layout.boxes[0].labels,
        )

    def test_panel_disables_verify_while_a_preflight_is_active(self) -> None:
        step = domain.load_task_tree_data(plan_with_override())
        session = _Session(step)
        companion = _Companion()
        companion.execution_track_preflight_request = {"requestId": "active"}
        _load_operators(session, companion, [])
        panel = _load_panel()
        layout = _Layout()

        panel._draw_walkthrough_controls(
            layout,
            session,
            companion,
            proposal_pending=False,
            history_error="",
        )

        self.assertFalse(layout.rows[2].enabled)


if __name__ == "__main__":
    unittest.main()
