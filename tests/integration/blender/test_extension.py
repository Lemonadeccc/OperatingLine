"""Headless Blender integration test for the extension lifecycle."""

import importlib.util
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import sys
import threading
import time
from tempfile import TemporaryDirectory
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
import uuid

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_extension",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_extension.operating_line.infrastructure import (  # noqa: E402
    CompanionTransport,
    overlay_enabled,
    remove_factory_startup_objects,
    validate_companion_url,
)
from operating_line_extension.operating_line.infrastructure import (  # noqa: E402
    observations as observation_module,
)
from operating_line_extension.operating_line.application import (  # noqa: E402
    ActionReceipt,
    DemoSession,
)
from operating_line_extension.operating_line.presentation.operators import (  # noqa: E402
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_start,
)
from operating_line_extension.operating_line.domain import (  # noqa: E402
    RESOURCE_PATH,
    executable_steps,
    load_task_tree,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    ALLOWED_ACTIONS,
)


with RESOURCE_PATH.open(encoding="utf-8") as resource:
    FULL_PLAN = json.load(resource)
with (RESOURCE_PATH.parent / "action-catalog.json").open(encoding="utf-8") as resource:
    ACTION_CATALOG = json.load(resource)


def geometry_regression_plan(plan: dict) -> dict:
    """Derive the original three-sphere safety slice from the canonical fixture."""
    selected_ids = {
        "snowman",
        "snowman.model",
        "snowman.model.body_lower",
        "snowman.model.body_upper",
        "snowman.model.head",
    }
    derived = {
        **deepcopy(plan),
        "id": "snowman-geometry-regression",
        "title": "Snowman geometry safety regression",
        "steps": [
            deepcopy(item) for item in plan["steps"] if item["id"] in selected_ids
        ],
    }
    by_id = {item["id"]: item for item in derived["steps"]}
    by_id["snowman.model"]["order"] = 1
    by_id["snowman.model.body_lower"]["dependsOn"] = []
    return derived


BUNDLED_PLAN = geometry_regression_plan(FULL_PLAN)
ACTION_STEPS = [step for step in BUNDLED_PLAN["steps"] if step["action"] is not None]
EXPECTED = tuple(step["action"]["arguments"]["objectName"] for step in ACTION_STEPS)
PLAN_REVISION = BUNDLED_PLAN["revision"]
DYNAMIC_REVISION = PLAN_REVISION + 1
OWNER_VALUE = f"snowman_demo_v{PLAN_REVISION}"


def assert_absent(name: str) -> None:
    assert bpy.data.objects.get(name) is None, f"{name} should not exist"


def action(name: str) -> dict:
    return {"adapterId": "blender", "name": name, "arguments": {}}


def step(
    step_id: str,
    parent_id: str | None,
    order: int,
    *,
    depends_on: list[str] | None = None,
    step_action: dict | None = None,
) -> dict:
    return {
        "id": step_id,
        "parentId": parent_id,
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": step_action,
    }


def load_temporary_plan(steps: list[dict]):
    with TemporaryDirectory() as temporary_directory:
        path = Path(temporary_directory) / "plan.json"
        path.write_text(
            json.dumps({"rootStepId": "root", "steps": steps}), encoding="utf-8"
        )
        return load_task_tree(path)


def assert_plan_rejected(steps: list[dict], message: str) -> None:
    try:
        load_temporary_plan(steps)
    except ValueError as error:
        assert message in str(error), f"Expected {message!r}, received {error!r}"
    else:
        raise AssertionError(f"Plan should be rejected with {message!r}")


def assert_companion_and_plan_semantics() -> None:
    root = step("root", None, 0)
    # Display order deliberately conflicts with dependency order. Execution must
    # follow the DAG, not the hierarchy's depth-first traversal.
    dependency_first = step(
        "action.z-first",
        "root",
        20,
        step_action=action("test.z-first"),
    )
    assert validate_companion_url("http://localhost:3210/") == "http://localhost:3210"
    assert validate_companion_url("http://127.1.2.3:80/runtime/") == (
        "http://127.1.2.3:80/runtime"
    )
    assert validate_companion_url("http://[::1]:8080") == "http://[::1]:8080"
    for unsafe_url in (
        "https://127.0.0.1:3000",
        "http://example.com:3000",
        "http://127.0.0.1:3000?token=bad",
        "http://user:password@127.0.0.1:3000",
    ):
        try:
            validate_companion_url(unsafe_url)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Unsafe URL should be rejected: {unsafe_url}")
    for invalid_timing in ({"poll_interval": 0}, {"timeout": 0}):
        try:
            CompanionTransport(
                "http://127.0.0.1:43123",
                "integration-token-123456",
                str(uuid.uuid4()),
                **invalid_timing,
            )
        except ValueError:
            pass
        else:
            raise AssertionError("Transport timing values must be positive")

    dynamic_plan = deepcopy(BUNDLED_PLAN)
    dynamic_plan["id"] = "live-snowman"
    dynamic_plan["revision"] = DYNAMIC_REVISION
    dynamic_plan["title"] = "Live snowman"
    token = "integration-token-123456"
    requests: list[dict] = []
    reports: list[dict] = []
    revision_requests: list[dict] = []
    post_result = ["accepted"]
    slow_guide = [False]
    slow_guide_started = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, payload: dict) -> None:
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

        def do_GET(self):
            assert self.headers.get("Authorization") == f"Bearer {token}"
            if urlsplit(self.path).path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "http://192.0.2.1/credential-leak")
                self.end_headers()
                return
            if slow_guide[0]:
                slow_guide_started.set()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "1000000")
                self.end_headers()
                for _index in range(100):
                    try:
                        self.wfile.write(b"{")
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    time.sleep(0.05)
                return
            query = parse_qs(urlsplit(self.path).query)
            requests.append(query)
            known = query.get("knownPlanId") == ["live-snowman"] and query.get(
                "knownRevision"
            ) == [str(DYNAMIC_REVISION)]
            self._reply(
                {
                    "protocolVersion": "1.0.0",
                    "plan": None if known else dynamic_plan,
                }
            )

        def do_POST(self):
            assert self.headers.get("Authorization") == f"Bearer {token}"
            length = int(self.headers["Content-Length"])
            payload = json.loads(self.rfile.read(length))
            if urlsplit(self.path).path == "/api/v1/companion/revision-request":
                revision_requests.append(payload)
                self._reply(
                    {
                        "result": "accepted",
                        "requestId": payload["requestId"],
                    }
                )
                return
            reports.append(payload)
            self._reply({"result": post_result[0]})

        def log_message(self, _format, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    companion = operating_line.get_companion()
    main_thread_id = threading.get_ident()
    try:
        runtime_url = f"http://127.0.0.1:{server.server_port}"
        redirect_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id=BUNDLED_PLAN["id"],
            known_revision=PLAN_REVISION,
        )
        try:
            redirect_transport._request_json("GET", "/redirect")
        except HTTPError as error:
            assert error.code == 302
        else:
            raise AssertionError("Companion transport must reject HTTP redirects")
        if not getattr(bpy.app, "online_access", True):
            try:
                companion.connect(runtime_url, token)
            except ValueError as error:
                assert "online access is disabled" in str(error)
            else:
                raise AssertionError("Disabled Blender networking should block Connect")
        session = operating_line.get_session()
        transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id=session.plan_id,
            known_revision=session.revision,
        )
        companion._transport = transport
        transport.start()
        companion.report("connected")
        deadline = time.monotonic() + 4.0
        while time.monotonic() < deadline:
            companion.pump()
            if (
                operating_line.get_session().plan_id == "live-snowman"
                and any(
                    query.get("knownPlanId") == ["live-snowman"]
                    and query.get("knownRevision") == [str(DYNAMIC_REVISION)]
                    for query in requests
                )
            ):
                break
            time.sleep(0.02)
        assert operating_line.get_session().plan_id == "live-snowman"
        assert requests[0].get("knownPlanId") == [BUNDLED_PLAN["id"]]
        assert requests[0].get("knownRevision") == [str(PLAN_REVISION)]
        assert all(query["adapterId"] == ["blender"] for query in requests)
        assert all(query["instanceId"] == [companion.instance_id] for query in requests)
        assert server_thread.ident != main_thread_id

        # Ref creates a stable node citation in Blender. Send queues one full,
        # immutable base plan for an MCP planner and does not mutate the scene.
        scene_objects_before_request = {
            item.as_pointer() for item in bpy.data.objects
        }
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_revision_message == "@1.1.3 "
        bpy.context.window_manager.operating_line_revision_message += (
            "Make the head slightly rougher"
        )
        assert bpy.ops.operating_line.submit_revision_request() == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_revision_message == ""
        request_deadline = time.monotonic() + 4.0
        while time.monotonic() < request_deadline:
            companion.pump()
            if revision_requests and "stored for MCP planner" in (
                companion.revision_request_status
            ):
                break
            time.sleep(0.02)
        assert len(revision_requests) == 1
        revision_request = revision_requests[0]
        uuid.UUID(revision_request["requestId"])
        assert revision_request["protocolVersion"] == "1.0.0"
        assert revision_request["adapterId"] == "blender"
        assert revision_request["catalogVersion"] == "1.0.0"
        assert revision_request["instanceId"] == companion.instance_id
        assert revision_request["basePlan"] == dynamic_plan
        assert revision_request["references"] == [
            {"nodeId": "snowman.model.head", "nodeNumber": "1.1.3"}
        ]
        assert revision_request["message"] == (
            "@1.1.3 Make the head slightly rougher"
        )
        assert companion.last_revision_request_id == revision_request["requestId"]
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )

        # Disconnect may flush queued state, but it must retain and expose any
        # worker that is still stopping instead of claiming to be offline.
        expected_sequence = companion.last_report["sequence"]
        active_transport = transport
        disconnect_started = time.monotonic()
        companion.disconnect()
        assert time.monotonic() - disconnect_started < 0.25
        assert companion.status in {"Disconnecting", "Offline"}
        if active_transport.running:
            assert companion.status == "Disconnecting"
            assert active_transport in companion._stopping_transports
        assert active_transport.wait_stopped(2.0)
        companion.pump()
        assert companion.status == "Offline"
        assert companion._stopping_transports == []
        assert active_transport.last_delivered_sequence >= expected_sequence
        transitions = [report["transition"] for report in reports]
        assert transitions[:2] == ["connected", "plan_loaded"]
        report = reports[-1]
        assert set(report) == {
            "protocolVersion",
            "reportId",
            "sequence",
            "adapterId",
            "instanceId",
            "companionVersion",
            "hostVersion",
            "plan",
            "phase",
            "activeStepId",
            "completedStepIds",
            "transition",
            "stepId",
            "observations",
            "error",
            "occurredAt",
        }
        uuid.UUID(report["reportId"])
        assert report["plan"] == {
            "id": "live-snowman",
            "revision": DYNAMIC_REVISION,
        }
        assert report["phase"] == "ready" and report["error"] is None

        # A stale/unknown acknowledgement is an error and cannot advance the
        # delivery watermark. Once accepted, the same pending report can flush.
        post_result[0] = "stale"
        rejected_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            timeout=0.2,
        )
        rejected_transport.send_report({"sequence": 99, "transition": "connected"})
        rejected_transport.start()
        rejection_deadline = time.monotonic() + 2.0
        saw_rejection = False
        while time.monotonic() < rejection_deadline:
            while not rejected_transport.incoming.empty():
                saw_rejection |= (
                    rejected_transport.incoming.get_nowait().get("kind") == "error"
                )
            if saw_rejection:
                break
            time.sleep(0.01)
        assert saw_rejection and rejected_transport.last_delivered_sequence == 0
        post_result[0] = "accepted"
        rejected_transport.stop()
        assert rejected_transport.wait_stopped(2.0)
        assert rejected_transport.last_delivered_sequence == 99

        # A drip-fed body cannot hold Disconnect/unregister or leave a
        # process-blocking worker behind.
        slow_guide[0] = True
        slow_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            timeout=5.0,
        )
        companion._transport = slow_transport
        slow_transport.start()
        assert slow_guide_started.wait(timeout=2.0)
        stop_started = time.monotonic()
        companion.disconnect(flush_timeout=0.0, wait_timeout=0.0)
        assert time.monotonic() - stop_started < 0.25
        if slow_transport.running:
            assert companion.status == "Disconnecting"
            assert slow_transport in companion._stopping_transports
        assert slow_transport.wait_stopped(2.0)
        companion.pump()
        assert not slow_transport.running
        assert companion.status == "Offline"
        assert companion._stopping_transports == []
        slow_guide[0] = False

        # First malformed deliveries must report once, while idempotent known
        # deliveries do not create false plan_loaded transitions. Recovery
        # clears stale connection-error UI state on the main thread.
        probe_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
        )
        companion._transport = probe_transport
        before_malformed = companion.last_report["sequence"]
        probe_transport.incoming.put(
            {"kind": "plan", "plan": {"protocolVersion": "1.0.0"}}
        )
        companion.pump()
        assert companion.last_report["sequence"] == before_malformed + 1
        assert companion.last_report["transition"] == "error"
        malformed_sequence = companion.last_report["sequence"]
        probe_transport.incoming.put(
            {"kind": "plan", "plan": {"protocolVersion": "1.0.0"}}
        )
        companion.pump()
        assert companion.last_report["sequence"] == malformed_sequence

        known_plan = deepcopy(dynamic_plan)
        companion.install_plan(known_plan)
        assert companion.last_report["sequence"] == malformed_sequence
        probe_transport.incoming.put({"kind": "error", "message": "temporary outage"})
        companion.pump()
        assert companion.status == "Connection error"
        probe_transport.incoming.put({"kind": "recovered"})
        companion.pump()
        assert companion.error == ""
        assert companion.status == f"Plan live-snowman r{DYNAMIC_REVISION}"
        companion._transport = None
    finally:
        companion.disconnect()
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2.0)

    installed_session = operating_line.get_session()
    invalid_plan = deepcopy(dynamic_plan)
    invalid_plan["revision"] = DYNAMIC_REVISION + 1
    invalid_plan["steps"][2]["action"]["name"] = "unsafe.execute_python"
    try:
        companion.install_plan(invalid_plan)
    except ValueError as error:
        assert "Unsupported Blender action" in str(error)
    else:
        raise AssertionError("Unsupported live action should be rejected")
    assert operating_line.get_session() is installed_session

    invalid_cases = (
        (
            "preview resolution budget",
            "blender.render.execute_preview",
            lambda arguments: arguments.update({"resolutionX": 1025}),
            "arguments.resolutionX must be an integer in [1, 1024]",
        ),
        (
            "non-portable logical ID",
            "blender.mesh.create_uv_sphere",
            lambda arguments: arguments.update({"resourceId": "snowman body"}),
            "must be a portable logical resource ID",
        ),
        (
            "derived mesh logical ID collision",
            "blender.mesh.create_primitive_batch",
            lambda arguments: arguments["items"][1].update(
                {"resourceId": f'{arguments["items"][0]["resourceId"]}.mesh'}
            ),
            "Created logical resource IDs must be unique",
        ),
        (
            "cross-step logical ID collision",
            "blender.mesh.create_uv_sphere",
            lambda arguments: arguments.update({"resourceId": "snowman.ground"}),
            "Duplicate planned logical resource ID",
        ),
        (
            "material target logical ID collision",
            "blender.material.create_and_assign",
            lambda arguments: arguments.update(
                {"materialId": arguments["targets"][0]}
            ),
            "Material logical ID cannot also be an assignment target",
        ),
        (
            "derived rig data logical ID collision",
            "blender.render_rig.create",
            lambda arguments: arguments["lights"][1].update(
                {"resourceId": f'{arguments["lights"][0]["resourceId"]}.data'}
            ),
            "Created logical resource IDs must be unique",
        ),
        (
            "render artifact logical ID collision",
            "blender.render.execute_preview",
            lambda arguments: arguments.update({"renderId": "snowman.render.scene"}),
            "Duplicate planned logical resource ID",
        ),
    )
    for label, action_name, mutate, expected_message in invalid_cases:
        invalid_case = deepcopy(FULL_PLAN)
        invalid_case["id"] = f"invalid-{label.replace(' ', '-')}"
        target = next(
            item
            for item in invalid_case["steps"]
            if (item.get("action") or {}).get("name") == action_name
        )
        mutate(target["action"]["arguments"])
        try:
            companion.install_plan(invalid_case)
        except ValueError as error:
            assert expected_message in str(error)
        else:
            raise AssertionError(f"Plan should reject {label}")
        assert operating_line.get_session() is installed_session

    duplicate_artifact_plan = deepcopy(FULL_PLAN)
    duplicate_artifact_plan["id"] = "invalid-duplicate-render-artifact"
    render_step = next(
        item
        for item in duplicate_artifact_plan["steps"]
        if (item.get("action") or {}).get("name")
        == "blender.render.execute_preview"
    )
    duplicate_render_step = deepcopy(render_step)
    duplicate_render_step["id"] = "snowman.render.preview.copy"
    duplicate_render_step["order"] = render_step["order"] + 1
    duplicate_render_step["dependsOn"] = [render_step["id"]]
    duplicate_artifact_plan["steps"].append(duplicate_render_step)
    try:
        companion.install_plan(duplicate_artifact_plan)
    except ValueError as error:
        assert "Duplicate planned logical resource ID" in str(error)
    else:
        raise AssertionError("Plan should reject duplicate render artifact IDs")
    assert operating_line.get_session() is installed_session

    # Restore the bundled fallback for the remainder of the offline test.
    companion.install_plan(deepcopy(BUNDLED_PLAN))
    assert operating_line.get_session().plan_id == BUNDLED_PLAN["id"]

    # AI-authored proposals are fully validated and previewed without replacing
    # the accepted session or mutating the scene. Start/Next remain gated until
    # the in-host user accepts or rejects the proposal.
    accepted_before_review = operating_line.get_session()
    objects_before_review = {
        item.as_pointer() for item in bpy.data.objects
    }
    reviewed_plan = deepcopy(BUNDLED_PLAN)
    reviewed_plan["id"] = "reviewed-proposal-plan"
    reviewed_plan["revision"] = PLAN_REVISION + 10
    reviewed_plan["title"] = "Reviewed snowman proposal"
    reviewed_proposal = {
        "protocolVersion": "1.0.0",
        "proposalId": str(uuid.uuid4()),
        "targetAdapterId": "blender",
        "targetInstanceId": companion.instance_id,
        "revisionRequestId": str(uuid.uuid4()),
        "catalogVersion": "1.0.0",
        "plan": reviewed_plan,
        "proposedAt": "2026-08-04T12:00:00Z",
    }
    for invalid_proposal, expected_error in (
        (
            {**reviewed_proposal, "targetInstanceId": str(uuid.uuid4())},
            "different Blender instance",
        ),
        (
            {**reviewed_proposal, "catalogVersion": "2.0.0"},
            "Unsupported proposal catalog version",
        ),
    ):
        try:
            companion.stage_proposal(invalid_proposal)
        except ValueError as error:
            assert expected_error in str(error)
        else:
            raise AssertionError("Invalid request-linked proposal should be rejected")
        assert companion.proposed_plan is None
        assert operating_line.get_session() is accepted_before_review
    assert companion.stage_proposal(reviewed_proposal) is True
    assert operating_line.get_session() is accepted_before_review
    assert companion.proposal_session is not None
    assert companion.proposal_session.plan_id == "reviewed-proposal-plan"
    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    assert companion.revision_reference_scope == "proposal"
    assert tuple(
        node.id for node in companion.revision_reference_nodes()
    ) == ("snowman.model.head",)
    assert bpy.ops.operating_line.clear_revision_request() == {"FINISHED"}
    assert companion.revision_reference_nodes() == ()
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review
    assert bpy.ops.operating_line.start() == {"CANCELLED"}
    assert bpy.ops.operating_line.next() == {"CANCELLED"}
    assert operating_line.get_session() is accepted_before_review
    assert bpy.ops.operating_line.reject_proposal() == {"FINISHED"}
    assert companion.proposed_plan is None and companion.proposal_session is None
    assert operating_line.get_session() is accepted_before_review
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review

    assert companion.stage_proposal(reviewed_proposal) is True
    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    bpy.context.window_manager.operating_line_revision_message += "Refine after accept"
    assert companion.accept_proposal() is True
    reviewed_session = operating_line.get_session()
    assert reviewed_session is not accepted_before_review
    assert reviewed_session.plan_id == "reviewed-proposal-plan"
    assert companion.revision_reference_scope == "active"
    assert companion.revision_base_session is reviewed_session
    assert bpy.context.window_manager.operating_line_revision_message.endswith(
        "Refine after accept"
    )
    assert bpy.ops.operating_line.clear_revision_request() == {"FINISHED"}
    assert bpy.context.window_manager.operating_line_revision_message == ""
    assert not reviewed_session.started and not reviewed_session.receipts
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review

    # Receipt ownership blocks acceptance but keeps Back available. Once Back
    # reaches the start, acceptance replaces the idle session without executing.
    reviewed_session.start()
    reviewed_session.next()
    lower = bpy.data.objects[EXPECTED[0]]
    lower_pointer = lower.as_pointer()
    blocked_plan = deepcopy(BUNDLED_PLAN)
    blocked_plan["id"] = "blocked-proposal-plan"
    blocked_plan["revision"] = PLAN_REVISION + 11
    blocked_proposal = {
        **reviewed_proposal,
        "proposalId": str(uuid.uuid4()),
        "plan": blocked_plan,
        "proposedAt": "2026-08-04T12:01:00Z",
    }
    assert companion.stage_proposal(blocked_proposal) is True
    assert companion.accept_proposal() is False
    assert companion.status == "Plan proposal blocked"
    assert operating_line.get_session() is reviewed_session
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    assert bpy.ops.operating_line.back() == {"FINISHED"}
    assert bpy.data.objects.get(EXPECTED[0]) is None
    assert companion.accept_proposal() is True
    assert operating_line.get_session().plan_id == "blocked-proposal-plan"
    assert not operating_line.get_session().receipts

    companion.install_plan(deepcopy(BUNDLED_PLAN))
    assert operating_line.get_session().plan_id == BUNDLED_PLAN["id"]

    # A newer revision is cached without scene mutation while receipts exist,
    # reported once, then installed automatically after Back reaches the start.
    pending_session = operating_line.get_session()
    pending_session.start()
    pending_session.next()
    lower = bpy.data.objects[EXPECTED[0]]
    lower_pointer = lower.as_pointer()
    newer_plan = deepcopy(BUNDLED_PLAN)
    newer_plan["revision"] = PLAN_REVISION + 1
    assert companion.install_plan(newer_plan) is False
    pending_error_sequence = companion.last_report["sequence"]
    assert companion.last_report["transition"] == "error"
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    assert companion.install_plan(newer_plan) is False
    assert companion.last_report["sequence"] == pending_error_sequence
    alternate_plan = deepcopy(BUNDLED_PLAN)
    alternate_plan["id"] = "alternate-live-plan"
    alternate_plan["revision"] = PLAN_REVISION
    assert companion.install_plan(alternate_plan) is False
    assert companion.pending_plan["id"] == "alternate-live-plan"
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    pending_session.back()
    companion.pump()
    assert bpy.data.objects.get(EXPECTED[0]) is None
    assert companion.pending_plan is None
    assert operating_line.get_session().plan_id == "alternate-live-plan"
    assert operating_line.get_session().revision == PLAN_REVISION
    assert companion.last_report["transition"] == "plan_loaded"

    # Disconnect is an explicit boundary: a queued remote plan must not install
    # later after the user rolls the local walkthrough back.
    cancellation_session = operating_line.get_session()
    cancellation_session.start()
    cancellation_session.next()
    cancelled_plan = deepcopy(BUNDLED_PLAN)
    cancelled_plan["id"] = "cancelled-live-plan"
    assert companion.install_plan(cancelled_plan) is False
    companion.disconnect()
    assert companion.pending_plan is None
    cancellation_session.back()
    companion.pump()
    assert operating_line.get_session().plan_id == "alternate-live-plan"

    # In protocol 0.1 observations are telemetry, not success gates. Preserve
    # the action result and report an unsatisfied expectation without claiming
    # that the expectation itself was verified.
    telemetry_plan = deepcopy(BUNDLED_PLAN)
    telemetry_plan["id"] = "observation-telemetry-plan"
    telemetry_step_data = next(
        item for item in telemetry_plan["steps"] if item["action"] is not None
    )
    telemetry_step_data["expectedObservations"] = [
        {
            "kind": "object_exists",
            "parameters": {"name": "OperatingLine.IntentionallyMissing"},
        }
    ]
    assert companion.install_plan(telemetry_plan) is True
    telemetry_session = operating_line.get_session()
    telemetry_session.start()
    telemetry_step = telemetry_session.next()
    telemetry_report = companion.report("step_succeeded", step=telemetry_step)
    assert telemetry_report["transition"] == "step_succeeded"
    assert telemetry_report["observations"] == [
        {
            "kind": "object_exists",
            "satisfied": False,
            "details": {
                "parameters": {"name": "OperatingLine.IntentionallyMissing"},
                "objectName": "OperatingLine.IntentionallyMissing",
                "supported": True,
            },
        }
    ]
    telemetry_session.back()

    original_evaluator = observation_module.OBSERVATION_EVALUATORS.get(
        "test_evaluation_error"
    )
    observation_module.OBSERVATION_EVALUATORS["test_evaluation_error"] = (
        lambda _parameters, _receipts: (_ for _ in ()).throw(ValueError("private"))
    )
    try:
        assert observation_module.evaluate_observations(
            ({"kind": "test_evaluation_error", "parameters": {}},),
            {},
        ) == [
            {
                "kind": "test_evaluation_error",
                "satisfied": False,
                "details": {
                    "parameters": {},
                    "supported": True,
                    "evaluationError": "ValueError",
                },
            }
        ]
    finally:
        if original_evaluator is None:
            del observation_module.OBSERVATION_EVALUATORS["test_evaluation_error"]
        else:
            observation_module.OBSERVATION_EVALUATORS[
                "test_evaluation_error"
            ] = original_evaluator
    assert companion.install_plan(deepcopy(BUNDLED_PLAN)) is True

    dependent = step(
        "action.a-second",
        "root",
        1,
        depends_on=["action.z-first"],
        step_action=action("test.a-second"),
    )
    independent = step(
        "action.b-independent",
        "root",
        1,
        step_action=action("test.b-independent"),
    )
    independent_tie = step(
        "action.c-independent",
        "root",
        1,
        step_action=action("test.c-independent"),
    )
    plan_root = load_temporary_plan(
        [root, dependent, independent_tie, independent, dependency_first]
    )
    assert tuple(node.id for node in executable_steps(plan_root)) == (
        "action.b-independent",
        "action.c-independent",
        "action.z-first",
        "action.a-second",
    )

    strict_root = load_temporary_plan(
        [root, step("action.strict", "root", 1, step_action=action("test.strict"))]
    )
    strict_session = DemoSession(
        strict_root,
        {
            "test.strict": (
                lambda _receipts: ActionReceipt(
                    "receipt",
                    "action.strict",
                    "test.strict",
                ),
                lambda _receipt: None,
            )
        },
    )
    strict_session.start()
    try:
        strict_session.next()
    except KeyError as error:
        assert error.args == ("action.strict",)
    else:
        raise AssertionError("Session must not resolve actions by action name")

    assert_plan_rejected(
        [
            root,
            step("branch", "root", 1, step_action=action("test.branch")),
            step("branch.child", "branch", 1),
        ],
        "must be a hierarchy leaf",
    )
    assert_plan_rejected(
        [
            root,
            step("manual", "root", 1),
            step(
                "action",
                "root",
                2,
                depends_on=["manual"],
                step_action=action("test.action"),
            ),
        ],
        "depends on non-action step",
    )
    assert_plan_rejected(
        [
            root,
            step("manual.a", "root", 1, depends_on=["manual.b"]),
            step("manual.b", "root", 2, depends_on=["manual.a"]),
        ],
        "Dependency cycle includes",
    )
    assert_plan_rejected(
        [root, step("action", "root", 1, depends_on=["missing"])],
        "Unknown dependency missing",
    )
    assert_plan_rejected(
        [root, step("action", "root", 1, depends_on=["action"])],
        "cannot depend on itself",
    )
    assert_plan_rejected(
        [root, step("雪人", "root", 1)],
        "Invalid portable step id",
    )
    assert_plan_rejected(
        [
            root,
            step("action.first", "root", 1, step_action=action("test.first")),
            step("branch", "root", 2, depends_on=["action.first"]),
            step("branch.child", "branch", 1),
        ],
        "Non-executable group branch cannot declare execution dependencies",
    )


def main() -> None:
    catalog_actions = {item["name"] for item in ACTION_CATALOG["actions"]}
    implemented_catalog_actions = {
        name for name in ALLOWED_ACTIONS if name.startswith("blender.")
    }
    assert catalog_actions == implemented_catalog_actions
    assert (ADAPTER_ROOT / "LICENSE").read_text(encoding="utf-8") == (
        REPO_ROOT / "LICENSE"
    ).read_text(encoding="utf-8")
    canonical_path = REPO_ROOT / "protocol" / "fixtures" / "v1" / "snowman.plan.json"
    with canonical_path.open(encoding="utf-8") as canonical_resource:
        assert FULL_PLAN == json.load(canonical_resource)

    session_before_registration = operating_line.get_session()
    operating_line.register()
    operating_line.register()
    assert operating_line.get_session() is session_before_registration
    registered_companion = operating_line.get_companion()
    assert registered_companion.timer_registered
    assert bpy.app.timers.is_registered(registered_companion.timer_callback)
    assert registered_companion.install_plan(deepcopy(BUNDLED_PLAN)) is True
    assert_companion_and_plan_semantics()
    assert all(
        "UNDO" not in operator.bl_options
        for operator in (OPERATINGLINE_OT_start, OPERATINGLINE_OT_next, OPERATINGLINE_OT_back)
    )
    try:
        # An edited startup object is user content: the atomic signature must fail
        # without deleting any member of the scene.
        factory_cube = bpy.data.objects["Cube"]
        factory_cube.location.x = 0.25
        assert remove_factory_startup_objects(bpy.context.scene) is False
        assert all(
            bpy.data.objects.get(name) is not None
            for name in ("Cube", "Camera", "Light")
        )
        factory_cube.location.x = 0.0

        factory_cube.data.vertices[0].co.x = -0.75
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_cube.data.vertices[0].co.x = 1.0

        base_color = factory_cube.data.materials[0].node_tree.nodes[
            "Principled BSDF"
        ].inputs["Base Color"]
        base_color.default_value[0] = 0.25
        assert remove_factory_startup_objects(bpy.context.scene) is False
        base_color.default_value[0] = 0.8

        factory_camera = bpy.data.objects["Camera"]
        factory_camera.data.lens = 35.0
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_camera.data.lens = 50.0
        factory_camera.data.display_size = 2.0
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_camera.data.display_size = 1.0

        factory_light = bpy.data.objects["Light"]
        factory_light.data.energy = 500.0
        assert remove_factory_startup_objects(bpy.context.scene) is False
        factory_light.data.energy = 1000.0

        # Any additional object makes this a user scene, even if the factory
        # trio itself is untouched.
        blocker_mesh = bpy.data.meshes.new("SceneBlocker.Mesh")
        blocker_object = bpy.data.objects.new("SceneBlocker", blocker_mesh)
        bpy.data.collections["Collection"].objects.link(blocker_object)
        assert remove_factory_startup_objects(bpy.context.scene) is False
        assert all(
            bpy.data.objects.get(name) is not None
            for name in ("Cube", "Camera", "Light", "SceneBlocker")
        )
        bpy.data.objects.remove(blocker_object, do_unlink=True)
        bpy.data.meshes.remove(blocker_mesh)

        assert overlay_enabled() is False
        session = operating_line.get_session()
        nodes = {}

        def collect(node):
            nodes[node.id] = node
            for child in node.children:
                collect(child)

        collect(session.root)
        assert nodes["snowman"].number == "1"
        assert nodes["snowman.model"].number == "1.1"
        assert nodes["snowman.model.body_lower"].number == "1.1.1"
        assert tuple(step.id for step in session.steps) == tuple(
            step["id"] for step in ACTION_STEPS
        )
        assert session.is_expanded("snowman")
        assert bpy.ops.operating_line.toggle_branch(node_id="snowman") == {"FINISHED"}
        assert not session.is_expanded("snowman")
        assert bpy.ops.operating_line.toggle_branch(node_id="snowman") == {"FINISHED"}

        # Safe default: merely starting a guide preserves Blender's factory
        # scene unless the user explicitly opts into replacement.
        result = bpy.ops.operating_line.start()
        assert result == {"FINISHED"}
        assert operating_line.get_companion().last_report["transition"] == (
            "walkthrough_started"
        )
        assert session.started and session.active_index == -1
        assert overlay_enabled() is True
        assert bpy.context.window_manager.operating_line_overlay_enabled is True
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert overlay_enabled() is False
        assert bpy.context.window_manager.operating_line_overlay_enabled is False
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert overlay_enabled() is True
        assert bpy.context.window_manager.operating_line_overlay_enabled is True
        assert all(
            bpy.data.objects.get(name) is not None
            for name in ("Cube", "Camera", "Light")
        )

        bpy.context.scene.operating_line_replace_factory_scene = True
        result = bpy.ops.operating_line.start()
        assert result == {"FINISHED"}
        for factory_name in ("Cube", "Camera", "Light"):
            assert_absent(factory_name)

        user_mesh = bpy.data.meshes.new("UserObject.Mesh")
        user_object = bpy.data.objects.new("UserObject", user_mesh)
        bpy.context.scene.collection.objects.link(user_object)
        assert bpy.data.objects.get("UserObject") is user_object

        # A conflicting user-owned name is an observable action failure. The
        # operator must preserve both the object and the walkthrough position.
        conflict_mesh = bpy.data.meshes.new(f"{EXPECTED[0]}.UserMesh")
        conflict_object = bpy.data.objects.new(EXPECTED[0], conflict_mesh)
        bpy.context.scene.collection.objects.link(conflict_object)
        try:
            bpy.ops.operating_line.next()
        except RuntimeError as error:
            assert f"Cannot replace existing object: {EXPECTED[0]}" in str(error)
        else:
            raise AssertionError("Blender should surface the operator error to Python")
        conflict_report = operating_line.get_companion().last_report
        assert conflict_report["transition"] == "error"
        assert conflict_report["phase"] == "error"
        assert conflict_report["stepId"] == ACTION_STEPS[0]["id"]
        assert conflict_report["activeStepId"] is None
        assert conflict_report["completedStepIds"] == []
        assert conflict_report["error"] == (
            f"Cannot replace existing object: {EXPECTED[0]}"
        )
        assert session.active_index == -1
        assert session.receipts == {}
        assert bpy.data.objects.get(EXPECTED[0]) is conflict_object
        bpy.data.objects.remove(conflict_object, do_unlink=True)
        bpy.data.meshes.remove(conflict_mesh)

        for index, (step_data, name) in enumerate(zip(ACTION_STEPS, EXPECTED)):
            result = bpy.ops.operating_line.next()
            assert result == {"FINISHED"}
            assert operating_line.get_companion().last_report["transition"] == (
                "step_succeeded"
            )
            obj = bpy.data.objects.get(name)
            assert obj is not None, f"{name} was not created"
            assert obj.type == "MESH"
            assert obj.get("operating_line_action_owned") is True
            assert obj.get("operating_line_action") == step_data["action"]["name"]
            rollback_token = obj.get("operating_line_rollback_token")
            assert isinstance(rollback_token, str) and rollback_token
            receipt = session.receipts[step_data["id"]]
            assert receipt.display_name == name
            assert receipt.rollback_token == rollback_token
            assert receipt.object_pointer == obj.as_pointer()
            owned_collection = obj.users_collection[0]
            if index == 0:
                assert receipt.collection_pointer == owned_collection.as_pointer()
            assert owned_collection.get("operating_line_owner") == OWNER_VALUE
            arguments = step_data["action"]["arguments"]
            assert all(
                math.isclose(actual, expected, abs_tol=1e-5)
                for actual, expected in zip(obj.location, arguments["location"])
            )
            assert math.isclose(
                max(obj.dimensions) / 2.0, arguments["radius"], abs_tol=1e-5
            )
            assert session.active_index == index
            if index == len(ACTION_STEPS) - 1:
                final_report = operating_line.get_companion().last_report
                assert final_report["phase"] == "completed"
                assert final_report["activeStepId"] == step_data["id"]
                assert final_report["completedStepIds"] == [
                    item["id"] for item in ACTION_STEPS
                ]
                assert final_report["observations"][0]["satisfied"] is True

        # Receiving a duplicate plan is a validated no-op and preserves scene work.
        completed_session = operating_line.get_session()
        pointers_before_update = {
            name: bpy.data.objects[name].as_pointer() for name in EXPECTED
        }
        operating_line.get_companion().install_plan(deepcopy(BUNDLED_PLAN))
        assert operating_line.get_session() is completed_session
        assert {
            name: bpy.data.objects[name].as_pointer() for name in EXPECTED
        } == pointers_before_update

        renamed_head = bpy.data.objects[EXPECTED[-1]]
        managed_collection = renamed_head.users_collection[0]
        duplicate_collection = managed_collection.copy()
        duplicate_collection.name = "UserDuplicateCollection"
        for linked_object in tuple(duplicate_collection.objects):
            duplicate_collection.objects.unlink(linked_object)
        bpy.context.scene.collection.children.link(duplicate_collection)
        assert duplicate_collection.get("operating_line_owner") == managed_collection.get(
            "operating_line_owner"
        )
        duplicate_head = renamed_head.copy()
        duplicate_head.data = renamed_head.data.copy()
        duplicate_head.name = "UserDuplicateSnowmanHead"
        renamed_head.users_collection[0].objects.link(duplicate_head)
        assert duplicate_head.get("operating_line_rollback_token") == renamed_head.get(
            "operating_line_rollback_token"
        )
        renamed_head.name = "UserRenamedSnowmanHead"
        assert bpy.ops.operating_line.back() == {"FINISHED"}
        assert operating_line.get_companion().last_report["transition"] == (
            "step_rolled_back"
        )
        assert_absent(EXPECTED[-1])
        assert_absent("UserRenamedSnowmanHead")
        assert bpy.data.objects.get("UserDuplicateSnowmanHead") is duplicate_head
        assert bpy.data.collections.get("UserDuplicateCollection") is duplicate_collection
        assert bpy.data.objects.get(EXPECTED[0]) is not None
        assert bpy.data.objects.get(EXPECTED[1]) is not None
        assert bpy.data.objects.get("UserObject") is user_object
        assert session.active_index == 1

        # Forward after rollback must deterministically recreate the same object.
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert bpy.data.objects.get(EXPECTED[-1]) is not None

        # Reset rolls back later steps, then fails closed before touching the
        # lower step whose collection now contains a copied user object.
        try:
            bpy.ops.operating_line.start()
        except RuntimeError as error:
            assert "Cannot rollback collection with external contents" in str(error)
        else:
            raise AssertionError("Reset must retain an unsafe collection receipt")
        assert session.active_index == 0
        assert tuple(session.receipts) == (ACTION_STEPS[0]["id"],)
        assert bpy.data.objects.get(EXPECTED[0]) is not None
        assert_absent(EXPECTED[1])
        assert_absent(EXPECTED[2])
        assert bpy.data.objects.get("UserDuplicateSnowmanHead") is duplicate_head
        assert bpy.data.collections.get("UserDuplicateCollection") is duplicate_collection
        conflict_report = operating_line.get_companion().last_report
        assert conflict_report["transition"] == "error"
        assert conflict_report["stepId"] == ACTION_STEPS[0]["id"]

        # Moving the copied object to its copied collection resolves the
        # ownership conflict. Retrying Start completes the retained receipt.
        managed_collection.objects.unlink(duplicate_head)
        duplicate_collection.objects.link(duplicate_head)
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        assert session.active_index == -1
        assert not session.receipts
        assert bpy.data.collections.get("OperatingLine Snowman") is None
        assert bpy.ops.operating_line.next() == {"FINISHED"}
        assert session.active_index == 0
    finally:
        operating_line.unregister()

    for name in EXPECTED:
        assert_absent(name)
    assert_absent("UserRenamedSnowmanLowerBody")
    duplicate_head = bpy.data.objects.get("UserDuplicateSnowmanHead")
    assert duplicate_head is not None
    duplicate_collection = bpy.data.collections.get("UserDuplicateCollection")
    assert duplicate_collection is not None
    assert bpy.data.objects.get("UserObject") is user_object
    assert bpy.data.collections.get("OperatingLine Snowman") is None
    assert duplicate_head.name in duplicate_collection.objects

    duplicate_mesh = duplicate_head.data
    bpy.data.objects.remove(duplicate_head, do_unlink=True)
    if duplicate_mesh.users == 0:
        bpy.data.meshes.remove(duplicate_mesh)
    bpy.data.collections.remove(duplicate_collection)
    assert not any(
        collection.get("operating_line_owner") == OWNER_VALUE
        for collection in bpy.data.collections
    )
    assert overlay_enabled() is False
    assert not hasattr(bpy.types.WindowManager, "operating_line_overlay_enabled")
    assert not hasattr(bpy.types.Scene, "operating_line_replace_factory_scene")
    assert not hasattr(bpy.types.WindowManager, "operating_line_runtime_url")
    assert not hasattr(bpy.types.WindowManager, "operating_line_bearer_token")
    assert not hasattr(bpy.types.WindowManager, "operating_line_revision_message")
    assert not registered_companion.timer_registered
    assert not bpy.app.timers.is_registered(registered_companion.timer_callback)
    print("OperatingLine Blender integration test passed")


if __name__ == "__main__":
    main()
