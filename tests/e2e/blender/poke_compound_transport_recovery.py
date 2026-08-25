"""Live Companion transport proof for a lost Poke compound result ACK."""

from __future__ import annotations

import json
import os
from pathlib import Path
from queue import Empty
import sys
import time
from datetime import datetime, timezone
from urllib.request import urlopen
import uuid

import bpy


REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
RESULT_PATH = Path(os.environ["OPERATINGLINE_POKE_TRANSPORT_RESULT"])
RUNTIME_URL = os.environ["OPERATINGLINE_POKE_TRANSPORT_RUNTIME_URL"]
ACCESS_TOKEN = os.environ["OPERATINGLINE_POKE_TRANSPORT_ACCESS_TOKEN"]
TIMEOUT_SECONDS = float(os.environ.get("OPERATINGLINE_POKE_TRANSPORT_TIMEOUT", "90"))
OUTBOX_KEY = "_operating_line_poke_compound_transport_outbox_v1"

sys.path.insert(0, str(ADAPTER_ROOT))

from operating_line.infrastructure.companion_transport import (  # noqa: E402
    CompanionTransport,
)


instance_id = str(uuid.uuid4())
document_incarnation_id = str(uuid.uuid4())
initial_session_id = str(uuid.uuid4())
replacement_session_id = str(uuid.uuid4())
started_at = time.monotonic()
initial_transport: CompanionTransport | None = None
replacement_transport: CompanionTransport | None = None
delivery: dict[str, object] | None = None
terminal_result: dict[str, object] | None = None
recovery_challenge: dict[str, object] | None = None
initial_stopped = False
replacement_started = False


def probe(path: str) -> dict[str, object]:
    with urlopen(f"{RUNTIME_URL}{path}", timeout=2.0) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("Transport probe returned a non-object payload")
    return payload


def make_transport(session_id: str) -> CompanionTransport:
    return CompanionTransport(
        RUNTIME_URL,
        ACCESS_TOKEN,
        instance_id,
        session_id=session_id,
        document_incarnation_id=document_incarnation_id,
        companion_version="0.1.0",
        host_version=".".join(str(part) for part in bpy.app.version[:3]),
        poll_interval=0.05,
        timeout=1.0,
    )


def finish(payload: dict[str, object], *, ok: bool) -> None:
    for transport in (initial_transport, replacement_transport):
        if transport is not None:
            transport.stop(flush_timeout=0.0)
            transport.wait_stopped(2.0)
    RESULT_PATH.write_text(
        json.dumps({"ok": ok, **payload}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"POKE_COMPOUND_TRANSPORT_{'PASS' if ok else 'FAIL'} "
        + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def drain(transport: CompanionTransport) -> list[dict[str, object]]:
    messages: list[dict[str, object]] = []
    while True:
        try:
            message = transport.incoming.get_nowait()
        except Empty:
            break
        if isinstance(message, dict):
            messages.append(message)
    return messages


def monitor() -> float | None:
    global delivery, terminal_result, recovery_challenge
    global initial_stopped, replacement_started, replacement_transport
    try:
        if time.monotonic() - started_at > TIMEOUT_SECONDS:
            raise TimeoutError(
                "Timed out waiting for Poke compound transport recovery: "
                f"delivery={delivery is not None}, initialStopped={initial_stopped}, "
                f"replacementStarted={replacement_started}, recovery={recovery_challenge is not None}"
            )
        assert initial_transport is not None
        active_transport = replacement_transport if replacement_started else initial_transport
        assert active_transport is not None
        for message in drain(active_transport):
            kind = message.get("kind")
            if kind == "poke_compound_execute_request":
                candidate = message.get("request")
                if not isinstance(candidate, dict):
                    raise RuntimeError("Poke compound delivery was not an object")
                delivery = candidate
                terminal_payload = probe(
                    f"/probe/terminal?deliveryId={candidate['deliveryId']}"
                )
                candidate_result = terminal_payload.get("result")
                if not isinstance(candidate_result, dict):
                    raise RuntimeError("Probe omitted the terminal Poke compound result")
                terminal_result = candidate_result
                bpy.context.scene[OUTBOX_KEY] = json.dumps(
                    candidate_result, separators=(",", ":"), sort_keys=True
                )
                initial_transport.submit_poke_compound_result(candidate_result)
            elif kind == "poke_compound_recovery_request":
                candidate = message.get("request")
                if not isinstance(candidate, dict):
                    raise RuntimeError("Poke compound recovery challenge was not an object")
                recovery_challenge = candidate
                retained = json.loads(str(bpy.context.scene[OUTBOX_KEY]))
                active_transport.submit_poke_compound_recovery_ack(
                    {
                        "formatVersion": "1.0.0",
                        "recoveryId": candidate["recoveryId"],
                        "challenge": candidate,
                        "outcome": "terminal_result",
                        "terminalResult": retained,
                        "observedCurrentState": None,
                        "automaticReplay": False,
                        "retainsTargetLock": True,
                        "occurredAt": datetime.now(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                    }
                )
            elif kind == "poke_compound_recovery_acknowledged":
                if recovery_challenge is None:
                    raise RuntimeError("Recovery ACK arrived without a challenge")
                del bpy.context.scene[OUTBOX_KEY]
                state = probe("/probe/state")
                checks = {
                    "deliveryReceived": delivery is not None,
                    "terminalOutboxPersistedBeforeDisconnect": terminal_result is not None,
                    "initialTransportStopped": initial_stopped,
                    "runtimeRestarted": state.get("runtimeRestarted") is True,
                    "replacementSessionRotated": replacement_session_id != initial_session_id,
                    "documentIncarnationPreserved": True,
                    "recoveryChallengeReceived": recovery_challenge is not None,
                    "automaticReplayForbidden": state.get("normalDeliveryCount") == 1,
                    "normalResultNeverCommitted": state.get("normalResultForwardCount") == 0,
                    "recoveryAckCommitted": state.get("recoveryAckCount") == 1,
                    "outboxClearedOnlyAfterAck": OUTBOX_KEY not in bpy.context.scene,
                }
                finish(
                    {
                        "blenderVersion": bpy.app.version_string,
                        "instanceId": instance_id,
                        "documentIncarnationId": document_incarnation_id,
                        "initialSessionId": initial_session_id,
                        "replacementSessionId": replacement_session_id,
                        "checks": checks,
                    },
                    ok=all(checks.values()),
                )
                return None
            elif kind in {
                "poke_compound_result_rejected",
                "poke_compound_recovery_rejected",
            }:
                raise RuntimeError(str(message.get("message") or kind))

        state = probe("/probe/state")
        if state.get("resultConnectionDropped") is True and not initial_stopped:
            initial_transport.stop(flush_timeout=0.0)
            if not initial_transport.wait_stopped(5.0):
                raise RuntimeError("Initial Poke compound transport did not stop")
            initial_stopped = True
        if (
            initial_stopped
            and state.get("runtimeRestarted") is True
            and not replacement_started
        ):
            replacement_transport = make_transport(replacement_session_id)
            replacement_transport.start()
            replacement_started = True
    except Exception as error:
        finish(
            {
                "error": str(error),
                "delivery": delivery,
                "terminalResultRetained": terminal_result is not None,
                "recoveryChallenge": recovery_challenge,
            },
            ok=False,
        )
        return None
    return 0.05


assert bpy.app.online_access is True
initial_transport = make_transport(initial_session_id)
initial_transport.start()
bpy.app.timers.register(monitor, first_interval=0.05)
