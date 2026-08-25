"""Guide 1.7 candidate-menu ingestion and legacy negotiation coverage."""

from copy import deepcopy
from importlib import import_module
import math
from pathlib import Path
from types import ModuleType, SimpleNamespace
import sys
import unittest


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_guide_1_7_candidate_projection_test"

package = ModuleType(PACKAGE_NAME)
package.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = package
domain = import_module(f"{PACKAGE_NAME}.domain")
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")


def candidate_projection() -> dict:
    return {
        "projection": "candidate_only",
        "interactionCatalogVersion": "1.49.0",
        "id": "candidate.create-eye.menu",
        "modality": "menu",
        "equivalence": "not_equivalent_to_managed_action",
        "executionAuthority": "none",
        "title": "Candidate eye menu projection",
        "reason": "Display-only native menu steps are not managed-action authority.",
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
            },
            {
                "id": "candidate.menu.eye",
                "order": 2,
                "semanticRefs": ["semantic.create-eye"],
                "description": "Create the eye with concrete values.",
                "evidenceRefs": ["evidence.ui-probe"],
                "intent": "execute",
                "target": {
                    "kind": "operator",
                    "hostId": "mesh.primitive_uv_sphere_add",
                },
                "path": ["Layout", "Add", "Mesh", "UV Sphere"],
                "parameters": {"radius": 0.12, "location": [0.32, -0.86, 2.14]},
            },
        ],
        "omittedActionArguments": [
            {
                "argumentName": "objectName",
                "reason": "Naming is not represented in this candidate.",
            }
        ],
        "nativeEvidence": {
            "kind": "bounded_blender_ui_probe",
            "executorId": "blender.native-ui",
            "hostVersions": ["4.5.3", "5.1.1"],
            "managedActionExecuted": False,
            "managedReceiptCreated": False,
            "managedReplacementMeshCreated": False,
            "nativeMutationKind": "native_operator",
            "operationIds": ["candidate.menu.add", "candidate.menu.eye"],
            "nativeUndoCheckpointRequired": True,
            "nativeUndoDepth": 1,
            "nativeRedoDepth": 1,
        },
    }


def execution_track_override() -> dict:
    return {
        "kind": "interaction_catalog_proof",
        "interactionCatalogVersion": "1.49.0",
        "interactionCatalogContentSha256": "a" * 64,
        "recipeId": "blender.mesh.create_uv_sphere.native",
        "modality": "menu",
        "trackId": "menu.layout.add.mesh.uv_sphere",
        "trackContentSha256": "b" * 64,
        "proofExecutionContentSha256": "c" * 64,
    }


def plan_with_projection() -> dict:
    return {
        "protocolVersion": "1.7.0",
        "rootStepId": "step",
        "steps": [
            {
                "id": "step",
                "parentId": None,
                "order": 0,
                "dependsOn": [],
                "title": "Create sphere",
                "action": {
                    "adapterId": "blender",
                    "name": "blender.mesh.create_uv_sphere",
                    "arguments": {
                        "radius": 0.12,
                        "location": [0.32, -0.86, 2.14],
                        "objectName": "Eye",
                    },
                },
                "anchors": [],
                "expectedObservations": [
                    {"kind": "uv_sphere_ready", "parameters": {}}
                ],
                "observationPolicy": {
                    "mode": "success_gate",
                    "failureStrategy": "rollback_step",
                    "retryPolicy": {"mode": "automatic_bounded", "maxAttempts": 2},
                },
                "executionTrackOverride": execution_track_override(),
                "candidateMenuProjection": candidate_projection(),
            }
        ],
    }


def action_delivery_step() -> dict:
    source = plan_with_projection()["steps"][0]
    return {
        "id": source["id"],
        "parentId": source["parentId"],
        "order": source["order"],
        "dependsOn": source["dependsOn"],
        "title": source["title"],
        "intent": "create",
        "explanation": "Create an eye.",
        "state": "ready",
        "action": source["action"],
        "anchors": source["anchors"],
        "expectedObservations": source["expectedObservations"],
        "observationPolicy": source["observationPolicy"],
        "candidateMenuProjection": source["candidateMenuProjection"],
        "rollback": {"mode": "native_undo", "checkpointRequired": True},
    }


class GuideCandidateProjectionTests(unittest.TestCase):
    def test_protocol_1_7_is_current_and_1_6_remains_supported(self) -> None:
        self.assertEqual(domain.PROTOCOL_VERSION, "1.7.0")
        self.assertIn("1.6.0", domain.SUPPORTED_PROTOCOL_VERSIONS)
        self.assertIn("1.7.0", domain.SUPPORTED_PROTOCOL_VERSIONS)

    def test_parses_candidate_only_projection_with_retry_override_and_evidence(self) -> None:
        plan = plan_with_projection()
        parsed = domain.load_task_tree_data(plan)
        projection = parsed.candidate_menu_projection

        self.assertIsNotNone(projection)
        assert projection is not None
        self.assertEqual(projection.execution_authority, "none")
        self.assertEqual(projection.equivalence, "not_equivalent_to_managed_action")
        self.assertEqual(
            [operation["order"] for operation in projection.operations], [1, 2]
        )
        self.assertEqual(
            projection.operations[1]["parameters"],
            {"radius": 0.12, "location": [0.32, -0.86, 2.14]},
        )
        self.assertEqual(
            projection.omitted_action_arguments[0]["argumentName"], "objectName"
        )
        self.assertEqual(
            projection.native_evidence["operationIds"],
            ["candidate.menu.add", "candidate.menu.eye"],
        )
        self.assertEqual(parsed.observation_policy.retry_mode, "automatic_bounded")
        self.assertIsNotNone(parsed.execution_track_override)

        plan["steps"][0]["candidateMenuProjection"]["operations"][0]["path"].append(
            "mutated"
        )
        self.assertEqual(projection.operations[0]["path"], ["Layout", "Add"])

    def test_rejects_projection_before_1_7_or_without_an_action(self) -> None:
        legacy = plan_with_projection()
        legacy["protocolVersion"] = "1.6.0"
        with self.assertRaisesRegex(ValueError, "require guide protocol 1.7"):
            domain.load_task_tree_data(legacy)

        group = plan_with_projection()
        group["steps"][0]["action"] = None
        with self.assertRaisesRegex(ValueError, "Only executable steps"):
            domain.load_task_tree_data(group)

    def test_rejects_authority_order_evidence_and_non_json_parameter_forgery(self) -> None:
        mutations = []

        authority = plan_with_projection()
        authority["steps"][0]["candidateMenuProjection"]["executionAuthority"] = (
            "managed_action"
        )
        mutations.append(authority)

        unordered = plan_with_projection()
        unordered["steps"][0]["candidateMenuProjection"]["operations"][1]["order"] = 3
        mutations.append(unordered)

        evidence = plan_with_projection()
        evidence["steps"][0]["candidateMenuProjection"]["nativeEvidence"][
            "operationIds"
        ] = ["candidate.menu.eye", "candidate.menu.add"]
        mutations.append(evidence)

        duplicate_host = plan_with_projection()
        duplicate_host["steps"][0]["candidateMenuProjection"]["nativeEvidence"][
            "hostVersions"
        ] = ["4.5.3", "4.5.3"]
        mutations.append(duplicate_host)

        non_json = plan_with_projection()
        non_json["steps"][0]["candidateMenuProjection"]["operations"][1][
            "parameters"
        ] = {"radius": math.nan}
        mutations.append(non_json)

        null_evidence = plan_with_projection()
        null_evidence["steps"][0]["candidateMenuProjection"]["nativeEvidence"] = None
        mutations.append(null_evidence)

        for plan in mutations:
            with self.subTest(plan=plan):
                with self.assertRaisesRegex(ValueError, "candidateMenuProjection"):
                    domain.load_task_tree_data(plan)

    def test_action_delivery_may_carry_but_never_derives_authority_from_candidate(self) -> None:
        step = action_delivery_step()

        transport_module.CompanionTransport._validate_action_step(step)
        self.assertNotIn("executionTrackOverride", step)
        self.assertEqual(step["candidateMenuProjection"]["executionAuthority"], "none")

        forged = deepcopy(step)
        forged["candidateMenuProjection"]["executionAuthority"] = "managed_action"
        with self.assertRaisesRegex(ValueError, "candidateMenuProjection authority"):
            transport_module.CompanionTransport._validate_action_step(forged)

    def test_decision_falls_back_to_current_but_preserves_negotiated_1_6(self) -> None:
        for negotiated_version in (None, "1.6.0", "1.7.0"):
            with self.subTest(negotiated_version=negotiated_version):
                transport = object.__new__(transport_module.CompanionTransport)
                transport._instance_id = "90000000-0000-4000-8000-000000000001"
                transport._session_snapshot = (
                    None
                    if negotiated_version is None
                    else SimpleNamespace(
                        negotiated_guide_protocol_version=negotiated_version
                    )
                )
                submissions = []
                transport.submit_proposal_decision = submissions.append

                transport.decide_proposal(
                    "90000000-0000-4000-8000-000000000002", "accepted"
                )

                self.assertEqual(
                    submissions[0]["protocolVersion"],
                    domain.PROTOCOL_VERSION
                    if negotiated_version is None
                    else negotiated_version,
                )


if __name__ == "__main__":
    unittest.main()
