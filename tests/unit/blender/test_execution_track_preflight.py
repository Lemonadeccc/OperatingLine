"""Zero-side-effect Blender execution-track preflight coverage."""

from copy import deepcopy
from importlib import import_module
import json
from pathlib import Path
from queue import Queue
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_execution_track_preflight_test"

fake_bpy = ModuleType("bpy")
fake_bpy.app = SimpleNamespace(version_string="4.5.3", timers=SimpleNamespace())
fake_bpy.context = SimpleNamespace()
fake_bpy.ops = SimpleNamespace()
sys.modules.setdefault("bpy", fake_bpy)

package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = package
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
blender_actions = ModuleType(f"{PACKAGE_NAME}.infrastructure.blender_actions")
blender_actions.action_registry = lambda _root: {}
sys.modules[blender_actions.__name__] = blender_actions
observations = ModuleType(f"{PACKAGE_NAME}.infrastructure.observations")
observations.evaluate_observations = lambda *_args, **_kwargs: []
sys.modules[observations.__name__] = observations
shortcut_history = ModuleType(f"{PACKAGE_NAME}.infrastructure.shortcut_history")
shortcut_history.shortcut_history_mutation_locked = lambda: False
sys.modules[shortcut_history.__name__] = shortcut_history
edit_subdivide_shortcut_history = ModuleType(
    f"{PACKAGE_NAME}.infrastructure.edit_subdivide_shortcut_history"
)
edit_subdivide_shortcut_history.edit_subdivide_shortcut_history_mutation_locked = (
    lambda: False
)
sys.modules[edit_subdivide_shortcut_history.__name__] = (
    edit_subdivide_shortcut_history
)

companion_module = import_module(f"{PACKAGE_NAME}.application.companion")
domain = import_module(f"{PACKAGE_NAME}.domain")
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")


class _Transport:
    def __init__(self, instance_id: str) -> None:
        self.running = True
        self.session_snapshot = SimpleNamespace(
            negotiated_guide_protocol_version="1.6.0"
        )
        self.last_delivered_sequence = 1
        self.current_document_lease = {
            "leaseId": str(uuid.uuid4()),
            "sessionId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": instance_id},
            "documentIncarnationId": str(uuid.uuid4()),
            "expiresAt": "2099-01-01T00:00:00Z",
        }
        self.creates: list[dict] = []
        self.results: list[dict] = []
        self.incoming = Queue()

    def create_execution_track_preflight(self, request: dict) -> None:
        self.creates.append(deepcopy(request))

    def submit_execution_track_preflight_result(self, result: dict) -> None:
        self.results.append(deepcopy(result))


class _Session:
    def __init__(self, source_step: dict, protocol_version: str = "1.6.0") -> None:
        self.plan_id = "tutorial.eye"
        self.revision = 2
        self.plan_content_sha256 = "1" * 64
        self.execution_id = str(uuid.uuid4())
        self.started = True
        self.active_index = -1
        self.steps = (domain.load_task_tree_data({
            "protocolVersion": protocol_version,
            "rootStepId": source_step["id"],
            "steps": [source_step],
        }),)
        self._source = {
            "protocolVersion": protocol_version,
            "id": self.plan_id,
            "revision": self.revision,
            "rootStepId": source_step["id"],
            "steps": [deepcopy(source_step)],
        }

    def source_plan_copy(self) -> dict:
        return deepcopy(self._source)


class ExecutionTrackPreflightTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.action = {
            "adapterId": "blender",
            "name": "blender.mesh.create_uv_sphere",
            "arguments": {
                "resourceId": "eye",
                "objectName": "Eye",
                "radius": 1.5,
                "location": [1.0, 2.0, 3.0],
            },
        }
        self.proof = {
            "executorId": "unavailable.test",
            "targetProfile": "test",
            "executionBoundary": "preflight_only",
            "authorization": "accepted_replay_next_step",
            "transport": "none",
            "operationIds": ["menu.add"],
            "managedActionExecuted": False,
            "managedReceiptCreated": False,
        }
        self.track = {
            "id": "menu.layout.add.mesh.uv_sphere",
            "modality": "menu",
            "availability": "available",
            "steps": [],
            "proofExecution": deepcopy(self.proof),
        }
        interaction_raw = json.loads(
            companion_module.RESOURCE_PATH.read_text(encoding="utf-8")
        )
        self.override = {
            "kind": "interaction_catalog_proof",
            "interactionCatalogVersion": companion_module.BUNDLED_INTERACTION_CATALOG.catalog_version,
            "interactionCatalogContentSha256": companion_module.CompanionTransport._canonical_sha256(interaction_raw),
            "recipeId": "blender.mesh.create_uv_sphere.native",
            "modality": "menu",
            "trackId": self.track["id"],
            "trackContentSha256": companion_module.CompanionTransport._canonical_sha256(self.track),
            "proofExecutionContentSha256": companion_module.CompanionTransport._canonical_sha256(self.proof),
        }
        self.source_step = {
            "id": "eye.create",
            "parentId": None,
            "order": 0,
            "dependsOn": [],
            "title": "Create eye",
            "intent": "Create eye",
            "explanation": "Create eye",
            "state": "pending",
            "action": deepcopy(self.action),
            "anchors": [],
            "expectedObservations": [],
            "rollback": {"mode": "native_undo", "checkpointRequired": True},
            "executionTrackOverride": deepcopy(self.override),
        }
        self.session = _Session(self.source_step)
        package.get_session = lambda: self.session
        self.controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        self.controller.instance_id = self.instance_id
        self.controller._transport = _Transport(self.instance_id)
        self.controller._last_accepted_proposal_id = str(uuid.uuid4())
        self.controller._last_accepted_proposal_decision = {
            "decisionId": str(uuid.uuid4()),
            "proposalId": self.controller._last_accepted_proposal_id,
            "instanceId": self.instance_id,
            "adapterId": "blender",
            "decision": "accepted",
            "decidedAt": "2026-08-22T01:00:00Z",
        }
        self.controller._pending_proposal_decisions = {}
        self.controller.proposed_plan = None
        self.controller._proposal_candidates = {}
        self.controller.pending_plan = None
        self.controller.last_report = {
            "protocolVersion": "1.6.0",
            "reportId": str(uuid.uuid4()),
            "sequence": 1,
        }
        self.controller.last_delivered_sequence = 1
        self.controller.execution_track_preflight_request = None
        self.controller.execution_track_preflight_status = None
        self.controller.execution_track_preflight_message = ""
        self.controller._execution_track_driver = None
        self.controller._execution_track_delivery = None
        self.controller._shortcut_proof_driver = None
        self.controller._menu_control_proof_driver = None
        self.controller._menu_control_history = SimpleNamespace(mutation_locked=False)
        self.controller._menu_control_recovery_locked = False
        self.controller.error = ""
        self.controller.status = "Connected"
        self.controller._stopping_transports = []
        self.controller.pending_plan_content_sha256 = None
        self.controller._timer_registered = False

    def _delivery(self) -> dict:
        request = self.controller.execution_track_preflight_request
        if request is None:
            request = self.controller.request_execution_track_preflight()
        source_leaf = {
            "id": request["leafId"],
            "kind": "leaf",
            "title": "Create eye",
            "semanticActions": [],
            "action": deepcopy(self.action),
            "menuTracks": [deepcopy(self.track)],
            "shortcutTracks": [],
            "mcpTracks": [],
            "validation": [],
        }
        decision = self.controller._last_accepted_proposal_decision
        accepted_decision = {
            "protocolVersion": request["plan"]["protocolVersion"],
            "decisionId": decision["decisionId"],
            "proposalId": decision["proposalId"],
            "instanceId": decision["instanceId"],
            "adapterId": decision["adapterId"],
            "decision": "accepted",
            "occurredAt": decision["decidedAt"],
        }
        replay_id = str(uuid.uuid4())
        binding = {
            **deepcopy(request),
            "proposal": {"id": request["proposalId"], "contentSha256": "2" * 64},
            "replayId": replay_id,
            "step": deepcopy(self.source_step),
            "review": {"id": str(uuid.uuid4()), "contentSha256": "3" * 64},
            "revision": {"requestContentSha256": "4" * 64, "diffContentSha256": "5" * 64},
            "replay": {"id": replay_id, "bindingContentSha256": "6" * 64},
            "artifacts": {
                "procedureTreeContentSha256": "7" * 64,
                "sourceLeafContentSha256": companion_module.CompanionTransport._canonical_sha256(source_leaf),
            },
            "catalogs": {
                "action": {
                    "version": domain.BLENDER_ACTION_CATALOG_VERSION,
                    "contentSha256": companion_module.CompanionTransport._canonical_sha256(
                        domain.bundled_action_catalog_data()
                    ),
                },
                "interaction": {
                    "version": companion_module.BUNDLED_INTERACTION_CATALOG.catalog_version,
                    "contentSha256": request["override"]["interactionCatalogContentSha256"],
                    "recipeId": request["override"]["recipeId"],
                },
            },
            "acceptance": {
                "decision": accepted_decision,
                "decisionContentSha256": companion_module.CompanionTransport._canonical_sha256(
                    accepted_decision
                ),
                "receipt": {
                    "sequence": 1,
                    "subjectType": "guide_proposal_decision",
                    "subjectId": decision["decisionId"],
                    "authentication": "negotiated_companion_lease",
                    "adapterId": "blender",
                    "instanceId": self.instance_id,
                    "sessionFingerprintSha256": "8" * 64,
                    "receivedAt": "2026-08-22T01:00:30Z",
                },
            },
            "action": deepcopy(self.action),
            "sourceLeaf": source_leaf,
            "selectedTrack": deepcopy(self.track),
            "requestedAt": "2026-08-22T01:01:00Z",
        }
        binding.pop("proposalId")
        binding["bindingContentSha256"] = companion_module.CompanionTransport._canonical_sha256(binding)
        return {
            "binding": binding,
            "deliveryId": str(uuid.uuid4()),
            "lease": deepcopy(self.controller._transport.current_document_lease),
            "dispatchedAt": "2026-08-22T01:02:00Z",
        }

    def test_builds_exact_client_known_request_after_decision_ack(self) -> None:
        request = self.controller.request_execution_track_preflight()

        self.assertEqual(set(request), {
            "formatVersion", "requestId", "target", "proposalId", "plan",
            "executionId", "leafId", "override", "expectedState",
        })
        self.assertEqual(request["override"], self.override)
        self.assertEqual(self.controller._transport.creates, [request])

    def test_guide_1_7_candidate_does_not_change_execution_track_authority(self) -> None:
        self.source_step["candidateMenuProjection"] = {
            "projection": "candidate_only",
            "interactionCatalogVersion": "1.49.0",
            "id": "candidate.eye.menu",
            "modality": "menu",
            "equivalence": "not_equivalent_to_managed_action",
            "executionAuthority": "none",
            "title": "Candidate eye menu",
            "reason": "Display only.",
            "preconditions": [
                {"kind": "workspace", "label": "Workspace", "value": "Layout"}
            ],
            "operations": [
                {
                    "id": "candidate.menu.add",
                    "order": 1,
                    "semanticRefs": ["semantic.create-eye"],
                    "description": "Open Add.",
                    "evidenceRefs": [],
                    "intent": "navigate",
                    "target": {"kind": "menu", "hostId": "VIEW3D_MT_add"},
                    "path": ["Layout", "Add"],
                    "parameters": {},
                }
            ],
            "omittedActionArguments": [],
        }
        self.session = _Session(self.source_step, "1.7.0")
        package.get_session = lambda: self.session
        self.controller._transport.session_snapshot.negotiated_guide_protocol_version = (
            "1.7.0"
        )
        self.controller.last_report["protocolVersion"] = "1.7.0"

        request = self.controller.request_execution_track_preflight()
        self.assertEqual(request["plan"]["protocolVersion"], "1.7.0")
        self.assertEqual(request["override"], self.override)
        self.assertNotIn("candidateMenuProjection", request)

        self.controller._handle_execution_track_preflight_delivery(self._delivery())
        result = self.controller._transport.results[-1]
        self.assertEqual(result["status"], "verified_unavailable")
        self.assertTrue(result["authorityVerified"])

    def test_guide_1_7_status_report_preserves_negotiated_protocol(self) -> None:
        self.controller._transport.session_snapshot.negotiated_guide_protocol_version = (
            "1.7.0"
        )
        self.session.active_step = None
        self.session.completed_step_ids = ()
        self.session.observation_blocked = False
        self.session.observation_gate = None
        self.session.receipts = {}
        self.controller._sequence = 0
        self.controller._artifact_attestation_execution_id = None
        self.controller._artifact_attestation = None

        report = self.controller.report("connected", submit=False)

        self.assertEqual(report["protocolVersion"], "1.7.0")
        self.assertIsNone(report["observationGate"])
        self.assertIsNone(report["artifactAttestation"])

    def test_refuses_create_until_acceptance_ack(self) -> None:
        decision = self.controller._last_accepted_proposal_decision
        self.controller._pending_proposal_decisions[decision["decisionId"]] = {}

        with self.assertRaisesRegex(ValueError, "acknowledge"):
            self.controller.request_execution_track_preflight()

        self.assertEqual(self.controller._transport.creates, [])

    def test_refuses_a_second_active_request(self) -> None:
        first = self.controller.request_execution_track_preflight()

        with self.assertRaisesRegex(ValueError, "already active"):
            self.controller.request_execution_track_preflight()

        self.assertEqual(self.controller._transport.creates, [first])

    def test_valid_authority_reports_only_verified_executor_unavailability(self) -> None:
        delivery = self._delivery()

        self.controller._handle_execution_track_preflight_delivery(delivery)

        result = self.controller._transport.results[-1]
        self.assertEqual(result["status"], "verified_unavailable")
        self.assertTrue(result["authorityVerified"])
        self.assertEqual(result["reasonCode"], "executor_unavailable")
        self.assertEqual(result["capability"], "preflight_only")

    def test_key_authority_drifts_fail_closed_without_execution(self) -> None:
        mutations = {
            "lease": lambda value: value["lease"].__setitem__("sessionId", str(uuid.uuid4())),
            "decision": lambda value: value["binding"]["acceptance"]["decision"].__setitem__("decisionId", str(uuid.uuid4())),
            "state": lambda value: value["binding"]["expectedState"].__setitem__("sequence", 2),
            "track": lambda value: value["binding"]["selectedTrack"].__setitem__("id", "menu.changed"),
            "catalog": lambda value: value["binding"]["catalogs"]["action"].__setitem__("contentSha256", "f" * 64),
            "decision_hash": lambda value: value["binding"]["acceptance"].__setitem__("decisionContentSha256", "f" * 64),
            "receipt": lambda value: value["binding"]["acceptance"]["receipt"].__setitem__("authentication", "none"),
            "replay": lambda value: value["binding"]["replay"].__setitem__("id", str(uuid.uuid4())),
            "chronology": lambda value: value.__setitem__("dispatchedAt", "2026-08-22T01:00:00Z"),
            "source_membership": lambda value: value["binding"]["sourceLeaf"].__setitem__("menuTracks", []),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name):
                self.controller._transport.results.clear()
                delivery = self._delivery()
                mutate(delivery)
                if name not in {"lease"}:
                    content = {
                        key: value for key, value in delivery["binding"].items()
                        if key != "bindingContentSha256"
                    }
                    delivery["binding"]["bindingContentSha256"] = (
                        companion_module.CompanionTransport._canonical_sha256(content)
                    )
                self.controller._handle_execution_track_preflight_delivery(delivery)
                result = self.controller._transport.results[-1]
                self.assertEqual(result["status"], "rejected")
                self.assertFalse(result["authorityVerified"])
                self.assertIn(result["reasonCode"], {
                    "authority_invalid", "binding_invalid", "history_locked", "preflight_rejected"
                })

    def test_hostile_nested_terminal_identity_never_escapes_or_posts(self) -> None:
        mutations = (
            lambda value: value.__setitem__("lease", "hostile"),
            lambda value: value["binding"].__setitem__("proposal", None),
            lambda value: value["binding"].__setitem__("plan", None),
            lambda value: value["binding"].__setitem__("target", None),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.controller._transport.results.clear()
                delivery = self._delivery()
                mutate(delivery)
                self.controller._handle_execution_track_preflight_delivery(delivery)
                self.assertEqual(self.controller._transport.results, [])
                self.assertEqual(self.controller.status, "Track preflight rejected")

    def test_pump_ignores_stale_and_regressive_preflight_messages(self) -> None:
        delivery = self._delivery()
        request_id = delivery["binding"]["requestId"]
        stale_delivery = deepcopy(delivery)
        stale_delivery["binding"]["requestId"] = str(uuid.uuid4())
        stale_content = {
            key: value for key, value in stale_delivery["binding"].items()
            if key != "bindingContentSha256"
        }
        stale_delivery["binding"]["bindingContentSha256"] = (
            companion_module.CompanionTransport._canonical_sha256(stale_content)
        )
        self.controller.execution_track_preflight_status = {
            "status": "verified_unavailable",
            "requestId": request_id,
        }
        terminal = deepcopy(self.controller.execution_track_preflight_status)
        self.controller._transport.incoming.put({
            "kind": "execution_track_preflight_delivery",
            "request": stale_delivery,
        })
        self.controller._transport.incoming.put({
            "kind": "execution_track_preflight_status",
            "requestId": str(uuid.uuid4()),
            "status": {"status": "rejected"},
        })
        self.controller._transport.incoming.put({
            "kind": "execution_track_preflight_create_rejected",
            "requestId": str(uuid.uuid4()),
            "message": "stale create rejection",
        })
        self.controller._transport.incoming.put({
            "kind": "execution_track_preflight_result_rejected",
            "requestId": str(uuid.uuid4()),
            "message": "stale result rejection",
        })
        self.controller._transport.incoming.put({
            "kind": "execution_track_preflight_result_acknowledged",
            "requestId": str(uuid.uuid4()),
            "result": "accepted",
        })
        self.controller._transport.incoming.put({
            "kind": "execution_track_preflight_status",
            "requestId": request_id,
            "status": {"status": "queued"},
        })

        self.controller.pump()

        self.assertEqual(self.controller.execution_track_preflight_status, terminal)
        self.assertEqual(self.controller._transport.results, [])
        self.assertEqual(
            self.controller.execution_track_preflight_request["requestId"], request_id
        )


class ExecutionTrackPreflightTransportTests(unittest.TestCase):
    @staticmethod
    def _result() -> dict:
        return {
            "formatVersion": "1.0.0",
            "requestId": str(uuid.uuid4()),
            "replayId": str(uuid.uuid4()),
            "deliveryId": str(uuid.uuid4()),
            "bindingContentSha256": "1" * 64,
            "target": {"adapterId": "blender", "instanceId": str(uuid.uuid4())},
            "leaseId": str(uuid.uuid4()),
            "proposalId": str(uuid.uuid4()),
            "planId": "plan",
            "planRevision": 1,
            "executionId": str(uuid.uuid4()),
            "leafId": "leaf",
            "status": "verified_unavailable",
            "authorityVerified": True,
            "capability": "preflight_only",
            "reasonCode": "executor_unavailable",
            "error": "executor unavailable",
            "occurredAt": "2026-08-22T01:00:00Z",
        }

    @staticmethod
    def _http_error(code: str) -> HTTPError:
        error = HTTPError("http://127.0.0.1", 409, "Conflict", {}, None)
        error.runtime_payload = {"error": code, "message": f"server: {code}"}
        return error

    def _drain_result(self, responses: list[object]) -> tuple[list[dict], list[dict]]:
        result = self._result()
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            result["target"]["instanceId"],
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=result["leaseId"],
            session_id=transport._session_id,
            document_incarnation_id=transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=10.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=9999999999.0,
            heartbeat_sequence=0,
        )
        posted: list[dict] = []

        def request_json(method, path, payload=None, **_kwargs):
            if path == "/api/v1/companion/execution-track-preflight/result":
                posted.append(deepcopy(payload))
                response = responses.pop(0)
                if isinstance(response, Exception):
                    raise response
                return response
            if path.startswith("/api/v1/companion/execution-track-preflight?"):
                return {"status": "rejected"}
            raise AssertionError(f"Unexpected request: {method} {path}")

        transport._request_json = request_json
        transport.submit_execution_track_preflight_result(result)
        transport._flush_deadline = 9999999999.0
        transport._stop.set()
        transport._run()
        messages = []
        while not transport.incoming.empty():
            messages.append(transport.incoming.get_nowait())
        return posted, messages

    def test_dedicated_authority_change_downgrades_once_then_retries(self) -> None:
        posted, messages = self._drain_result([
            self._http_error("execution_track_preflight_verified_authority_changed"),
            {"result": "accepted"},
        ])

        self.assertEqual(len(posted), 2)
        original_identity = transport_module.CompanionTransport._execution_track_preflight_result_identity(
            posted[0]
        )
        self.assertEqual(
            transport_module.CompanionTransport._execution_track_preflight_result_identity(
                posted[1]
            ),
            original_identity,
        )
        self.assertEqual(posted[1]["status"], "rejected")
        self.assertFalse(posted[1]["authorityVerified"])
        self.assertEqual(posted[1]["reasonCode"], "authority_invalid")
        self.assertNotEqual(posted[1]["occurredAt"], posted[0]["occurredAt"])
        self.assertFalse(any(
            message.get("kind") == "execution_track_preflight_result_rejected"
            for message in messages
        ))
        self.assertTrue(any(
            message.get("kind") == "execution_track_preflight_result_acknowledged"
            for message in messages
        ))

    def test_other_409_codes_never_downgrade(self) -> None:
        for code in (
            "execution_track_preflight_result_identity_mismatch",
            "companion_lease_mismatch",
            "some_other_conflict",
        ):
            with self.subTest(code=code):
                posted, messages = self._drain_result([self._http_error(code)])
                self.assertEqual(len(posted), 1)
                self.assertEqual(posted[0]["status"], "verified_unavailable")
                self.assertTrue(any(
                    message.get("kind") == "execution_track_preflight_result_rejected"
                    for message in messages
                ))

    def test_dedicated_conflict_cannot_downgrade_twice(self) -> None:
        conflict = "execution_track_preflight_verified_authority_changed"
        posted, messages = self._drain_result([
            self._http_error(conflict),
            self._http_error(conflict),
        ])

        self.assertEqual(len(posted), 2)
        self.assertEqual(posted[1]["status"], "rejected")
        self.assertEqual(
            sum(
                message.get("kind") == "execution_track_preflight_result_rejected"
                for message in messages
            ),
            1,
        )

    def test_dedicated_code_on_create_stays_a_permanent_create_rejection(self) -> None:
        instance_id = str(uuid.uuid4())
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=transport._session_id,
            document_incarnation_id=transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=10.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=9999999999.0,
            heartbeat_sequence=0,
        )
        request_id = str(uuid.uuid4())

        def request_json(_method, path, _payload=None, **_kwargs):
            self.assertEqual(path, "/api/v1/companion/execution-track-preflight")
            raise self._http_error(
                "execution_track_preflight_verified_authority_changed"
            )

        transport._request_json = request_json
        transport.create_execution_track_preflight({"requestId": request_id})
        transport._flush_deadline = 9999999999.0
        transport._stop.set()
        transport._run()

        message = transport.incoming.get_nowait()
        self.assertEqual(message["kind"], "execution_track_preflight_create_rejected")
        self.assertEqual(message["requestId"], request_id)
        self.assertTrue(transport.execution_track_preflight_results.empty())

    def test_every_preflight_endpoint_injects_the_current_lease(self) -> None:
        instance_id = str(uuid.uuid4())
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        lease_id = str(uuid.uuid4())
        transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=lease_id,
            session_id=transport._session_id,
            document_incarnation_id=transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=10.0,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=0.0,
            heartbeat_sequence=0,
        )
        captured: list[dict] = []

        class Response:
            status = 200
            reason = "OK"
            headers = {}

            def __init__(self) -> None:
                self._body = b'{"result":"accepted"}'

            def read1(self, _size):
                body, self._body = self._body, b""
                return body

        class Connection:
            sock = None

            def __init__(self, *_args, **_kwargs):
                pass

            def request(self, method, path, body=None, headers=None):
                captured.append({"method": method, "path": path, "headers": headers})

            def getresponse(self):
                return Response()

            def close(self):
                pass

        requests = (
            ("POST", "/api/v1/companion/execution-track-preflight", {}),
            ("GET", "/api/v1/companion/execution-track-preflight?requestId=x", None),
            ("GET", "/api/v1/companion/execution-track-preflight/poll?adapterId=blender", None),
            ("POST", "/api/v1/companion/execution-track-preflight/result", {}),
        )
        with patch.object(transport_module, "HTTPConnection", Connection):
            for method, path, payload in requests:
                transport._request_json(method, path, payload)

        self.assertEqual(len(captured), len(requests))
        self.assertTrue(all(
            request["headers"]["x-operatingline-companion-lease"] == lease_id
            for request in captured
        ))


if __name__ == "__main__":
    unittest.main()
