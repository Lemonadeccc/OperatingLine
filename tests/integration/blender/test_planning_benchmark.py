"""Execute the non-snowman planning benchmark in real Blender."""

import importlib.util
import json
from pathlib import Path
import sys

import bpy

sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
BENCHMARK_PATH = (
    REPO_ROOT
    / "protocol"
    / "fixtures"
    / "v1"
    / "planning"
    / "robot-preview.benchmark.json"
)
spec = importlib.util.spec_from_file_location(
    "operating_line_robot_benchmark_extension",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
operating_line = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = operating_line
spec.loader.exec_module(operating_line)

from operating_line_robot_benchmark_extension.operating_line.application import (  # noqa: E402
    DemoSession,
)
from operating_line_robot_benchmark_extension.operating_line.domain import (  # noqa: E402
    executable_steps,
    load_task_tree_data,
)
from operating_line_robot_benchmark_extension.operating_line.infrastructure import (  # noqa: E402
    action_registry,
    build_resource_registry,
    find_artifact,
    remove_factory_startup_objects,
    resolve_resource,
)
from operating_line_robot_benchmark_extension.operating_line.infrastructure.snowman_actions.common import (  # noqa: E402
    COLLECTION_LOGICAL_ID,
    COLLECTION_NAME,
    OWNER_KEY,
    OWNER_VALUE,
)


def owned_resources() -> list[object]:
    collections = (
        bpy.data.objects,
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.collections,
        bpy.data.scenes,
        bpy.data.worlds,
        bpy.data.lights,
        bpy.data.cameras,
        bpy.data.armatures,
        bpy.data.actions,
    )
    return [
        resource
        for collection in collections
        for resource in collection
        if resource.get(OWNER_KEY) == OWNER_VALUE
    ]


def main() -> None:
    with BENCHMARK_PATH.open(encoding="utf-8") as resource:
        benchmark = json.load(resource)
    plan = benchmark["referencePlan"]
    root = load_task_tree_data(plan)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id=plan["id"],
        revision=plan["revision"],
        source_plan=plan,
    )
    expected_step_ids = [
        "robot.geometry.ground",
        "robot.geometry.parts",
        "robot.materials.palette",
        "robot.render_setup.scene",
        "robot.render_setup.rig",
        "robot.output.preview",
    ]
    assert [step.id for step in executable_steps(root)] == expected_step_ids
    assert remove_factory_startup_objects(bpy.context.scene) is True
    assert all(bpy.data.objects.get(name) is None for name in ("Cube", "Camera", "Light"))

    session.start()
    executed = []
    while True:
        step = session.next()
        if step is None:
            break
        executed.append(step.id)
    assert executed == expected_step_ids
    assert session.active_index == len(expected_step_ids) - 1

    registry = build_resource_registry(session.receipts)
    collection = resolve_resource(registry[COLLECTION_LOGICAL_ID])
    assert collection is not None and collection.name == COLLECTION_NAME
    for resource_id in (
        "robot.body",
        "robot.head",
        "robot.arm.left",
        "robot.arm.right",
        "robot.eye.left",
        "robot.eye.right",
        "robot.antenna",
        "robot.antenna.tip",
        "robot.material.shell",
        "robot.material.accent",
        "robot.render.scene",
        "robot.camera.preview",
    ):
        assert resolve_resource(registry[resource_id]) is not None, resource_id

    artifact = find_artifact(session.receipts, "robot.render.preview")
    assert artifact is not None
    artifact_path = Path(artifact.path)
    assert artifact_path.is_file() and artifact_path.stat().st_size > 0
    assert (artifact.width, artifact.height) == (320, 320)

    session.reset()
    assert session.active_index == -1 and not session.receipts
    assert not artifact_path.exists()
    assert bpy.data.collections.get(COLLECTION_NAME) is None
    assert owned_resources() == []
    print(
        "OperatingLine robot planning benchmark passed: "
        f"{len(expected_step_ids)} steps, 320x320 PNG, full rollback"
    )


if __name__ == "__main__":
    main()
