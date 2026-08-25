"""Real Blender save/load proof for Companion Session 1.1 identities."""

import importlib.util
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import uuid

import bpy


sys.dont_write_bytecode = True

REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"
spec = importlib.util.spec_from_file_location(
    "operating_line_identity_e2e",
    ADAPTER_ROOT / "__init__.py",
    submodule_search_locations=[str(ADAPTER_ROOT)],
)
assert spec is not None and spec.loader is not None
extension = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = extension
spec.loader.exec_module(extension)

import operating_line_identity_e2e.operating_line as addon  # noqa: E402


def assert_canonical_uuid(value: str) -> None:
    assert str(uuid.UUID(value)) == value


def assert_not_persisted() -> None:
    slots = {
        addon._COMPANION_SESSION_ID_SLOT,
        addon._COMPANION_INSTANCE_ID_SLOT,
        addon._COMPANION_DOCUMENT_INCARNATION_ID_SLOT,
        addon._COMPANION_REPORT_SEQUENCE_SLOT,
    }
    assert all(slot not in bpy.context.scene for slot in slots)
    assert all(slot not in bpy.context.window_manager for slot in slots)


def main() -> None:
    addon.register()
    initial = addon.get_companion()
    initial_ids = (
        initial.session_id,
        initial.document_incarnation_id,
        initial.instance_id,
    )
    for identity in initial_ids:
        assert_canonical_uuid(identity)
    assert_not_persisted()

    with TemporaryDirectory() as temporary_directory:
        blend_path = Path(temporary_directory) / "identity-lifecycle.blend"
        assert bpy.ops.wm.save_as_mainfile(filepath=str(blend_path)) == {"FINISHED"}
        saved = addon.get_companion()
        assert (
            saved.session_id,
            saved.document_incarnation_id,
            saved.instance_id,
        ) == initial_ids
        blend_bytes = blend_path.read_bytes()
        assert all(identity.encode() not in blend_bytes for identity in initial_ids)
        assert_not_persisted()

        assert bpy.ops.wm.open_mainfile(filepath=str(blend_path)) == {"FINISHED"}
        first_load = addon.get_companion()
        assert first_load.session_id == initial.session_id
        assert first_load.document_incarnation_id != initial.document_incarnation_id
        assert first_load.instance_id != initial.instance_id
        assert_not_persisted()

        assert bpy.ops.wm.open_mainfile(filepath=str(blend_path)) == {"FINISHED"}
        second_load = addon.get_companion()
        assert second_load.session_id == initial.session_id
        assert second_load.document_incarnation_id != first_load.document_incarnation_id
        assert second_load.instance_id != first_load.instance_id
        assert_not_persisted()

    final_report_before_restart = second_load.report("connected", submit=False)
    session_id = second_load.session_id
    document_incarnation_id = second_load.document_incarnation_id
    instance_id = second_load.instance_id
    addon.unregister()
    addon.register()
    restarted = addon.get_companion()
    assert restarted.session_id != session_id
    assert restarted.document_incarnation_id == document_incarnation_id
    assert restarted.instance_id == instance_id
    assert restarted.last_report is None
    assert restarted.report_sequence == final_report_before_restart["sequence"]
    first_report_after_restart = restarted.report("connected", submit=False)
    assert (
        first_report_after_restart["sequence"]
        == final_report_before_restart["sequence"] + 1
    )
    namespace = addon._runtime_namespace()
    valid_sequence_state = namespace[addon._COMPANION_REPORT_SEQUENCE_SLOT]
    namespace[addon._COMPANION_REPORT_SEQUENCE_SLOT] = {
        "instanceId": instance_id,
        "sequence": addon.MAX_COMPANION_REPORT_SEQUENCE + 1,
    }
    try:
        addon._companion_report_sequence(instance_id)
    except RuntimeError as error:
        assert "outside protocol bounds" in str(error)
    else:
        raise AssertionError("Out-of-range persisted report sequence was accepted")
    finally:
        namespace[addon._COMPANION_REPORT_SEQUENCE_SLOT] = valid_sequence_state
    different_instance_id = str(uuid.uuid4())
    namespace[addon._COMPANION_REPORT_SEQUENCE_SLOT] = {
        "instanceId": different_instance_id,
        "sequence": addon.MAX_COMPANION_REPORT_SEQUENCE,
    }
    assert addon._companion_report_sequence(instance_id) == 0
    assert namespace[addon._COMPANION_REPORT_SEQUENCE_SLOT] == {
        "instanceId": instance_id,
        "sequence": 0,
    }
    namespace[addon._COMPANION_REPORT_SEQUENCE_SLOT] = valid_sequence_state
    exhausted = addon.CompanionController(
        str(uuid.uuid4()),
        session_id=str(uuid.uuid4()),
        document_incarnation_id=str(uuid.uuid4()),
        initial_report_sequence=addon.MAX_COMPANION_REPORT_SEQUENCE,
    )
    try:
        exhausted.report("connected", submit=False)
    except RuntimeError as error:
        assert "sequence is exhausted" in str(error)
    else:
        raise AssertionError("Exhausted report sequence generated an invalid report")
    addon.unregister()
    print("OperatingLine Companion identity lifecycle test passed")


if __name__ == "__main__":
    main()
