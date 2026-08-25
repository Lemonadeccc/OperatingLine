"""Deterministic microsteps resolved from the Blender InteractionCatalog."""

from copy import deepcopy
from dataclasses import dataclass, replace
from enum import Enum
import hashlib
import json
import math
from typing import Any

from ..domain import TaskNode
from .guidance import GuidanceState
from .interaction_catalog import (
    BUNDLED_INTERACTION_CATALOG,
    InteractionCatalog,
    InteractionPathKind,
    InteractionRecipe,
    NodeSocketConnectionDefinition,
    ParameterAssignmentDefinition,
    ParameterAssignmentSourceDefinition,
)


class MenuGuidanceRole(str, Enum):
    """Navigation role for a non-mutating native-menu microstep."""

    COMPLETED = "completed"
    PREVIOUS = "previous"
    CURRENT = "current"
    NEXT = "next"
    LOCKED = "locked"


class LeafOperationEvidence(str, Enum):
    """Host evidence observed for one leaf-local instruction."""

    NONE = "none"
    REVEALED = "revealed"
    VERIFIED = "verified"


class LeafTargetTrust(str, Enum):
    """How precisely one instruction is bound to a visible Blender target."""

    EXACT_NATIVE = "exact_native"
    GUIDED_CONTROL = "guided_control"
    CONTAINER_CAPABLE = "container_capable"
    CONTAINER_EXACT = "container_exact"
    PROFILED = "profiled"
    VISION_CANDIDATE = "vision_candidate"
    REFERENCE_ONLY = "reference_only"


_ROLE_STATES = {
    MenuGuidanceRole.COMPLETED: GuidanceState.COMPLETED,
    MenuGuidanceRole.PREVIOUS: GuidanceState.BACK,
    MenuGuidanceRole.CURRENT: GuidanceState.COMPLETED,
    MenuGuidanceRole.NEXT: GuidanceState.NEXT,
    MenuGuidanceRole.LOCKED: GuidanceState.LOCKED,
}

_GUIDED_GEOMETRY_PARAMETER_RECIPES = {
    "blender.geometry_nodes.create_transform.semantic",
    "blender.geometry_nodes.create_light_trails.semantic",
    "blender.animation.create_pose_keyframes.semantic",
    "blender.rig.create_armature.semantic",
    "blender.rig.bind_skin_weights.semantic",
}


@dataclass(frozen=True, slots=True)
class MenuGuidanceItem:
    """One visible microstep inside an executable task-tree leaf."""

    ordinal: int
    step_id: str
    label: str
    intent: str
    target_kind: str
    target_id: str
    role: MenuGuidanceRole

    @property
    def state(self) -> GuidanceState:
        """Map the menu role onto the shared visual color tokens."""

        return _ROLE_STATES[self.role]


@dataclass(frozen=True, slots=True)
class LeafGuidanceParameter:
    """One catalog parameter resolved for display without guessing."""

    name: str
    value: Any
    display_value: str
    resolved: bool
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class LeafGuidanceOperation:
    """One leaf-local menu, control, node, or socket operation."""

    ordinal: int
    operation_id: str
    label: str
    intent: str
    target_kind: str
    target_id: str
    path: tuple[str, ...]
    parameters: tuple[LeafGuidanceParameter, ...]
    role: MenuGuidanceRole
    native: bool
    evidence: LeafOperationEvidence = LeafOperationEvidence.NONE
    failure_reason: str | None = None
    connection: NodeSocketConnectionDefinition | None = None
    container_operation_id: str | None = None
    container_target_id: str | None = None
    target_trust: LeafTargetTrust = LeafTargetTrust.REFERENCE_ONLY

    @property
    def state(self) -> GuidanceState:
        """Map the operation role onto the shared visual color tokens."""

        return _ROLE_STATES[self.role]

    @property
    def reference(self) -> bool:
        """Whether this operation is descriptive rather than host-wired."""

        return not self.native

    @property
    def uses_guided_control(self) -> bool:
        """Whether an OperatingLine-owned control can perform this instruction."""

        return self.target_trust is LeafTargetTrust.GUIDED_CONTROL

    @property
    def ordinal_label(self) -> str:
        """Return the stable two-digit label used by the Blender UI."""

        return f"{self.ordinal:02d}"


@dataclass(frozen=True, slots=True)
class MenuGuidanceSnapshot:
    """Current state of one catalog-owned native or semantic path."""

    step_id: str
    recipe_id: str
    catalog_version: str
    path_kind: InteractionPathKind
    title: str
    operator_id: str | None
    revealed_depth: int
    reason: str | None
    items: tuple[MenuGuidanceItem, ...]
    operations: tuple[LeafGuidanceOperation, ...]
    focused_ordinal: int
    cursor_token: str
    retry_serial: int
    can_focus_back: bool
    can_focus_next: bool
    candidate_only: bool = False
    managed_equivalent: bool = True

    @property
    def native(self) -> bool:
        """Whether the path is wired to a verified real host control."""

        return self.path_kind is InteractionPathKind.NATIVE

    def collapsed_ordinals(self, label: str) -> tuple[int, ...]:
        """Return this label and all still-nested ordinals for a closed menu."""

        index = next(
            (item_index for item_index, item in enumerate(self.items) if item.label == label),
            -1,
        )
        if index < 0:
            return ()
        return tuple(item.ordinal for item in self.items[index:])

    def accepts(self, operator_id: str) -> bool:
        """Whether a native final menu item matches the accepted leaf exactly."""

        return (
            not self.candidate_only
            and self.managed_equivalent
            and self.native
            and operator_id == self.operator_id
        )

    @property
    def focused_operation(self) -> LeafGuidanceOperation:
        """Return the instruction selected by leaf-local navigation."""

        return self.operations[self.focused_ordinal - 1]


def _recipe_for_step(
    step: TaskNode,
    catalog: InteractionCatalog,
) -> InteractionRecipe | None:
    # GuidePlan currently carries only selected-track identity and hashes, not
    # the full selected ProcedureTree operations. Do not substitute a local
    # menu recipe for an override that may select shortcut or MCP execution.
    if step.execution_track_override is not None:
        return None
    action = step.action
    if action is None or action.adapter_id != catalog.adapter_id:
        return None
    return catalog.recipe_for(action.name)


def _display_value(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    except (TypeError, ValueError):
        return repr(value)


def _unresolved_parameter(name: str, reason: str) -> LeafGuidanceParameter:
    return LeafGuidanceParameter(
        name=name,
        value=None,
        display_value=f"Unresolved ({reason})",
        resolved=False,
        reason=reason,
    )


def _numeric_vector3(value: Any) -> tuple[float, float, float] | None:
    if (
        not isinstance(value, (list, tuple))
        or len(value) != 3
        or any(isinstance(component, bool) for component in value)
        or not all(isinstance(component, (int, float)) for component in value)
        or not all(math.isfinite(component) for component in value)
    ):
        return None
    return (float(value[0]), float(value[1]), float(value[2]))


def _canonical_finite_number(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("segment frame result must be finite")
    return 0.0 if value == 0 else value


def _resolve_action_argument_source(
    source: ParameterAssignmentSourceDefinition,
    arguments: dict[str, Any],
) -> tuple[bool, Any, str | None]:
    argument_name = source.argument_name
    if argument_name is None or argument_name not in arguments:
        return False, None, f"missing action argument {argument_name!r}"
    value = deepcopy(arguments[argument_name])
    transform = source.transform
    if transform in {"identity", "json_identity"}:
        return True, value, None
    if transform == "uniform_vector3":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False, None, f"{argument_name!r} is not numeric"
        return True, [value, value, value], None
    if transform == "divide_by_two":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False, None, f"{argument_name!r} is not numeric"
        return True, value / 2, None
    component_indexes = {
        "vector3_x": 0,
        "vector3_y": 1,
        "vector3_z": 2,
    }
    if transform in component_indexes:
        vector = _numeric_vector3(value)
        if vector is None:
            return False, None, f"{argument_name!r} is not a numeric vector3"
        return True, value[component_indexes[transform]], None
    return False, None, f"unsupported transform {transform!r}"


def _resolve_derived_source(
    source: ParameterAssignmentSourceDefinition,
    arguments: dict[str, Any],
) -> tuple[bool, Any, str | None]:
    start_name = source.start_argument_name
    end_name = source.end_argument_name
    if start_name not in arguments or end_name not in arguments:
        missing = start_name if start_name not in arguments else end_name
        return False, None, f"missing action argument {missing!r}"
    start = _numeric_vector3(arguments[start_name])
    end = _numeric_vector3(arguments[end_name])
    if start is None or end is None:
        return False, None, "segment frame endpoints must be finite numeric vector3 values"
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    dz = end[2] - start[2]
    horizontal = math.hypot(dx, dy)
    distance = math.hypot(horizontal, dz)
    if not math.isfinite(distance) or distance == 0:
        return (
            False,
            None,
            "segment frame requires distinct finite endpoints with nonzero distance",
        )
    if source.output == "distance":
        return True, _canonical_finite_number(distance), None
    if source.output == "midpoint":
        result = [(start[index] + end[index]) / 2 for index in range(3)]
    elif source.output == "rotation_euler_xyz_align_z":
        result = [
            0.0,
            math.atan2(horizontal, dz),
            0.0 if horizontal == 0 else math.atan2(dy, dx),
        ]
    else:
        return False, None, f"unsupported derived output {source.output!r}"
    try:
        canonical_result = [_canonical_finite_number(component) for component in result]
    except ValueError as error:
        return False, None, str(error)
    return True, canonical_result, None


def _resolve_parameter(
    definition: ParameterAssignmentDefinition,
    arguments: dict[str, Any],
) -> LeafGuidanceParameter:
    source = definition.source
    if source.kind == "literal":
        resolved, value, reason = True, deepcopy(source.value), None
    elif source.kind == "action_argument":
        resolved, value, reason = _resolve_action_argument_source(source, arguments)
    elif source.kind == "derived_action_arguments":
        resolved, value, reason = _resolve_derived_source(source, arguments)
    else:
        resolved, value, reason = False, None, f"unsupported source {source.kind!r}"
    if not resolved:
        assert reason is not None
        return _unresolved_parameter(definition.name, reason)
    return LeafGuidanceParameter(
        name=definition.name,
        value=value,
        display_value=_display_value(value),
        resolved=True,
    )


def _semantic_projection_path(path) -> tuple[str, tuple[str, ...]]:
    """Return one stable parameter key and readable node/socket path."""

    key = ""
    labels: list[str] = []
    for segment in path:
        if segment.kind == "field":
            assert segment.name is not None
            key = f"{key}.{segment.name}" if key else segment.name
            labels.append(segment.name.replace("_", " ").title())
        else:
            assert segment.index is not None
            key = f"{key}[{segment.index}]"
            index_label = f"[{segment.index}]"
            if labels:
                labels[-1] = f"{labels[-1]} {index_label}"
            else:
                labels.append(index_label)
    return key, tuple(labels)


def _materialize_semantic_parameter_operations(
    recipe: InteractionRecipe,
    operations: list[LeafGuidanceOperation],
    action_arguments: dict[str, Any],
) -> list[LeafGuidanceOperation]:
    """Insert exact catalog parameters after their semantic node operation."""

    materialization = recipe.procedure_materialization
    semantic = materialization.semantic if materialization is not None else None
    if (
        recipe.guidance.kind is not InteractionPathKind.SEMANTIC
        or semantic is None
    ):
        return operations

    projections_by_action = {}
    for projection in semantic.projections:
        projections_by_action.setdefault(projection.semantic_action, []).append(projection)

    guidance_ids = tuple(operation.operation_id for operation in operations)
    for semantic_action in projections_by_action:
        if guidance_ids.count(semantic_action) != 1:
            raise ValueError(
                f"Interaction recipe {recipe.id} semantic action "
                f"{semantic_action!r} does not identify exactly one guidance operation"
            )

    materialized: list[LeafGuidanceOperation] = []
    operation_ids = set(guidance_ids)
    for operation in operations:
        materialized.append(operation)
        for projection in projections_by_action.get(operation.operation_id, ()):
            if projection.id in operation_ids:
                raise ValueError(
                    f"Interaction recipe {recipe.id} repeats operation "
                    f"{projection.id!r}"
                )
            operation_ids.add(projection.id)
            parameter_key, path_labels = _semantic_projection_path(projection.path)
            parameter = _resolve_parameter(
                ParameterAssignmentDefinition(
                    name=parameter_key,
                    source=ParameterAssignmentSourceDefinition(
                        kind="action_argument",
                        argument_name=projection.action_argument,
                        transform=projection.transform,
                    ),
                ),
                action_arguments,
            )
            target_kind = (
                "socket" if operation.target_kind == "node" else "control"
            )
            materialized.append(
                LeafGuidanceOperation(
                    ordinal=len(materialized) + 1,
                    operation_id=projection.id,
                    label=f"Set {' / '.join(path_labels)}",
                    intent="configure",
                    target_kind=target_kind,
                    target_id=f"{operation.target_id}.{parameter_key}",
                    path=(*operation.path, *path_labels),
                    parameters=(parameter,),
                    role=MenuGuidanceRole.LOCKED,
                    # A semantic projection identifies the exact value and
                    # logical socket, not a verified pixel/control resolver.
                    native=False,
                    container_operation_id=operation.operation_id,
                    container_target_id=operation.target_id,
                    target_trust=(
                        LeafTargetTrust.GUIDED_CONTROL
                        if recipe.id in _GUIDED_GEOMETRY_PARAMETER_RECIPES
                        else LeafTargetTrust.CONTAINER_CAPABLE
                        if operation.target_kind == "node"
                        else LeafTargetTrust.REFERENCE_ONLY
                    ),
                )
            )
    return materialized


def _bind_operation_level_mcp_parameters(
    recipe: InteractionRecipe,
    operations: list[LeafGuidanceOperation],
    action_arguments: dict[str, Any],
) -> list[LeafGuidanceOperation]:
    """Expose catalog-ordered MCP parameters on the visible leaf operations."""

    materialization = recipe.procedure_materialization
    mcp = materialization.mcp if materialization is not None else None
    definitions = mcp.mcp_operations if mcp is not None else None
    if (
        mcp is None
        or mcp.availability != "available"
        or mcp.source != "catalog.operation_level_mcp"
        or definitions is None
    ):
        return operations
    if len(definitions) != len(operations) or any(
        definition.source_operation_id != operation.operation_id
        for definition, operation in zip(definitions, operations, strict=True)
    ):
        raise ValueError(
            f"Interaction recipe {recipe.id} MCP operations do not match the visible leaf"
        )
    return [
        replace(
            operation,
            parameters=tuple(
                _resolve_parameter(parameter, action_arguments)
                for parameter in definition.parameters
            ),
        )
        for definition, operation in zip(definitions, operations, strict=True)
    ]


class MenuGuidanceTracker:
    """Keep leaf browsing and real menu evidence outside executable plan state."""

    def __init__(
        self,
        catalog: InteractionCatalog = BUNDLED_INTERACTION_CATALOG,
    ) -> None:
        self._catalog = catalog
        self._step_key: tuple[str, str, str, int] | None = None
        self._cursor_generation = 0
        self._cursor_token = ""
        self._revealed_depth = 1
        self._focused_ordinal = 1
        self._retry_serial = 0
        self._revealed_operation_ids: set[str] = set()

    def reset(self) -> None:
        self._step_key = None
        self._cursor_token = ""
        self._revealed_depth = 1
        self._focused_ordinal = 1
        self._retry_serial = 0
        self._revealed_operation_ids.clear()

    @staticmethod
    def _step_identity(
        step: TaskNode,
        recipe: InteractionRecipe | None,
    ) -> tuple[str, str, str, int]:
        arguments = step.action.arguments if step.action is not None else {}
        projection = getattr(step, "candidate_menu_projection", None)
        return (
            step.id,
            projection.id if projection is not None else recipe.id,
            json.dumps(
                arguments,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=True,
            ),
            id(step),
        )

    def _candidate_snapshot(self, step: TaskNode) -> MenuGuidanceSnapshot | None:
        """Materialize Guide-owned candidate instructions without execution authority."""

        projection = getattr(step, "candidate_menu_projection", None)
        if projection is None:
            return None
        step_key = self._step_identity(step, None)
        if self._step_key != step_key:
            self._step_key = step_key
            self._cursor_generation += 1
            cursor_material = json.dumps(
                (*step_key, self._cursor_generation, id(self)),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            self._cursor_token = hashlib.sha256(
                cursor_material.encode("utf-8")
            ).hexdigest()
            self._revealed_depth = 0
            self._focused_ordinal = 1
            self._retry_serial = 0
            self._revealed_operation_ids.clear()

        host_targetable_ids = {
            "VIEW3D_MT_select_edit_mesh",
            "mesh.select_all",
            "VIEW3D_MT_edit_mesh_edges",
            "mesh.subdivide",
        }
        operations = []
        for index, definition in enumerate(projection.operations):
            parameters = tuple(
                LeafGuidanceParameter(
                    name=name,
                    value=deepcopy(value),
                    display_value=_display_value(value),
                    resolved=True,
                )
                for name, value in definition["parameters"].items()
            )
            target = definition["target"]
            host_targetable = target["hostId"] in host_targetable_ids
            operations.append(
                LeafGuidanceOperation(
                    ordinal=index + 1,
                    operation_id=definition["id"],
                    label=definition["description"],
                    intent=definition["intent"],
                    target_kind=target["kind"],
                    target_id=target["hostId"],
                    path=tuple(definition["path"]),
                    parameters=parameters,
                    role=self._focus_role(index, self._focused_ordinal - 1),
                    native=host_targetable,
                    target_trust=(
                        LeafTargetTrust.EXACT_NATIVE
                        if host_targetable
                        else LeafTargetTrust.REFERENCE_ONLY
                    ),
                )
            )
        if not operations:
            self.reset()
            return None
        self._focused_ordinal = min(self._focused_ordinal, len(operations))
        operations = [
            replace(
                operation,
                ordinal=index + 1,
                role=self._focus_role(index, self._focused_ordinal - 1),
            )
            for index, operation in enumerate(operations)
        ]
        return MenuGuidanceSnapshot(
            step_id=step.id,
            recipe_id=projection.id,
            catalog_version=projection.interaction_catalog_version,
            path_kind=InteractionPathKind.SEMANTIC,
            title=projection.title,
            operator_id=None,
            revealed_depth=0,
            reason=projection.reason,
            items=(),
            operations=tuple(operations),
            focused_ordinal=self._focused_ordinal,
            cursor_token=self._cursor_token,
            retry_serial=self._retry_serial,
            can_focus_back=self._focused_ordinal > 1,
            can_focus_next=self._focused_ordinal < len(operations),
            candidate_only=True,
            managed_equivalent=False,
        )

    @staticmethod
    def _focus_role(index: int, focused_index: int) -> MenuGuidanceRole:
        if index == focused_index - 1:
            return MenuGuidanceRole.PREVIOUS
        if index == focused_index:
            return MenuGuidanceRole.CURRENT
        if index == focused_index + 1:
            return MenuGuidanceRole.NEXT
        return MenuGuidanceRole.LOCKED

    def snapshot(self, step: TaskNode | None) -> MenuGuidanceSnapshot | None:
        if step is None:
            self.reset()
            return None
        if getattr(step, "candidate_menu_projection", None) is not None:
            return self._candidate_snapshot(step)
        recipe = _recipe_for_step(step, self._catalog)
        if recipe is None:
            self.reset()
            return None
        step_key = self._step_identity(step, recipe)
        if self._step_key != step_key:
            self._step_key = step_key
            self._cursor_generation += 1
            cursor_material = json.dumps(
                (*step_key, self._cursor_generation, id(self)),
                ensure_ascii=False,
                separators=(",", ":"),
            )
            self._cursor_token = hashlib.sha256(
                cursor_material.encode("utf-8")
            ).hexdigest()
            self._revealed_depth = 1
            self._focused_ordinal = 1
            self._retry_serial = 0
            self._revealed_operation_ids.clear()
        guidance = recipe.guidance
        items: list[MenuGuidanceItem] = []
        operations: list[LeafGuidanceOperation] = []
        current_index = self._revealed_depth - 1
        for index, definition in enumerate(guidance.steps):
            if guidance.kind is InteractionPathKind.SEMANTIC:
                role = MenuGuidanceRole.LOCKED
            elif index < current_index - 1:
                role = MenuGuidanceRole.COMPLETED
            elif index == current_index - 1:
                role = MenuGuidanceRole.PREVIOUS
            elif index == current_index:
                role = MenuGuidanceRole.CURRENT
            elif index == current_index + 1:
                role = MenuGuidanceRole.NEXT
            else:
                role = MenuGuidanceRole.LOCKED
            items.append(
                MenuGuidanceItem(
                    ordinal=definition.order,
                    step_id=definition.id,
                    label=definition.label,
                    intent=definition.intent,
                    target_kind=definition.target_kind,
                    target_id=definition.target_id,
                    role=role,
                )
            )
            operations.append(
                LeafGuidanceOperation(
                    ordinal=index + 1,
                    operation_id=definition.id,
                    label=definition.label,
                    intent=definition.intent,
                    target_kind=definition.target_kind,
                    target_id=definition.target_id,
                    path=tuple(
                        path_step.label for path_step in guidance.steps[: index + 1]
                    ),
                    parameters=(),
                    role=self._focus_role(index, self._focused_ordinal - 1),
                    native=guidance.kind is InteractionPathKind.NATIVE,
                    evidence=(
                        LeafOperationEvidence.REVEALED
                        if definition.id in self._revealed_operation_ids
                        else LeafOperationEvidence.NONE
                    ),
                    connection=definition.connection,
                    target_trust=(
                        LeafTargetTrust.EXACT_NATIVE
                        if guidance.kind is InteractionPathKind.NATIVE
                        else LeafTargetTrust.CONTAINER_CAPABLE
                        if definition.target_kind == "node"
                        else LeafTargetTrust.GUIDED_CONTROL
                        if (
                            recipe.id
                            == "blender.geometry_nodes.create_transform.semantic"
                            and definition.connection is not None
                        )
                        else LeafTargetTrust.REFERENCE_ONLY
                    ),
                )
            )
        materialization = recipe.procedure_materialization
        action_arguments = step.action.arguments if step.action is not None else {}
        operations = _materialize_semantic_parameter_operations(
            recipe,
            operations,
            action_arguments,
        )
        operations = _bind_operation_level_mcp_parameters(
            recipe,
            operations,
            action_arguments,
        )
        menu_channel = materialization.menu if materialization is not None else None
        controls = menu_channel.control_operations if menu_channel is not None else None
        operator_parameters = (
            menu_channel.operator_parameters if menu_channel is not None else None
        )
        if operator_parameters is not None:
            if controls is None:
                raise ValueError(
                    f"Interaction recipe {recipe.id} operator parameters have no "
                    "declared insertion point"
                )
            insertion_indexes = tuple(
                index
                for index, operation in enumerate(operations)
                if operation.operation_id == controls.insert_after_step_id
            )
            if len(insertion_indexes) != 1:
                raise ValueError(
                    f"Interaction recipe {recipe.id} insertion step "
                    f"{controls.insert_after_step_id!r} does not identify exactly one "
                    "guidance operation"
                )
            insertion_index = insertion_indexes[0]
            operations[insertion_index] = replace(
                operations[insertion_index],
                parameters=tuple(
                    _resolve_parameter(parameter, action_arguments)
                    for parameter in operator_parameters
                ),
            )
        if controls is not None:
            for definition in controls.operations:
                operations.append(
                    LeafGuidanceOperation(
                        ordinal=len(operations) + 1,
                        operation_id=definition.id,
                        label=definition.label,
                        intent="adjust",
                        target_kind="control",
                        target_id=definition.target_id,
                        path=definition.path,
                        parameters=tuple(
                            _resolve_parameter(parameter, action_arguments)
                            for parameter in definition.parameters
                        ),
                        role=MenuGuidanceRole.LOCKED,
                        # Materialization declares what to adjust, but no exact
                        # built-in control coordinate resolver exists yet.
                        native=False,
                    )
                )
        operation_count = len(operations)
        if operation_count == 0:
            self.reset()
            return None
        self._focused_ordinal = min(self._focused_ordinal, operation_count)
        operations = [
            replace(
                operation,
                ordinal=index + 1,
                role=self._focus_role(index, self._focused_ordinal - 1),
            )
            for index, operation in enumerate(operations)
        ]
        return MenuGuidanceSnapshot(
            step_id=step.id,
            recipe_id=recipe.id,
            catalog_version=self._catalog.catalog_version,
            path_kind=guidance.kind,
            title=recipe.title,
            operator_id=guidance.operator_id,
            revealed_depth=(
                self._revealed_depth
                if guidance.kind is InteractionPathKind.NATIVE
                else 0
            ),
            reason=guidance.reason,
            items=tuple(items),
            operations=tuple(operations),
            focused_ordinal=self._focused_ordinal,
            cursor_token=self._cursor_token,
            retry_serial=self._retry_serial,
            can_focus_back=self._focused_ordinal > 1,
            can_focus_next=self._focused_ordinal < operation_count,
        )

    def _focus_matches(
        self,
        snapshot: MenuGuidanceSnapshot,
        expected_operation_id: str,
        expected_ordinal: int,
        expected_cursor_token: str,
    ) -> bool:
        return (
            bool(expected_cursor_token)
            and snapshot.cursor_token == expected_cursor_token
            and snapshot.focused_ordinal == expected_ordinal
            and snapshot.focused_operation.operation_id == expected_operation_id
        )

    def focus_back(
        self,
        step: TaskNode,
        expected_operation_id: str,
        expected_ordinal: int,
        expected_cursor_token: str,
    ) -> bool:
        """Move only the instructional focus; never mutate Blender or receipts."""

        snapshot = self.snapshot(step)
        if (
            snapshot is None
            or not self._focus_matches(
                snapshot,
                expected_operation_id,
                expected_ordinal,
                expected_cursor_token,
            )
            or not snapshot.can_focus_back
        ):
            return False
        self._focused_ordinal -= 1
        return True

    def focus_next(
        self,
        step: TaskNode,
        expected_operation_id: str,
        expected_ordinal: int,
        expected_cursor_token: str,
    ) -> bool:
        """Move only the instructional focus; never imply execution evidence."""

        snapshot = self.snapshot(step)
        if (
            snapshot is None
            or not self._focus_matches(
                snapshot,
                expected_operation_id,
                expected_ordinal,
                expected_cursor_token,
            )
            or not snapshot.can_focus_next
        ):
            return False
        self._focused_ordinal += 1
        return True

    def retry_focus(
        self,
        step: TaskNode,
        expected_operation_id: str,
        expected_ordinal: int,
        expected_cursor_token: str,
    ) -> bool:
        """Re-emit the current instruction without executing its action."""

        snapshot = self.snapshot(step)
        if snapshot is None or not self._focus_matches(
            snapshot,
            expected_operation_id,
            expected_ordinal,
            expected_cursor_token,
        ):
            return False
        self._retry_serial += 1
        return True

    def reveal(self, step: TaskNode, label: str) -> bool:
        recipe = _recipe_for_step(step, self._catalog)
        if recipe is None or recipe.guidance.kind is not InteractionPathKind.NATIVE:
            return False
        if self._step_key is None:
            self.snapshot(step)
        if self._step_key != self._step_identity(step, recipe):
            return False
        labels = tuple(item.label for item in recipe.guidance.steps)
        matching_indexes = tuple(
            index for index, candidate in enumerate(labels) if candidate == label
        )
        if len(matching_indexes) != 1:
            return False
        label_index = matching_indexes[0]
        if label_index <= 0 or label_index >= len(labels) - 1:
            return False
        self._revealed_depth = max(self._revealed_depth, label_index + 1)
        self._focused_ordinal = max(self._focused_ordinal, label_index + 1)
        self._revealed_operation_ids.update(
            definition.id for definition in recipe.guidance.steps[: label_index + 1]
        )
        return True


__all__ = (
    "LeafGuidanceOperation",
    "LeafGuidanceParameter",
    "LeafOperationEvidence",
    "LeafTargetTrust",
    "MenuGuidanceItem",
    "MenuGuidanceRole",
    "MenuGuidanceSnapshot",
    "MenuGuidanceTracker",
)
