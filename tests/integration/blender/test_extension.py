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


with RESOURCE_PATH.open(encoding="utf-8") as resource:
    BUNDLED_PLAN = json.load(resource)
ACTION_STEPS = [step for step in BUNDLED_PLAN["steps"] if step["action"] is not None]
EXPECTED = tuple(step["action"]["arguments"]["objectName"] for step in ACTION_STEPS)


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
    dynamic_plan["revision"] = 2
    dynamic_plan["title"] = "Live snowman"
    token = "integration-token-123456"
    requests: list[dict] = []
    reports: list[dict] = []
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
            ) == ["2"]
            self._reply(
                {
                    "protocolVersion": "1.0.0",
                    "plan": None if known else dynamic_plan,
                }
            )

        def do_POST(self):
            assert self.headers.get("Authorization") == f"Bearer {token}"
            length = int(self.headers["Content-Length"])
            reports.append(json.loads(self.rfile.read(length)))
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
            known_plan_id="snowman-demo",
            known_revision=1,
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
                    and query.get("knownRevision") == ["2"]
                    for query in requests
                )
            ):
                break
            time.sleep(0.02)
        assert operating_line.get_session().plan_id == "live-snowman"
        assert requests[0].get("knownPlanId") == ["snowman-demo"]
        assert requests[0].get("knownRevision") == ["1"]
        assert all(query["adapterId"] == ["blender"] for query in requests)
        assert all(query["instanceId"] == [companion.instance_id] for query in requests)
        assert server_thread.ident != main_thread_id

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
        assert report["plan"] == {"id": "live-snowman", "revision": 2}
        assert report["phase"] == "ready" and report["error"] is None

        # A stale/unknown acknowledgement is an error and cannot advance the
        # delivery watermark. Once accepted, the same pending report can flush.
        post_result[0] = "stale"
        rejected_transport = CompanionTransport(
            runtime_url,
            token,
            companion.instance_id,
            known_plan_id="live-snowman",
            known_revision=2,
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
            known_revision=2,
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
        assert slow_transport.wait_stopped(1.0)
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
            known_revision=2,
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
        assert companion.status == "Plan live-snowman r2"
        companion._transport = None
    finally:
        companion.disconnect()
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2.0)

    installed_session = operating_line.get_session()
    invalid_plan = deepcopy(dynamic_plan)
    invalid_plan["revision"] = 3
    invalid_plan["steps"][2]["action"]["name"] = "unsafe.execute_python"
    try:
        companion.install_plan(invalid_plan)
    except ValueError as error:
        assert "Unsupported Blender action" in str(error)
    else:
        raise AssertionError("Unsupported live action should be rejected")
    assert operating_line.get_session() is installed_session

    # Restore the bundled fallback for the remainder of the offline test.
    companion.install_plan(deepcopy(BUNDLED_PLAN))
    assert operating_line.get_session().plan_id == "snowman-demo"

    # A newer revision is cached without scene mutation while receipts exist,
    # reported once, then installed automatically after Back reaches the start.
    pending_session = operating_line.get_session()
    pending_session.start()
    pending_session.next()
    lower = bpy.data.objects[EXPECTED[0]]
    lower_pointer = lower.as_pointer()
    newer_plan = deepcopy(BUNDLED_PLAN)
    newer_plan["revision"] = 2
    assert companion.install_plan(newer_plan) is False
    pending_error_sequence = companion.last_report["sequence"]
    assert companion.last_report["transition"] == "error"
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    assert companion.install_plan(newer_plan) is False
    assert companion.last_report["sequence"] == pending_error_sequence
    alternate_plan = deepcopy(BUNDLED_PLAN)
    alternate_plan["id"] = "alternate-live-plan"
    alternate_plan["revision"] = 1
    assert companion.install_plan(alternate_plan) is False
    assert companion.pending_plan["id"] == "alternate-live-plan"
    assert bpy.data.objects[EXPECTED[0]].as_pointer() == lower_pointer
    pending_session.back()
    companion.pump()
    assert bpy.data.objects.get(EXPECTED[0]) is None
    assert companion.pending_plan is None
    assert operating_line.get_session().plan_id == "alternate-live-plan"
    assert operating_line.get_session().revision == 1
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
            },
        }
    ]
    telemetry_session.back()
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
    assert (ADAPTER_ROOT / "LICENSE").read_text(encoding="utf-8") == (
        REPO_ROOT / "LICENSE"
    ).read_text(encoding="utf-8")
    canonical_path = REPO_ROOT / "protocol" / "fixtures" / "v1" / "snowman.plan.json"
    with canonical_path.open(encoding="utf-8") as canonical_resource:
        assert BUNDLED_PLAN == json.load(canonical_resource)

    session_before_registration = operating_line.get_session()
    operating_line.register()
    operating_line.register()
    assert operating_line.get_session() is session_before_registration
    registered_companion = operating_line.get_companion()
    assert registered_companion.timer_registered
    assert bpy.app.timers.is_registered(registered_companion.timer_callback)
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
        assert nodes["snowman.details"].number == "1.2"
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
            receipt = session.receipts[step_data["action"]["name"]]
            assert receipt.display_name == name
            assert receipt.rollback_token == rollback_token
            assert receipt.object_pointer == obj.as_pointer()
            owned_collection = obj.users_collection[0]
            assert receipt.collection_pointer == owned_collection.as_pointer()
            assert owned_collection.get("operating_line_owner") == "snowman_demo_v1"
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

        # Reset must also use exact receipts rather than cloneable metadata.
        assert bpy.ops.operating_line.start() == {"FINISHED"}
        for name in EXPECTED:
            assert_absent(name)
        assert bpy.data.objects.get("UserDuplicateSnowmanHead") is duplicate_head
        assert bpy.data.collections.get("UserDuplicateCollection") is duplicate_collection

        assert bpy.ops.operating_line.next() == {"FINISHED"}
        renamed_lower = bpy.data.objects[EXPECTED[0]]
        renamed_lower.name = "UserRenamedSnowmanLowerBody"
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
    owned_collection = next(
        collection
        for collection in bpy.data.collections
        if collection.get("operating_line_owner") == "snowman_demo_v1"
    )
    assert duplicate_head.name in owned_collection.objects

    duplicate_mesh = duplicate_head.data
    bpy.data.objects.remove(duplicate_head, do_unlink=True)
    if duplicate_mesh.users == 0:
        bpy.data.meshes.remove(duplicate_mesh)
    bpy.data.collections.remove(owned_collection)
    bpy.data.collections.remove(duplicate_collection)
    assert not any(
        collection.get("operating_line_owner") == "snowman_demo_v1"
        for collection in bpy.data.collections
    )
    assert overlay_enabled() is False
    assert not hasattr(bpy.types.Scene, "operating_line_overlay_enabled")
    assert not hasattr(bpy.types.Scene, "operating_line_replace_factory_scene")
    assert not hasattr(bpy.types.WindowManager, "operating_line_runtime_url")
    assert not hasattr(bpy.types.WindowManager, "operating_line_bearer_token")
    assert not registered_companion.timer_registered
    assert not bpy.app.timers.is_registered(registered_companion.timer_callback)
    print("OperatingLine Blender integration test passed")


if __name__ == "__main__":
    main()
