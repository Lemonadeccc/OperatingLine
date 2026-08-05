"""Headless Blender integration test for the extension lifecycle."""

import importlib.util
from copy import deepcopy
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from queue import Queue
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
from operating_line_extension.operating_line.application.session import (  # noqa: E402
    _canonical_json_value_bytes,
    canonical_plan_content_sha256,
)
from operating_line_extension.operating_line.application.companion import (  # noqa: E402
    CompanionController,
)
from operating_line_extension.operating_line import (  # noqa: E402
    replace_session as replace_operating_line_session,
)
from operating_line_extension.operating_line.presentation.operators import (  # noqa: E402
    OPERATINGLINE_OT_back,
    OPERATINGLINE_OT_next,
    OPERATINGLINE_OT_start,
)
from operating_line_extension.operating_line.presentation.revision_workspace import (  # noqa: E402
    _display_columns,
    _proposal_accept_requires_verifiable_base,
    _wrap_history_message,
)
from operating_line_extension.operating_line.domain import (  # noqa: E402
    RESOURCE_PATH,
    executable_steps,
    load_task_tree,
)
from operating_line_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    ALLOWED_ACTIONS,
    COLLECTION_NAME,
    OWNER_VALUE,
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
FULL_PLAN_CONTENT_SHA256 = (
    "73ca76a923816eb8d1073f6bf799d6563a7b0627ada0ac2fb92d8b9e4ec08f7a"
)


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
    assert canonical_plan_content_sha256(FULL_PLAN) == FULL_PLAN_CONTENT_SHA256
    for value, expected_sha256 in (
        (1e-7, "69b47e10cce2f956c2d24354284f67ee84f3a0d9d072563498718fd1bb1a3cc3"),
        (1e20, "1df21ce650e785b5d5abb0115da72f0198295bd3befc35ee7bb0bad6b4048c76"),
        (-0.0, "5b87553ae592ab403ab5f5ebfb177424b7c26ca3de95a76b160ac1aef027f1de"),
        (
            {
                "10": "ten",
                "2": "two",
                "é": "accent",
                "😀": "emoji",
                "text": "hello 😀",
                "small": 1e-7,
                "large": 1e20,
                "zero": -0.0,
            },
            "53034233732c02e4a0058220b140da17c9fe8242f55c9455bdb7724529980149",
        ),
        (
            ["😀", -0.0, 1e-7, 1e20],
            "6cf88735d4a75d91930a01aaaeaaece30f54a260d2e10362321a70e42c598b66",
        ),
    ):
        assert sha256(_canonical_json_value_bytes(value, set())).hexdigest() == expected_sha256
    dynamic_plan_content_sha256 = canonical_plan_content_sha256(dynamic_plan)
    try:
        CompanionController._validated_session(dynamic_plan, "0" * 64)
    except ValueError as error:
        assert "does not match the source plan" in str(error)
    else:
        raise AssertionError("A delivery hash must match the exact canonical plan")
    delivery_transport = CompanionTransport(
        "http://127.0.0.1:43123",
        "integration-token-123456",
        str(uuid.uuid4()),
    )
    delivery_transport._request_json = lambda *_args, **_kwargs: {
        "protocolVersion": "1.1.0",
        "plan": deepcopy(dynamic_plan),
        "planContentSha256": dynamic_plan_content_sha256,
        "proposal": None,
        "proposalPlanContentSha256": None,
    }
    delivery_transport._poll()
    assert delivery_transport.incoming.get_nowait() == {
        "kind": "plan",
        "plan": dynamic_plan,
        "planContentSha256": dynamic_plan_content_sha256,
    }
    delivery_transport._request_json = lambda *_args, **_kwargs: {
        "protocolVersion": "1.1.0",
        "plan": deepcopy(dynamic_plan),
        "planContentSha256": dynamic_plan_content_sha256,
        "proposal": None,
    }
    try:
        delivery_transport._poll()
    except ValueError as error:
        assert "proposalPlanContentSha256" in str(error)
    else:
        raise AssertionError("Runtime delivery hash fields must be required")
    assert delivery_transport.incoming.empty()
    for invalid_hash in (None, "A" * 64, "0" * 63):
        try:
            delivery_transport._validated_delivery_hash(
                invalid_hash,
                present=True,
                label="Runtime plan content SHA-256",
            )
        except ValueError:
            pass
        else:
            raise AssertionError("Runtime delivery must reject an invalid plan hash")

    token = "integration-token-123456"
    requests: list[dict] = []
    reports: list[dict] = []
    revision_requests: list[dict] = []
    proposal_decisions: list[dict] = []
    replan_runs: list[dict] = []
    replan_post_attempts: list[dict] = []
    invoked_generation_ids: set[str] = set()
    replan_run_polls = [0]
    reject_replan_runs = [False]
    drop_first_replan_response = [True]
    slow_provider_discovery_once = [False]
    provider_proposal_id = str(uuid.uuid4())
    provider_payload = {
        "contractVersion": "1.0.0",
        "generationAvailable": True,
        "providers": [
            {
                "contractVersion": "1.0.0",
                "id": "available-planner",
                "version": "0.1.0",
                "displayName": "Available Planner",
                "description": "Local deterministic Blender replan provider.",
                "availability": {"available": True},
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "local",
                    "dataTransmission": "none",
                    "credentialManagement": "provider_managed",
                },
            },
            {
                "contractVersion": "1.0.0",
                "id": "unavailable-planner",
                "version": "0.1.0",
                "displayName": "Unavailable Planner",
                "description": "Provider requiring runtime configuration.",
                "availability": {
                    "available": False,
                    "reason": "not_configured",
                    "message": "Provider credential is not configured",
                },
                "limits": {"maxConcurrency": 1},
                "dataHandling": {
                    "executionLocation": "remote",
                    "dataTransmission": "provider_managed",
                    "credentialManagement": "provider_managed",
                },
            },
        ],
    }
    post_result = ["accepted"]
    slow_guide = [False]
    slow_guide_started = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def _reply(self, payload: dict, status: int = 200) -> None:
            encoded = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            assert self.headers.get("Authorization") == f"Bearer {token}"
            parsed_path = urlsplit(self.path)
            if parsed_path.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "http://192.0.2.1/credential-leak")
                self.end_headers()
                return
            if parsed_path.path == "/api/v1/replan/providers":
                if slow_provider_discovery_once[0]:
                    slow_provider_discovery_once[0] = False
                    time.sleep(0.25)
                self._reply(provider_payload)
                return
            if parsed_path.path == "/api/v1/companion/replan-run":
                query = parse_qs(parsed_path.query)
                assert replan_runs
                run = replan_runs[-1]
                assert query == {
                    "generationRequestId": [run["generationRequestId"]]
                }
                replan_run_polls[0] += 1
                terminal = replan_run_polls[0] >= 2
                self._reply(
                    {
                        "contractVersion": "1.0.0",
                        "generationRequestId": run["generationRequestId"],
                        "revisionRequestId": run["revisionRequestId"],
                        "targetAdapterId": "blender",
                        "targetInstanceId": companion.instance_id,
                        "provider": {
                            "id": "available-planner",
                            "version": "0.1.0",
                            "displayName": "Available Planner",
                        },
                        "status": "proposal_created" if terminal else "generating",
                        "terminal": terminal,
                        "sceneChanged": False,
                        "proposalId": provider_proposal_id if terminal else None,
                        "error": None,
                        "needsRevision": None,
                        "updatedAt": "2026-08-05T12:00:02.000Z",
                    }
                )
                return
            if parsed_path.path == "/api/v1/replan/thread":
                query = parse_qs(parsed_path.query)
                assert revision_requests
                revision_request = revision_requests[-1]
                assert query["threadId"] == [
                    revision_request["revisionThread"]["threadId"]
                ]
                assert query["targetAdapterId"] == ["blender"]
                assert query["instanceId"] == [companion.instance_id]
                self._reply(
                    {
                        "protocolVersion": "1.1.0",
                        "threadId": revision_request["revisionThread"]["threadId"],
                        "targetAdapterId": "blender",
                        "instanceId": companion.instance_id,
                        "planId": revision_request["basePlan"]["id"],
                        "latestTurn": 1,
                        "status": "awaiting_proposal",
                        "turns": [
                            {
                                "turn": 1,
                                "state": "awaiting_proposal",
                                "request": revision_request,
                                "proposal": None,
                                "decision": None,
                            }
                        ],
                        "page": {
                            "beforeTurn": None,
                            "nextBeforeTurn": None,
                            "hasMore": False,
                        },
                    }
                )
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
            query = parse_qs(parsed_path.query)
            requests.append(query)
            known = query.get("knownPlanId") == ["live-snowman"] and query.get(
                "knownRevision"
            ) == [str(DYNAMIC_REVISION)] and query.get(
                "knownPlanContentSha256"
            ) == [dynamic_plan_content_sha256]
            self._reply(
                {
                    "protocolVersion": "1.1.0",
                    "plan": None if known else dynamic_plan,
                    "planContentSha256": (
                        None if known else dynamic_plan_content_sha256
                    ),
                    "proposal": None,
                    "proposalPlanContentSha256": None,
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
            if urlsplit(self.path).path == "/api/v1/companion/replan-run":
                replan_post_attempts.append(payload)
                if reject_replan_runs[0]:
                    self._reply(
                        {
                            "error": "provider_binding_mismatch",
                            "message": "Selected provider version is stale",
                        },
                        status=409,
                    )
                    return
                generation_request_id = payload["generationRequestId"]
                if generation_request_id not in invoked_generation_ids:
                    invoked_generation_ids.add(generation_request_id)
                    replan_runs.append(payload)
                if drop_first_replan_response[0]:
                    drop_first_replan_response[0] = False
                    try:
                        self.connection.shutdown(2)
                    except OSError:
                        pass
                    self.connection.close()
                    return
                self._reply(
                    {
                        "contractVersion": "1.0.0",
                        "generationRequestId": payload["generationRequestId"],
                        "revisionRequestId": payload["revisionRequestId"],
                        "targetAdapterId": "blender",
                        "targetInstanceId": companion.instance_id,
                        "provider": {
                            "id": "available-planner",
                            "version": "0.1.0",
                            "displayName": "Available Planner",
                        },
                        "status": "proposal_created",
                        "terminal": True,
                        "sceneChanged": False,
                        "proposalId": provider_proposal_id,
                        "error": None,
                        "needsRevision": None,
                        "updatedAt": "2026-08-05T12:00:01.000Z",
                    }
                )
                return
            if urlsplit(self.path).path == "/api/v1/companion/proposal-decision":
                proposal_decisions.append(payload)
                self._reply({"result": "accepted"})
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
            known_plan_content_sha256=canonical_plan_content_sha256(BUNDLED_PLAN),
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
            known_plan_content_sha256=session.plan_content_sha256,
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
                    and query.get("knownPlanContentSha256")
                    == [dynamic_plan_content_sha256]
                    for query in requests
                )
            ):
                break
            time.sleep(0.02)
        assert operating_line.get_session().plan_id == "live-snowman"
        assert operating_line.get_session().plan_content_sha256 == (
            dynamic_plan_content_sha256
        )
        assert companion.last_report["planContentSha256"] == (
            dynamic_plan_content_sha256
        )
        assert requests[0].get("knownPlanId") == [BUNDLED_PLAN["id"]]
        assert requests[0].get("knownRevision") == [str(PLAN_REVISION)]
        assert requests[0].get("knownPlanContentSha256") == [
            session.plan_content_sha256
        ]
        assert all(query["adapterId"] == ["blender"] for query in requests)
        assert all(query["instanceId"] == [companion.instance_id] for query in requests)
        assert server_thread.ident != main_thread_id

        # Provider discovery never makes a default choice. Unavailable choices
        # remain visible but cannot cross the explicit selection/ACK/run gates.
        provider_deadline = time.monotonic() + 2.0
        while time.monotonic() < provider_deadline:
            companion.pump()
            if len(companion.provider_descriptors) == 2:
                break
            time.sleep(0.02)
        assert len(companion.provider_descriptors) == 2
        assert companion.selected_provider_id is None
        try:
            companion.select_replan_provider("unavailable-planner")
        except ValueError as error:
            assert "credential is not configured" in str(error)
        else:
            raise AssertionError("Unavailable provider selection must fail")
        assert companion.selected_provider_id is None
        assert companion.select_replan_provider("available-planner")["id"] == (
            "available-planner"
        )
        try:
            companion.begin_replan_run()
        except ValueError as error:
            assert "runtime acknowledges" in str(error)
        else:
            raise AssertionError("Provider run must remain gated before request ACK")

        # The revision workspace keeps structured references separate from the
        # user-authored request body. References are ordered, de-duplicated,
        # and removable one at a time without changing the base session or scene.
        session_before_request = operating_line.get_session()
        scene_objects_before_request = {
            item.as_pointer() for item in bpy.data.objects
        }
        bpy.context.window_manager.operating_line_revision_message = (
            "Make the selected parts slightly rougher"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Make the selected parts slightly rougher"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.body_upper",
        ) == {"FINISHED"}
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head", "snowman.model.body_upper")
        assert bpy.ops.operating_line.remove_revision_reference(
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.body_upper",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Make the selected parts slightly rougher"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.body_upper", "snowman.model.head")
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )
        assert bpy.ops.operating_line.submit_revision_request() == {"FINISHED"}
        assert bpy.context.window_manager.operating_line_revision_message == ""
        assert "queued locally" in companion.revision_request_status
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )
        request_deadline = time.monotonic() + 4.0
        while time.monotonic() < request_deadline:
            companion.pump()
            if revision_requests and "stored in runtime for MCP planner" in (
                companion.revision_request_status
            ):
                break
            time.sleep(0.02)
        assert len(revision_requests) == 1
        revision_request = revision_requests[0]
        uuid.UUID(revision_request["requestId"])
        assert revision_request["protocolVersion"] == "1.1.0"
        assert revision_request["adapterId"] == "blender"
        assert revision_request["catalogVersion"] == ACTION_CATALOG["catalogVersion"]
        assert revision_request["instanceId"] == companion.instance_id
        assert revision_request["basePlan"] == dynamic_plan
        assert revision_request["references"] == [
            {"nodeId": "snowman.model.body_upper", "nodeNumber": "1.1.2"},
            {"nodeId": "snowman.model.head", "nodeNumber": "1.1.3"},
        ]
        assert revision_request["message"] == "Make the selected parts slightly rougher"
        assert revision_request["revisionThread"] == {
            "threadId": revision_request["requestId"],
            "turn": 1,
            "parentRequestId": None,
        }
        assert companion.last_revision_request_id == revision_request["requestId"]

        # One explicit authorization queues on the worker and is polled without
        # blocking Blender's main thread. A terminal proposal-created status is
        # still only a review handoff: scene and accepted Session stay unchanged.
        assert companion.provider_handoff.acknowledged_revision_request_id == (
            revision_request["requestId"]
        )
        session_before_provider = operating_line.get_session()
        scene_before_provider = {item.as_pointer() for item in bpy.data.objects}
        try:
            bpy.ops.operating_line.run_replan_provider()
        except RuntimeError as error:
            assert "authorization dialog" in str(error)
        else:
            raise AssertionError("Direct execute must not bypass provider confirmation")
        assert replan_runs == []
        assert companion.provider_handoff.generation_request_id is None
        run_request = companion.begin_replan_run()
        assert run_request["revisionRequestId"] == revision_request["requestId"]
        assert run_request["providerId"] == "available-planner"
        assert run_request["authorization"] == {
            "disclosureVersion": "1.0.0",
            "dataHandlingAcknowledged": True,
            "possibleChargesAcknowledged": True,
            "proposalCreationAcknowledged": True,
            "authorizedAt": run_request["authorization"]["authorizedAt"],
        }
        active_run_identity = (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        )
        try:
            companion.refresh_replan_providers()
        except ValueError as error:
            assert "active provider run" in str(error)
        else:
            raise AssertionError("Active provider run must block provider refresh")
        assert (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        ) == active_run_identity
        unrelated_plan = deepcopy(dynamic_plan)
        unrelated_plan["revision"] = DYNAMIC_REVISION + 1
        unrelated_plan["title"] = "Unrelated guide update during provider run"
        assert companion.install_plan(unrelated_plan)
        assert (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        ) == active_run_identity
        replace_operating_line_session(session_before_provider)
        transport.accept_plan(
            "live-snowman",
            DYNAMIC_REVISION,
            dynamic_plan_content_sha256,
        )
        transport.follow_revision_thread(revision_request["revisionThread"]["threadId"])

        unrelated_preview_plan = deepcopy(dynamic_plan)
        unrelated_preview_plan["id"] = "unrelated-provider-preview"
        unrelated_preview_plan["revision"] = DYNAMIC_REVISION + 2
        unrelated_proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": companion.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "plan": unrelated_preview_plan,
            "planDiff": None,
            "proposedAt": "2026-08-05T12:00:00Z",
        }
        assert companion.stage_proposal(unrelated_proposal)
        assert companion.provider_handoff.phase == "queued"
        assert companion.accept_proposal() is False
        assert companion.reject_proposal() is False
        assert companion.proposed_plan is unrelated_proposal
        assert companion.provider_handoff.generation_request_id == (
            run_request["generationRequestId"]
        )
        companion.add_revision_reference("active", "snowman.model.body_lower")
        blocked_message = "Queue this only after the active provider run"
        bpy.context.window_manager.operating_line_revision_message = blocked_message
        handoff_identity = (
            companion.provider_handoff.acknowledged_revision_request_id,
            companion.provider_handoff.generation_request_id,
            companion.provider_handoff.phase,
        )
        for active_phase in ("queued", "generating"):
            companion.provider_handoff.phase = active_phase
            try:
                companion.submit_revision_request(blocked_message)
            except ValueError as error:
                assert "active provider run" in str(error)
            else:
                raise AssertionError(
                    f"A {active_phase} provider run must block a second request"
                )
            assert companion.provider_handoff.acknowledged_revision_request_id == (
                handoff_identity[0]
            )
            assert companion.provider_handoff.generation_request_id == handoff_identity[1]
            assert companion.provider_handoff.phase == active_phase
            assert tuple(
                node.id for node in companion.revision_reference_nodes()
            ) == ("snowman.model.body_lower",)
            assert bpy.context.window_manager.operating_line_revision_message == (
                blocked_message
            )
        assert len(revision_requests) == 1
        provider_deadline = time.monotonic() + 3.5
        while time.monotonic() < provider_deadline:
            companion.pump()
            if companion.provider_handoff.phase == "proposal_created":
                break
            time.sleep(0.02)
        assert len(replan_runs) == 1
        assert len(replan_post_attempts) == 2
        assert {
            attempt["generationRequestId"] for attempt in replan_post_attempts
        } == {run_request["generationRequestId"]}
        assert invoked_generation_ids == {run_request["generationRequestId"]}
        assert replan_run_polls[0] == 0
        assert companion.provider_handoff.phase == "proposal_created"
        assert companion.provider_handoff.generation_request_id == (
            run_request["generationRequestId"]
        )
        assert companion.proposed_plan is None
        assert operating_line.get_session() is session_before_provider
        assert {item.as_pointer() for item in bpy.data.objects} == scene_before_provider
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.body_lower",)
        assert bpy.context.window_manager.operating_line_revision_message == blocked_message
        provider_plan = deepcopy(dynamic_plan)
        provider_plan["revision"] = DYNAMIC_REVISION + 1
        provider_plan_content_sha256 = canonical_plan_content_sha256(provider_plan)
        provider_proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": provider_proposal_id,
            "targetAdapterId": "blender",
            "targetInstanceId": companion.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "revisionRequestId": revision_request["requestId"],
            "revisionThread": revision_request["revisionThread"],
            "plan": provider_plan,
            "planDiff": {
                "basePlan": {
                    "id": dynamic_plan["id"],
                    "revision": dynamic_plan["revision"],
                },
                "targetPlan": {
                    "id": provider_plan["id"],
                    "revision": provider_plan["revision"],
                },
                "summary": {
                    "planFields": 0,
                    "addedSteps": 0,
                    "removedSteps": 0,
                    "updatedSteps": 0,
                    "movedSteps": 0,
                },
                "planChanges": [],
                "stepChanges": [],
            },
            "proposedAt": "2026-08-05T12:00:03Z",
        }
        assert companion.stage_proposal(
            provider_proposal,
            provider_plan_content_sha256,
        )
        assert companion.proposed_plan is provider_proposal
        assert companion.proposal_session.plan_content_sha256 == (
            provider_plan_content_sha256
        )
        assert companion.stage_proposal(unrelated_proposal)
        assert companion.proposed_plan is provider_proposal
        assert companion.provider_handoff.complete_proposal_review(
            revision_request["requestId"], unrelated_proposal["proposalId"]
        ) is False
        assert companion.reject_proposal()
        decision_deadline = time.monotonic() + 2.0
        while time.monotonic() < decision_deadline and not proposal_decisions:
            time.sleep(0.01)
        assert proposal_decisions
        assert proposal_decisions[-1]["proposalId"] == provider_proposal_id
        assert companion.provider_handoff.generation_request_id is None
        assert companion.provider_handoff.phase == "idle"
        assert companion.proposed_plan is unrelated_proposal
        assert companion.reject_proposal()
        companion.clear_revision_draft()

        # A deterministic 4xx authorization rejection is terminal on the
        # transport queue: surface it once and never retry it in the background.
        companion.provider_handoff.revision_submitted(
            revision_request["requestId"]
        )
        companion.provider_handoff.revision_acknowledged(
            revision_request["requestId"]
        )
        reject_replan_runs[0] = True
        rejected_request = companion.begin_replan_run()
        rejected_deadline = time.monotonic() + 2.0
        while time.monotonic() < rejected_deadline:
            companion.pump()
            if companion.provider_handoff.retry_mode == "never":
                break
            time.sleep(0.02)
        assert len(replan_post_attempts) == 3
        assert replan_post_attempts[-1]["generationRequestId"] == (
            rejected_request["generationRequestId"]
        )
        assert len(replan_runs) == 1
        assert companion.provider_handoff.phase == "failed"
        assert companion.provider_handoff.retry_mode == "never"
        assert "provider version is stale" in companion.provider_handoff.message
        time.sleep(0.25)
        companion.pump()
        assert len(replan_post_attempts) == 3
        reject_replan_runs[0] = False

        # Optional provider discovery may time out once, but must not stay at
        # the head of the worker queue and starve reports or guide polling.
        core_requests_before = len(requests)
        slow_provider_discovery_once[0] = True
        starvation_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=DYNAMIC_REVISION,
            known_plan_content_sha256=dynamic_plan_content_sha256,
            timeout=0.1,
            poll_interval=0.05,
        )
        starvation_report = deepcopy(companion.last_report)
        starvation_report["reportId"] = str(uuid.uuid4())
        starvation_report["sequence"] = 10_001
        starvation_report["transition"] = "provider_discovery_probe"
        starvation_report["plan"] = {
            "id": "live-snowman",
            "revision": DYNAMIC_REVISION,
        }
        starvation_transport.send_report(starvation_report)
        starvation_transport.start()
        starvation_deadline = time.monotonic() + 2.0
        saw_provider_unavailable = False
        while time.monotonic() < starvation_deadline:
            while not starvation_transport.incoming.empty():
                saw_provider_unavailable |= (
                    starvation_transport.incoming.get_nowait().get("kind")
                    == "replan_provider_list_unavailable"
                )
            if (
                saw_provider_unavailable
                and starvation_transport.last_delivered_sequence == 10_001
                and len(requests) > core_requests_before
            ):
                break
            time.sleep(0.01)
        assert saw_provider_unavailable
        assert starvation_transport.last_delivered_sequence == 10_001
        assert len(requests) > core_requests_before
        starvation_transport.stop(flush_timeout=0.0)
        assert starvation_transport.wait_stopped(2.0)

        history_deadline = time.monotonic() + 2.0
        while time.monotonic() < history_deadline:
            companion.pump()
            if companion.revision_thread_history is not None:
                break
            time.sleep(0.02)
        assert companion.revision_thread_history is not None
        assert companion.revision_thread_history["turns"][0]["request"][
            "message"
        ] == revision_request["message"]
        assert companion.revision_thread_history["status"] == "awaiting_proposal"
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )

        # The application boundary enforces the documented eight-reference
        # limit without dropping the existing structured selection or body.
        maximum_reference_ids = (
            "snowman",
            "snowman.scene",
            "snowman.scene.ground",
            "snowman.model",
            "snowman.model.body_lower",
            "snowman.model.body_upper",
            "snowman.model.head",
            "snowman.details",
        )
        limit_controller = CompanionController()
        assert limit_controller.stage_proposal(
            {
                "protocolVersion": "1.1.0",
                "proposalId": str(uuid.uuid4()),
                "targetAdapterId": "blender",
                "plan": deepcopy(FULL_PLAN),
                "planDiff": None,
                "proposedAt": "2026-08-05T12:00:00Z",
            }
        ) is True
        bpy.context.window_manager.operating_line_revision_message = (
            "Keep all eight references if another node is rejected"
        )
        for node_id in maximum_reference_ids:
            limit_controller.add_revision_reference("proposal", node_id)
        try:
            limit_controller.add_revision_reference(
                "proposal",
                "snowman.details.face",
            )
        except ValueError as error:
            assert "at most 8 nodes" in str(error)
        else:
            raise AssertionError("A ninth revision reference must be rejected")
        assert tuple(
            node.id for node in limit_controller.revision_reference_nodes()
        ) == maximum_reference_ids
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Keep all eight references if another node is rejected"
        )
        limit_controller.clear_revision_draft()

        # Installing a plan while a revision request is awaiting its runtime
        # ACK invalidates that authorization. A late ACK for the old request
        # must not resurrect the handoff or make a provider runnable.
        late_ack_controller = CompanionController()
        late_request_id = str(uuid.uuid4())
        late_ack_controller.provider_handoff.revision_submitted(late_request_id)
        late_ack_controller.last_revision_request_id = late_request_id
        late_ack_controller._pending_revision_request_ids.add(late_request_id)
        late_ack_controller._invalidate_handoff_for_plan_install()
        assert late_ack_controller.last_revision_request_id is None
        assert late_ack_controller.provider_handoff.pending_revision_request_id is None
        late_ack_controller._acknowledge_revision_request(late_request_id)
        assert (
            late_ack_controller.provider_handoff.acknowledged_revision_request_id
            is None
        )
        assert late_ack_controller.provider_handoff.can_run is False

        # Proposal delivery and terminal status are independent streams. The
        # provider-authored proposal must win by exact proposal/request identity
        # in every meaningful ordering, while unrelated work remains bounded
        # and is promoted only after the provider proposal is reviewed.
        for order in (
            ("P", "U", "S"),
            ("U", "P", "S"),
            ("S", "P"),
            ("P", "S", "U"),
            ("S", "U", "P"),
            ("X", "S", "P"),
            ("S", "X", "P"),
        ):
            ordering_controller = CompanionController()
            ordering_controller.provider_handoff.set_providers(provider_payload)
            ordering_controller.select_replan_provider("available-planner")
            ordering_request_id = str(uuid.uuid4())
            ordering_controller.provider_handoff.revision_submitted(
                ordering_request_id
            )
            ordering_controller.provider_handoff.revision_acknowledged(
                ordering_request_id
            )
            ordering_run = ordering_controller.provider_handoff.begin(
                target_instance_id=ordering_controller.instance_id
            )
            ordering_plan = deepcopy(dynamic_plan)
            ordering_plan["revision"] = DYNAMIC_REVISION + 20
            ordering_proposal_id = str(uuid.uuid4())
            ordering_provider_proposal = {
                "protocolVersion": "1.1.0",
                "proposalId": ordering_proposal_id,
                "targetAdapterId": "blender",
                "targetInstanceId": ordering_controller.instance_id,
                "catalogVersion": ACTION_CATALOG["catalogVersion"],
                "revisionRequestId": ordering_request_id,
                "revisionThread": {
                    "threadId": ordering_request_id,
                    "turn": 1,
                    "parentRequestId": None,
                },
                "plan": ordering_plan,
                "planDiff": {
                    "basePlan": {
                        "id": dynamic_plan["id"],
                        "revision": dynamic_plan["revision"],
                    },
                    "targetPlan": {
                        "id": ordering_plan["id"],
                        "revision": ordering_plan["revision"],
                    },
                    "summary": {
                        "planFields": 0,
                        "addedSteps": 0,
                        "removedSteps": 0,
                        "updatedSteps": 0,
                        "movedSteps": 0,
                    },
                    "planChanges": [],
                    "stepChanges": [],
                },
                "proposedAt": "2026-08-05T12:00:04Z",
            }
            ordering_unrelated_plan = deepcopy(dynamic_plan)
            ordering_unrelated_plan["id"] = f"ordering-unrelated-{''.join(order)}"
            ordering_unrelated_plan["revision"] = DYNAMIC_REVISION + 21
            ordering_unrelated = {
                "protocolVersion": "1.1.0",
                "proposalId": str(uuid.uuid4()),
                "targetAdapterId": "blender",
                "targetInstanceId": ordering_controller.instance_id,
                "catalogVersion": ACTION_CATALOG["catalogVersion"],
                "plan": ordering_unrelated_plan,
                "planDiff": None,
                "proposedAt": "2026-08-05T12:00:05Z",
            }
            poisoning_request_id = str(uuid.uuid4())
            poisoning_proposal = {
                **ordering_provider_proposal,
                "revisionRequestId": poisoning_request_id,
                "revisionThread": {
                    "threadId": poisoning_request_id,
                    "turn": 1,
                    "parentRequestId": None,
                },
            }
            ordering_status = {
                "contractVersion": "1.0.0",
                "generationRequestId": ordering_run["generationRequestId"],
                "revisionRequestId": ordering_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": ordering_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": ordering_proposal_id,
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:06Z",
            }
            for event in order:
                if event == "P":
                    assert ordering_controller.stage_proposal(
                        ordering_provider_proposal
                    )
                elif event == "U":
                    assert ordering_controller.stage_proposal(ordering_unrelated)
                    if ordering_controller.provider_handoff.phase == "proposal_created":
                        if ordering_controller.proposed_plan is None:
                            assert ordering_controller.accept_proposal() is False
                            assert ordering_controller.reject_proposal() is False
                        else:
                            assert (
                                ordering_controller.proposed_plan
                                is ordering_provider_proposal
                            )
                elif event == "X":
                    assert ordering_controller.stage_proposal(poisoning_proposal)
                    if ordering_controller.provider_handoff.phase == "proposal_created":
                        assert ordering_controller.proposed_plan is None
                        assert ordering_controller.accept_proposal() is False
                        assert ordering_controller.reject_proposal() is False
                        assert (
                            ordering_controller.provider_handoff.proposal_id
                            == ordering_proposal_id
                        )
                else:
                    ordering_controller.provider_handoff.apply_status(ordering_status)
                    ordering_controller._bind_provider_proposal()
            assert ordering_controller.proposed_plan is ordering_provider_proposal
            assert ordering_controller.reject_proposal()
            if "U" in order:
                assert ordering_controller.proposed_plan is ordering_unrelated
                assert ordering_controller.reject_proposal()
            else:
                assert ordering_controller.proposed_plan is None, order

        bounded_controller = CompanionController()
        bounded_controller.provider_handoff.set_providers(provider_payload)
        bounded_controller.select_replan_provider("available-planner")
        bounded_request_id = str(uuid.uuid4())
        bounded_controller.provider_handoff.revision_submitted(bounded_request_id)
        bounded_controller.provider_handoff.revision_acknowledged(bounded_request_id)
        bounded_run = bounded_controller.provider_handoff.begin(
            target_instance_id=bounded_controller.instance_id
        )
        bounded_proposal_id = str(uuid.uuid4())
        bounded_plan = deepcopy(dynamic_plan)
        bounded_plan["revision"] = DYNAMIC_REVISION + 30

        def bounded_candidate(request_id):
            return {
                "protocolVersion": "1.1.0",
                "proposalId": bounded_proposal_id,
                "targetAdapterId": "blender",
                "targetInstanceId": bounded_controller.instance_id,
                "catalogVersion": ACTION_CATALOG["catalogVersion"],
                "revisionRequestId": request_id,
                "revisionThread": {
                    "threadId": request_id,
                    "turn": 1,
                    "parentRequestId": None,
                },
                "plan": bounded_plan,
                "planDiff": {
                    "basePlan": {
                        "id": dynamic_plan["id"],
                        "revision": dynamic_plan["revision"],
                    },
                    "targetPlan": {
                        "id": bounded_plan["id"],
                        "revision": bounded_plan["revision"],
                    },
                    "summary": {
                        "planFields": 0,
                        "addedSteps": 0,
                        "removedSteps": 0,
                        "updatedSteps": 0,
                        "movedSteps": 0,
                    },
                    "planChanges": [],
                    "stepChanges": [],
                },
                "proposedAt": "2026-08-05T12:00:06Z",
            }

        for _index in range(7):
            assert bounded_controller.stage_proposal(
                bounded_candidate(str(uuid.uuid4()))
            )
        assert len(bounded_controller._proposal_candidates) == 7
        bounded_decisions = []

        class BoundedTransport:
            running = True

            def __init__(self, proposal):
                self.incoming = Queue()
                self.incoming.put({"kind": "proposal", "proposal": proposal})

            def decide_proposal(self, proposal_id, decision):
                bounded_decisions.append((proposal_id, decision))

            def send_report(self, _report):
                pass

        bounded_controller._transport = BoundedTransport(
            bounded_candidate(str(uuid.uuid4()))
        )
        bounded_controller.pump()
        assert len(bounded_controller._proposal_candidates) == 7
        assert bounded_controller.status == "Proposal review queue full"
        assert "queue is full" in bounded_controller.error
        assert bounded_decisions == []
        bounded_controller._transport = None
        bounded_controller.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": bounded_run["generationRequestId"],
                "revisionRequestId": bounded_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": bounded_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": bounded_proposal_id,
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:07Z",
            }
        )
        exact_bounded_proposal = bounded_candidate(bounded_request_id)
        assert bounded_controller.stage_proposal(exact_bounded_proposal)
        assert bounded_controller.proposed_plan is exact_bounded_proposal
        assert len(bounded_controller._proposal_candidates) == 1

        # A request-linked proposal is bound to the plan snapshot it revised.
        # If an ordinary plan update moves the active session first, Accept is
        # rejected without changing the scene/session/proposal; Reject remains
        # available so the stale review can be closed explicitly.
        drift_controller = CompanionController()
        drift_base_session = operating_line.get_session()
        drift_base_plan = drift_base_session.source_plan_copy()
        drift_target_plan = deepcopy(drift_base_plan)
        drift_target_plan["revision"] = drift_base_session.revision + 2
        drift_request_id = str(uuid.uuid4())
        drift_controller.provider_handoff.set_providers(provider_payload)
        drift_controller.select_replan_provider("available-planner")
        drift_controller.provider_handoff.revision_submitted(drift_request_id)
        drift_controller.provider_handoff.revision_acknowledged(drift_request_id)
        drift_run = drift_controller.provider_handoff.begin(
            target_instance_id=drift_controller.instance_id
        )
        drift_proposal = {
            "protocolVersion": "1.1.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": drift_controller.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "revisionRequestId": drift_request_id,
            "revisionThread": {
                "threadId": drift_request_id,
                "turn": 1,
                "parentRequestId": None,
            },
            "plan": drift_target_plan,
            "planDiff": {
                "basePlan": {
                    "id": drift_base_session.plan_id,
                    "revision": drift_base_session.revision,
                },
                "targetPlan": {
                    "id": drift_target_plan["id"],
                    "revision": drift_target_plan["revision"],
                },
                "summary": {
                    "planFields": 0,
                    "addedSteps": 0,
                    "removedSteps": 0,
                    "updatedSteps": 0,
                    "movedSteps": 0,
                },
                "planChanges": [],
                "stepChanges": [],
            },
            "proposedAt": "2026-08-05T12:00:07Z",
        }
        assert drift_controller.stage_proposal(drift_proposal)
        drifted_plan = deepcopy(drift_base_plan)
        drifted_plan["revision"] = drift_base_session.revision + 1
        assert drift_controller.install_plan(drifted_plan)
        drift_controller.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": drift_run["generationRequestId"],
                "revisionRequestId": drift_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": drift_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": drift_proposal["proposalId"],
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:08Z",
            }
        )
        assert drift_controller._bind_provider_proposal()
        drifted_session = operating_line.get_session()
        drift_scene = {item.as_pointer() for item in bpy.data.objects}
        drift_proposal_session = drift_controller.proposal_session
        drift_candidates = dict(drift_controller._proposal_candidates)
        drift_handoff_identity = (
            drift_controller.provider_handoff.acknowledged_revision_request_id,
            drift_controller.provider_handoff.generation_request_id,
            drift_controller.provider_handoff.proposal_id,
            drift_controller.provider_handoff.phase,
        )
        drift_decisions = []

        class DriftTransport:
            running = True

            def send_report(self, _report):
                pass

            def decide_proposal(self, proposal_id, decision):
                drift_decisions.append((proposal_id, decision))

            def follow_revision_thread(self, _thread_id):
                pass

        drift_controller._transport = DriftTransport()
        assert drift_controller.accept_proposal() is False
        assert drift_controller.proposed_plan is drift_proposal
        assert drift_controller.proposal_session is drift_proposal_session
        assert drift_controller._proposal_candidates == drift_candidates
        assert (
            drift_controller.provider_handoff.acknowledged_revision_request_id,
            drift_controller.provider_handoff.generation_request_id,
            drift_controller.provider_handoff.proposal_id,
            drift_controller.provider_handoff.phase,
        ) == drift_handoff_identity
        assert operating_line.get_session() is drifted_session
        assert {item.as_pointer() for item in bpy.data.objects} == drift_scene
        assert drift_decisions == []
        assert "current" in drift_controller.error
        assert "base" in drift_controller.error
        assert drift_controller.reject_proposal()
        assert drift_decisions == [(drift_proposal["proposalId"], "rejected")]
        drift_controller._transport = None
        replace_operating_line_session(drift_base_session)

        # Protocol 1.0 legally permits a request-linked proposal without a
        # planDiff. It remains reviewable and rejectable, but Accept fails
        # closed because Blender cannot verify which active base it revised.
        legacy_controller = CompanionController()
        legacy_controller.provider_handoff.set_providers(provider_payload)
        legacy_controller.select_replan_provider("available-planner")
        legacy_request_id = str(uuid.uuid4())
        legacy_controller.provider_handoff.revision_submitted(legacy_request_id)
        legacy_controller.provider_handoff.revision_acknowledged(legacy_request_id)
        legacy_run = legacy_controller.provider_handoff.begin(
            target_instance_id=legacy_controller.instance_id
        )
        legacy_plan = deepcopy(dynamic_plan)
        legacy_plan["revision"] = DYNAMIC_REVISION + 40
        legacy_proposal = {
            "protocolVersion": "1.0.0",
            "proposalId": str(uuid.uuid4()),
            "targetAdapterId": "blender",
            "targetInstanceId": legacy_controller.instance_id,
            "catalogVersion": ACTION_CATALOG["catalogVersion"],
            "revisionRequestId": legacy_request_id,
            "revisionThread": {
                "threadId": legacy_request_id,
                "turn": 1,
                "parentRequestId": None,
            },
            "plan": legacy_plan,
            "proposedAt": "2026-08-05T12:00:09Z",
        }
        assert legacy_controller.stage_proposal(legacy_proposal)
        legacy_controller.provider_handoff.apply_status(
            {
                "contractVersion": "1.0.0",
                "generationRequestId": legacy_run["generationRequestId"],
                "revisionRequestId": legacy_request_id,
                "targetAdapterId": "blender",
                "targetInstanceId": legacy_controller.instance_id,
                "provider": {
                    "id": "available-planner",
                    "version": "0.1.0",
                    "displayName": "Available Planner",
                },
                "status": "proposal_created",
                "terminal": True,
                "sceneChanged": False,
                "proposalId": legacy_proposal["proposalId"],
                "error": None,
                "needsRevision": None,
                "updatedAt": "2026-08-05T12:00:10Z",
            }
        )
        assert legacy_controller._bind_provider_proposal()
        assert _proposal_accept_requires_verifiable_base(legacy_proposal)
        legacy_session = operating_line.get_session()
        legacy_scene = {item.as_pointer() for item in bpy.data.objects}
        legacy_proposal_session = legacy_controller.proposal_session
        legacy_candidates = dict(legacy_controller._proposal_candidates)
        legacy_handoff = deepcopy(legacy_controller.provider_handoff.__dict__)
        legacy_decisions = []

        class LegacyTransport:
            running = True

            def decide_proposal(self, proposal_id, decision):
                legacy_decisions.append((proposal_id, decision))

            def follow_revision_thread(self, _thread_id):
                pass

        legacy_controller._transport = LegacyTransport()
        assert legacy_controller.accept_proposal() is False
        assert "protocol 1.1" in legacy_controller.error
        assert legacy_controller.status == "Proposal base cannot be verified"
        assert legacy_controller.proposed_plan is legacy_proposal
        assert legacy_controller.proposal_session is legacy_proposal_session
        assert legacy_controller._proposal_candidates == legacy_candidates
        assert legacy_controller.provider_handoff.__dict__ == legacy_handoff
        assert operating_line.get_session() is legacy_session
        assert {item.as_pointer() for item in bpy.data.objects} == legacy_scene
        assert legacy_decisions == []
        assert legacy_controller.reject_proposal()
        assert legacy_decisions == [(legacy_proposal["proposalId"], "rejected")]
        legacy_controller._transport = None

        # Hiding the visual guidance does not discard a new workspace draft or
        # the loaded immutable thread. Collapsing the workspace and toggling
        # guidance both leave the host state alone.
        history_before_hide = companion.revision_thread_history
        bpy.context.window_manager.operating_line_revision_message = (
            "Preserve this draft while guidance is hidden"
        )
        assert bpy.ops.operating_line.reference_node(
            scope="active",
            node_id="snowman.model.head",
        ) == {"FINISHED"}
        bpy.context.window_manager.operating_line_revision_workspace_expanded = False
        assert companion.revision_thread_history is history_before_hide
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        bpy.context.window_manager.operating_line_revision_workspace_expanded = True
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert companion.revision_thread_history is history_before_hide
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        assert operating_line.get_session() is session_before_request
        assert {item.as_pointer() for item in bpy.data.objects} == (
            scene_objects_before_request
        )
        assert bpy.ops.operating_line.toggle_overlay() == {"FINISHED"}
        assert overlay_enabled() is False
        assert companion.revision_thread_history is history_before_hide
        assert tuple(
            node.id for node in companion.revision_reference_nodes()
        ) == ("snowman.model.head",)
        assert bpy.context.window_manager.operating_line_revision_message == (
            "Preserve this draft while guidance is hidden"
        )
        assert operating_line.get_session() is session_before_request
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
        assert companion.revision_reference_nodes() == ()
        assert companion.revision_base_session is None
        assert bpy.context.window_manager.operating_line_revision_message == ""
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
            "planContentSha256",
            "executionId",
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
        assert isinstance(report["planContentSha256"], str)
        assert len(report["planContentSha256"]) == 64
        assert report["executionId"] is None
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
            known_plan_content_sha256=dynamic_plan_content_sha256,
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
            known_plan_content_sha256=dynamic_plan_content_sha256,
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
            known_plan_content_sha256=dynamic_plan_content_sha256,
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
            "cyclic armature parents",
            "blender.rig.create_armature",
            lambda arguments: arguments["bones"][0].update(
                {"parentName": arguments["bones"][1]["boneName"]}
            ),
            "Armature bone parents must be acyclic",
        ),
        (
            "duplicate armature binding target",
            "blender.rig.create_armature",
            lambda arguments: arguments["bindings"][1].update(
                {"targetId": arguments["bindings"][0]["targetId"]}
            ),
            "Armature binding targetId values must be unique",
        ),
        (
            "non-increasing animation frames",
            "blender.animation.create_pose_keyframes",
            lambda arguments: arguments["keyframes"][1].update(
                {"frame": arguments["keyframes"][0]["frame"]}
            ),
            "arguments.keyframes frames must be strictly increasing",
        ),
        (
            "render frame budget",
            "blender.render.execute_preview",
            lambda arguments: arguments.update({"frame": 100_001}),
            "arguments.frame must be an integer in [1, 100000]",
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

    class IdentityGuardTransport:
        def __init__(self):
            self.incoming = Queue()
            self.running = False
            self.accepted_plans = []
            self.proposal_decisions = []
            self.reports = []

        def accept_plan(self, plan_id, revision, plan_content_sha256):
            self.accepted_plans.append((plan_id, revision, plan_content_sha256))

        def decide_proposal(self, proposal_id, decision):
            self.proposal_decisions.append((proposal_id, decision))

        def send_report(self, report):
            self.reports.append(report)

    identity_controller = CompanionController()
    identity_transport = IdentityGuardTransport()
    identity_controller._transport = identity_transport
    identity_collision = deepcopy(BUNDLED_PLAN)
    identity_collision["title"] = "Same identity, different immutable content"
    try:
        identity_controller.install_plan(identity_collision)
    except ValueError as error:
        assert "id/revision was reused" in str(error)
    else:
        raise AssertionError("A plan identity must not be reusable for new content")
    assert identity_transport.accepted_plans == []
    assert operating_line.get_session().plan_content_sha256 == (
        canonical_plan_content_sha256(BUNDLED_PLAN)
    )
    identity_transport.incoming.put(
        {
            "kind": "plan",
            "plan": identity_collision,
            "planContentSha256": canonical_plan_content_sha256(
                identity_collision
            ),
        }
    )
    identity_controller.pump()
    assert identity_transport.accepted_plans == []
    assert operating_line.get_session().plan_content_sha256 == (
        canonical_plan_content_sha256(BUNDLED_PLAN)
    )
    assert identity_controller.last_report["transition"] == "error"
    assert "id/revision was reused" in identity_controller.last_report["error"]

    # Older deliveries keep their established stale-ack behavior.
    identity_controller._transport = None
    future_identity_plan = deepcopy(BUNDLED_PLAN)
    future_identity_plan["id"] = "immutable-identity-regression"
    future_identity_plan["revision"] = PLAN_REVISION + 3
    assert identity_controller.install_plan(future_identity_plan)
    older_identity_plan = deepcopy(future_identity_plan)
    older_identity_plan["revision"] -= 1
    older_identity_plan["title"] = "Stale content remains stale"
    assert identity_controller.install_plan(older_identity_plan)
    assert operating_line.get_session().revision == future_identity_plan["revision"]
    assert identity_controller.install_plan(deepcopy(BUNDLED_PLAN))

    collision_proposal = {
        "protocolVersion": "1.1.0",
        "proposalId": str(uuid.uuid4()),
        "targetAdapterId": "blender",
        "targetInstanceId": identity_controller.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "plan": identity_collision,
        "planDiff": None,
        "proposedAt": "2026-08-04T11:59:00Z",
    }
    identity_controller._transport = identity_transport
    assert identity_controller.stage_proposal(collision_proposal)
    accepted_session = operating_line.get_session()
    try:
        identity_controller.accept_proposal()
    except ValueError as error:
        assert "id/revision was reused" in str(error)
    else:
        raise AssertionError("Proposal acceptance must enforce immutable plan identity")
    assert identity_transport.accepted_plans == []
    assert identity_transport.proposal_decisions == []
    assert identity_controller.proposed_plan is collision_proposal
    assert operating_line.get_session() is accepted_session

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
        "protocolVersion": "1.1.0",
        "proposalId": str(uuid.uuid4()),
        "targetAdapterId": "blender",
        "targetInstanceId": companion.instance_id,
        "catalogVersion": ACTION_CATALOG["catalogVersion"],
        "plan": reviewed_plan,
        "planDiff": None,
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

    # A draft cannot silently jump from the active plan to a proposal. The
    # failed cross-base reference preserves both the structured selection and
    # the independently authored request body.
    bpy.context.window_manager.operating_line_revision_message = (
        "Keep this active-plan draft intact"
    )
    assert bpy.ops.operating_line.reference_node(
        scope="active",
        node_id="snowman.model.body_upper",
    ) == {"FINISHED"}
    try:
        bpy.ops.operating_line.reference_node(
            scope="proposal",
            node_id="snowman.model.head",
        )
    except RuntimeError as error:
        assert "Clear the draft before switching bases" in str(error)
    else:
        raise AssertionError("A cross-base reference must fail visibly")
    assert companion.revision_reference_scope == "active"
    assert tuple(
        node.id for node in companion.revision_reference_nodes()
    ) == ("snowman.model.body_upper",)
    assert bpy.context.window_manager.operating_line_revision_message == (
        "Keep this active-plan draft intact"
    )
    assert "clear the draft" in companion.revision_request_status.lower()
    assert accepted_before_review.plan_id in companion.revision_request_status
    assert reviewed_proposal["plan"]["id"] in companion.revision_request_status
    assert operating_line.get_session() is accepted_before_review
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review
    assert bpy.ops.operating_line.clear_revision_request() == {"FINISHED"}

    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    assert companion.revision_reference_scope == "proposal"
    assert tuple(
        node.id for node in companion.revision_reference_nodes()
    ) == ("snowman.model.head",)
    bpy.context.window_manager.operating_line_revision_message = (
        "Replace this proposal-bound draft safely"
    )
    replacement_proposal = deepcopy(reviewed_proposal)
    replacement_proposal["proposalId"] = str(uuid.uuid4())
    replacement_proposal["plan"]["revision"] += 1
    replacement_proposal["plan"]["title"] = "Replacement reviewed proposal"
    assert companion.stage_proposal(replacement_proposal) is True
    assert companion.revision_reference_nodes() == ()
    assert companion.revision_base_session is None
    assert bpy.context.window_manager.operating_line_revision_message == ""
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review
    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    bpy.context.window_manager.operating_line_revision_message = (
        "Discard this proposal-bound draft on reject"
    )
    assert bpy.ops.operating_line.start() == {"CANCELLED"}
    assert bpy.ops.operating_line.next() == {"CANCELLED"}
    assert operating_line.get_session() is accepted_before_review
    assert bpy.ops.operating_line.reject_proposal() == {"FINISHED"}
    assert companion.proposed_plan is reviewed_proposal
    assert bpy.ops.operating_line.reject_proposal() == {"FINISHED"}
    assert companion.proposed_plan is None and companion.proposal_session is None
    assert companion.revision_reference_nodes() == ()
    assert companion.revision_base_session is None
    assert bpy.context.window_manager.operating_line_revision_message == ""
    assert operating_line.get_session() is accepted_before_review
    assert {item.as_pointer() for item in bpy.data.objects} == objects_before_review

    assert companion.stage_proposal(reviewed_proposal) is True
    assert bpy.ops.operating_line.reference_node(
        scope="proposal",
        node_id="snowman.model.head",
    ) == {"FINISHED"}
    bpy.context.window_manager.operating_line_revision_message = "Refine after accept"
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
    assert companion.last_report["transition"] == "error"
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    conflicting_pending_plan = deepcopy(newer_plan)
    conflicting_pending_plan["title"] = "Same pending identity, different content"
    original_pending_hash = companion.pending_plan_content_sha256
    try:
        companion.install_plan(conflicting_pending_plan)
    except ValueError as error:
        assert "Pending plan id/revision was reused" in str(error)
    else:
        raise AssertionError("Pending plan identity must be immutable")
    assert companion.pending_plan is newer_plan
    assert companion.pending_plan_content_sha256 == original_pending_hash
    pending_identity_transport = IdentityGuardTransport()
    companion._transport = pending_identity_transport
    pending_identity_transport.incoming.put(
        {
            "kind": "plan",
            "plan": conflicting_pending_plan,
            "planContentSha256": canonical_plan_content_sha256(
                conflicting_pending_plan
            ),
        }
    )
    companion.pump()
    assert pending_identity_transport.accepted_plans == []
    assert companion.pending_plan is newer_plan
    assert companion.pending_plan_content_sha256 == original_pending_hash
    assert companion.last_report["transition"] == "error"
    assert "Pending plan id/revision was reused" in companion.last_report["error"]
    pending_collision_sequence = companion.last_report["sequence"]
    companion._transport = None
    assert companion.install_plan(newer_plan) is False
    assert companion.last_report["sequence"] == pending_collision_sequence
    alternate_plan = deepcopy(BUNDLED_PLAN)
    alternate_plan["id"] = "alternate-live-plan"
    alternate_plan["revision"] = PLAN_REVISION
    alternate_plan_content_sha256 = canonical_plan_content_sha256(alternate_plan)
    assert companion.install_plan(
        alternate_plan,
        plan_content_sha256=alternate_plan_content_sha256,
    ) is False
    assert companion.pending_plan["id"] == "alternate-live-plan"
    assert companion.pending_plan_content_sha256 == alternate_plan_content_sha256
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    pending_session.back()
    companion.pump()
    assert bpy.data.objects.get(EXPECTED[0]) is None
    assert companion.pending_plan is None
    assert operating_line.get_session().plan_id == "alternate-live-plan"
    assert operating_line.get_session().revision == PLAN_REVISION
    assert operating_line.get_session().plan_content_sha256 == (
        alternate_plan_content_sha256
    )
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
    strict_execution_id = strict_session.execution_id
    assert strict_execution_id is not None
    uuid.UUID(strict_execution_id)
    try:
        strict_session.next()
    except KeyError as error:
        assert error.args == ("action.strict",)
    else:
        raise AssertionError("Session must not resolve actions by action name")
    assert strict_session.execution_id == strict_execution_id
    strict_session.reset()
    assert strict_session.execution_id is None

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
    wrapped_english = _wrap_history_message(
        "@1.2.3 Make this head larger and rougher"
    )
    wrapped_chinese = _wrap_history_message("@1.2.3 把雪人的头部放大并增加粗糙感")
    assert " ".join(wrapped_english) == "@1.2.3 Make this head larger and rougher"
    assert "".join(wrapped_chinese).replace(" ", "") == (
        "@1.2.3 把雪人的头部放大并增加粗糙感".replace(" ", "")
    )
    assert all(_display_columns(line) <= 24 for line in wrapped_english)
    assert all(_display_columns(line) <= 24 for line in wrapped_chinese)

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
    assert hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_workspace_expanded",
    )
    assert bpy.context.window_manager.operating_line_revision_workspace_expanded is True
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
        first_execution_id = session.execution_id
        assert first_execution_id is not None
        uuid.UUID(first_execution_id)
        assert operating_line.get_companion().last_report["transition"] == (
            "walkthrough_started"
        )
        assert operating_line.get_companion().last_report["executionId"] == (
            first_execution_id
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
        execution_id = session.execution_id
        assert execution_id is not None and execution_id != first_execution_id
        uuid.UUID(execution_id)
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
                assert final_report["executionId"] == execution_id
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
        assert bpy.data.collections.get(COLLECTION_NAME) is None
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
    assert bpy.data.collections.get(COLLECTION_NAME) is None
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
    assert not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_history_expanded",
    )
    assert not hasattr(
        bpy.types.WindowManager,
        "operating_line_revision_workspace_expanded",
    )
    assert not hasattr(bpy.types, "OPERATINGLINE_OT_remove_revision_reference")
    assert not hasattr(bpy.types, "OPERATINGLINE_PT_sidebar")
    assert not registered_companion.timer_registered
    assert not bpy.app.timers.is_registered(registered_companion.timer_callback)
    print("OperatingLine Blender integration test passed")


if __name__ == "__main__":
    main()
