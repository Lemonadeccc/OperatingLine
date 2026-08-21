"""Canonical validation for provider-call authority records."""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any


PROVIDER_AUTHORITY_REQUIRED = (
    "provider_authority_required: a trusted operator or server must provide a "
    "complete signed ProviderCallAuthorization"
)

_AUTHORITY_ID_PATTERN = re.compile(
    r"^(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|"
    r"00000000-0000-0000-0000-000000000000|"
    r"ffffffff-ffff-ffff-ffff-ffffffffffff)$"
)
_BOUNDED_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$")
_RFC3339_DATETIME_PATTERN = re.compile(
    r"^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|"
    r"[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:"
    r"(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|"
    r"(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|"
    r"(?:02)-(?:0[1-9]|1\d|2[0-8])))T"
    r"(?:(?:[01]\d|2[0-3]):[0-5]\d"
    r"(?::[0-5]\d(?:\.\d+)?)?"
    r"(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))$"
)
_SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_SIGNATURE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{86}$")
_PROVIDER_CALL_OPERATIONS = frozenset(
    {
        "planning_generation",
        "semantic_replan_generation",
        "procedure_authoring_generation",
        "procedure_refinement_generation",
    }
)
_REQUIRED_FIELDS = {
    "formatVersion",
    "canonicalization",
    "kind",
    "authorityId",
    "issuer",
    "notBefore",
    "expiresAt",
    "provider",
    "operation",
    "generationRequestSha256",
    "disclosedDataSha256",
    "maximumCallCount",
    "signature",
}


def _invalid() -> ValueError:
    return ValueError(PROVIDER_AUTHORITY_REQUIRED)


def _bounded_id(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    normalized = value.strip()
    return (
        1 <= len(normalized) <= 256
        and _BOUNDED_ID_PATTERN.fullmatch(normalized) is not None
    )


def _instant(value: Any) -> datetime | None:
    if (
        not isinstance(value, str)
        or _RFC3339_DATETIME_PATTERN.fullmatch(value) is None
    ):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def validate_provider_call_authorization(
    value: Any,
    *,
    provider_id: Any,
    provider_version: Any,
    operation: str = "semantic_replan_generation",
) -> dict[str, Any]:
    """Validate, but never create or alter, a signed provider authority."""
    if not isinstance(value, dict) or set(value) not in (
        _REQUIRED_FIELDS,
        _REQUIRED_FIELDS | {"costCeiling"},
    ):
        raise _invalid()
    maximum_call_count = value.get("maximumCallCount")
    if (
        value.get("formatVersion") != "1.0.0"
        or value.get("canonicalization") != "operatingline-authority-json-v1"
        or value.get("kind") != "ProviderCallAuthorization"
        or operation not in _PROVIDER_CALL_OPERATIONS
        or value.get("operation") != operation
        or isinstance(maximum_call_count, bool)
        or not isinstance(maximum_call_count, (int, float))
        or maximum_call_count != 1
    ):
        raise _invalid()
    if (
        not isinstance(value.get("authorityId"), str)
        or _AUTHORITY_ID_PATTERN.fullmatch(value["authorityId"]) is None
        or not _bounded_id(value.get("issuer"))
    ):
        raise _invalid()

    not_before = _instant(value.get("notBefore"))
    expires_at = _instant(value.get("expiresAt"))
    if not_before is None or expires_at is None or expires_at <= not_before:
        raise _invalid()

    provider = value.get("provider")
    if (
        not isinstance(provider, dict)
        or set(provider) != {"providerId", "descriptorVersion", "model"}
        or not _bounded_id(provider.get("providerId"))
        or not _bounded_id(provider.get("descriptorVersion"))
        or provider["providerId"].strip() != provider_id
        or provider["descriptorVersion"].strip() != provider_version
        or not isinstance(provider.get("model"), str)
        or not 1 <= len(provider["model"].strip()) <= 256
    ):
        raise _invalid()

    if any(
        not isinstance(value.get(field), str)
        or _SHA256_PATTERN.fullmatch(value[field]) is None
        for field in ("generationRequestSha256", "disclosedDataSha256")
    ):
        raise _invalid()

    signature = value.get("signature")
    if (
        not isinstance(signature, dict)
        or set(signature)
        != {"signerId", "keyId", "algorithm", "signature", "signedAt"}
        or not _bounded_id(signature.get("signerId"))
        or not _bounded_id(signature.get("keyId"))
        or signature.get("algorithm") != "ed25519"
        or not isinstance(signature.get("signature"), str)
        or _SIGNATURE_PATTERN.fullmatch(signature["signature"]) is None
    ):
        raise _invalid()
    signed_at = _instant(signature.get("signedAt"))
    if signed_at is None or signed_at > expires_at:
        raise _invalid()

    cost_ceiling = value.get("costCeiling")
    if "costCeiling" in value and (
        not isinstance(cost_ceiling, dict)
        or set(cost_ceiling) != {"currency", "minorUnits"}
        or not isinstance(cost_ceiling.get("currency"), str)
        or re.fullmatch(r"[A-Z]{3}", cost_ceiling["currency"]) is None
        or isinstance(cost_ceiling.get("minorUnits"), bool)
        or not isinstance(cost_ceiling.get("minorUnits"), int)
        or not 0 <= cost_ceiling["minorUnits"] <= 1_000_000_000
    ):
        raise _invalid()
    return value
