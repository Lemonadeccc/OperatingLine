"""Unit checks for the closed Poke Faces compound execution shape."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest


MODULE_PATH = (
    Path(__file__).resolve().parents[3]
    / "adapters/blender/extension/operating_line/domain/action_execution.py"
)
SPEC = spec_from_file_location("poke_action_execution", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def leaf(kind: str, *, count: int, changing: bool, proof: dict | None) -> dict:
    return {
        "kind": kind,
        "nativeUndoRedoOperationCount": count,
        "modelChanging": changing,
        "historyProof": proof,
    }


def proof(kind: str) -> dict:
    value = {
        "kind": kind,
        "modeScope": "edit_middle_only",
        "objectModeUndoRedoClaim": False,
    }
    for field, character in (
        ("editBaselineIdentitySha256", "1"),
        ("editFinalIdentitySha256", "2"),
        ("objectPointerSha256", "3"),
        ("meshPointerSha256", "4"),
        ("meshDatablockSha256", "5"),
        ("baselineTopologySha256", "6"),
        ("finalTopologySha256", "7"),
        ("baselineSelectionSha256", "8"),
        ("finalSelectionSha256", "9"),
        ("historyHeadBeforeSha256", "a"),
        ("historyHeadAfterSha256", "b"),
        ("checkpointSha256", "c"),
        ("journalHeadSha256", "d"),
    ):
        value[field] = character * 64
    return value


class PokeCompoundActionExecutionTest(unittest.TestCase):
    def test_accepts_exact_forward_back_and_redo(self) -> None:
        for recipe_kind, middle_kind, operation_count, proof_kind in (
            ("forward", "poke", 0, "poke_native_checkpoint"),
            ("back", "native_undo_once", 1, "native_undo_once"),
            ("redo", "native_redo_once", 1, "native_redo_once"),
        ):
            leaves = [
                leaf("enter_edit", count=0, changing=False, proof=None),
                leaf(
                    middle_kind,
                    count=operation_count,
                    changing=True,
                    proof=proof(proof_kind),
                ),
                leaf("exit_edit", count=0, changing=False, proof=None),
            ]
            self.assertTrue(
                MODULE.validate_poke_faces_compound_leaves(recipe_kind, leaves)
            )

    def test_rejects_wrong_proof_owner_and_native_operation_count(self) -> None:
        back = [
            leaf("enter_edit", count=0, changing=False, proof=None),
            leaf("native_undo_once", count=0, changing=True, proof=proof("native_undo_once")),
            leaf("exit_edit", count=0, changing=False, proof=None),
        ]
        self.assertFalse(MODULE.validate_poke_faces_compound_leaves("back", back))
        back[1]["nativeUndoRedoOperationCount"] = 2
        self.assertFalse(MODULE.validate_poke_faces_compound_leaves("back", back))
        back[1]["nativeUndoRedoOperationCount"] = 1
        back[0]["historyProof"] = proof("native_undo_once")
        self.assertFalse(MODULE.validate_poke_faces_compound_leaves("back", back))

    def test_rejects_object_mode_or_managed_compensation_claim(self) -> None:
        forward = [
            leaf("enter_edit", count=0, changing=False, proof=None),
            leaf("poke", count=0, changing=True, proof=proof("poke_native_checkpoint")),
            leaf("exit_edit", count=0, changing=False, proof=None),
        ]
        forward[1]["historyProof"]["objectModeUndoRedoClaim"] = True
        self.assertFalse(
            MODULE.validate_poke_faces_compound_leaves("forward", forward)
        )
        forward[1]["historyProof"] = {"kind": "managed_compensation"}
        self.assertFalse(
            MODULE.validate_poke_faces_compound_leaves("forward", forward)
        )
        forward[1]["historyProof"] = {
            **proof("poke_native_checkpoint"),
            "snapshotRestoreSha256": "e" * 64,
        }
        self.assertFalse(
            MODULE.validate_poke_faces_compound_leaves("forward", forward)
        )


if __name__ == "__main__":
    unittest.main()
