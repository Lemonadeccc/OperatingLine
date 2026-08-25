"""Owned material creation and compare-and-restore assignment."""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import bpy

from ...application import ActionReceipt
from ...application.session import MutationRecord, ResourceIdentity
from ...domain import ActionSpec
from .common import (
    build_resource_registry,
    ensure_logical_ids_available,
    ensure_name_available,
    ensure_receipts_intact,
    journal_created_resource,
    logical_id,
    make_receipt,
    mesh_content_signature,
    new_receipt_id,
    number,
    owned_resource,
    reference_data_block,
    require_keys,
    require_object,
    resolve_resource,
    rollback_partial,
    snapshot_material_surface,
    text,
    vector,
)
from .node_access import require_unique_input, require_unique_node


@dataclass(frozen=True, slots=True)
class MaterialDefinition:
    logical_id: str
    name: str
    targets: tuple[str, ...]
    base_color: tuple[float, float, float, float]
    roughness: float
    metallic: float


def _definition(raw: Mapping[str, Any], label: str) -> MaterialDefinition:
    allowed = {"materialId", "materialName", "targets", "baseColor", "roughness", "metallic"}
    require_keys(raw, allowed, allowed, label)
    targets = raw["targets"]
    if (
        not isinstance(targets, list)
        or not 1 <= len(targets) <= 64
        or not all(isinstance(item, str) and item for item in targets)
    ):
        raise ValueError(f"{label}.targets must contain 1 to 64 resource IDs")
    if len(set(targets)) != len(targets):
        raise ValueError(f"{label}.targets must be unique")
    target_ids = tuple(
        logical_id(item, f"{label}.targets[{index}]")
        for index, item in enumerate(targets)
    )
    base_color = vector(raw["baseColor"], f"{label}.baseColor", 4, minimum=0.0)
    if any(channel > 1.0 for channel in base_color):
        raise ValueError(f"{label}.baseColor channels must be in [0, 1]")
    roughness = number(raw["roughness"], f"{label}.roughness", minimum=0.0)
    metallic = number(raw["metallic"], f"{label}.metallic", minimum=0.0)
    if roughness > 1.0 or metallic > 1.0:
        raise ValueError(f"{label} roughness and metallic must be in [0, 1]")
    return MaterialDefinition(
        logical_id=logical_id(raw["materialId"], f"{label}.materialId"),
        name=text(raw["materialName"], f"{label}.materialName", prefix="OperatingLine."),
        targets=target_ids,
        base_color=base_color,
        roughness=roughness,
        metallic=metallic,
    )


def validate_single(arguments: Mapping[str, Any]) -> tuple[MaterialDefinition, ...]:
    definitions = (validate_single_definition(arguments),)
    return definitions


def validate_single_definition(arguments: Mapping[str, Any]) -> MaterialDefinition:
    definition = _definition(arguments, "arguments")
    definitions = (definition,)
    _validate_logical_ids(definitions)
    return definition


def validate_palette(arguments: Mapping[str, Any]) -> tuple[MaterialDefinition, ...]:
    require_keys(arguments, {"materials"}, {"materials"}, "arguments")
    raw_materials = arguments["materials"]
    if not isinstance(raw_materials, list) or not 1 <= len(raw_materials) <= 8:
        raise ValueError("arguments.materials must contain 1 to 8 definitions")
    definitions = tuple(
        _definition(
            require_object(raw, f"arguments.materials[{index}]"),
            f"arguments.materials[{index}]",
        )
        for index, raw in enumerate(raw_materials)
    )
    ids = [item.logical_id for item in definitions]
    names = [item.name for item in definitions]
    targets = [target for item in definitions for target in item.targets]
    if len(set(ids)) != len(ids) or len(set(names)) != len(names):
        raise ValueError("Palette materialId and materialName values must be unique")
    if len(set(targets)) != len(targets):
        raise ValueError("A palette target may only be assigned once")
    _validate_logical_ids(definitions)
    return definitions


def _validate_logical_ids(definitions: tuple[MaterialDefinition, ...]) -> None:
    material_ids = tuple(item.logical_id for item in definitions)
    target_ids = {target for item in definitions for target in item.targets}
    ensure_logical_ids_available({}, material_ids)
    overlap = target_ids.intersection(material_ids)
    if overlap:
        raise ValueError(
            f"Material logical ID cannot also be an assignment target: {min(overlap)}"
        )


ValidatedTarget = tuple[
    ResourceIdentity,
    bpy.types.Object,
    ResourceIdentity,
    bpy.types.Mesh,
]

ValidatedMaterial = tuple[MaterialDefinition, list[ValidatedTarget]]


def _configure_material_nodes(
    material: bpy.types.Material,
    definition: MaterialDefinition,
) -> None:
    material.use_nodes = True
    principled = require_unique_node(
        material.node_tree,
        "ShaderNodeBsdfPrincipled",
        f"Material {material.name!r}",
    )
    require_unique_node(
        material.node_tree,
        "ShaderNodeOutputMaterial",
        f"Material {material.name!r}",
    )
    require_unique_input(
        principled,
        "Base Color",
        "ShaderNodeBsdfPrincipled",
    ).default_value = definition.base_color
    require_unique_input(
        principled,
        "Roughness",
        "ShaderNodeBsdfPrincipled",
    ).default_value = definition.roughness
    require_unique_input(
        principled,
        "Metallic",
        "ShaderNodeBsdfPrincipled",
    ).default_value = definition.metallic


def _validate(
    definitions: tuple[MaterialDefinition, ...],
    registry: Mapping[str, ResourceIdentity],
) -> list[ValidatedMaterial]:
    validated: list[ValidatedMaterial] = []
    ensure_logical_ids_available(
        registry,
        (definition.logical_id for definition in definitions),
    )
    for definition in definitions:
        ensure_name_available(bpy.data.materials, definition.name, "material")
        targets: list[ValidatedTarget] = []
        for target_id in definition.targets:
            identity, obj = owned_resource(registry, target_id, "OBJECT")
            if not isinstance(obj, bpy.types.Object) or obj.type != "MESH":
                raise ValueError(f"Material target is not an owned mesh object: {target_id}")
            mesh = obj.data
            mesh_identities = tuple(
                candidate
                for candidate in registry.values()
                if candidate.resource_type == "MESH"
                and resolve_resource(candidate) is mesh
            )
            if len(mesh_identities) != 1:
                raise RuntimeError(
                    "Material target must bind exactly one owned mesh data-block: "
                    f"{target_id}"
                )
            targets.append((identity, obj, mesh_identities[0], mesh))
        validated.append((definition, targets))
    return validated


def execute_materials(
    step_id: str,
    action: ActionSpec,
    receipts: Mapping[str, ActionReceipt],
    definitions: tuple[MaterialDefinition, ...],
) -> ActionReceipt:
    ensure_receipts_intact(receipts)
    registry = build_resource_registry(receipts)
    validated = _validate(definitions, registry)
    receipt_id = new_receipt_id()
    created: list[ResourceIdentity] = []
    mutations: list[MutationRecord] = []
    anchor: ResourceIdentity | None = None
    try:
        for definition, targets in validated:
            material = bpy.data.materials.new(definition.name)
            identity = journal_created_resource(
                created,
                material,
                definition.logical_id,
                receipt_id,
                step_id,
                action.name,
            )
            material.diffuse_color = definition.base_color
            material.roughness = definition.roughness
            material.metallic = definition.metallic
            _configure_material_nodes(material, definition)
            mutations.append(
                MutationRecord(
                    identity,
                    "material_surface",
                    None,
                    snapshot_material_surface(material),
                )
            )
            for object_identity, obj, mesh_identity, mesh in targets:
                before = tuple(
                    reference_data_block(slot.material)
                    if slot.material is not None
                    else None
                    for slot in obj.material_slots
                )
                source_content = mesh_content_signature(mesh)
                obj.data.materials.clear()
                obj.data.materials.append(material)
                mutations.extend(
                    (
                        MutationRecord(
                            object_identity,
                            "data",
                            mesh_identity,
                            mesh_identity,
                        ),
                        MutationRecord(
                            mesh_identity,
                            "mesh_content",
                            source_content,
                            source_content,
                        ),
                        MutationRecord(
                            object_identity,
                            "material_slots",
                            before,
                            (identity,),
                        ),
                    )
                )
                anchor = anchor or object_identity
        return make_receipt(receipt_id, step_id, action.name, created, mutations, [], anchor)
    except Exception:
        rollback_partial(receipt_id, step_id, action.name, created, mutations, [])
        raise
