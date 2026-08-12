"""Catalog-derived, Blender-neutral parameter form descriptions."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Mapping

from ..domain import ActionSpec, bundled_action_catalog_data


@dataclass(frozen=True, slots=True)
class ParameterField:
    """One top-level action argument rendered by the native revision form."""

    name: str
    kind: str
    original_value: Any
    value: Any
    description: str
    editable: bool
    enum_values: tuple[Any, ...] = ()
    minimum: float | int | None = None
    maximum: float | int | None = None
    vector_length: int = 0


_ACTION_CATALOG = bundled_action_catalog_data()
_ACTION_SCHEMAS = {
    action["name"]: action["argumentsSchema"]
    for action in _ACTION_CATALOG["actions"]
}


def _numeric_bound(value: Any) -> float | int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value


def _field_kind(schema: Mapping[str, Any], value: Any) -> tuple[str, int]:
    enum_values = schema.get("enum")
    if (
        isinstance(enum_values, list)
        and enum_values
        and isinstance(value, str)
        and all(isinstance(item, str) for item in enum_values)
    ):
        return "enum", 0
    field_type = schema.get("type")
    if field_type == "boolean" and isinstance(value, bool):
        return "boolean", 0
    if field_type == "integer" and isinstance(value, int) and not isinstance(value, bool):
        return "integer", 0
    if field_type == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
        return "number", 0
    if field_type == "string" and isinstance(value, str):
        return "string", 0
    if field_type == "array" and isinstance(value, list):
        items = schema.get("items")
        minimum_items = schema.get("minItems")
        maximum_items = schema.get("maxItems")
        if (
            isinstance(items, dict)
            and items.get("type") in {"integer", "number"}
            and isinstance(minimum_items, int)
            and minimum_items == maximum_items == len(value)
            and 1 <= len(value) <= 4
            and all(
                isinstance(item, (int, float)) and not isinstance(item, bool)
                for item in value
            )
        ):
            return (
                "integer_vector" if items["type"] == "integer" else "number_vector",
                len(value),
            )
    return "structured", 0


def action_parameter_fields(
    action: ActionSpec,
    requested_values: Mapping[str, Any] | None = None,
) -> tuple[ParameterField, ...]:
    """Describe current top-level arguments using the exact bundled schema."""
    schema = _ACTION_SCHEMAS.get(action.name)
    if not isinstance(schema, dict):
        raise ValueError(f"Action has no bundled parameter form: {action.name}")
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        raise ValueError(f"Action parameter schema is invalid: {action.name}")
    requested = requested_values or {}
    fields: list[ParameterField] = []
    for name, property_schema in properties.items():
        if name not in action.arguments or not isinstance(property_schema, dict):
            continue
        original = action.arguments[name]
        value = requested.get(name, original)
        kind, vector_length = _field_kind(property_schema, value)
        bounds = property_schema.get("items", property_schema)
        if not isinstance(bounds, dict):
            bounds = {}
        raw_enum = property_schema.get("enum")
        enum_values = tuple(raw_enum) if isinstance(raw_enum, list) else ()
        fields.append(
            ParameterField(
                name=name,
                kind=kind,
                original_value=deepcopy(original),
                value=deepcopy(value),
                description=str(property_schema.get("description", "")),
                editable=kind not in {"structured", "string"},
                enum_values=enum_values,
                minimum=_numeric_bound(bounds.get("minimum")),
                maximum=_numeric_bound(bounds.get("maximum")),
                vector_length=vector_length,
            )
        )
    return tuple(fields)


__all__ = ("ParameterField", "action_parameter_fields")
