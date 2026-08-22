"""Real-Blender entry point for the production UV Sphere menu-control driver."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys

import bpy


REPO_ROOT = Path(__file__).resolve().parents[3]
EXTENSION_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
sys.path.insert(0, str(EXTENSION_ROOT))

from operating_line.infrastructure.menu_control_proof import (  # noqa: E402
    UVSphereMenuControlProof,
)


RESULT_PATH = Path(os.environ["OPERATINGLINE_UV_SPHERE_MENU_RESULT"])


def write_result(payload: dict[str, object]) -> None:
    RESULT_PATH.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def finish(payload: dict[str, object]) -> None:
    write_result(payload)
    print(
        "UV_SPHERE_MENU_CONTROL_DRIVER PASS "
        + json.dumps(
            {
                "hostVersion": payload["hostVersion"],
                "eventSimulateCount": payload["eventSimulateCount"],
                "baselineSceneFingerprintSha256": payload[
                    "baselineSceneFingerprintSha256"
                ],
                "finalSceneFingerprintSha256": payload[
                    "finalSceneFingerprintSha256"
                ],
            },
            sort_keys=True,
        ),
        flush=True,
    )
    bpy.ops.wm.quit_blender()


def fail(payload: dict[str, object]) -> None:
    write_result(payload)
    print(
        "UV_SPHERE_MENU_CONTROL_DRIVER FAIL " + json.dumps(payload, sort_keys=True),
        flush=True,
    )
    bpy.app.timers.register(
        lambda: (bpy.ops.wm.quit_blender(), None)[1],
        first_interval=0.01,
    )


UVSphereMenuControlProof().start(
    preflight_hook=lambda: True,
    pre_mutation_hook=lambda: True,
    on_complete=finish,
    on_failure=fail,
)
