"""Cross-language parity tests for provider-call authority validation."""

from importlib import import_module
from pathlib import Path
import sys
from types import ModuleType
import unittest
import uuid


REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = REPO_ROOT / "adapters" / "blender" / "extension" / "operating_line"
PACKAGE_NAME = "operating_line_provider_authorization_test"
operating_line = ModuleType(PACKAGE_NAME)
operating_line.__path__ = [str(PACKAGE_ROOT)]
sys.modules[PACKAGE_NAME] = operating_line

import_module(f"{PACKAGE_NAME}.domain")
authority_module = import_module(f"{PACKAGE_NAME}.domain.provider_authorization")
provider_handoff = import_module(f"{PACKAGE_NAME}.application.provider_handoff")
infrastructure = ModuleType(f"{PACKAGE_NAME}.infrastructure")
infrastructure.__path__ = [str(PACKAGE_ROOT / "infrastructure")]
sys.modules[infrastructure.__name__] = infrastructure
transport_module = import_module(f"{PACKAGE_NAME}.infrastructure.companion_transport")

validate_provider_call_authorization = (
    authority_module.validate_provider_call_authorization
)
CompanionTransport = transport_module.CompanionTransport


def authorization(
    *,
    provider_id: str = "providers/acme",
    provider_version: str = "descriptors/v1",
) -> dict:
    return {
        "formatVersion": "1.0.0",
        "canonicalization": "operatingline-authority-json-v1",
        "kind": "ProviderCallAuthorization",
        "authorityId": str(uuid.uuid4()),
        "issuer": "issuers/acme",
        "notBefore": "2026-08-21T00:00:00Z",
        "expiresAt": "2026-08-21T01:00:00+00:00",
        "provider": {
            "providerId": provider_id,
            "descriptorVersion": provider_version,
            "model": "model/name",
        },
        "operation": "semantic_replan_generation",
        "generationRequestSha256": "a" * 64,
        "disclosedDataSha256": "b" * 64,
        "maximumCallCount": 1,
        "signature": {
            "signerId": "signers/acme",
            "keyId": "keys/2026-08",
            "algorithm": "ed25519",
            "signature": "A" * 86,
            "signedAt": "2026-08-21T00:00:00Z",
        },
    }


class ProviderAuthorizationParityTests(unittest.TestCase):
    def validate(self, value: dict) -> dict:
        return validate_provider_call_authorization(
            value,
            provider_id=value["provider"]["providerId"],
            provider_version=value["provider"]["descriptorVersion"],
        )

    def test_application_and_transport_use_the_shared_validator(self) -> None:
        self.assertIs(
            provider_handoff.validate_provider_call_authorization,
            validate_provider_call_authorization,
        )
        self.assertIs(
            transport_module.validate_provider_call_authorization,
            validate_provider_call_authorization,
        )

    def test_accepts_slash_ids_and_canonical_boundary_lengths(self) -> None:
        value = authorization()
        boundary_id = "a" + "/" * 255
        value["issuer"] = boundary_id
        value["provider"]["providerId"] = boundary_id
        value["provider"]["descriptorVersion"] = boundary_id
        value["provider"]["model"] = "m" * 256
        value["signature"]["signerId"] = boundary_id
        value["signature"]["keyId"] = boundary_id

        self.assertIs(self.validate(value), value)

        trimmed = authorization()
        trimmed["issuer"] = "  issuers/acme  "
        trimmed["provider"]["providerId"] = "  providers/acme  "
        trimmed["provider"]["descriptorVersion"] = "  descriptors/v1  "
        trimmed["signature"]["signerId"] = "  signers/acme  "
        trimmed["signature"]["keyId"] = "  keys/2026-08  "
        self.assertIs(
            validate_provider_call_authorization(
                trimmed,
                provider_id="providers/acme",
                provider_version="descriptors/v1",
            ),
            trimmed,
        )

    def test_rejects_values_past_canonical_length_limits(self) -> None:
        cases = (
            ("issuer", lambda value: value.__setitem__("issuer", "a" * 257)),
            (
                "providerId",
                lambda value: value["provider"].__setitem__(
                    "providerId", "a" * 257
                ),
            ),
            (
                "descriptorVersion",
                lambda value: value["provider"].__setitem__(
                    "descriptorVersion", "a" * 257
                ),
            ),
            (
                "model",
                lambda value: value["provider"].__setitem__("model", "m" * 257),
            ),
            (
                "signerId",
                lambda value: value["signature"].__setitem__(
                    "signerId", "a" * 257
                ),
            ),
            (
                "keyId",
                lambda value: value["signature"].__setitem__("keyId", "a" * 257),
            ),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                value = authorization()
                mutate(value)
                with self.assertRaisesRegex(ValueError, "provider_authority_required"):
                    self.validate(value)

    def test_rejects_noncanonical_hashes_and_signatures(self) -> None:
        cases = (
            ("short hash", "generationRequestSha256", "a" * 63),
            ("uppercase hash", "generationRequestSha256", "A" * 64),
            ("long hash", "disclosedDataSha256", "b" * 65),
        )
        for label, field, replacement in cases:
            with self.subTest(label=label):
                value = authorization()
                value[field] = replacement
                with self.assertRaisesRegex(ValueError, "provider_authority_required"):
                    self.validate(value)
        for replacement in ("A" * 85, "A" * 87, "+" + "A" * 85):
            with self.subTest(signature=replacement):
                value = authorization()
                value["signature"]["signature"] = replacement
                with self.assertRaisesRegex(ValueError, "provider_authority_required"):
                    self.validate(value)

    def test_rejects_invalid_temporal_ordering(self) -> None:
        cases = (
            ("equal validity bounds", "expiresAt", "2026-08-21T00:00:00Z"),
            ("reversed validity bounds", "expiresAt", "2026-08-20T23:59:59Z"),
        )
        for label, field, replacement in cases:
            with self.subTest(label=label):
                value = authorization()
                value[field] = replacement
                with self.assertRaisesRegex(ValueError, "provider_authority_required"):
                    self.validate(value)

        value = authorization()
        value["signature"]["signedAt"] = "2026-08-21T01:00:00.001Z"
        with self.assertRaisesRegex(ValueError, "provider_authority_required"):
            self.validate(value)

    def test_rejects_legacy_boolean_authority_and_boolean_call_count(self) -> None:
        legacy = {
            "dataHandlingAcknowledged": True,
            "possibleChargesAcknowledged": True,
            "proposalCreationAcknowledged": True,
        }
        with self.assertRaisesRegex(ValueError, "provider_authority_required"):
            validate_provider_call_authorization(
                legacy,
                provider_id="providers/acme",
                provider_version="descriptors/v1",
            )

        value = authorization()
        value["maximumCallCount"] = True
        with self.assertRaisesRegex(ValueError, "provider_authority_required"):
            self.validate(value)

    def test_rejects_unknown_fields_at_every_strict_object_boundary(self) -> None:
        for label, mutate in (
            ("authority", lambda value: value.__setitem__("unknown", True)),
            ("provider", lambda value: value["provider"].__setitem__("unknown", True)),
            (
                "signature",
                lambda value: value["signature"].__setitem__("unknown", True),
            ),
        ):
            with self.subTest(label=label):
                value = authorization()
                mutate(value)
                with self.assertRaisesRegex(ValueError, "provider_authority_required"):
                    self.validate(value)

        value = authorization()
        value["costCeiling"] = None
        with self.assertRaisesRegex(ValueError, "provider_authority_required"):
            self.validate(value)

    def test_transport_accepts_the_same_slash_id_record(self) -> None:
        instance_id = str(uuid.uuid4())
        transport = CompanionTransport(
            "http://127.0.0.1:43123",
            "0123456789abcdef",
            instance_id,
            session_id=str(uuid.uuid4()),
            document_incarnation_id=str(uuid.uuid4()),
        )
        value = authorization(
            provider_id="providers/acme",
            provider_version="0.1.0",
        )
        request = {
            "generationRequestId": str(uuid.uuid4()),
            "revisionRequestId": str(uuid.uuid4()),
            "providerId": "providers/acme",
            "providerVersion": "0.1.0",
            "targetAdapterId": "blender",
            "targetInstanceId": instance_id,
            "authorization": value,
        }

        transport.start_replan_run(request)

        self.assertEqual(transport.replan_runs.get_nowait(), request)


if __name__ == "__main__":
    unittest.main()
