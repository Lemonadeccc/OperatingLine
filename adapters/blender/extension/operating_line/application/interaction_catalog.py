"""Validated adapter-owned interaction recipes for accepted Blender actions."""

from dataclasses import dataclass
from enum import Enum
import json
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
        _expect_exact_keys(
            raw_menu,
            required={
                "availability",
                "source",
                "semanticBinding",
                "parameterBinding",
            },
            label=f"{label} menu",
        )
        if raw_menu["source"] != "guidance.native_path":
            raise ValueError(f"{label} menu has unsupported source")
        if raw_menu["semanticBinding"] != "all_leaf_operations":
            raise ValueError(f"{label} menu has unsupported semanticBinding")
        if raw_menu["parameterBinding"] != "accepted_action_arguments":
            raise ValueError(f"{label} menu has unsupported parameterBinding")
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
        menu = ProcedureMaterializationChannel(
            availability="available",
            source="guidance.native_path",
            semantic_binding="all_leaf_operations",
            parameter_binding="accepted_action_arguments",
        )
    else:
        raise ValueError(f"{label} menu has unknown availability")

    return ProcedureMaterializationDefinition(
        menu=menu,
        shortcut=_parse_unavailable_materialization(
            raw["shortcut"], f"{label} shortcut"
        ),
        mcp=_parse_unavailable_materialization(raw["mcp"], f"{label} mcp"),
    )


def load_interaction_catalog(
    path: Path = RESOURCE_PATH,
    action_catalog_path: Path = ACTION_CATALOG_PATH,
) -> InteractionCatalog:
    """Load, strictly validate, and cross-check one adapter interaction catalog."""

    with path.open(encoding="utf-8") as resource:
        raw = _expect_object(json.load(resource), "Interaction catalog")
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
        action_catalog = _expect_object(json.load(resource), "Action catalog")
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
    catalog_actions = {
        _expect_string(
            _expect_object(action, "Action catalog action").get("name"),
            "Action catalog action name",
        )
        for action in raw_actions
    }
    missing = catalog_actions - action_names
    unknown = action_names - catalog_actions
    if missing or unknown:
        raise ValueError(
            "Interaction catalog action coverage mismatch; "
            f"missing: {', '.join(sorted(missing)) or 'none'}; "
            f"unknown: {', '.join(sorted(unknown)) or 'none'}"
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
    "ProcedureMaterializationChannel",
    "ProcedureMaterializationDefinition",
    "RESOURCE_PATH",
    "load_interaction_catalog",
)
