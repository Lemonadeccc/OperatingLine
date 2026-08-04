"""Headless Blender integration test for the extension lifecycle."""

import importlib.util
import json
import math
import sys
from tempfile import TemporaryDirectory
from pathlib import Path

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
    overlay_enabled,
    remove_factory_startup_objects,
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


def assert_plan_dependency_semantics() -> None:
    root = step("root", None, 0)
    # Display order deliberately conflicts with dependency order. Execution must
    # follow the DAG, not the hierarchy's depth-first traversal.
    dependency_first = step(
        "action.z-first",
        "root",
        20,
        step_action=action("test.z-first"),
    )
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
    assert_plan_dependency_semantics()
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

        for index, (step_data, name) in enumerate(zip(ACTION_STEPS, EXPECTED)):
            result = bpy.ops.operating_line.next()
            assert result == {"FINISHED"}
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
    print("OperatingLine Blender integration test passed")


if __name__ == "__main__":
    main()
