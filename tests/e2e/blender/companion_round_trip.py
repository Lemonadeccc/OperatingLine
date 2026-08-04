"""Real Orchestrator-to-Blender companion round-trip smoke test."""

import importlib.util
import json
import os
from pathlib import Path
import sys
import threading
import time

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_companion_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def main() -> None:
    runtime_url = required_environment("OPERATINGLINE_E2E_RUNTIME_URL")
    access_token = required_environment("OPERATINGLINE_E2E_ACCESS_TOKEN")
    result_path = Path(required_environment("OPERATINGLINE_E2E_RESULT_PATH"))
    expected_plan_id = required_environment("OPERATINGLINE_E2E_PLAN_ID")
    expected_revision = int(required_environment("OPERATINGLINE_E2E_PLAN_REVISION"))
    expected_root_title = required_environment("OPERATINGLINE_E2E_ROOT_TITLE")

    assert bpy.app.online_access is True, "E2E must run Blender with --online-mode"
    operating_line.register()
    controller = operating_line.get_companion()
    original_install_plan = controller.install_plan
    plan_install_threads: list[int] = []
    maximum_pump_seconds = 0.0

    def install_plan_on_main_thread(plan):
        assert threading.current_thread() is threading.main_thread()
        plan_install_threads.append(threading.get_ident())
        return original_install_plan(plan)

    controller.install_plan = install_plan_on_main_thread

    def pump_once() -> None:
        nonlocal maximum_pump_seconds
        started_at = time.monotonic()
        controller.pump()
        maximum_pump_seconds = max(maximum_pump_seconds, time.monotonic() - started_at)

    def wait_until(predicate, label: str, timeout: float = 6.0) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            pump_once()
            if predicate():
                return
            time.sleep(0.02)
        raise TimeoutError(f"Timed out waiting for {label}")

    try:
        factory_cube = bpy.data.objects.get("Cube")
        factory_camera = bpy.data.objects.get("Camera")
        factory_light = bpy.data.objects.get("Light")
        assert factory_cube is not None and factory_camera is not None
        assert factory_light is not None
        factory_objects = (factory_cube, factory_camera, factory_light)
        factory_object_pointers = {
            item.name: item.as_pointer() for item in factory_objects
        }
        factory_data_pointers = {
            item.name: item.data.as_pointer() for item in factory_objects
        }
        factory_scene = bpy.context.scene
        factory_scene_pointer = factory_scene.as_pointer()
        factory_scene_camera = factory_scene.camera
        assert bpy.context.scene.operating_line_replace_factory_scene is False

        window_manager = bpy.context.window_manager
        window_manager.operating_line_runtime_url = runtime_url
        window_manager.operating_line_bearer_token = access_token
        assert bpy.ops.operating_line.connect() == {"FINISHED"}

        wait_until(
            lambda: (
                operating_line.get_session().plan_id == expected_plan_id
                and operating_line.get_session().revision == expected_revision
            ),
            "remote GuidePlan installation",
        )
        session = operating_line.get_session()
        assert session.root.title == expected_root_title
        assert plan_install_threads == [threading.main_thread().ident]
        assert maximum_pump_seconds < 0.15, (
            f"Main-thread pump blocked for {maximum_pump_seconds:.3f}s"
        )

        assert bpy.ops.operating_line.start() == {"FINISHED"}
        start_sequence = controller.last_report["sequence"]
        wait_until(
            lambda: (
                controller._transport is not None
                and controller._transport.last_delivered_sequence >= start_sequence
            ),
            "walkthrough_started report delivery",
        )
        for item in factory_objects:
            assert bpy.data.objects.get(item.name) is item
            assert item.as_pointer() == factory_object_pointers[item.name]

        step_count = len(session.steps)
        assert step_count == 13
        for expected_index, expected_step in enumerate(session.steps):
            assert bpy.ops.operating_line.next() == {"FINISHED"}
            assert session.active_index == expected_index
            assert session.active_step is expected_step
            assert controller.last_report["stepId"] == expected_step.id
            assert controller.last_report["observations"]
            assert all(
                observation["satisfied"]
                for observation in controller.last_report["observations"]
            )
            sequence = controller.last_report["sequence"]
            wait_until(
                lambda sequence=sequence: (
                    controller._transport is not None
                    and controller._transport.last_delivered_sequence >= sequence
                ),
                f"step_succeeded delivery for {expected_step.id}",
            )

        render_receipt = session.receipts["snowman.render.preview"]
        assert len(render_receipt.artifacts) == 1
        render_artifact = render_receipt.artifacts[0]
        render_path = Path(render_artifact.path)
        assert render_path.is_file()
        assert render_path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        assert (render_artifact.width, render_artifact.height) == (320, 320)

        render_scene = bpy.data.scenes.get("OperatingLine.Scene.Snowman")
        owned_collection = bpy.data.collections.get("OperatingLine Snowman")
        owned_camera = bpy.data.objects.get("OperatingLine.Camera.Preview")
        assert render_scene is not None and owned_collection is not None
        assert owned_camera is not None and render_scene.camera is owned_camera
        assert render_scene.collection.children.get(owned_collection.name) is owned_collection
        assert factory_cube not in tuple(render_scene.objects)
        assert bpy.context.scene is factory_scene
        assert factory_scene.as_pointer() == factory_scene_pointer
        assert factory_scene.camera is factory_scene_camera

        for expected_index in reversed(range(step_count)):
            expected_step = session.steps[expected_index]
            assert bpy.ops.operating_line.back() == {"FINISHED"}
            assert controller.last_report["stepId"] == expected_step.id
            sequence = controller.last_report["sequence"]
            wait_until(
                lambda sequence=sequence: (
                    controller._transport is not None
                    and controller._transport.last_delivered_sequence >= sequence
                ),
                f"step_rolled_back delivery for {expected_step.id}",
            )

        assert session.active_index == -1
        assert not session.receipts
        assert not render_path.exists()
        for item in factory_objects:
            assert bpy.data.objects.get(item.name) is item
            assert item.as_pointer() == factory_object_pointers[item.name]
            assert item.data.as_pointer() == factory_data_pointers[item.name]
        assert bpy.context.scene is factory_scene
        assert factory_scene.as_pointer() == factory_scene_pointer
        assert factory_scene.camera is factory_scene_camera
        for collection in (
            bpy.data.objects,
            bpy.data.meshes,
            bpy.data.materials,
            bpy.data.collections,
            bpy.data.scenes,
            bpy.data.worlds,
            bpy.data.lights,
            bpy.data.cameras,
        ):
            assert all(
                item.get("operating_line_owner") != "snowman_demo_v2"
                for item in collection
            )

        result_path.write_text(
            json.dumps(
                {
                    "planId": session.plan_id,
                    "revision": session.revision,
                    "rootTitle": session.root.title,
                    "maximumPumpSeconds": maximum_pump_seconds,
                    "stepCount": step_count,
                    "factoryCubePointer": factory_object_pointers["Cube"],
                    "lastTransition": controller.last_report["transition"],
                    "lastSequence": controller.last_report["sequence"],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
    finally:
        operating_line.unregister()


if __name__ == "__main__":
    main()
