"""Validated adapter-owned interaction recipes for accepted Blender actions."""

from dataclasses import dataclass
from enum import Enum
import json
import math
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlsplit


RESOURCE_PATH = (
    Path(__file__).parents[1] / "resources" / "interaction-catalog.json"
)
ACTION_CATALOG_PATH = Path(__file__).parents[1] / "resources" / "action-catalog.json"
VERSION_PATTERN = re.compile(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)")
STEP_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*")
TARGET_KINDS = frozenset(
    {
        "workspace",
        "editor",
        "mode",
        "menu",
        "menu_item",
        "operator",
        "control",
        "panel",
        "node",
        "socket",
        "canvas",
        "semantic",
    }
)
MENU_PROCEDURE_TARGET_KINDS = frozenset(
    {
        "workspace",
        "editor",
        "mode",
        "menu",
        "menu_item",
        "operator",
        "control",
    }
)
STEP_INTENTS = frozenset({"navigate", "configure", "execute", "verify"})
PRECONDITION_KINDS = frozenset({"workspace", "editor", "mode", "selection"})
SHORTCUT_PRECONDITION_KINDS = frozenset(
    {
        "workspace",
        "editor",
        "mode",
        "selection",
        "keymap",
        "modal_state",
        "scene_state",
    }
)
REQUIRED_SHORTCUT_PRECONDITION_KINDS = frozenset(
    {"workspace", "editor", "mode", "keymap", "scene_state"}
)
SINGLETON_SHORTCUT_PRECONDITION_KINDS = frozenset(
    {"workspace", "editor", "mode", "keymap"}
)
RESERVED_PARAMETER_NAMES = frozenset({"__proto__", "prototype", "constructor"})
PARAMETER_ASSIGNMENT_NAME_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]*")


class InteractionPathKind(str, Enum):
    """Whether a recipe is wired to real host UI or only a truthful reference."""

    NATIVE = "native_path"
    SEMANTIC = "semantic_path"


@dataclass(frozen=True, slots=True)
class InteractionStepDefinition:
    """One ordered host interaction target from a versioned recipe."""

    id: str
    order: int
    label: str
    intent: str
    target_kind: str
    target_id: str


@dataclass(frozen=True, slots=True)
class InteractionPathDefinition:
    """A native path or an explicit semantic-only fallback."""

    kind: InteractionPathKind
    steps: tuple[InteractionStepDefinition, ...]
    surface_id: str | None = None
    operator_id: str | None = None
    reason: str | None = None
    manual_reference: str | None = None


@dataclass(frozen=True, slots=True)
class ProcedureMaterializationChannel:
    """One declared procedure materialization channel."""

    availability: str
    reason: str | None = None
    source: str | None = None
    semantic_binding: str | None = None
    parameter_binding: str | None = None
    operator_parameters: tuple["ParameterAssignmentDefinition", ...] | None = None
    control_operations: "PostExecutionControlOperationsDefinition | None" = None
    omitted_action_arguments: (
        tuple["OmittedActionArgumentDefinition", ...] | None
    ) = None
    projection: str | None = None
    preconditions: tuple["ShortcutPreconditionDefinition", ...] | None = None
    shortcut_operations: tuple["ShortcutOperationDefinition", ...] | None = None


@dataclass(frozen=True, slots=True)
class ParameterAssignmentSourceDefinition:
    """One closed source for a materialized host-operation parameter."""

    kind: str
    value: Any = None
    argument_name: str | None = None
    transform: str | None = None
    derivation: str | None = None
    start_argument_name: str | None = None
    end_argument_name: str | None = None
    output: str | None = None


@dataclass(frozen=True, slots=True)
class ParameterAssignmentDefinition:
    """One named parameter supplied to an ordered host operation."""

    name: str
    source: ParameterAssignmentSourceDefinition


@dataclass(frozen=True, slots=True)
class PostExecutionControlOperationDefinition:
    """One ordered post-execution host control declared by the catalog."""

    id: str
    label: str
    target_id: str
    path: tuple[str, ...]
    parameters: tuple[ParameterAssignmentDefinition, ...]


@dataclass(frozen=True, slots=True)
class PostExecutionControlOperationsDefinition:
    """Ordered host controls inserted after one native execution step."""

    insert_after_step_id: str
    operations: tuple[PostExecutionControlOperationDefinition, ...]


@dataclass(frozen=True, slots=True)
class OmittedActionArgumentDefinition:
    """One action argument deliberately absent from materialized operations."""

    argument_name: str
    reason: str


@dataclass(frozen=True, slots=True)
class ShortcutPreconditionDefinition:
    """One declared prerequisite for replaying a shortcut candidate."""

    kind: str
    label: str
    value: str


@dataclass(frozen=True, slots=True)
class ShortcutOperationDefinition:
    """One ordered shortcut operation from an adapter-owned candidate recipe."""

    id: str
    label: str
    key_mode: str
    keys: tuple[str, ...]
    parameters: tuple[ParameterAssignmentDefinition, ...]
    selection_path: tuple[str, ...] | None = None


@dataclass(frozen=True, slots=True)
class ProcedureMaterializationDefinition:
    """Declared menu, shortcut, and MCP procedure materialization support."""

    menu: ProcedureMaterializationChannel
    shortcut: ProcedureMaterializationChannel
    mcp: ProcedureMaterializationChannel


@dataclass(frozen=True, slots=True)
class InteractionRecipe:
    """Host interaction guidance bound to exactly one catalog action."""

    id: str
    action_name: str
    title: str
    guidance: InteractionPathDefinition
    procedure_materialization: ProcedureMaterializationDefinition | None = None


@dataclass(frozen=True, slots=True)
class InteractionCatalog:
    """Versioned adapter-specific presentation recipes."""

    protocol_version: str
    catalog_version: str
    adapter_id: str
    action_catalog_version: str
    adapter_version_range: str
    host_version_range: str
    title: str
    description: str
    recipes: tuple[InteractionRecipe, ...]

    def recipe_for(self, action_name: str) -> InteractionRecipe | None:
        return next(
            (recipe for recipe in self.recipes if recipe.action_name == action_name),
            None,
        )


def _expect_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _expect_exact_keys(
    value: dict[str, Any],
    *,
    required: set[str],
    optional: set[str] = frozenset(),
    label: str,
) -> None:
    keys = set(value)
    missing = required - keys
    unknown = keys - required - optional
    if missing:
        raise ValueError(f"{label} is missing {min(missing)}")
    if unknown:
        raise ValueError(f"{label} contains unknown field {min(unknown)}")


def _expect_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty string")
    return value


def _reject_non_finite_json_constant(value: str) -> Any:
    raise ValueError(f"JSON document contains non-finite number {value}")


def _validate_finite_json_numbers(value: Any) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("JSON document contains a non-finite number")
    if isinstance(value, list):
        for item in value:
            _validate_finite_json_numbers(item)
    elif isinstance(value, dict):
        for item in value.values():
            _validate_finite_json_numbers(item)


def _load_json_object(resource: Any, label: str) -> dict[str, Any]:
    value = json.load(resource, parse_constant=_reject_non_finite_json_constant)
    _validate_finite_json_numbers(value)
    return _expect_object(value, label)


def _expect_version(value: Any, label: str) -> str:
    version = _expect_string(value, label)
    if VERSION_PATTERN.fullmatch(version) is None:
        raise ValueError(f"{label} must use stable x.y.z form")
    return version


def _expect_url(value: Any, label: str) -> str:
    url = _expect_string(value, label)
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"{label} must be an absolute HTTP URL")
    return url


def _parse_steps(value: Any, recipe_id: str) -> tuple[InteractionStepDefinition, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"Interaction recipe {recipe_id} must contain steps")
    steps: list[InteractionStepDefinition] = []
    ids: set[str] = set()
    orders: set[int] = set()
    labels: set[str] = set()
    for index, raw_value in enumerate(value):
        raw = _expect_object(raw_value, f"Interaction recipe {recipe_id} step")
        _expect_exact_keys(
            raw,
            required={"id", "order", "label", "intent", "target"},
            label=f"Interaction recipe {recipe_id} step",
        )
        step_id = _expect_string(raw["id"], "Interaction step id")
        if STEP_ID_PATTERN.fullmatch(step_id) is None:
            raise ValueError(f"Interaction recipe {recipe_id} has invalid step id")
        order = raw["order"]
        if isinstance(order, bool) or not isinstance(order, int) or order <= 0:
            raise ValueError(f"Interaction recipe {recipe_id} has invalid step order")
        if step_id in ids:
            raise ValueError(
                f"Interaction recipe {recipe_id} contains duplicate step {step_id}"
            )
        if order in orders:
            raise ValueError(
                f"Interaction recipe {recipe_id} contains duplicate step order {order}"
            )
        intent = _expect_string(raw["intent"], "Interaction step intent")
        if intent not in STEP_INTENTS:
            raise ValueError(f"Interaction recipe {recipe_id} has unknown step intent")
        target = _expect_object(raw["target"], "Interaction target")
        _expect_exact_keys(
            target,
            required={"kind", "hostId"},
            label="Interaction target",
        )
        target_kind = _expect_string(target["kind"], "Interaction target kind")
        if target_kind not in TARGET_KINDS:
            raise ValueError(f"Interaction recipe {recipe_id} has unknown target kind")
        label = _expect_string(raw["label"], "Interaction step label")
        if label in labels:
            raise ValueError(
                f"Interaction recipe {recipe_id} contains duplicate step label {label}"
            )
        ids.add(step_id)
        orders.add(order)
        labels.add(label)
        steps.append(
            InteractionStepDefinition(
                id=step_id,
                order=order,
                label=label,
                intent=intent,
                target_kind=target_kind,
                target_id=_expect_string(
                    target["hostId"], "Interaction target hostId"
                ),
            )
        )
    steps.sort(key=lambda step: step.order)
    if tuple(step.order for step in steps) != tuple(range(1, len(steps) + 1)):
        raise ValueError(
            f"Interaction recipe {recipe_id} step orders must be contiguous from 1"
        )
    return tuple(steps)


def _parse_guidance(
    value: Any,
    recipe_id: str,
) -> InteractionPathDefinition:
    raw = _expect_object(value, f"Interaction recipe {recipe_id} guidance")
    kind_value = _expect_string(raw.get("kind"), "Interaction guidance kind")
    try:
        kind = InteractionPathKind(kind_value)
    except ValueError as error:
        raise ValueError(
            f"Interaction recipe {recipe_id} has unknown guidance kind"
        ) from error
    manual_reference = (
        _expect_url(raw["manualReference"], "Interaction manualReference")
        if "manualReference" in raw
        else None
    )

    if kind is InteractionPathKind.SEMANTIC:
        _expect_exact_keys(
            raw,
            required={"kind", "steps", "reason"},
            optional={"manualReference"},
            label=f"Interaction recipe {recipe_id} semantic guidance",
        )
        return InteractionPathDefinition(
            kind=kind,
            steps=_parse_steps(raw["steps"], recipe_id),
            reason=_expect_string(raw["reason"], "Semantic guidance reason"),
            manual_reference=manual_reference,
        )

    _expect_exact_keys(
        raw,
        required={"kind", "surfaceId", "preconditions", "steps", "execution"},
        optional={"manualReference"},
        label=f"Interaction recipe {recipe_id} native guidance",
    )
    preconditions = raw["preconditions"]
    if not isinstance(preconditions, list):
        raise ValueError(f"Interaction recipe {recipe_id} preconditions must be an array")
    for raw_precondition in preconditions:
        precondition = _expect_object(raw_precondition, "Interaction precondition")
        _expect_exact_keys(
            precondition,
            required={"kind", "label", "value"},
            label="Interaction precondition",
        )
        precondition_kind = _expect_string(
            precondition["kind"], "Interaction precondition kind"
        )
        if precondition_kind not in PRECONDITION_KINDS:
            raise ValueError(
                f"Interaction recipe {recipe_id} has unknown precondition kind"
            )
        _expect_string(precondition["label"], "Interaction precondition label")
        _expect_string(precondition["value"], "Interaction precondition value")

    steps = _parse_steps(raw["steps"], recipe_id)
    if len(steps) < 2:
        raise ValueError(f"Native interaction recipe {recipe_id} needs at least two steps")
    execution = _expect_object(raw["execution"], "Native interaction execution")
    _expect_exact_keys(
        execution,
        required={"stepId", "operatorId", "binding"},
        label="Native interaction execution",
    )
    if execution["binding"] != "accepted_plan_action":
        raise ValueError(
            f"Interaction recipe {recipe_id} has unsupported execution binding"
        )
    execution_step_id = _expect_string(
        execution["stepId"], "Native interaction execution stepId"
    )
    operator_id = _expect_string(
        execution["operatorId"], "Native interaction operatorId"
    )
    execution_step = next(
        (step for step in steps if step.id == execution_step_id),
        None,
    )
    if (
        execution_step is None
        or execution_step.intent != "execute"
        or execution_step.target_kind != "operator"
        or execution_step.target_id != operator_id
    ):
        raise ValueError(
            f"Interaction recipe {recipe_id} execution must bind its operator target exactly"
        )
    if execution_step is not steps[-1]:
        raise ValueError(
            f"Interaction recipe {recipe_id} execution step must be last"
        )
    return InteractionPathDefinition(
        kind=kind,
        steps=steps,
        surface_id=_expect_string(raw["surfaceId"], "Interaction surfaceId"),
        operator_id=operator_id,
        manual_reference=manual_reference,
    )


def _parse_unavailable_materialization(
    value: Any,
    label: str,
) -> ProcedureMaterializationChannel:
    raw = _expect_object(value, label)
    _expect_exact_keys(
        raw,
        required={"availability", "reason"},
        label=label,
    )
    if raw["availability"] != "unavailable":
        raise ValueError(f"{label} availability must be unavailable")
    return ProcedureMaterializationChannel(
        availability="unavailable",
        reason=_expect_string(raw["reason"], f"{label} reason"),
    )


def _parse_parameter_source(
    value: Any,
    label: str,
) -> ParameterAssignmentSourceDefinition:
    raw = _expect_object(value, label)
    kind = _expect_string(raw.get("kind"), f"{label} kind")
    if kind == "literal":
        _expect_exact_keys(raw, required={"kind", "value"}, label=label)
        return ParameterAssignmentSourceDefinition(kind=kind, value=raw["value"])
    if kind == "action_argument":
        _expect_exact_keys(
            raw,
            required={"kind", "argumentName", "transform"},
            label=label,
        )
        transform = _expect_string(raw["transform"], f"{label} transform")
        if transform not in {
            "identity",
            "divide_by_two",
            "uniform_vector3",
            "vector3_x",
            "vector3_y",
            "vector3_z",
        }:
            raise ValueError(f"{label} has unsupported transform")
        return ParameterAssignmentSourceDefinition(
            kind=kind,
            argument_name=_expect_string(
                raw["argumentName"], f"{label} argumentName"
            ),
            transform=transform,
        )
    if kind == "derived_action_arguments":
        _expect_exact_keys(
            raw,
            required={
                "kind",
                "derivation",
                "startArgumentName",
                "endArgumentName",
                "output",
            },
            label=label,
        )
        derivation = _expect_string(raw["derivation"], f"{label} derivation")
        if derivation != "segment_frame":
            raise ValueError(f"{label} has unsupported derivation")
        start_argument_name = _expect_string(
            raw["startArgumentName"], f"{label} startArgumentName"
        )
        end_argument_name = _expect_string(
            raw["endArgumentName"], f"{label} endArgumentName"
        )
        if start_argument_name == end_argument_name:
            raise ValueError(f"{label} segment frame arguments must differ")
        output = _expect_string(raw["output"], f"{label} output")
        if output not in {
            "distance",
            "midpoint",
            "rotation_euler_xyz_align_z",
        }:
            raise ValueError(f"{label} has unsupported segment frame output")
        return ParameterAssignmentSourceDefinition(
            kind=kind,
            derivation=derivation,
            start_argument_name=start_argument_name,
            end_argument_name=end_argument_name,
            output=output,
        )
    raise ValueError(f"{label} has unknown kind")


def _parse_parameters(
    value: Any,
    label: str,
    *,
    require_nonempty: bool = False,
) -> tuple[ParameterAssignmentDefinition, ...]:
    if not isinstance(value, list) or (require_nonempty and not value):
        if require_nonempty:
            raise ValueError(f"{label} must be a non-empty array")
        raise ValueError(f"{label} must be an array")
    parameters: list[ParameterAssignmentDefinition] = []
    names: set[str] = set()
    for raw_value in value:
        raw = _expect_object(raw_value, f"{label} parameter")
        _expect_exact_keys(
            raw,
            required={"name", "source"},
            label=f"{label} parameter",
        )
        name = _expect_string(raw["name"], f"{label} parameter name")
        if name in RESERVED_PARAMETER_NAMES:
            raise ValueError(f"{label} contains reserved parameter name {name}")
        if PARAMETER_ASSIGNMENT_NAME_PATTERN.fullmatch(name) is None:
            raise ValueError(f"{label} contains non-portable parameter name {name}")
        if name in names:
            raise ValueError(f"{label} contains duplicate parameter name {name}")
        names.add(name)
        parameters.append(
            ParameterAssignmentDefinition(
                name=name,
                source=_parse_parameter_source(
                    raw["source"], f"{label} parameter {name} source"
                ),
            )
        )
    return tuple(parameters)


def _parse_control_operations(
    value: Any,
    recipe_id: str,
    guidance: InteractionPathDefinition,
) -> tuple[PostExecutionControlOperationDefinition, ...]:
    label = f"Interaction recipe {recipe_id} controlOperations"
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a non-empty array")
    step_ids = {step.id for step in guidance.steps}
    step_labels = {step.label for step in guidance.steps}
    operation_ids: set[str] = set()
    operation_labels: set[str] = set()
    operations: list[PostExecutionControlOperationDefinition] = []
    for raw_value in value:
        raw = _expect_object(raw_value, f"{label} operation")
        _expect_exact_keys(
            raw,
            required={"id", "label", "target", "path", "parameters"},
            label=f"{label} operation",
        )
        operation_id = _expect_string(raw["id"], f"{label} operation id")
        if STEP_ID_PATTERN.fullmatch(operation_id) is None:
            raise ValueError(f"{label} has invalid operation id")
        operation_label = _expect_string(raw["label"], f"{label} operation label")
        if operation_id in operation_ids or operation_id in step_ids:
            raise ValueError(f"{label} contains duplicate operation id {operation_id}")
        if operation_label in operation_labels or operation_label in step_labels:
            raise ValueError(
                f"{label} contains duplicate operation label {operation_label}"
            )
        target = _expect_object(raw["target"], f"{label} operation target")
        _expect_exact_keys(
            target,
            required={"kind", "hostId"},
            label=f"{label} operation target",
        )
        if target["kind"] != "control":
            raise ValueError(f"{label} operation target kind must be control")
        raw_path = raw["path"]
        if not isinstance(raw_path, list) or not raw_path:
            raise ValueError(f"{label} operation path must be a non-empty array")
        path = tuple(
            _expect_string(item, f"{label} operation path item")
            for item in raw_path
        )
        operation_ids.add(operation_id)
        operation_labels.add(operation_label)
        operations.append(
            PostExecutionControlOperationDefinition(
                id=operation_id,
                label=operation_label,
                target_id=_expect_string(
                    target["hostId"], f"{label} operation target hostId"
                ),
                path=path,
                parameters=_parse_parameters(
                    raw["parameters"],
                    f"{label} operation {operation_id}",
                    require_nonempty=True,
                ),
            )
        )
    return tuple(operations)


def _parse_omitted_action_arguments(
    value: Any,
    recipe_id: str,
) -> tuple[OmittedActionArgumentDefinition, ...]:
    label = f"Interaction recipe {recipe_id} omittedActionArguments"
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    omitted: list[OmittedActionArgumentDefinition] = []
    names: set[str] = set()
    for raw_value in value:
        raw = _expect_object(raw_value, f"{label} entry")
        _expect_exact_keys(
            raw,
            required={"argumentName", "reason"},
            label=f"{label} entry",
        )
        argument_name = _expect_string(
            raw["argumentName"], f"{label} argumentName"
        )
        if argument_name in names:
            raise ValueError(f"{label} contains duplicate argument {argument_name}")
        names.add(argument_name)
        omitted.append(
            OmittedActionArgumentDefinition(
                argument_name=argument_name,
                reason=_expect_string(raw["reason"], f"{label} reason"),
            )
        )
    return tuple(omitted)


def _parse_shortcut_preconditions(
    value: Any,
    recipe_id: str,
) -> tuple[ShortcutPreconditionDefinition, ...]:
    label = f"Interaction recipe {recipe_id} shortcut preconditions"
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a non-empty array")
    preconditions: list[ShortcutPreconditionDefinition] = []
    kinds: set[str] = set()
    singleton_kinds: set[str] = set()
    kind_labels: set[tuple[str, str]] = set()
    for raw_value in value:
        raw = _expect_object(raw_value, f"{label} entry")
        _expect_exact_keys(
            raw,
            required={"kind", "label", "value"},
            label=f"{label} entry",
        )
        kind = _expect_string(raw["kind"], f"{label} kind")
        if kind not in SHORTCUT_PRECONDITION_KINDS:
            raise ValueError(f"{label} has unknown kind {kind}")
        precondition_label = _expect_string(raw["label"], f"{label} label")
        kind_label = (kind, precondition_label)
        if kind_label in kind_labels:
            raise ValueError(
                f"{label} contains duplicate precondition "
                f"{kind}:{precondition_label}"
            )
        if kind in SINGLETON_SHORTCUT_PRECONDITION_KINDS:
            if kind in singleton_kinds:
                raise ValueError(
                    f"{label} must declare exactly one precondition for {kind}"
                )
            singleton_kinds.add(kind)
        kind_labels.add(kind_label)
        kinds.add(kind)
        preconditions.append(
            ShortcutPreconditionDefinition(
                kind=kind,
                label=precondition_label,
                value=_expect_string(raw["value"], f"{label} value"),
            )
        )
    missing = REQUIRED_SHORTCUT_PRECONDITION_KINDS - kinds
    if missing:
        raise ValueError(
            f"{label} missing required kinds: {', '.join(sorted(missing))}"
        )
    return tuple(preconditions)


def _parse_shortcut_operations(
    value: Any,
    recipe_id: str,
) -> tuple[ShortcutOperationDefinition, ...]:
    label = f"Interaction recipe {recipe_id} shortcut operations"
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a non-empty array")
    operations: list[ShortcutOperationDefinition] = []
    ids: set[str] = set()
    labels: set[str] = set()
    for raw_value in value:
        raw = _expect_object(raw_value, f"{label} operation")
        _expect_exact_keys(
            raw,
            required={"id", "label", "keyMode", "keys", "parameters"},
            optional={"selectionPath"},
            label=f"{label} operation",
        )
        operation_id = _expect_string(raw["id"], f"{label} operation id")
        if STEP_ID_PATTERN.fullmatch(operation_id) is None:
            raise ValueError(f"{label} has invalid operation id")
        operation_label = _expect_string(raw["label"], f"{label} operation label")
        if operation_id in ids:
            raise ValueError(f"{label} contains duplicate operation id {operation_id}")
        if operation_label in labels:
            raise ValueError(
                f"{label} contains duplicate operation label {operation_label}"
            )
        key_mode = _expect_string(raw["keyMode"], f"{label} operation keyMode")
        if key_mode not in {"chord", "sequence"}:
            raise ValueError(f"{label} operation has unsupported keyMode")
        raw_keys = raw["keys"]
        if not isinstance(raw_keys, list) or not raw_keys:
            raise ValueError(f"{label} operation keys must be a non-empty array")
        keys = tuple(
            _expect_string(item, f"{label} operation key") for item in raw_keys
        )
        selection_path = None
        if "selectionPath" in raw:
            raw_selection_path = raw["selectionPath"]
            if not isinstance(raw_selection_path, list) or not raw_selection_path:
                raise ValueError(
                    f"{label} operation selectionPath must be a non-empty array"
                )
            selection_path = tuple(
                _expect_string(item, f"{label} operation selectionPath item")
                for item in raw_selection_path
            )
        ids.add(operation_id)
        labels.add(operation_label)
        operations.append(
            ShortcutOperationDefinition(
                id=operation_id,
                label=operation_label,
                key_mode=key_mode,
                keys=keys,
                selection_path=selection_path,
                parameters=_parse_parameters(
                    raw["parameters"],
                    f"{label} operation {operation_id}",
                    require_nonempty=True,
                ),
            )
        )
    return tuple(operations)


def _parse_shortcut_materialization(
    value: Any,
    recipe_id: str,
) -> ProcedureMaterializationChannel:
    label = f"Interaction recipe {recipe_id} procedureMaterialization shortcut"
    raw = _expect_object(value, label)
    availability = _expect_string(raw.get("availability"), f"{label} availability")
    if availability == "unavailable":
        return _parse_unavailable_materialization(raw, label)
    if availability != "available":
        raise ValueError(f"{label} has unknown availability")
    _expect_exact_keys(
        raw,
        required={
            "availability",
            "source",
            "semanticBinding",
            "parameterBinding",
            "projection",
            "preconditions",
            "operations",
            "omittedActionArguments",
        },
        label=label,
    )
    if raw["source"] != "catalog.ordered_shortcut_operations":
        raise ValueError(f"{label} has unsupported source")
    if raw["semanticBinding"] != "all_leaf_operations":
        raise ValueError(f"{label} has unsupported semanticBinding")
    if raw["parameterBinding"] != "ordered_parameter_operations":
        raise ValueError(f"{label} has unsupported parameterBinding")
    if raw["projection"] != "candidate_only":
        raise ValueError(f"{label} projection must be candidate_only")
    return ProcedureMaterializationChannel(
        availability="available",
        source="catalog.ordered_shortcut_operations",
        semantic_binding="all_leaf_operations",
        parameter_binding="ordered_parameter_operations",
        projection="candidate_only",
        preconditions=_parse_shortcut_preconditions(raw["preconditions"], recipe_id),
        shortcut_operations=_parse_shortcut_operations(raw["operations"], recipe_id),
        omitted_action_arguments=_parse_omitted_action_arguments(
            raw["omittedActionArguments"], recipe_id
        ),
    )


def _parse_procedure_materialization(
    value: Any,
    recipe_id: str,
    guidance: InteractionPathDefinition,
) -> ProcedureMaterializationDefinition:
    label = f"Interaction recipe {recipe_id} procedureMaterialization"
    raw = _expect_object(value, label)
    _expect_exact_keys(
        raw,
        required={"menu", "shortcut", "mcp"},
        label=label,
    )
    raw_menu = _expect_object(raw["menu"], f"{label} menu")
    menu_availability = _expect_string(
        raw_menu.get("availability"), f"{label} menu availability"
    )
    if menu_availability == "unavailable":
        menu = _parse_unavailable_materialization(raw_menu, f"{label} menu")
    elif menu_availability == "available":
        parameter_binding = _expect_string(
            raw_menu.get("parameterBinding"), f"{label} menu parameterBinding"
        )
        base_keys = {
            "availability",
            "source",
            "semanticBinding",
            "parameterBinding",
        }
        if parameter_binding == "accepted_action_arguments":
            _expect_exact_keys(raw_menu, required=base_keys, label=f"{label} menu")
        elif parameter_binding == "ordered_parameter_operations":
            _expect_exact_keys(
                raw_menu,
                required=base_keys
                | {
                    "operatorParameters",
                    "controlOperations",
                    "omittedActionArguments",
                },
                label=f"{label} menu",
            )
        else:
            raise ValueError(f"{label} menu has unsupported parameterBinding")
        if raw_menu["source"] != "guidance.native_path":
            raise ValueError(f"{label} menu has unsupported source")
        if raw_menu["semanticBinding"] != "all_leaf_operations":
            raise ValueError(f"{label} menu has unsupported semanticBinding")
        if guidance.kind is not InteractionPathKind.NATIVE:
            raise ValueError(
                f"Interaction recipe {recipe_id} available menu materialization "
                "requires native_path guidance with accepted_plan_action execution"
            )
        unsupported_step = next(
            (
                step
                for step in guidance.steps
                if step.target_kind not in MENU_PROCEDURE_TARGET_KINDS
            ),
            None,
        )
        if unsupported_step is not None:
            raise ValueError(
                f"Interaction recipe {recipe_id} available menu materialization "
                f"cannot represent {unsupported_step.target_kind} targets"
            )
        operator_parameters = None
        control_operations = None
        omitted_action_arguments = None
        if parameter_binding == "ordered_parameter_operations":
            raw_control_operations = _expect_object(
                raw_menu["controlOperations"],
                f"Interaction recipe {recipe_id} controlOperations",
            )
            _expect_exact_keys(
                raw_control_operations,
                required={"insertAfterStepId", "operations"},
                label=f"Interaction recipe {recipe_id} controlOperations",
            )
            insert_after_step_id = _expect_string(
                raw_control_operations["insertAfterStepId"],
                f"{label} menu controlOperations insertAfterStepId",
            )
            if insert_after_step_id != guidance.steps[-1].id:
                raise ValueError(
                    f"Interaction recipe {recipe_id} insertAfterStepId must equal "
                    "the execution step"
                )
            operator_parameters = _parse_parameters(
                raw_menu["operatorParameters"],
                f"Interaction recipe {recipe_id} operatorParameters",
            )
            control_operations = PostExecutionControlOperationsDefinition(
                insert_after_step_id=insert_after_step_id,
                operations=_parse_control_operations(
                    raw_control_operations["operations"], recipe_id, guidance
                ),
            )
            omitted_action_arguments = _parse_omitted_action_arguments(
                raw_menu["omittedActionArguments"], recipe_id
            )
        menu = ProcedureMaterializationChannel(
            availability="available",
            source="guidance.native_path",
            semantic_binding="all_leaf_operations",
            parameter_binding=parameter_binding,
            operator_parameters=operator_parameters,
            control_operations=control_operations,
            omitted_action_arguments=omitted_action_arguments,
        )
    else:
        raise ValueError(f"{label} menu has unknown availability")

    return ProcedureMaterializationDefinition(
        menu=menu,
        shortcut=_parse_shortcut_materialization(raw["shortcut"], recipe_id),
        mcp=_parse_unavailable_materialization(raw["mcp"], f"{label} mcp"),
    )


def _is_fixed_numeric_vector3_schema(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and value.get("type") == "array"
        and value.get("minItems") == 3
        and value.get("maxItems") == 3
        and isinstance(value.get("items"), dict)
        and value["items"].get("type") in {"number", "integer"}
    )


def _validate_parameter_assignment_coverage(
    recipe: InteractionRecipe,
    action: dict[str, Any],
    channel_name: str,
    channel: ProcedureMaterializationChannel,
    parameters: list[ParameterAssignmentDefinition],
) -> None:
    assert channel.omitted_action_arguments is not None

    argument_schema = _expect_object(
        action.get("argumentsSchema"),
        f"Action {recipe.action_name} argumentsSchema",
    )
    properties = _expect_object(
        argument_schema.get("properties"),
        f"Action {recipe.action_name} argument properties",
    )
    property_names = set(properties)
    direct_sources: dict[str, list[ParameterAssignmentSourceDefinition]] = {}
    segment_groups: dict[
        tuple[str, str], dict[str, ParameterAssignmentSourceDefinition]
    ] = {}
    segment_argument_groups: dict[str, tuple[str, str]] = {}
    for parameter in parameters:
        source = parameter.source
        if source.kind == "literal":
            continue
        if source.kind == "action_argument":
            assert source.argument_name is not None
            direct_sources.setdefault(source.argument_name, []).append(source)
            continue
        assert source.kind == "derived_action_arguments"
        assert source.derivation == "segment_frame"
        assert source.start_argument_name is not None
        assert source.end_argument_name is not None
        assert source.output is not None
        group_key = (source.start_argument_name, source.end_argument_name)
        for argument_name in group_key:
            existing_group = segment_argument_groups.get(argument_name)
            if existing_group is not None and existing_group != group_key:
                raise ValueError(
                    f"Interaction recipe {recipe.id} {channel_name} action argument "
                    f"{argument_name} participates in more than one segment frame"
                )
            segment_argument_groups[argument_name] = group_key
        outputs = segment_groups.setdefault(group_key, {})
        if source.output in outputs:
            raise ValueError(
                f"Interaction recipe {recipe.id} {channel_name} segment frame "
                f"{source.start_argument_name}->{source.end_argument_name} maps output "
                f"{source.output} more than once"
            )
        outputs[source.output] = source

    omitted_names = {
        omitted.argument_name for omitted in channel.omitted_action_arguments
    }
    mapped_names = set(direct_sources) | set(segment_argument_groups)
    overlap = mapped_names & omitted_names
    if overlap:
        raise ValueError(
            f"Interaction recipe {recipe.id} both maps and omits action argument "
            f"{min(overlap)}"
        )
    unknown = (mapped_names | omitted_names) - property_names
    missing = property_names - mapped_names - omitted_names
    if unknown or missing:
        raise ValueError(
            f"Interaction recipe {recipe.id} {channel_name} ordered parameter "
            "action coverage mismatch; "
            f"missing: {', '.join(sorted(missing)) or 'none'}; "
            f"unknown: {', '.join(sorted(unknown)) or 'none'}"
        )
    component_transforms = {"vector3_x", "vector3_y", "vector3_z"}
    for argument_name, sources in direct_sources.items():
        if argument_name in segment_argument_groups:
            raise ValueError(
                f"Interaction recipe {recipe.id} {channel_name} action argument "
                f"{argument_name} cannot mix direct and segment-frame mappings"
            )
        transforms = [source.transform for source in sources]
        components = [
            transform for transform in transforms if transform in component_transforms
        ]
        whole = [
            transform
            for transform in transforms
            if transform not in component_transforms
        ]
        property_schema = _expect_object(
            properties[argument_name],
            f"Action {recipe.action_name} argument {argument_name} schema",
        )
        if components:
            if not _is_fixed_numeric_vector3_schema(property_schema):
                raise ValueError(
                    f"Interaction recipe {recipe.id} {channel_name} vector3 "
                    f"component source {argument_name} must have a fixed-length "
                    "numeric vector3 action schema"
                )
        if components and whole:
            raise ValueError(
                f"Interaction recipe {recipe.id} {channel_name} mixes whole and "
                f"component mappings for action argument {argument_name}"
            )
        if components:
            duplicate_component = next(
                (
                    component
                    for component in component_transforms
                    if components.count(component) > 1
                ),
                None,
            )
            if duplicate_component is not None:
                raise ValueError(
                    f"Interaction recipe {recipe.id} {channel_name} maps action "
                    f"argument {argument_name} {duplicate_component} more than once"
                )
            if len(components) != 3 or set(components) != component_transforms:
                raise ValueError(
                    f"Interaction recipe {recipe.id} {channel_name} must map "
                    f"vector3 components x, y, and z exactly once for action argument "
                    f"{argument_name}"
                )
        elif len(whole) != 1:
            raise ValueError(
                f"Interaction recipe {recipe.id} maps action argument "
                f"{argument_name} more than once"
            )
        source = sources[0]
        if source.transform not in {"divide_by_two", "uniform_vector3"}:
            continue
        if property_schema.get("type") not in {"number", "integer"}:
            raise ValueError(
                f"Interaction recipe {recipe.id} {source.transform} source "
                f"{argument_name} must have a numeric action schema"
            )

    required_segment_outputs = {
        "distance",
        "midpoint",
        "rotation_euler_xyz_align_z",
    }
    for (start_argument_name, end_argument_name), outputs in segment_groups.items():
        for argument_name in (start_argument_name, end_argument_name):
            if argument_name in direct_sources:
                raise ValueError(
                    f"Interaction recipe {recipe.id} {channel_name} action argument "
                    f"{argument_name} cannot mix direct and segment-frame mappings"
                )
            property_schema = properties.get(argument_name)
            if not _is_fixed_numeric_vector3_schema(property_schema):
                raise ValueError(
                    f"Interaction recipe {recipe.id} {channel_name} segment frame "
                    f"argument {argument_name} must have a fixed-length numeric "
                    "vector3 action schema"
                )
        actual_outputs = set(outputs)
        if actual_outputs != required_segment_outputs:
            missing_outputs = required_segment_outputs - actual_outputs
            unknown_outputs = actual_outputs - required_segment_outputs
            raise ValueError(
                f"Interaction recipe {recipe.id} {channel_name} segment frame "
                f"{start_argument_name}->{end_argument_name} output coverage mismatch; "
                f"missing: {', '.join(sorted(missing_outputs)) or 'none'}; "
                f"unknown: {', '.join(sorted(unknown_outputs)) or 'none'}"
            )


def _validate_ordered_parameter_operations(
    recipe: InteractionRecipe,
    action: dict[str, Any],
) -> None:
    materialization = recipe.procedure_materialization
    if materialization is None:
        return
    menu = materialization.menu
    if menu.parameter_binding == "ordered_parameter_operations":
        assert menu.operator_parameters is not None
        assert menu.control_operations is not None
        parameters = list(menu.operator_parameters)
        for operation in menu.control_operations.operations:
            parameters.extend(operation.parameters)
        _validate_parameter_assignment_coverage(
            recipe, action, "menu", menu, parameters
        )
    shortcut = materialization.shortcut
    if shortcut.parameter_binding == "ordered_parameter_operations":
        assert shortcut.shortcut_operations is not None
        parameters = []
        for operation in shortcut.shortcut_operations:
            parameters.extend(operation.parameters)
        _validate_parameter_assignment_coverage(
            recipe, action, "shortcut", shortcut, parameters
        )


def load_interaction_catalog(
    path: Path = RESOURCE_PATH,
    action_catalog_path: Path = ACTION_CATALOG_PATH,
) -> InteractionCatalog:
    """Load, strictly validate, and cross-check one adapter interaction catalog."""

    with path.open(encoding="utf-8") as resource:
        raw = _load_json_object(resource, "Interaction catalog")
    _expect_exact_keys(
        raw,
        required={
            "protocolVersion",
            "catalogVersion",
            "adapterId",
            "actionCatalogVersion",
            "adapterVersionRange",
            "hostVersionRange",
            "title",
            "description",
            "recipes",
        },
        label="Interaction catalog",
    )
    raw_recipes = raw["recipes"]
    if not isinstance(raw_recipes, list) or not raw_recipes:
        raise ValueError("Interaction catalog must contain recipes")
    recipes: list[InteractionRecipe] = []
    recipe_ids: set[str] = set()
    action_names: set[str] = set()
    for raw_recipe_value in raw_recipes:
        raw_recipe = _expect_object(raw_recipe_value, "Interaction recipe")
        _expect_exact_keys(
            raw_recipe,
            required={"id", "actionName", "title", "guidance"},
            optional={"procedureMaterialization"},
            label="Interaction recipe",
        )
        recipe_id = _expect_string(raw_recipe["id"], "Interaction recipe id")
        if STEP_ID_PATTERN.fullmatch(recipe_id) is None:
            raise ValueError(f"Invalid interaction recipe id: {recipe_id}")
        action_name = _expect_string(
            raw_recipe["actionName"], "Interaction recipe actionName"
        )
        if recipe_id in recipe_ids:
            raise ValueError(f"Duplicate interaction recipe id: {recipe_id}")
        if action_name in action_names:
            raise ValueError(f"Duplicate interaction recipe action: {action_name}")
        recipe_ids.add(recipe_id)
        action_names.add(action_name)
        guidance = _parse_guidance(raw_recipe["guidance"], recipe_id)
        recipes.append(
            InteractionRecipe(
                id=recipe_id,
                action_name=action_name,
                title=_expect_string(raw_recipe["title"], "Interaction recipe title"),
                guidance=guidance,
                procedure_materialization=(
                    _parse_procedure_materialization(
                        raw_recipe["procedureMaterialization"], recipe_id, guidance
                    )
                    if "procedureMaterialization" in raw_recipe
                    else None
                ),
            )
        )

    with action_catalog_path.open(encoding="utf-8") as resource:
        action_catalog = _load_json_object(resource, "Action catalog")
    action_catalog_adapter = _expect_string(
        action_catalog.get("adapterId"), "Action catalog adapterId"
    )
    action_catalog_version = _expect_version(
        action_catalog.get("catalogVersion"), "Action catalog catalogVersion"
    )
    adapter_id = _expect_string(raw["adapterId"], "Interaction catalog adapterId")
    bound_action_catalog_version = _expect_version(
        raw["actionCatalogVersion"], "Interaction catalog actionCatalogVersion"
    )
    if (
        adapter_id != action_catalog_adapter
        or bound_action_catalog_version != action_catalog_version
    ):
        raise ValueError("Interaction catalog does not match its ActionCatalog identity")
    raw_actions = action_catalog.get("actions")
    if not isinstance(raw_actions, list):
        raise ValueError("Action catalog actions must be an array")
    catalog_action_definitions: dict[str, dict[str, Any]] = {}
    for raw_action_value in raw_actions:
        raw_action = _expect_object(raw_action_value, "Action catalog action")
        raw_action_name = _expect_string(
            raw_action.get("name"), "Action catalog action name"
        )
        catalog_action_definitions[raw_action_name] = raw_action
    catalog_actions = set(catalog_action_definitions)
    missing = catalog_actions - action_names
    unknown = action_names - catalog_actions
    if missing or unknown:
        raise ValueError(
            "Interaction catalog action coverage mismatch; "
            f"missing: {', '.join(sorted(missing)) or 'none'}; "
            f"unknown: {', '.join(sorted(unknown)) or 'none'}"
        )
    for recipe in recipes:
        _validate_ordered_parameter_operations(
            recipe, catalog_action_definitions[recipe.action_name]
        )

    return InteractionCatalog(
        protocol_version=_expect_version(
            raw["protocolVersion"], "Interaction catalog protocolVersion"
        ),
        catalog_version=_expect_version(
            raw["catalogVersion"], "Interaction catalog catalogVersion"
        ),
        adapter_id=adapter_id,
        action_catalog_version=bound_action_catalog_version,
        adapter_version_range=_expect_string(
            raw["adapterVersionRange"], "Interaction catalog adapterVersionRange"
        ),
        host_version_range=_expect_string(
            raw["hostVersionRange"], "Interaction catalog hostVersionRange"
        ),
        title=_expect_string(raw["title"], "Interaction catalog title"),
        description=_expect_string(
            raw["description"], "Interaction catalog description"
        ),
        recipes=tuple(recipes),
    )


BUNDLED_INTERACTION_CATALOG = load_interaction_catalog()


__all__ = (
    "ACTION_CATALOG_PATH",
    "BUNDLED_INTERACTION_CATALOG",
    "InteractionCatalog",
    "InteractionPathDefinition",
    "InteractionPathKind",
    "InteractionRecipe",
    "InteractionStepDefinition",
    "OmittedActionArgumentDefinition",
    "ParameterAssignmentDefinition",
    "ParameterAssignmentSourceDefinition",
    "PostExecutionControlOperationDefinition",
    "PostExecutionControlOperationsDefinition",
    "ProcedureMaterializationChannel",
    "ProcedureMaterializationDefinition",
    "RESOURCE_PATH",
    "ShortcutOperationDefinition",
    "ShortcutPreconditionDefinition",
    "load_interaction_catalog",
)
