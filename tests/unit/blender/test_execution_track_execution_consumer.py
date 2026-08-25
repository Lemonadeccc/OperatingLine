"""Blender-side managed execution-track v2 fail-closed consumer tests."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from importlib import import_module
import json
from pathlib import Path
from queue import Queue
import subprocess
import sys
import threading
from types import ModuleType, SimpleNamespace
import unittest
import uuid
from unittest.mock import Mock, patch


PACKAGE_ROOT = (
    Path(__file__).resolve().parents[3]
    / "adapters"
    / "blender"
    / "extension"
    / "operating_line"
)
PACKAGE_NAME = "operating_line_execution_track_execution_consumer_test"

fake_bpy = ModuleType("bpy")
fake_bpy.context = SimpleNamespace(scene={})
fake_bpy.app = SimpleNamespace(version_string="4.5.3", timers=SimpleNamespace())
fake_bpy.ops = SimpleNamespace()
previous_bpy = sys.modules.get("bpy")
sys.modules["bpy"] = fake_bpy
package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = package
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
consumer = import_module(f"{PACKAGE_NAME}.infrastructure.execution_track_execution")
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")
blender_actions = ModuleType(f"{PACKAGE_NAME}.infrastructure.blender_actions")
blender_actions.action_registry = lambda _root: {}
sys.modules[blender_actions.__name__] = blender_actions
observations = ModuleType(f"{PACKAGE_NAME}.infrastructure.observations")
observations.evaluate_observations = lambda *_args, **_kwargs: []
sys.modules[observations.__name__] = observations
companion_module = import_module(f"{PACKAGE_NAME}.application.companion")
if previous_bpy is None:
    del sys.modules["bpy"]
else:
    sys.modules["bpy"] = previous_bpy


class FakeScene(dict):
    pass


class ExecutionTrackExecutionConsumerTests(unittest.TestCase):
    def test_transport_services_explicit_lease_refresh_on_network_thread(self) -> None:
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        now = datetime.now(timezone.utc)
        stale = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=transport._session_id,
            document_incarnation_id=transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.7.0",
            heartbeat_interval_seconds=5.0,
            expires_at=(now + timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
            next_heartbeat_at=0.0,
            heartbeat_sequence=2,
        )
        renewed = transport_module.CompanionSessionSnapshot(
            **{
                **stale.__dict__,
                "expires_at": (now + timedelta(seconds=30))
                .isoformat()
                .replace("+00:00", "Z"),
                "heartbeat_sequence": 3,
            }
        )
        transport._session_snapshot = stale
        transport._send_heartbeat = lambda: setattr(
            transport, "_session_snapshot", renewed
        )
        request = transport_module._LeaseRefreshRequest(
            minimum_validity_seconds=5.0,
            completed=threading.Event(),
        )
        transport._lease_refresh_requests.put(request)

        self.assertTrue(transport._service_lease_refresh_requests())
        self.assertTrue(request.completed.is_set())
        self.assertIsNone(request.error)
        self.assertEqual(request.lease["expiresAt"], renewed.expires_at)

    def test_execution_track_proof_pushes_native_baseline_guard(self) -> None:
        calls = []
        region = SimpleNamespace(type="WINDOW")
        space = object()
        area = SimpleNamespace(
            type="VIEW_3D",
            regions=[region],
            spaces=SimpleNamespace(active=space),
        )
        window = SimpleNamespace(screen=SimpleNamespace(areas=[area]))

        class Override:
            def __enter__(self):
                calls.append("override_enter")

            def __exit__(self, *_args):
                calls.append("override_exit")

        context = SimpleNamespace(
            window=window,
            temp_override=lambda **kwargs: calls.append(kwargs) or Override(),
        )
        ops = SimpleNamespace(
            ed=SimpleNamespace(
                undo_push=lambda **kwargs: calls.append(kwargs) or {"FINISHED"}
            )
        )
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._supersede_restored_menu_history = lambda: calls.append(
            "supersede"
        ) or False

        with patch.object(companion_module.bpy, "context", context), patch.object(
            companion_module.bpy, "ops", ops
        ):
            self.assertTrue(controller._prepare_execution_track_proof_history())

        self.assertEqual(calls[0], "supersede")
        self.assertEqual(calls[1]["area"], area)
        self.assertEqual(calls[1]["region"], region)
        self.assertEqual(calls[1]["space_data"], space)
        self.assertEqual(
            calls[2:],
            [
                "override_enter",
                {
                    "message": (
                        "OperatingLine execution-track proof baseline guard"
                    )
                },
                "override_exit",
            ],
        )

    def test_execution_track_delivery_accepts_only_monotonic_heartbeat_lease(self) -> None:
        delivered = {
            "leaseId": "90000000-0000-4000-8000-000000000001",
            "sessionId": "90000000-0000-4000-8000-000000000002",
            "target": {
                "adapterId": "blender",
                "instanceId": "90000000-0000-4000-8000-000000000003",
            },
            "documentIncarnationId": "90000000-0000-4000-8000-000000000004",
            "expiresAt": "2026-08-24T12:00:20Z",
        }
        renewed = {**delivered, "expiresAt": "2026-08-24T12:00:40Z"}

        self.assertTrue(
            companion_module.CompanionController._execution_track_lease_is_monotonic(
                delivered, delivered
            )
        )
        self.assertTrue(
            companion_module.CompanionController._execution_track_lease_is_monotonic(
                delivered, renewed
            )
        )
        self.assertFalse(
            companion_module.CompanionController._execution_track_lease_is_monotonic(
                renewed, delivered
            )
        )
        self.assertFalse(
            companion_module.CompanionController._execution_track_lease_is_monotonic(
                delivered,
                {
                    **renewed,
                    "documentIncarnationId": "90000000-0000-4000-8000-000000000005",
                },
            )
        )

    def _managed_repair_fixture(self) -> dict:
        script = r"""
import {
  companionExecutionTrackExecutionRecoveryRequestSchema,
  companionExecutionTrackExecutionResultSchema,
  companionStateReportSchema,
  computeProtocolCanonicalJsonSha256,
} from './packages/protocol/src/index.ts';
import {
  managedExecutionTrackBaseline,
  managedExecutionTrackBinding,
  managedExecutionTrackManagedStart,
  managedExecutionTrackProgressTail,
} from './tests/support/managed-execution-track-scenario.ts';
const binding = managedExecutionTrackBinding();
const lease = {
  leaseId: '90000000-0000-4000-8000-000000000060',
  sessionId: '90000000-0000-4000-8000-000000000061',
  target: binding.target,
  documentIncarnationId: '90000000-0000-4000-8000-000000000062',
  expiresAt: '2026-08-22T10:10:00Z',
};
const delivery = { binding, deliveryId: '90000000-0000-4000-8000-000000000063',
  lease, dispatchedAt: '2026-08-22T10:00:01Z' };
const baseline = managedExecutionTrackBaseline(delivery);
const tail = managedExecutionTrackProgressTail(delivery, baseline);
const commit = tail.at(-1);
const submission = managedExecutionTrackManagedStart(delivery, commit);
const failedCheckpoint = {
  formatVersion: '1.0.0', evidenceClass: 'companion_reported_native_undo_checkpoint',
  checkpointId: '90000000-0000-4000-8000-000000000064',
  previousCheckpointId: baseline.startCheckpoint.checkpointId,
  operation: 'next', committedAt: '2026-08-22T10:00:22Z',
  marker: { key: '_operating_line_native_history_v1', matched: true },
  journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
  session: { plan: { id: binding.plan.id, revision: binding.plan.revision },
    planContentSha256: binding.plan.contentSha256, executionId: binding.executionId,
    activeStepId: binding.leafId, completedStepIds: [], receiptStepIds: [binding.leafId] },
};
const failedObservation = { kind: 'uv_sphere_ready', satisfied: false,
  details: { reason: 'not ready' } };
const failedGate = { stepId: binding.leafId, status: 'repair_required',
  failureStrategy: 'retain_for_repair', message: 'repair required' };
const failedReport = companionStateReportSchema.parse({
  protocolVersion: binding.plan.protocolVersion,
  reportId: '90000000-0000-4000-8000-000000000065',
  sequence: binding.expectedState.sequence + 1, adapterId: 'blender',
  instanceId: binding.target.instanceId, companionVersion: '0.1.0', hostVersion: '4.5.3',
  plan: { id: binding.plan.id, revision: binding.plan.revision },
  planContentSha256: binding.plan.contentSha256, executionId: binding.executionId,
  phase: 'blocked', activeStepId: binding.leafId, completedStepIds: [],
  transition: 'step_observation_failed', stepId: binding.leafId,
  observations: [failedObservation], observationGate: failedGate, artifactAttestation: null,
  nativeUndoCheckpoint: failedCheckpoint, error: null, occurredAt: '2026-08-22T10:00:23Z',
});
const failedResult = companionExecutionTrackExecutionResultSchema.parse({
  formatVersion: '2.0.0', requestId: binding.requestId, deliveryId: delivery.deliveryId,
  bindingContentSha256: binding.bindingContentSha256, target: binding.target,
  leaseId: lease.leaseId, currentLease: lease, proposalId: binding.proposalId,
  planId: binding.plan.id, planRevision: binding.plan.revision, executionId: binding.executionId,
  leafId: binding.leafId, occurredAt: '2026-08-22T10:00:24Z', status: 'failed_managed',
  startCheckpointId: baseline.startCheckpoint.checkpointId,
  commitIntentId: commit.intent.intentId, commitIntentContentSha256: commit.intent.contentSha256,
  baselineContentSha256: commit.baseline.contentSha256,
  proofEvidenceContentSha256: commit.proofEvidenceContentSha256,
  lastProgressContentSha256: commit.contentSha256, managedStart: submission.managedStart,
  managedReport: { reportId: failedReport.reportId, sequence: failedReport.sequence,
    transition: 'step_observation_failed', stepId: binding.leafId,
    contentSha256: computeProtocolCanonicalJsonSha256(failedReport) },
  managedCheckpoint: { checkpointId: failedCheckpoint.checkpointId,
    previousCheckpointId: failedCheckpoint.previousCheckpointId, operation: 'next',
    receiptStepIds: failedCheckpoint.session.receiptStepIds,
    contentSha256: computeProtocolCanonicalJsonSha256(failedCheckpoint) },
  observationGate: failedGate,
  failedObservation: { observationIndex: 0, kind: failedObservation.kind, satisfied: false,
    contentSha256: computeProtocolCanonicalJsonSha256(failedObservation) },
  retainsTargetLock: true, error: 'managed observation failed',
});
const failedResultHash = computeProtocolCanonicalJsonSha256(failedResult);
const markerContent = { kind: 'persisted_managed_terminal', terminalStatus: 'failed_managed',
  terminalResultContentSha256: failedResultHash, managedReportId: failedReport.reportId,
  managedReportSequence: failedReport.sequence, managedCheckpointId: failedCheckpoint.checkpointId,
  sceneFingerprintSha256: '1'.repeat(64), viewLayerIdentitySha256: '2'.repeat(64),
  objectIdentitySha256: '3'.repeat(64), meshIdentitySha256: '4'.repeat(64),
  collectionIdentitySha256: '5'.repeat(64), sessionUidDomainSha256: '6'.repeat(64),
  pointerDomainSha256: '7'.repeat(64), linksAndSelectionSha256: '8'.repeat(64),
  failedObservationContentSha256: failedResult.failedObservation.contentSha256 };
const marker = { ...markerContent, contentSha256: computeProtocolCanonicalJsonSha256(markerContent) };
const replacementLease = { ...lease, leaseId: '90000000-0000-4000-8000-000000000066',
  expiresAt: '2026-08-22T10:30:00Z' };
const request = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
  formatVersion: '2.0.0', recoveryId: '90000000-0000-4000-8000-000000000067',
  requestId: binding.requestId, target: binding.target, originalDeliveryId: delivery.deliveryId,
  bindingContentSha256: binding.bindingContentSha256, originalLease: lease,
  replacementLease, acceptedProgress: commit,
  acceptedProgressChainHeadContentSha256: commit.contentSha256,
  durableReferences: { terminalMarkerContentSha256: marker.contentSha256,
    terminalResultContentSha256: failedResultHash,
    managedStartContentSha256: submission.managedStart.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256 },
  source: 'failed_managed_repair', mode: 'read_only_reconcile', automaticReplay: false,
  requestedAt: '2026-08-22T10:15:00Z',
});
console.log(JSON.stringify({ request, progress: commit, result: failedResult, marker,
  failedReport, replacementLease }));
"""
        completed = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", script],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(completed.stdout)

    def _managed_success_recovery_fixture(self) -> dict:
        script = r"""
import {
  companionExecutionTrackExecutionRecoveryRequestSchema,
} from './packages/protocol/src/index.ts';
import {
  managedExecutionTrackBaseline,
  managedExecutionTrackBinding,
  managedExecutionTrackManagedStart,
  managedExecutionTrackProgressTail,
  managedExecutionTrackSuccessReport,
  managedExecutionTrackSuccessResult,
} from './tests/support/managed-execution-track-scenario.ts';
const binding = managedExecutionTrackBinding();
const lease = {
  leaseId: '90000000-0000-4000-8000-000000000070',
  sessionId: '90000000-0000-4000-8000-000000000071',
  target: binding.target,
  documentIncarnationId: '90000000-0000-4000-8000-000000000072',
  expiresAt: '2026-08-22T10:10:00Z',
};
const delivery = {
  binding,
  deliveryId: '90000000-0000-4000-8000-000000000073',
  lease,
  dispatchedAt: '2026-08-22T10:00:01Z',
};
const baseline = managedExecutionTrackBaseline(delivery);
const tail = managedExecutionTrackProgressTail(delivery, baseline);
const commit = tail.at(-1);
const submission = managedExecutionTrackManagedStart(delivery, commit);
const report = managedExecutionTrackSuccessReport(delivery, baseline);
const result = managedExecutionTrackSuccessResult(
  delivery, baseline, commit, submission, report,
);
const replacementLease = {
  ...lease,
  leaseId: '90000000-0000-4000-8000-000000000074',
  expiresAt: '2026-08-22T10:30:00Z',
};
const request = companionExecutionTrackExecutionRecoveryRequestSchema.parse({
  formatVersion: '2.0.0',
  recoveryId: '90000000-0000-4000-8000-000000000075',
  requestId: binding.requestId,
  target: binding.target,
  originalDeliveryId: delivery.deliveryId,
  bindingContentSha256: binding.bindingContentSha256,
  originalLease: lease,
  replacementLease,
  acceptedProgress: commit,
  acceptedProgressChainHeadContentSha256: commit.contentSha256,
  durableReferences: {
    terminalMarkerContentSha256: null,
    managedStartContentSha256: submission.managedStart.contentSha256,
    baselineContentSha256: commit.baseline.contentSha256,
    commitIntentId: commit.intent.intentId,
    commitIntentContentSha256: commit.intent.contentSha256,
  },
  source: 'coordinator_restart',
  mode: 'read_only_reconcile',
  automaticReplay: false,
  requestedAt: '2026-08-22T10:15:00Z',
});
console.log(JSON.stringify({
  baseline, commit, submission, report, result, replacementLease, request,
}));
"""
        completed = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", script],
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(completed.stdout)

    def _assert_recovery_ack_matches_strict_schema(self, ack: dict) -> None:
        validation_script = r"""
import {
  companionExecutionTrackExecutionRecoveryAckSchema,
} from './packages/protocol/src/index.ts';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
companionExecutionTrackExecutionRecoveryAckSchema.parse(JSON.parse(raw));
process.stdout.write('accepted');
"""
        validated = subprocess.run(
            [
                "node",
                "--import",
                "tsx",
                "--input-type=module",
                "-e",
                validation_script,
            ],
            input=json.dumps(ack),
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(validated.returncode, 0, validated.stderr)
        self.assertEqual(validated.stdout, "accepted")

    def test_main_thread_persistence_failure_releases_delivery_for_retry(self) -> None:
        request_id = str(uuid.uuid4())
        delivery = {"binding": {"requestId": request_id}}
        calls = []
        transport = SimpleNamespace(
            current_document_lease={},
            acknowledge_execution_track_execution_delivery=lambda value, persisted: calls.append(
                ("ack", value, persisted)
            ),
            submit_execution_track_execution_progress=lambda value: calls.append(
                ("progress", value)
            ),
            submit_execution_track_execution_result=lambda value: calls.append(
                ("result", value)
            ),
        )
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._transport = transport
        controller.instance_id = str(uuid.uuid4())
        controller.last_report = {}
        controller.execution_track_execution_message = ""
        controller.error = ""
        controller.status = ""
        fake_bpy.context.scene = {}
        outbox = {
            "formatVersion": "2.0.0",
            "progress": {
                "binding": {"requestId": request_id},
                "contentSha256": "a" * 64,
            },
            "baselineProgress": {
                "binding": {"requestId": request_id},
                "contentSha256": "a" * 64,
            },
        }
        controller._execution_track_delivery = None
        controller._execution_track_outbox_cache = None

        with patch.object(consumer, "load_outbox", return_value=None), patch.object(
            controller, "_validate_execution_track_execution_authority"
        ), patch.object(
            consumer, "build_baseline_progress", return_value=outbox["progress"]
        ), patch.object(
            consumer, "build_active_outbox", return_value=outbox
        ), patch.object(
            consumer, "persist_outbox", side_effect=[OSError("disk full"), None]
        ):
            controller._handle_execution_track_execution_delivery(delivery)
            controller._handle_execution_track_execution_delivery(delivery)

        self.assertEqual(calls[0], ("ack", request_id, False))
        self.assertIn(("ack", request_id, True), calls)
        self.assertIn(("progress", outbox["progress"]), calls)
        self.assertNotIn("result", outbox)

    def test_full_orchestrator_fixture_outputs_pass_strict_protocol_schemas(self) -> None:
        fixture_script = r"""
import { managedExecutionTrackBinding } from './tests/support/managed-execution-track-scenario.ts';
import { companionStateReportSchema } from './packages/protocol/src/index.ts';
const binding = managedExecutionTrackBinding();
const checkpoint = {
  formatVersion: '1.0.0', evidenceClass: 'companion_reported_native_undo_checkpoint',
  checkpointId: '90000000-0000-4000-8000-000000000003', previousCheckpointId: null,
  operation: 'start', committedAt: '2026-08-22T09:59:59Z',
  marker: { key: '_operating_line_native_history_v1', matched: true },
  journal: { entryPresent: true, snapshotMatchesSession: true, artifactsBackedUp: true },
  session: { plan: { id: binding.plan.id, revision: binding.plan.revision },
    planContentSha256: binding.plan.contentSha256, executionId: binding.executionId,
    activeStepId: null, completedStepIds: [], receiptStepIds: [] }
};
const report = companionStateReportSchema.parse({
  protocolVersion: binding.plan.protocolVersion, reportId: binding.expectedState.reportId,
  sequence: binding.expectedState.sequence, adapterId: 'blender',
  instanceId: binding.target.instanceId, companionVersion: '0.1.0', hostVersion: '4.5.3',
  plan: { id: binding.plan.id, revision: binding.plan.revision },
  planContentSha256: binding.plan.contentSha256, executionId: binding.executionId,
  phase: 'running', activeStepId: null, completedStepIds: [], transition: 'walkthrough_started',
  stepId: null, observations: [], observationGate: null, artifactAttestation: null,
  nativeUndoCheckpoint: checkpoint, error: null, occurredAt: '2026-08-22T10:00:00Z'
});
const lease = { leaseId: '90000000-0000-4000-8000-000000000010',
  sessionId: '90000000-0000-4000-8000-000000000012', target: binding.target,
  documentIncarnationId: '90000000-0000-4000-8000-000000000013',
  expiresAt: '2026-08-22T10:10:00Z' };
console.log(JSON.stringify({ delivery: { binding, deliveryId: '90000000-0000-4000-8000-000000000014',
  lease, dispatchedAt: '2026-08-22T10:00:01Z' }, report, lease }));
"""
        fixture_run = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", fixture_script],
            check=True,
            capture_output=True,
            text=True,
        )
        fixture = json.loads(fixture_run.stdout)
        snapshot = {"activeObject": None, "selectedObjects": [], "objects": []}
        with patch.object(consumer, "_scene_snapshot", return_value=snapshot), patch.object(
            consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
        ), patch.object(consumer, "_now", return_value="2026-08-22T10:00:02Z"):
            outbox = consumer.build_fail_closed_outbox(
                fixture["delivery"],
                instance_id=fixture["delivery"]["binding"]["target"]["instanceId"],
                last_report=fixture["report"],
                current_lease=fixture["lease"],
            )
            replacement_lease = {
                **fixture["lease"],
                "leaseId": "90000000-0000-4000-8000-000000000015",
                "expiresAt": "2026-08-22T10:30:00Z",
            }
            recovery_request = {
                "formatVersion": "2.0.0",
                "recoveryId": "90000000-0000-4000-8000-000000000016",
                "requestId": outbox["result"]["requestId"],
                "target": outbox["result"]["target"],
                "originalDeliveryId": outbox["result"]["deliveryId"],
                "bindingContentSha256": outbox["result"]["bindingContentSha256"],
                "originalLease": fixture["lease"],
                "replacementLease": replacement_lease,
                "acceptedProgress": outbox["progress"],
                "acceptedProgressChainHeadContentSha256": outbox["progress"]["contentSha256"],
                "durableReferences": {
                    "terminalMarkerContentSha256": None,
                    "managedStartContentSha256": None,
                    "baselineContentSha256": None,
                    "commitIntentId": None,
                    "commitIntentContentSha256": None,
                },
                "source": "coordinator_restart",
                "mode": "read_only_reconcile",
                "automaticReplay": False,
                "requestedAt": "2026-08-22T10:15:00Z",
            }
        with patch.object(consumer, "_scene_snapshot", return_value=snapshot), patch.object(
            consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
        ), patch.object(consumer, "_now", return_value="2026-08-22T10:20:00Z"):
            recovery_ack = consumer.build_baseline_terminal_recovery_ack(
                recovery_request,
                outbox=outbox,
                current_lease=replacement_lease,
            )
        crash_scene = FakeScene()
        consumer.persist_outbox(crash_scene, outbox)
        restarted_outbox = consumer.load_outbox(crash_scene)
        assert restarted_outbox is not None
        consumer.persist_recovery_ack(crash_scene, restarted_outbox, recovery_ack)
        recovery_posts = []
        restarted_transport = SimpleNamespace(
            submit_execution_track_execution_recovery_ack=lambda value: recovery_posts.append(
                value
            ),
            submit_execution_track_execution_progress=lambda _value: self.fail(
                "accepted progress must not be replayed after recovery ACK persistence"
            ),
            submit_execution_track_execution_result=lambda _value: self.fail(
                "terminal result must travel inside baseline_terminal recovery evidence"
            ),
            enable_execution_track_execution_recovery_poll=lambda: None,
        )
        self.assertTrue(consumer.resubmit_outbox(restarted_transport, crash_scene))
        self.assertEqual(recovery_posts, [recovery_ack])
        self.assertTrue(
            consumer.acknowledge_outbox(
                crash_scene, recovery_ack["requestId"]
            )
        )
        validation_script = r"""
import { companionExecutionTrackExecutionProgressSchema,
  companionExecutionTrackExecutionRecoveryAckSchema,
  companionExecutionTrackExecutionResultSchema } from './packages/protocol/src/index.ts';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const value = JSON.parse(raw);
companionExecutionTrackExecutionProgressSchema.parse(value.progress);
companionExecutionTrackExecutionResultSchema.parse(value.result);
companionExecutionTrackExecutionRecoveryAckSchema.parse(value.recoveryAck);
process.stdout.write('accepted');
"""
        validated = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", validation_script],
            input=json.dumps({**outbox, "recoveryAck": recovery_ack}),
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(validated.returncode, 0, validated.stderr)
        self.assertEqual(validated.stdout, "accepted")

    def test_persisted_managed_terminal_recovery_ack_replays_only_exact_ack(self) -> None:
        fixture = self._managed_success_recovery_fixture()
        managed_snapshot = {
            "activeObject": "OperatingLine.TutorialEye",
            "selectedObjects": ["OperatingLine.TutorialEye"],
            "objects": [
                {
                    "name": "OperatingLine.TutorialEye",
                    "type": "MESH",
                    "mesh": {"vertices": 482, "edges": 992, "polygons": 512},
                }
            ],
        }
        marker = consumer.build_persisted_managed_terminal_marker(
            fixture["result"], managed_snapshot
        )
        outbox = {
            "formatVersion": "2.0.0",
            "progress": fixture["commit"],
            "baselineProgress": fixture["baseline"],
            "managedStartSubmission": fixture["submission"],
            "result": fixture["result"],
            "terminalMarker": marker,
        }
        with patch.object(
            consumer, "_scene_snapshot", return_value=managed_snapshot
        ), patch.object(consumer, "_now", return_value="2026-08-22T10:20:00Z"):
            recovery_ack = consumer.build_persisted_managed_terminal_recovery_ack(
                fixture["request"],
                outbox=outbox,
                current_lease=fixture["replacementLease"],
            )

        self.assertEqual(recovery_ack["outcome"], "reconciled")
        self.assertEqual(
            recovery_ack["evidence"]["kind"], "persisted_managed_terminal"
        )
        self.assertFalse(recovery_ack["retainsTargetLock"])
        self.assertFalse(recovery_ack["automaticReplay"])
        self._assert_recovery_ack_matches_strict_schema(recovery_ack)

        crash_scene = FakeScene()
        consumer.persist_outbox(crash_scene, outbox)
        restarted_outbox = consumer.load_outbox(crash_scene)
        self.assertIsNotNone(restarted_outbox)
        assert restarted_outbox is not None
        consumer.persist_recovery_ack(crash_scene, restarted_outbox, recovery_ack)
        recovery_posts = []
        restarted_transport = SimpleNamespace(
            submit_execution_track_execution_recovery_ack=lambda value: recovery_posts.append(
                value
            ),
            submit_execution_track_execution_progress=lambda _value: self.fail(
                "accepted commit progress must not be replayed after recovery ACK persistence"
            ),
            submit_execution_track_execution_result=lambda _value: self.fail(
                "managed terminal must travel only inside persisted recovery evidence"
            ),
            enable_execution_track_execution_recovery_poll=lambda: None,
        )
        self.assertTrue(
            consumer.resubmit_outbox(restarted_transport, crash_scene)
        )
        self.assertEqual(recovery_posts, [recovery_ack])

    def test_unresolved_commit_recovery_ack_retains_lock_without_replay(self) -> None:
        fixture = self._managed_success_recovery_fixture()
        current_snapshot = {
            "activeObject": "OperatingLine.TutorialEye",
            "selectedObjects": ["OperatingLine.TutorialEye"],
            "objects": [
                {
                    "name": "OperatingLine.TutorialEye",
                    "type": "MESH",
                    "mesh": {"vertices": 482, "edges": 992, "polygons": 512},
                }
            ],
        }
        outbox = {
            "formatVersion": "2.0.0",
            "progress": fixture["commit"],
            "baselineProgress": fixture["baseline"],
            "managedStartSubmission": fixture["submission"],
        }
        with patch.object(
            consumer, "_scene_snapshot", return_value=current_snapshot
        ), patch.object(consumer, "_now", return_value="2026-08-22T10:20:00Z"):
            recovery_ack = consumer.build_unresolved_recovery_ack(
                fixture["request"],
                outbox=outbox,
                current_lease=fixture["replacementLease"],
                current_report=fixture["report"],
            )

        self.assertEqual(recovery_ack["outcome"], "recovery_required")
        self.assertEqual(
            recovery_ack["evidence"]["kind"], "unresolved_current_state"
        )
        self.assertEqual(
            recovery_ack["evidence"]["reason"], "managed_state_indeterminate"
        )
        self.assertTrue(recovery_ack["retainsTargetLock"])
        self.assertFalse(recovery_ack["automaticReplay"])
        self._assert_recovery_ack_matches_strict_schema(recovery_ack)

    def test_complete_python_builder_chain_passes_strict_protocol_schemas(self) -> None:
        fixture_script = r"""
import {
  managedExecutionTrackBaseline,
  managedExecutionTrackBinding,
  managedExecutionTrackStartReport,
} from './tests/support/managed-execution-track-scenario.ts';
const binding = managedExecutionTrackBinding();
const lease = {
  leaseId: '91000000-0000-4000-8000-000000000001',
  sessionId: '91000000-0000-4000-8000-000000000002',
  target: binding.target,
  documentIncarnationId: '91000000-0000-4000-8000-000000000003',
  expiresAt: '2026-08-22T10:30:00Z',
};
const delivery = { binding, deliveryId: '91000000-0000-4000-8000-000000000004',
  lease, dispatchedAt: '2026-08-22T10:00:01Z' };
const scenarioBaseline = managedExecutionTrackBaseline(delivery);
const report = managedExecutionTrackStartReport(delivery, scenarioBaseline);
console.log(JSON.stringify({ delivery, report }));
"""
        fixture_run = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", fixture_script],
            check=True,
            capture_output=True,
            text=True,
        )
        fixture = json.loads(fixture_run.stdout)
        delivery = fixture["delivery"]
        report = fixture["report"]
        baseline_snapshot = {
            "activeObject": "Cube",
            "selectedObjects": ["Cube"],
            "objects": [
                {
                    "name": "Camera",
                    "type": "CAMERA",
                    "mesh": None,
                },
                {
                    "name": "Cube",
                    "type": "MESH",
                    "mesh": {"vertices": 8, "edges": 12, "polygons": 6},
                },
                {
                    "name": "Light",
                    "type": "LIGHT",
                    "mesh": None,
                },
            ],
        }
        with patch.object(consumer, "_scene_snapshot", return_value=baseline_snapshot), patch.object(
            consumer, "_now", return_value="2026-08-22T10:00:02Z"
        ):
            baseline = consumer.build_baseline_progress(
                delivery,
                instance_id=delivery["binding"]["target"]["instanceId"],
                last_report=report,
                current_lease=delivery["lease"],
            )

        final_fingerprint = "f" * 64
        evidence = {
            "operationSummaries": [
                {
                    "operationId": "workspace.layout",
                    "status": "precondition_verified",
                    "path": ["Layout"],
                    "parameters": {},
                },
                {
                    "operationId": "menu.add",
                    "status": "control_executed",
                    "path": ["Layout", "Add"],
                    "parameters": {},
                },
                {
                    "operationId": "menu.mesh",
                    "status": "control_executed",
                    "path": ["Layout", "Add", "Mesh"],
                    "parameters": {},
                },
                {
                    "operationId": "operator.uv_sphere",
                    "status": "control_executed",
                    "path": ["Layout", "Add", "Mesh", "UV Sphere"],
                    "parameters": {"radius": 1.0},
                },
                {
                    "operationId": "control.location",
                    "status": "control_executed",
                    "path": ["Sidebar", "Item", "Transform", "Location"],
                    "parameters": {"value": [1.25, -2.0, 0.75]},
                },
                {
                    "operationId": "control.scale",
                    "status": "control_executed",
                    "path": ["Sidebar", "Item", "Transform", "Scale"],
                    "parameters": {"value": [1.5, 1.5, 1.5]},
                },
                {
                    "operationId": "control.object_name",
                    "status": "control_executed",
                    "path": ["Properties", "Object", "Name"],
                    "parameters": {"value": "OperatingLine.TutorialEye"},
                },
            ],
            "finalState": {
                "objectName": "OperatingLine.TutorialEye",
                "objectType": "MESH",
                "location": [1.25, -2.0, 0.75],
                "scale": [1.5, 1.5, 1.5],
                "meshTopology": {"vertices": 482, "edges": 992, "polygons": 512},
                "meshSha256": "e" * 64,
            },
            "baselineSceneFingerprintSha256": baseline["startAttestation"][
                "sceneFingerprintSha256"
            ],
            "finalSceneFingerprintSha256": final_fingerprint,
            "restoredSceneFingerprintSha256": baseline["startAttestation"][
                "sceneFingerprintSha256"
            ],
            "reappliedSceneFingerprintSha256": final_fingerprint,
        }
        stage_fingerprints = [
            baseline["startAttestation"]["sceneFingerprintSha256"],
            *(character * 64 for character in "1234567"),
            final_fingerprint,
        ]
        proof_checkpoint = {
            "checkpointId": "91000000-0000-4000-8000-000000000005",
            "undoLockId": "91000000-0000-4000-8000-000000000006",
            "stageFingerprints": stage_fingerprints,
            "committedAt": "2026-08-22T10:00:11Z",
        }
        proof, observed = consumer.build_proof_progress_pair(
            baseline,
            evidence,
            current_lease=delivery["lease"],
            checkpoint=proof_checkpoint,
            observed_at="2026-08-22T10:00:10Z",
            occurred_at="2026-08-22T10:00:11Z",
        )
        transitions = []
        for index in range(8):
            internal = {
                "direction": "undo",
                "fromCursor": 8 - index,
                "toCursor": 7 - index,
                "sceneFingerprintSha256": stage_fingerprints[7 - index],
                "occurredAt": f"2026-08-22T10:00:{index + 12:02d}Z",
            }
            transitions.append(
                consumer.build_native_undo_transition(
                    internal,
                    stage_fingerprints=stage_fingerprints,
                    order=index + 1,
                )
            )
        restoring = consumer.build_restore_progress(
            observed,
            transitions[0],
            current_lease=delivery["lease"],
        )
        with patch.object(consumer, "compute_scene_fingerprint_sha256") as fingerprint:
            fingerprint.return_value = baseline["startAttestation"][
                "sceneFingerprintSha256"
            ]
            baseline_identity = consumer.build_baseline_identity(
                baseline, baseline_snapshot
            )
        restored = consumer.build_baseline_restored_progress(
            restoring,
            transitions,
            baseline=baseline_identity,
            current_lease=delivery["lease"],
            occurred_at="2026-08-22T10:00:19Z",
        )
        commit = consumer.build_commit_intent_progress(
            restored,
            current_lease=delivery["lease"],
            occurred_at="2026-08-22T10:00:20Z",
        )
        submission = consumer.build_managed_start_submission(
            commit,
            current_lease=delivery["lease"],
            started_at="2026-08-22T10:00:21Z",
        )
        binding = delivery["binding"]
        completed = [
            *binding["authorizedStartState"]["completedStepIds"],
            binding["leafId"],
        ]
        receipts = [
            *binding["authorizedStartState"]["receiptStepIds"],
            binding["leafId"],
        ]
        managed_checkpoint = {
            "formatVersion": "1.0.0",
            "evidenceClass": "companion_reported_native_undo_checkpoint",
            "checkpointId": "91000000-0000-4000-8000-000000000007",
            "previousCheckpointId": baseline["startCheckpoint"]["checkpointId"],
            "operation": "next",
            "committedAt": "2026-08-22T10:00:22Z",
            "marker": {"key": "_operating_line_native_history_v1", "matched": True},
            "journal": {
                "entryPresent": True,
                "snapshotMatchesSession": True,
                "artifactsBackedUp": True,
            },
            "session": {
                "plan": {"id": binding["plan"]["id"], "revision": binding["plan"]["revision"]},
                "planContentSha256": binding["plan"]["contentSha256"],
                "executionId": binding["executionId"],
                "activeStepId": binding["leafId"],
                "completedStepIds": completed,
                "receiptStepIds": receipts,
            },
        }
        managed_observation = {
            "kind": "uv_sphere_ready",
            "satisfied": True,
            "details": deepcopy(
                binding["preflightBinding"]["step"]["expectedObservations"][0][
                    "parameters"
                ]
            ),
        }
        managed_report = {
            "protocolVersion": binding["plan"]["protocolVersion"],
            "reportId": "91000000-0000-4000-8000-000000000008",
            "sequence": binding["expectedState"]["sequence"] + 1,
            "adapterId": "blender",
            "instanceId": binding["target"]["instanceId"],
            "companionVersion": "0.1.0",
            "hostVersion": "4.5.3",
            "plan": {"id": binding["plan"]["id"], "revision": binding["plan"]["revision"]},
            "planContentSha256": binding["plan"]["contentSha256"],
            "executionId": binding["executionId"],
            "phase": binding["authorizedStartState"]["successPhase"],
            "activeStepId": binding["leafId"],
            "completedStepIds": completed,
            "transition": "step_succeeded",
            "stepId": binding["leafId"],
            "observations": [managed_observation],
            "observationGate": None,
            "artifactAttestation": None,
            "nativeUndoCheckpoint": managed_checkpoint,
            "error": None,
            "occurredAt": "2026-08-22T10:00:23Z",
        }
        result = consumer.build_terminal_result(
            baseline,
            commit,
            submission,
            managed_report,
            current_lease=delivery["lease"],
            occurred_at="2026-08-22T10:00:24Z",
        )
        managed_snapshot = {
            "activeObject": "OperatingLine.TutorialEye",
            "selectedObjects": ["OperatingLine.TutorialEye"],
            "objects": [
                {
                    "name": "OperatingLine.TutorialEye",
                    "type": "MESH",
                    "mesh": {"vertices": 482, "edges": 992, "polygons": 512},
                }
            ],
        }
        marker = consumer.build_persisted_managed_terminal_marker(
            result, managed_snapshot
        )

        validation_script = r"""
import {
  companionExecutionTrackExecutionManagedStartSubmissionSchema,
  companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema,
  companionExecutionTrackExecutionProgressChainSchema,
  companionExecutionTrackExecutionResultSchema,
  companionStateReportSchema,
} from './packages/protocol/src/index.ts';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const value = JSON.parse(raw);
companionExecutionTrackExecutionProgressChainSchema.parse(value.progress);
companionExecutionTrackExecutionManagedStartSubmissionSchema.parse(value.submission);
companionStateReportSchema.parse(value.report);
companionExecutionTrackExecutionResultSchema.parse(value.result);
companionExecutionTrackExecutionPersistedManagedTerminalMarkerSchema.parse(value.marker);
process.stdout.write('accepted');
"""
        validated = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", validation_script],
            input=json.dumps(
                {
                    "progress": [
                        baseline,
                        proof,
                        observed,
                        restoring,
                        restored,
                        commit,
                    ],
                    "submission": submission,
                    "report": managed_report,
                    "result": result,
                    "marker": marker,
                }
            ),
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(validated.returncode, 0, validated.stderr)
        self.assertEqual(validated.stdout, "accepted")

    def test_execution_track_http_paths_carry_current_lease_header(self) -> None:
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
            heartbeat_interval_seconds=30,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=10**20,
            heartbeat_sequence=0,
        )
        captures = []

        class Response:
            status = 200
            reason = "OK"
            headers = {}

            def __init__(self):
                self.body = b'{"request":null}'

            def read1(self, _size):
                body, self.body = self.body, b""
                return body

        class Connection:
            sock = None

            def __init__(self, *_args, **_kwargs):
                pass

            def request(self, method, path, body=None, headers=None):
                captures.append((method, path, headers))

            def getresponse(self):
                return Response()

            def close(self):
                pass

        paths = (
            "/api/v1/companion/execution-track-execution?adapterId=blender",
            "/api/v1/companion/execution-track-execution/progress",
            "/api/v1/companion/execution-track-execution/managed-start",
            "/api/v1/companion/execution-track-execution/result",
            "/api/v1/companion/execution-track-execution/recovery?adapterId=blender",
            "/api/v1/companion/execution-track-execution/recovery",
        )
        with patch.object(transport_module, "HTTPConnection", Connection):
            for path in paths:
                transport._request_json("GET", path)

        self.assertEqual(len(captures), len(paths))
        self.assertTrue(
            all(headers["x-operatingline-companion-lease"] == lease_id for _, _, headers in captures)
        )

    def test_transport_polls_and_deduplicates_execution_delivery(self) -> None:
        instance_id = str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        delivery = {"binding": {"requestId": request_id}}
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        paths = []

        def request_json(_method, path, **_kwargs):
            paths.append(path)
            return {"request": delivery}

        transport._request_json = request_json
        transport._poll_execution_track_execution()
        transport._poll_execution_track_execution()

        self.assertEqual(len(paths), 2)
        self.assertEqual(
            transport.incoming.get_nowait(),
            {"kind": "execution_track_execution_delivery", "request": delivery},
        )
        self.assertTrue(transport.incoming.empty())
        transport._apply_execution_track_execution_delivery_ack(
            request_id, persisted=False
        )
        transport._poll_execution_track_execution()
        self.assertEqual(
            transport.incoming.get_nowait(),
            {"kind": "execution_track_execution_delivery", "request": delivery},
        )
        transport._apply_execution_track_execution_delivery_ack(
            request_id, persisted=True
        )
        transport._poll_execution_track_execution()
        self.assertTrue(transport.incoming.empty())

    def test_transport_polls_execution_recovery_request(self) -> None:
        instance_id = str(uuid.uuid4())
        recovery = {"formatVersion": "2.0.0", "recoveryId": str(uuid.uuid4())}
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        transport._request_json = lambda *_args, **_kwargs: {"request": recovery}

        transport._poll_execution_track_execution_recovery()

        self.assertEqual(
            transport.incoming.get_nowait(),
            {"kind": "execution_track_execution_recovery_request", "request": recovery},
        )

    def test_transport_posts_managed_start_and_returns_hash_bound_ack(self) -> None:
        instance_id = str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        managed_start_hash = "a" * 64
        submission = {
            "requestId": request_id,
            "managedStart": {"contentSha256": managed_start_hash},
        }
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            poll_interval=0.01,
        )
        transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=transport._session_id,
            document_incarnation_id=transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=60,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=10**20,
            heartbeat_sequence=0,
        )
        posts = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path == "/api/v1/companion/execution-track-execution/managed-start":
                posts.append(body)
                transport._stop.set()
                return {"result": "accepted"}
            raise AssertionError(path)

        transport._request_json = request_json
        transport._poll = lambda: None
        transport.submit_execution_track_execution_managed_start(submission)
        transport.start()
        self.assertTrue(transport.wait_stopped(2))

        self.assertEqual(posts, [submission])
        messages = list(transport.incoming.queue)
        self.assertIn(
            {
                "kind": "execution_track_execution_managed_start_acknowledged",
                "requestId": request_id,
                "managedStartContentSha256": managed_start_hash,
                "result": "accepted",
            },
            messages,
        )

    def test_progress_ack_is_durable_idempotent_and_not_replayed(self) -> None:
        progress = {
            "phase": "baseline_attested",
            "binding": {"requestId": str(uuid.uuid4())},
            "contentSha256": "a" * 64,
        }
        outbox = consumer.build_active_outbox(progress)
        durable, first = consumer.record_progress_ack(outbox, "a" * 64)
        duplicate, second = consumer.record_progress_ack(durable, "a" * 64)

        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(duplicate, durable)
        scene = FakeScene()
        consumer.persist_outbox(scene, durable)
        queued = SimpleNamespace(progress=[], recovery_polls=0)
        transport = SimpleNamespace(
            submit_execution_track_execution_progress=lambda value: queued.progress.append(value),
            submit_execution_track_execution_result=lambda _value: self.fail(
                "an active acknowledged progress has no result"
            ),
            submit_execution_track_execution_managed_start=lambda _value: self.fail(
                "an active baseline has no managed start"
            ),
            enable_execution_track_execution_recovery_poll=lambda: setattr(
                queued, "recovery_polls", queued.recovery_polls + 1
            ),
        )

        self.assertTrue(consumer.resubmit_outbox(transport, scene))
        self.assertEqual(queued.progress, [])
        self.assertEqual(queued.recovery_polls, 1)

    def test_unacknowledged_managed_start_replays_once_then_recovers_read_only(self) -> None:
        progress = {
            "phase": "commit_intent_recorded",
            "binding": {"requestId": str(uuid.uuid4())},
            "contentSha256": "a" * 64,
        }
        submission = {
            "managedStart": {"contentSha256": "b" * 64},
            "commitProgress": progress,
        }
        outbox = {
            "formatVersion": "2.0.0",
            "progress": progress,
            "baselineProgress": progress,
            "acknowledgedProgressContentSha256s": ["a" * 64],
            "managedStartSubmission": submission,
        }
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)
        first = SimpleNamespace(managed=[], recovery_polls=0)
        transport = SimpleNamespace(
            submit_execution_track_execution_progress=lambda _value: self.fail(
                "the commit progress was already acknowledged"
            ),
            submit_execution_track_execution_result=lambda _value: self.fail(
                "the managed action has no result yet"
            ),
            submit_execution_track_execution_managed_start=lambda value: first.managed.append(
                value
            ),
            enable_execution_track_execution_recovery_poll=lambda: setattr(
                first, "recovery_polls", first.recovery_polls + 1
            ),
        )
        self.assertTrue(consumer.resubmit_outbox(transport, scene))
        self.assertEqual(first.managed, [submission])

        acknowledged, fresh = consumer.record_managed_start_ack(outbox, "b" * 64)
        self.assertTrue(fresh)
        consumer.persist_outbox(scene, acknowledged)
        second = SimpleNamespace(managed=[], recovery_polls=0)
        transport.submit_execution_track_execution_managed_start = (
            lambda value: second.managed.append(value)
        )
        transport.enable_execution_track_execution_recovery_poll = lambda: setattr(
            second, "recovery_polls", second.recovery_polls + 1
        )
        self.assertTrue(consumer.resubmit_outbox(transport, scene))
        self.assertEqual(second.managed, [])
        self.assertEqual(second.recovery_polls, 1)

    def test_controller_consumes_progress_and_managed_start_acks_once(self) -> None:
        request_id = str(uuid.uuid4())
        progress = {
            "phase": "baseline_attested",
            "binding": {"requestId": request_id},
            "contentSha256": "a" * 64,
        }
        stored = consumer.build_active_outbox(progress)
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._execution_track_outbox = lambda _request_id=None: deepcopy(stored)

        def persist(value):
            nonlocal stored
            stored = deepcopy(value)

        controller._persist_execution_track_outbox = persist
        controller._start_execution_track_proof = Mock()
        controller._terminate_execution_track_before_managed = Mock()
        controller._handle_execution_track_progress_ack(
            {"requestId": request_id, "progressContentSha256": "a" * 64}
        )
        controller._handle_execution_track_progress_ack(
            {"requestId": request_id, "progressContentSha256": "a" * 64}
        )
        controller._start_execution_track_proof.assert_called_once_with()
        controller._terminate_execution_track_before_managed.assert_not_called()

        progress = {
            "phase": "commit_intent_recorded",
            "binding": {"requestId": request_id},
            "contentSha256": "c" * 64,
        }
        submission = {
            "managedStart": {"contentSha256": "d" * 64},
            "commitProgress": progress,
        }
        stored = {
            "formatVersion": "2.0.0",
            "progress": progress,
            "managedStartSubmission": submission,
        }
        controller._execution_track_delivery = {"binding": {"requestId": request_id}}
        controller._execution_track_managed_commit_token = None
        controller._fresh_execution_track_lease = Mock(return_value={})
        controller._validate_execution_track_execution_authority = Mock()
        controller._terminate_execution_track_managed_indeterminate = Mock()
        issued_tokens = []

        def execute_managed_commit(*, authorization_token):
            issued_tokens.append(authorization_token)
            self.assertTrue(
                controller.authorize_execution_track_managed_commit(
                    authorization_token
                )
            )
            self.assertFalse(
                controller.authorize_execution_track_managed_commit(
                    authorization_token
                )
            )
            return {"FINISHED"}

        previous_ops = fake_bpy.ops
        fake_bpy.ops = SimpleNamespace(
            operating_line=SimpleNamespace(
                execution_track_managed_commit=execute_managed_commit
            )
        )
        try:
            message = {
                "requestId": request_id,
                "managedStartContentSha256": "d" * 64,
            }
            controller._handle_execution_track_managed_start_ack(message)
            controller._handle_execution_track_managed_start_ack(message)
        finally:
            fake_bpy.ops = previous_ops

        self.assertEqual(len(issued_tokens), 1)
        self.assertEqual(
            stored["acknowledgedManagedStartContentSha256"], "d" * 64
        )
        controller._terminate_execution_track_managed_indeterminate.assert_not_called()

    def test_stale_recovery_ack_waits_for_scene_persisted_rotated_ack(self) -> None:
        instance_id = str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        old_ack = {"requestId": request_id, "recoveryId": str(uuid.uuid4())}
        rotated_ack = {"requestId": request_id, "recoveryId": str(uuid.uuid4())}
        transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
            poll_interval=0.01,
        )
        transport._session_snapshot = transport_module.CompanionSessionSnapshot(
            lease_id=str(uuid.uuid4()),
            session_id=transport._session_id,
            document_incarnation_id=transport._document_incarnation_id,
            negotiated_guide_protocol_version="1.6.0",
            heartbeat_interval_seconds=60,
            expires_at="2099-01-01T00:00:00Z",
            next_heartbeat_at=10**20,
            heartbeat_sequence=0,
        )
        recovery_posts = []
        polls = []

        def request_json(_method, path, body=None, **_kwargs):
            if path == "/api/v1/replan/providers":
                return {"providers": []}
            if path == "/api/v1/companion/execution-track-execution/recovery":
                recovery_posts.append(body)
                if len(recovery_posts) == 1:
                    from urllib.error import HTTPError

                    error = HTTPError(path, 409, "Conflict", {}, None)
                    error.runtime_payload = {"error": "lease_not_current"}
                    raise error
                transport._stop.set()
                return {"result": "accepted"}
            raise AssertionError(path)

        def poll():
            polls.append("poll")
            transport.execution_track_execution_recovery_acks.put(
                old_ack if len(polls) == 1 else rotated_ack
            )

        transport._request_json = request_json
        transport._poll = poll
        transport._execution_track_execution_recovery_poll_enabled = True
        transport.execution_track_execution_recovery_acks.put(old_ack)
        transport.start()
        self.assertTrue(transport.wait_stopped(2))

        self.assertGreaterEqual(len(polls), 2)
        self.assertEqual(recovery_posts, [old_ack, rotated_ack])
        messages = list(transport.incoming.queue)
        supersession = next(
            message
            for message in messages
            if message["kind"]
            == "execution_track_execution_recovery_ack_supersession_required"
        )
        self.assertEqual(supersession["recoveryId"], old_ack["recoveryId"])
        self.assertIn(
            "execution_track_execution_recovery_acknowledged",
            {message["kind"] for message in messages},
        )

    def test_persists_baseline_before_no_mutation_result_and_acknowledges_exactly(self) -> None:
        instance_id = str(uuid.uuid4())
        checkpoint = {
            "formatVersion": "1.0.0",
            "evidenceClass": "companion_reported_native_undo_checkpoint",
            "checkpointId": str(uuid.uuid4()),
            "previousCheckpointId": None,
            "operation": "start",
            "committedAt": "2026-08-22T10:00:00Z",
            "marker": {"key": "_operating_line_native_history_v1", "matched": True},
            "journal": {
                "entryPresent": True,
                "snapshotMatchesSession": True,
                "artifactsBackedUp": True,
            },
            "session": {
                "plan": {"id": "plan", "revision": 1},
                "planContentSha256": "a" * 64,
                "executionId": str(uuid.uuid4()),
                "activeStepId": None,
                "completedStepIds": [],
                "receiptStepIds": [],
            },
        }
        lease = {
            "leaseId": str(uuid.uuid4()),
            "sessionId": str(uuid.uuid4()),
            "target": {"adapterId": "blender", "instanceId": instance_id},
            "documentIncarnationId": str(uuid.uuid4()),
            "expiresAt": "2099-01-01T00:00:00Z",
        }
        report = {
            "reportId": str(uuid.uuid4()),
            "sequence": 8,
            "nativeUndoCheckpoint": checkpoint,
        }
        binding = {
            "formatVersion": "2.0.0",
            "requestId": str(uuid.uuid4()),
            "target": lease["target"],
            "proposalId": str(uuid.uuid4()),
            "plan": {"id": "plan", "revision": 1},
            "executionId": checkpoint["session"]["executionId"],
            "leafId": "eye.left",
            "expectedState": {"reportId": report["reportId"], "sequence": 8},
            "authorizedStartState": {
                "reportContentSha256": consumer.canonical_sha256(report),
                "checkpoint": {
                    "checkpointId": checkpoint["checkpointId"],
                    "contentSha256": consumer.canonical_sha256(checkpoint),
                }
            },
            "bindingContentSha256": "b" * 64,
        }
        delivery = {
            "binding": binding,
            "deliveryId": str(uuid.uuid4()),
            "lease": lease,
            "dispatchedAt": "2026-08-22T10:00:01Z",
        }
        snapshot = {
            "activeObject": "Cube",
            "selectedObjects": ["Cube"],
            "objects": [{"name": "Cube", "type": "MESH", "mesh": {"vertices": 8}}],
        }
        with patch.object(consumer, "_scene_snapshot", return_value=snapshot), patch.object(
            consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
        ):
            outbox = consumer.build_fail_closed_outbox(
                delivery,
                instance_id=instance_id,
                last_report=report,
                current_lease=lease,
            )

        self.assertEqual(outbox["progress"]["phase"], "baseline_attested")
        self.assertEqual(outbox["result"]["status"], "failed_no_mutation")
        self.assertEqual(
            outbox["result"]["lastProgressContentSha256"],
            outbox["progress"]["contentSha256"],
        )
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)
        self.assertEqual(consumer.load_outbox(scene), outbox)
        queued = SimpleNamespace(
            progress=[],
            results=[],
            submit_execution_track_execution_progress=lambda value: queued.progress.append(value),
            submit_execution_track_execution_result=lambda value: queued.results.append(value),
            enable_execution_track_execution_recovery_poll=lambda: None,
        )
        self.assertTrue(consumer.resubmit_outbox(queued, scene))
        self.assertEqual(queued.progress, [outbox["progress"]])
        self.assertEqual(queued.results, [outbox["result"]])
        self.assertFalse(consumer.acknowledge_outbox(scene, str(uuid.uuid4())))
        self.assertTrue(consumer.acknowledge_outbox(scene, binding["requestId"]))
        self.assertIsNone(consumer.load_outbox(scene))

    def test_managed_repair_persists_full_report_and_replays_exact_ack_only(self) -> None:
        fixture = self._managed_repair_fixture()
        outbox = {
            "formatVersion": "1.0.0",
            "progress": fixture["progress"],
            "result": fixture["result"],
            "terminalMarker": fixture["marker"],
        }
        snapshot = {
            "activeObject": "OperatingLine.TutorialEye",
            "selectedObjects": ["OperatingLine.TutorialEye"],
            "objects": [
                {
                    "name": "OperatingLine.TutorialEye",
                    "type": "MESH",
                    "location": [1.25, -2.0, 0.75],
                    "rotation": [0.0, 0.0, 0.0],
                    "scale": [1.5, 1.5, 1.5],
                    "mesh": {"vertices": 482, "edges": 992, "polygons": 512, "sha256": "9" * 64},
                }
            ],
        }
        identity = consumer._identity_hashes(snapshot)
        report_id = "90000000-0000-4000-8000-000000000068"
        checkpoint_id = "90000000-0000-4000-8000-000000000069"
        details_content = {
            "evidenceClass": "managed_repair_strong_observation",
            "observationIndex": 1,
            "reportId": report_id,
            "reportSequence": fixture["result"]["managedReport"]["sequence"] + 1,
            "checkpointId": checkpoint_id,
            "sceneFingerprintSha256": "c" * 64,
            **identity,
            "observedAt": "2026-08-22T10:17:00Z",
        }
        binding = fixture["progress"]["binding"]
        completed = [*binding["authorizedStartState"]["completedStepIds"], binding["leafId"]]
        receipts = [*binding["authorizedStartState"]["receiptStepIds"], binding["leafId"]]
        report = {
            "protocolVersion": binding["plan"]["protocolVersion"],
            "reportId": report_id,
            "sequence": details_content["reportSequence"],
            "adapterId": "blender",
            "instanceId": binding["target"]["instanceId"],
            "companionVersion": "0.1.0",
            "hostVersion": "4.5.3",
            "plan": {"id": binding["plan"]["id"], "revision": binding["plan"]["revision"]},
            "planContentSha256": binding["plan"]["contentSha256"],
            "executionId": binding["executionId"],
            "phase": binding["authorizedStartState"]["successPhase"],
            "activeStepId": binding["leafId"],
            "completedStepIds": completed,
            "transition": "observation_recovered",
            "stepId": binding["leafId"],
            "observations": [{
                "kind": fixture["result"]["failedObservation"]["kind"],
                "satisfied": True,
                "details": {**details_content, "contentSha256": consumer.canonical_sha256(details_content)},
            }],
            "observationGate": {
                "stepId": binding["leafId"], "status": "recovered",
                "failureStrategy": "retain_for_repair", "message": "recovered",
            },
            "artifactAttestation": None,
            "nativeUndoCheckpoint": {
                "formatVersion": "1.0.0",
                "evidenceClass": "companion_reported_native_undo_checkpoint",
                "checkpointId": checkpoint_id,
                "previousCheckpointId": fixture["result"]["managedCheckpoint"]["checkpointId"],
                "operation": "recheck", "committedAt": "2026-08-22T10:16:00Z",
                "marker": {"key": "_operating_line_native_history_v1", "matched": True},
                "journal": {"entryPresent": True, "snapshotMatchesSession": True, "artifactsBackedUp": True},
                "session": {"plan": {"id": binding["plan"]["id"], "revision": binding["plan"]["revision"]},
                    "planContentSha256": binding["plan"]["contentSha256"],
                    "executionId": binding["executionId"], "activeStepId": binding["leafId"],
                    "completedStepIds": completed, "receiptStepIds": receipts},
            },
            "error": None,
            "occurredAt": "2026-08-22T10:18:00Z",
        }
        with patch.object(consumer, "_scene_snapshot", return_value=snapshot), patch.object(
            consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
        ), patch.object(
            consumer, "_now", side_effect=["2026-08-22T10:19:00Z", "2026-08-22T10:20:00Z"]
        ):
            ack = consumer.build_managed_repair_recovery_ack(
                fixture["request"], outbox=outbox,
                current_lease=fixture["replacementLease"], recovered_report=report,
            )
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)
        durable = consumer.persist_recovery_ack(scene, outbox, ack)
        submitted = []
        transport = SimpleNamespace(
            submit_execution_track_execution_recovery_ack=lambda value: submitted.append(value),
            enable_execution_track_execution_recovery_poll=lambda: None,
        )
        self.assertTrue(consumer.resubmit_outbox(transport, scene))
        self.assertEqual(submitted, [ack])
        self.assertEqual(durable["recoveredReport"], report)

        validation_script = r"""
import { companionExecutionTrackExecutionRecoveryAckSchema,
  companionStateReportSchema } from './packages/protocol/src/index.ts';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
const value = JSON.parse(raw);
companionStateReportSchema.parse(value.report);
companionExecutionTrackExecutionRecoveryAckSchema.parse(value.ack);
"""
        validated = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", validation_script],
            input=json.dumps({"report": report, "ack": ack}), capture_output=True, text=True,
        )
        self.assertEqual(validated.returncode, 0, validated.stderr)

        stale = {**report, "sequence": report["sequence"] + 1}
        with patch.object(consumer, "_scene_snapshot", return_value=snapshot), patch.object(
            consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
        ):
            with self.assertRaisesRegex(ValueError, "does not match managed repair authority"):
                consumer.build_managed_repair_recovery_ack(
                    fixture["request"], outbox=outbox,
                    current_lease=fixture["replacementLease"], recovered_report=stale,
                )
        self.assertEqual(consumer.load_outbox(scene), durable)

    def test_controller_managed_repair_uses_recheck_report_without_direct_state_post(self) -> None:
        fixture = self._managed_repair_fixture()
        outbox = {
            "formatVersion": "1.0.0",
            "progress": fixture["progress"],
            "result": fixture["result"],
            "terminalMarker": fixture["marker"],
        }
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)
        fake_bpy.context.scene = scene
        submitted = []
        transport = SimpleNamespace(
            current_document_lease=fixture["replacementLease"],
            submit_execution_track_execution_recovery_ack=lambda value: submitted.append(value),
        )
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._transport = transport
        controller.last_report = fixture["failedReport"]
        controller._sequence = fixture["failedReport"]["sequence"]
        controller.error = ""
        controller.status = ""
        failed_gate = SimpleNamespace(status="repair_required", blocking=True)
        gate = SimpleNamespace(status="recovered", blocking=False)
        step = SimpleNamespace(id=fixture["result"]["leafId"])
        authorized_completed = fixture["progress"]["binding"][
            "authorizedStartState"
        ]["completedStepIds"]
        session = SimpleNamespace(
            observation_gate=failed_gate,
            completed_step_ids=tuple(authorized_completed),
            active_step=step,
            recheck_observations=lambda: step,
        )

        def recheck():
            session.observation_gate = gate
            session.completed_step_ids = (*authorized_completed, step.id)
            return step

        session.recheck_observations = recheck
        report = {
            "reportId": "90000000-0000-4000-8000-000000000070",
            "sequence": fixture["failedReport"]["sequence"] + 1,
        }
        report_call = Mock(return_value=report)
        controller.report = report_call
        ack = {"requestId": fixture["request"]["requestId"], "evidence": {}}
        native_module_name = f"{PACKAGE_NAME}.infrastructure.native_history"
        previous_native = sys.modules.get(native_module_name)
        native_module = ModuleType(native_module_name)
        native_module.prepare_native_history = lambda *_args: None
        native_module.cancel_native_history = lambda: None
        native_state = {"committed": False}
        recheck_checkpoint = {
            **fixture["failedReport"]["nativeUndoCheckpoint"],
            "checkpointId": "90000000-0000-4000-8000-000000000071",
            "previousCheckpointId": fixture["result"]["managedCheckpoint"]["checkpointId"],
            "operation": "recheck",
            "session": {
                **fixture["failedReport"]["nativeUndoCheckpoint"]["session"],
                "completedStepIds": [*authorized_completed, step.id],
            },
        }
        native_module.native_undo_checkpoint_attestation = (
            lambda _session: (
                recheck_checkpoint
                if native_state["committed"]
                else fixture["failedReport"]["nativeUndoCheckpoint"]
            )
        )

        def commit(_session):
            native_state["committed"] = True
            return recheck_checkpoint["checkpointId"]

        native_module.commit_native_history = commit
        sys.modules[native_module_name] = native_module
        previous_get_session = getattr(package, "get_session", None)
        package.get_session = lambda: session
        try:
            with patch.object(
                consumer,
                "_validate_managed_repair_request",
                return_value=(fixture["progress"], fixture["result"], fixture["marker"]),
            ), patch.object(
                consumer,
                "_scene_snapshot",
                return_value={"activeObject": None, "selectedObjects": [], "objects": []},
            ), patch.object(
                consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
            ), patch.object(
                consumer, "build_managed_repair_recovery_ack", return_value=ack
            ), patch.object(
                consumer,
                "persist_recovery_ack",
                side_effect=lambda _scene, value, _ack: value,
            ):
                controller._handle_execution_track_execution_recovery(fixture["request"])
        finally:
            if previous_native is None:
                del sys.modules[native_module_name]
            else:
                sys.modules[native_module_name] = previous_native
            if previous_get_session is None:
                delattr(package, "get_session")
            else:
                package.get_session = previous_get_session

        self.assertEqual(submitted, [ack])
        self.assertEqual(report_call.call_args.args, ("observation_recovered",))
        self.assertFalse(report_call.call_args.kwargs["submit"])
        self.assertEqual(controller._sequence, fixture["failedReport"]["sequence"])
        observation = report_call.call_args.kwargs["observations_override"][0]
        self.assertTrue(observation["satisfied"])
        self.assertEqual(
            observation["details"]["evidenceClass"],
            "managed_repair_strong_observation",
        )

    def test_failed_managed_terminal_ack_retains_marker_for_rotated_repair(self) -> None:
        fixture = self._managed_repair_fixture()
        request_id = fixture["result"]["requestId"]
        outbox = {
            "formatVersion": "1.0.0",
            "progress": fixture["progress"],
            "result": fixture["result"],
            "recoveryAck": {
                "requestId": request_id,
                "evidence": {
                    "kind": "persisted_managed_terminal",
                    "terminalResult": fixture["result"],
                    "terminalMarker": fixture["marker"],
                },
            },
        }
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)

        self.assertTrue(consumer.retain_failed_managed_terminal(scene, request_id))
        retained = consumer.load_outbox(scene)
        assert retained is not None
        self.assertEqual(retained["terminalMarker"], fixture["marker"])
        self.assertNotIn("recoveryAck", retained)

    def test_failed_managed_first_stage_marker_ack_is_durable_and_keeps_lock(self) -> None:
        fixture = self._managed_repair_fixture()
        snapshot = {"activeObject": None, "selectedObjects": [], "objects": []}
        marker_content = {
            key: value
            for key, value in fixture["marker"].items()
            if key != "contentSha256"
        }
        marker_content.update(
            {
                "sceneFingerprintSha256": "c" * 64,
                **consumer._identity_hashes(snapshot),
            }
        )
        marker = {
            **marker_content,
            "contentSha256": consumer.canonical_sha256(marker_content),
        }
        request = {
            **fixture["request"],
            "recoveryId": "90000000-0000-4000-8000-000000000072",
            "durableReferences": {
                **fixture["request"]["durableReferences"],
                "terminalMarkerContentSha256": None,
                "terminalResultContentSha256": None,
            },
            "source": "coordinator_restart",
        }
        outbox = {
            "formatVersion": "1.0.0",
            "progress": fixture["progress"],
            "result": fixture["result"],
            "terminalMarker": marker,
        }
        with patch.object(consumer, "_scene_snapshot", return_value=snapshot), patch.object(
            consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
        ), patch.object(
            consumer, "_now", side_effect=["2026-08-22T10:16:00Z", "2026-08-22T10:17:00Z"]
        ):
            ack = consumer.build_persisted_failed_managed_recovery_ack(
                request,
                outbox=outbox,
                current_lease=fixture["replacementLease"],
            )
        self.assertEqual(ack["evidence"]["kind"], "persisted_managed_terminal")
        self.assertTrue(ack["retainsTargetLock"])

        scene = FakeScene()
        durable = consumer.persist_recovery_ack(scene, outbox, ack)
        submitted = []
        transport = SimpleNamespace(
            submit_execution_track_execution_recovery_ack=lambda value: submitted.append(value),
            enable_execution_track_execution_recovery_poll=lambda: None,
        )
        self.assertTrue(consumer.resubmit_outbox(transport, scene))
        self.assertEqual(submitted, [ack])
        self.assertTrue(
            consumer.retain_failed_managed_terminal(scene, fixture["result"]["requestId"])
        )
        retained = consumer.load_outbox(scene)
        assert retained is not None
        self.assertEqual(retained["terminalMarker"], marker)
        self.assertNotIn("recoveryAck", retained)

        validation_script = r"""
import { companionExecutionTrackExecutionRecoveryAckSchema } from './packages/protocol/src/index.ts';
let raw = ''; for await (const chunk of process.stdin) raw += chunk;
companionExecutionTrackExecutionRecoveryAckSchema.parse(JSON.parse(raw));
"""
        validated = subprocess.run(
            ["node", "--import", "tsx", "--input-type=module", "-e", validation_script],
            input=json.dumps(ack), capture_output=True, text=True,
        )
        self.assertEqual(validated.returncode, 0, validated.stderr)
        self.assertEqual(durable["recoveryAck"], ack)

    def test_repair_reuses_committed_recheck_after_pre_persist_crash(self) -> None:
        fixture = self._managed_repair_fixture()
        authorized = fixture["progress"]["binding"]["authorizedStartState"]
        leaf_id = fixture["result"]["leafId"]
        recovered_completed = [*authorized["completedStepIds"], leaf_id]
        recheck_checkpoint = {
            **fixture["failedReport"]["nativeUndoCheckpoint"],
            "checkpointId": "90000000-0000-4000-8000-000000000073",
            "previousCheckpointId": fixture["result"]["managedCheckpoint"]["checkpointId"],
            "operation": "recheck",
            "session": {
                **fixture["failedReport"]["nativeUndoCheckpoint"]["session"],
                "completedStepIds": recovered_completed,
            },
        }
        step = SimpleNamespace(id=leaf_id)
        gate = SimpleNamespace(status="recovered", blocking=False)
        session = SimpleNamespace(
            active_step=step,
            completed_step_ids=tuple(recovered_completed),
            observation_gate=gate,
            evaluate_current_step_observations=lambda _step_id: (
                step,
                [{"kind": "uv_sphere_ready", "satisfied": True, "details": {}}],
            ),
        )
        outbox = {
            "formatVersion": "1.0.0",
            "progress": fixture["progress"],
            "result": fixture["result"],
            "terminalMarker": fixture["marker"],
        }
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)
        fake_bpy.context.scene = scene
        submitted = []
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._transport = SimpleNamespace(
            current_document_lease=fixture["replacementLease"],
            submit_execution_track_execution_recovery_ack=lambda value: submitted.append(value),
        )
        controller._sequence = 0
        controller.error = ""
        controller.status = ""
        controller.report = Mock(
            return_value={
                "reportId": "90000000-0000-4000-8000-000000000074",
                "sequence": fixture["failedReport"]["sequence"] + 1,
            }
        )
        ack = {"requestId": fixture["request"]["requestId"], "evidence": {}}
        native_module_name = f"{PACKAGE_NAME}.infrastructure.native_history"
        previous_native = sys.modules.get(native_module_name)
        native_module = ModuleType(native_module_name)
        native_module.native_undo_checkpoint_attestation = lambda _session: recheck_checkpoint
        native_module.prepare_native_history = lambda *_args: self.fail(
            "retained recheck checkpoint must not be prepared again"
        )
        native_module.commit_native_history = lambda *_args: self.fail(
            "retained recheck checkpoint must not be committed again"
        )
        native_module.cancel_native_history = lambda: None
        sys.modules[native_module_name] = native_module
        previous_get_session = getattr(package, "get_session", None)
        package.get_session = lambda: session
        try:
            with patch.object(
                consumer,
                "_validate_managed_repair_request",
                return_value=(fixture["progress"], fixture["result"], fixture["marker"]),
            ), patch.object(
                consumer,
                "_scene_snapshot",
                return_value={"activeObject": None, "selectedObjects": [], "objects": []},
            ), patch.object(
                consumer, "compute_scene_fingerprint_sha256", return_value="c" * 64
            ), patch.object(
                consumer, "build_managed_repair_recovery_ack", return_value=ack
            ), patch.object(
                consumer,
                "persist_recovery_ack",
                side_effect=lambda _scene, value, _ack: value,
            ):
                controller._handle_execution_track_execution_recovery(fixture["request"])
        finally:
            if previous_native is None:
                del sys.modules[native_module_name]
            else:
                sys.modules[native_module_name] = previous_native
            if previous_get_session is None:
                delattr(package, "get_session")
            else:
                package.get_session = previous_get_session
        self.assertEqual(submitted, [ack])
        self.assertFalse(controller.report.call_args.kwargs["submit"])

    def test_session_established_with_execution_outbox_does_not_send_connected_report(self) -> None:
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._timer_registered = False
        controller._stopping_transports = []
        controller.proposal_session = None
        controller.pending_plan = None
        controller.pending_plan_content_sha256 = None
        controller.error = ""
        controller.status = ""
        controller._transport = SimpleNamespace(incoming=Queue())
        controller._transport.incoming.put(
            {"kind": "session_established", "leaseId": str(uuid.uuid4())}
        )
        report = Mock()
        controller.report = report
        with patch.object(
            controller, "_resubmit_menu_control_terminal_outbox", return_value=False
        ), patch.object(
            controller, "_resubmit_execution_track_execution_outbox", return_value=True
        ), patch.object(
            package,
            "get_session",
            return_value=SimpleNamespace(plan_id=None, revision=None, receipts={}),
            create=True,
        ):
            controller.pump()
        report.assert_not_called()

    def test_replacement_lease_does_not_repeat_connected_report_for_same_session(self) -> None:
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._timer_registered = False
        controller._stopping_transports = []
        controller._connected_session_reported = False
        controller.proposal_session = None
        controller.pending_plan = None
        controller.pending_plan_content_sha256 = None
        controller.error = ""
        controller.status = ""
        controller._transport = SimpleNamespace(incoming=Queue())
        controller._transport.incoming.put(
            {"kind": "session_established", "leaseId": str(uuid.uuid4())}
        )
        controller._transport.incoming.put(
            {"kind": "session_established", "leaseId": str(uuid.uuid4())}
        )
        report = Mock()
        controller.report = report
        with patch.object(
            controller, "_resubmit_menu_control_terminal_outbox", return_value=False
        ), patch.object(
            controller, "_resubmit_execution_track_execution_outbox", return_value=False
        ), patch.object(
            package,
            "get_session",
            return_value=SimpleNamespace(plan_id=None, revision=None, receipts={}),
            create=True,
        ):
            controller.pump()
        report.assert_called_once_with("connected")

    def test_recovery_ack_scene_write_failure_keeps_outbox_and_pump_alive(self) -> None:
        request_id = str(uuid.uuid4())
        ack = {
            "requestId": request_id,
            "recoveryId": str(uuid.uuid4()),
            "evidence": {"kind": "persisted_managed_terminal"},
        }
        outbox = {
            "formatVersion": "1.0.0",
            "progress": {"requestId": request_id},
            "result": {"requestId": request_id, "status": "failed_managed"},
            "recoveryAck": ack,
        }
        scene = FakeScene()
        consumer.persist_outbox(scene, outbox)
        fake_bpy.context.scene = scene
        controller = companion_module.CompanionController.__new__(
            companion_module.CompanionController
        )
        controller._timer_registered = False
        controller._stopping_transports = []
        controller.proposal_session = None
        controller.pending_plan = None
        controller.pending_plan_content_sha256 = None
        controller.error = ""
        controller.status = ""
        controller._transport = SimpleNamespace(incoming=Queue())
        controller._transport.incoming.put(
            {
                "kind": "execution_track_execution_recovery_acknowledged",
                "requestId": request_id,
            }
        )
        resubmit = Mock(return_value=True)
        controller._resubmit_execution_track_execution_outbox = resubmit

        with patch.object(
            consumer,
            "retain_failed_managed_terminal",
            side_effect=OSError("scene write failed"),
        ), patch.object(
            package,
            "get_session",
            return_value=SimpleNamespace(plan_id=None, revision=None, receipts={}),
            create=True,
        ):
            controller.pump()

        self.assertTrue(controller._transport.incoming.empty())
        self.assertEqual(consumer.load_outbox(scene), outbox)
        resubmit.assert_called_once_with()
        self.assertIn("failed closed", controller.error)
        self.assertEqual(controller.status, "Execution-track recovery required")


if __name__ == "__main__":
    unittest.main()
