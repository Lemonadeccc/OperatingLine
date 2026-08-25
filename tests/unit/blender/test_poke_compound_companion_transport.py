"""Pure-Python contracts for the proof-only Poke compound transport."""

from copy import deepcopy
from datetime import datetime, timezone
from importlib import import_module
from pathlib import Path
from types import ModuleType
import sys
import unittest
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_poke_compound_transport_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line
domain = import_module(f"{PACKAGE_NAME}.domain")
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")


class PokeCompoundCompanionTransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.instance_id = str(uuid.uuid4())
        self.transport = transport_module.CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            self.instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )

    def _delivery(self) -> dict:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        replay_id = str(uuid.uuid4())
        compound_id = str(uuid.uuid4())
        decision_id = str(uuid.uuid4())
        target = {"adapterId": "blender", "instanceId": self.instance_id}
        recipe = {
            "replayId": replay_id,
            "compoundId": compound_id,
            "compoundContentSha256": "1" * 64,
            "historyLockTokenSha256": "2" * 64,
        }
        replay = {
            "formatVersion": "1.0.0",
            "planContentSha256": "3" * 64,
            "target": target,
            "actionCatalogVersion": "1.22.0",
            "interactionCatalogVersion": "1.50.0",
            "recipe": recipe,
            "currentState": {
                "replayId": replay_id,
                "compoundId": compound_id,
            },
            "leafProgress": [
                {"leafId": "forward.enter", "intentSha256": None, "receiptSha256": None},
                {"leafId": "forward.poke", "intentSha256": None, "receiptSha256": None},
                {"leafId": "forward.exit", "intentSha256": None, "receiptSha256": None},
            ],
        }
        content = {
            "formatVersion": "1.0.0",
            "requestId": str(uuid.uuid4()),
            "deliveryId": str(uuid.uuid4()),
            "target": target,
            "replayId": replay_id,
            "compoundId": compound_id,
            "compoundContentSha256": "1" * 64,
            "historyLockTokenSha256": "2" * 64,
            "replay": replay,
            "decisionReceipt": {
                "decisionId": decision_id,
                "replayId": replay_id,
                "target": target,
            },
            "trustedDecisionConsumptionEvent": {
                "credentialId": decision_id,
            },
            "requestedAt": now,
            "dispatchedAt": now,
        }
        return {
            **content,
            "deliveryContentSha256": self.transport._canonical_sha256(content),
        }

    def test_poll_delivers_once_and_rejects_content_tampering(self) -> None:
        delivery = self._delivery()
        self.transport._request_json = lambda *_args, **_kwargs: {  # type: ignore[method-assign]
            "request": deepcopy(delivery)
        }
        self.transport._poll_poke_compound_request()
        self.transport._poll_poke_compound_request()
        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "poke_compound_execute_request", "request": delivery},
        )
        self.assertTrue(self.transport.incoming.empty())

        hostile = deepcopy(delivery)
        hostile["historyLockTokenSha256"] = "f" * 64
        self.transport._request_json = lambda *_args, **_kwargs: {  # type: ignore[method-assign]
            "request": hostile
        }
        with self.assertRaises(ValueError):
            self.transport._poll_poke_compound_request()

    def test_recovery_poll_deduplicates_and_never_requests_replay(self) -> None:
        challenge = {
            "formatVersion": "1.0.0",
            "recoveryId": str(uuid.uuid4()),
            "originalDelivery": self._delivery(),
            "replacementSessionFingerprintSha256": "a" * 64,
            "replacementDocumentAuthoritySha256": "b" * 64,
            "requestedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        self.transport._request_json = lambda *_args, **_kwargs: {  # type: ignore[method-assign]
            "request": deepcopy(challenge)
        }
        self.assertTrue(self.transport._poll_poke_compound_recovery_request())
        self.assertTrue(self.transport._poll_poke_compound_recovery_request())
        self.assertEqual(
            self.transport.incoming.get_nowait(),
            {"kind": "poke_compound_recovery_request", "request": challenge},
        )
        self.assertTrue(self.transport.incoming.empty())

    def test_result_and_recovery_submission_use_independent_durable_queues(self) -> None:
        result = {"requestId": str(uuid.uuid4()), "status": "succeeded"}
        ack = {
            "recoveryId": str(uuid.uuid4()),
            "outcome": "terminal_result",
        }
        self.transport.submit_poke_compound_result(result)
        self.transport.submit_poke_compound_recovery_ack(ack)
        self.assertEqual(self.transport.poke_compound_results.get_nowait(), result)
        self.assertEqual(self.transport.poke_compound_recovery_acks.get_nowait(), ack)


if __name__ == "__main__":
    unittest.main()
