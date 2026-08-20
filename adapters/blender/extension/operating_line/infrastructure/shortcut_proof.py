"""Bounded native-shortcut proof for Blender's Subdivision Surface F9 flow.

The executor deliberately owns its entire event and coordinate policy.  A
caller may select only the catalog-supported viewport level and receive the
terminal proof; it cannot supply Blender events, UI coordinates, operators, or
post-hoc RNA corrections.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import struct
from typing import Any
import uuid

import bpy


EXECUTOR_ID = "blender.subdivision_surface_f9.event_simulate.v1"
TARGET_PROFILE = "factory_cube_8_12_6"
OPERATION_IDS = (
    "shortcut.add_subdivision_surface_level_one",
    "shortcut.open_adjust_last_operation",
    "shortcut.set_viewport_level",
    "shortcut.close_adjust_last_operation",
)
OPERATION_EVENT_COUNTS = (2, 2, 9, 2)
EXPECTED_TOPOLOGY = {
    1: {"vertices": 26, "edges": 48, "polygons": 24},
    2: {"vertices": 98, "edges": 192, "polygons": 96},
    3: {"vertices": 386, "edges": 768, "polygons": 384},
}
EXPECTED_MODIFIER_FLAGS = {
    "subdivision_type": "CATMULL_CLARK",
    "quality": 3,
    "show_viewport": True,
    "show_render": True,
    "show_in_editmode": True,
    "show_on_cage": False,
    "show_only_control_edges": True,
    "use_limit_surface": True,
    "use_creases": True,
    "use_custom_normals": False,
    "boundary_smooth": "ALL",
    "uv_smooth": "PRESERVE_BOUNDARIES",
}
_GENESIS_RECEIPT_SHA256 = None
_FACTORY_CUBE_VERTICES = tuple(
    [x, y, z]
    for x in (-1.0, 1.0)
    for y in (-1.0, 1.0)
    for z in (-1.0, 1.0)
)
_FACTORY_CUBE_EDGES = tuple(
    sorted(
        (
            left,
            right,
        )
        for left_index, left in enumerate(_FACTORY_CUBE_VERTICES)
        for right in _FACTORY_CUBE_VERTICES[left_index + 1 :]
        if sum(a != b for a, b in zip(left, right)) == 1
    )
)


def _vector_snapshot(value: Sequence[float]) -> list[float]:
    return [float(component) for component in value]


def _canonical_face(vertex_coordinates: Sequence[Sequence[float]]) -> list[list[float]]:
    """Normalize a directed polygon ring independently of mesh indices."""

    ring = tuple(tuple(_vector_snapshot(point)) for point in vertex_coordinates)
    rotations = tuple(ring[index:] + ring[:index] for index in range(len(ring)))
    return [list(point) for point in min(rotations)]


_FACTORY_CUBE_FACES = tuple(
    sorted(
        tuple(tuple(point) for point in face)
        for face in (
            _canonical_face(((1, 1, 1), (-1, 1, 1), (-1, -1, 1), (1, -1, 1))),
            _canonical_face(((1, -1, -1), (1, -1, 1), (-1, -1, 1), (-1, -1, -1))),
            _canonical_face(((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1))),
            _canonical_face(((-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1))),
            _canonical_face(((1, 1, -1), (1, 1, 1), (1, -1, 1), (1, -1, -1))),
            _canonical_face(((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1))),
        )
    )
)
_FACTORY_CUBE_UV_MAP = (
    (0.625, 0.5),
    (0.875, 0.5),
    (0.875, 0.75),
    (0.625, 0.75),
    (0.375, 0.75),
    (0.625, 0.75),
    (0.625, 1.0),
    (0.375, 1.0),
    (0.375, 0.0),
    (0.625, 0.0),
    (0.625, 0.25),
    (0.375, 0.25),
    (0.125, 0.5),
    (0.375, 0.5),
    (0.375, 0.75),
    (0.125, 0.75),
    (0.375, 0.5),
    (0.625, 0.5),
    (0.625, 0.75),
    (0.375, 0.75),
    (0.375, 0.25),
    (0.625, 0.25),
    (0.625, 0.5),
    (0.375, 0.5),
)
_NON_SUBDIVISION_ATTRIBUTE_NAMES = frozenset(
    {
        "position",
        ".edge_verts",
        ".corner_vert",
        ".corner_edge",
        ".select_vert",
        ".select_edge",
        ".select_poly",
        ".uv_select_face",
        ".uv_select_vert",
        ".uv_select_edge",
    }
)


def _attribute_element_value(element: Any) -> object:
    for property_name in ("value", "vector", "color"):
        if hasattr(element, property_name):
            value = getattr(element, property_name)
            if isinstance(value, (bool, int, float, str)):
                return value
            return [float(component) for component in value]
    raise RuntimeError("Shortcut proof cannot serialize a Mesh attribute value")


def _subdivision_attribute_snapshot(mesh: Any) -> list[dict[str, object]]:
    return sorted(
        (
            {
                "name": attribute.name,
                "domain": attribute.domain,
                "dataType": attribute.data_type,
                "data": [
                    _attribute_element_value(element) for element in attribute.data
                ],
            }
            for attribute in mesh.attributes
            if attribute.name not in _NON_SUBDIVISION_ATTRIBUTE_NAMES
        ),
        key=lambda attribute: str(attribute["name"]),
    )


def build_factory_cube_canonical_snapshot(active: Any) -> dict[str, object]:
    """Build the pointer-free identity and base-mesh proof for the factory Cube."""

    mesh = active.data
    vertices = sorted(_vector_snapshot(vertex.co) for vertex in mesh.vertices)
    edges = sorted(
        sorted(
            (
                _vector_snapshot(mesh.vertices[index].co)
                for index in edge.vertices
            )
        )
        for edge in mesh.edges
    )
    faces = sorted(
        _canonical_face(tuple(mesh.vertices[index].co for index in polygon.vertices))
        for polygon in mesh.polygons
    )
    shape_keys = mesh.shape_keys
    return {
        "transform": {
            "location": _vector_snapshot(active.location),
            "rotationMode": active.rotation_mode,
            "rotationEuler": _vector_snapshot(active.rotation_euler),
            "rotationQuaternion": _vector_snapshot(active.rotation_quaternion),
            "rotationAxisAngle": _vector_snapshot(active.rotation_axis_angle),
            "scale": _vector_snapshot(active.scale),
            "deltaLocation": _vector_snapshot(active.delta_location),
            "deltaRotationEuler": _vector_snapshot(active.delta_rotation_euler),
            "deltaRotationQuaternion": _vector_snapshot(active.delta_rotation_quaternion),
            "deltaScale": _vector_snapshot(active.delta_scale),
            "parentName": None if active.parent is None else active.parent.name,
            "parentType": active.parent_type,
            "parentVertices": [int(index) for index in active.parent_vertices],
            "constraints": [
                {"name": constraint.name, "type": constraint.type}
                for constraint in active.constraints
            ],
        },
        "geometry": {
            "vertices": vertices,
            "edgeEndpoints": edges,
            "quadFaces": faces,
            "shapeKeys": (
                None
                if shape_keys is None
                else {
                    "name": shape_keys.name,
                    "keyBlockNames": [key.name for key in shape_keys.key_blocks],
                }
            ),
            "hasCustomNormals": bool(mesh.has_custom_normals),
            "subdivisionAttributes": _subdivision_attribute_snapshot(mesh),
        },
    }


def validate_factory_cube_canonical_snapshot(snapshot: Mapping[str, object]) -> None:
    """Reject lookalike 8/12/6 meshes or transformed factory-Cube impostors."""

    expected_transform = {
        "location": [0.0, 0.0, 0.0],
        "rotationMode": "XYZ",
        "rotationEuler": [0.0, 0.0, 0.0],
        "rotationQuaternion": [1.0, 0.0, 0.0, 0.0],
        "rotationAxisAngle": [0.0, 0.0, 1.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
        "deltaLocation": [0.0, 0.0, 0.0],
        "deltaRotationEuler": [0.0, 0.0, 0.0],
        "deltaRotationQuaternion": [1.0, 0.0, 0.0, 0.0],
        "deltaScale": [1.0, 1.0, 1.0],
        "parentName": None,
        "parentType": "OBJECT",
        "parentVertices": [0, 0, 0],
        "constraints": [],
    }
    if snapshot.get("transform") != expected_transform:
        raise RuntimeError(
            "Shortcut proof preflight requires the factory Cube identity transform"
        )
    geometry = snapshot.get("geometry")
    if not isinstance(geometry, Mapping):
        raise RuntimeError("Shortcut proof preflight requires canonical factory Cube geometry")
    if geometry.get("vertices") != [list(point) for point in _FACTORY_CUBE_VERTICES]:
        raise RuntimeError("Shortcut proof preflight requires canonical factory Cube vertices")
    if geometry.get("edgeEndpoints") != [
        [list(left), list(right)] for left, right in _FACTORY_CUBE_EDGES
    ]:
        raise RuntimeError("Shortcut proof preflight requires canonical factory Cube edges")
    if geometry.get("quadFaces") != [
        [list(point) for point in face] for face in _FACTORY_CUBE_FACES
    ]:
        raise RuntimeError("Shortcut proof preflight requires canonical factory Cube faces")
    if geometry.get("shapeKeys") is not None:
        raise RuntimeError("Shortcut proof preflight rejects factory Cube shape keys")
    if geometry.get("hasCustomNormals") is not False:
        raise RuntimeError("Shortcut proof preflight rejects factory Cube custom normals")
    expected_attributes = [
        {
            "name": "UVMap",
            "domain": "CORNER",
            "dataType": "FLOAT2",
            "data": [list(uv) for uv in _FACTORY_CUBE_UV_MAP],
        },
        {
            "name": "sharp_face",
            "domain": "FACE",
            "dataType": "BOOLEAN",
            "data": [True] * 6,
        },
    ]
    if geometry.get("subdivisionAttributes") != expected_attributes:
        raise RuntimeError(
            "Shortcut proof preflight requires default factory Cube subdivision attributes"
        )


def execution_evidence_claims() -> dict[str, object]:
    """Return the executor's fixed, intentionally narrow provenance claims."""

    return {
        "evidenceClass": "blender_event_simulation",
        "osHidInput": False,
        "managedActionResult": "not_executed",
        "managedIdentityVerified": False,
    }


def compute_shortcut_scene_fingerprint_sha256(
    snapshot: Mapping[str, object],
) -> str:
    """Hash one pointer-free target Scene snapshot using canonical JSON."""

    return _canonical_sha256(snapshot)


def build_subdivision_surface_scene_fingerprint_snapshot() -> dict[str, object]:
    """Read the stable target state used by native Undo/Redo matching."""

    context = bpy.context
    active = context.view_layer.objects.active
    if active is None or active.type != "MESH" or active.data is None:
        raise RuntimeError("Shortcut fingerprint requires an active Mesh object")
    base_topology = {
        "vertices": len(active.data.vertices),
        "edges": len(active.data.edges),
        "polygons": len(active.data.polygons),
    }
    depsgraph = context.evaluated_depsgraph_get()
    evaluated_object = active.evaluated_get(depsgraph)
    evaluated_mesh = evaluated_object.to_mesh()
    try:
        evaluated_topology = {
            "vertices": len(evaluated_mesh.vertices),
            "edges": len(evaluated_mesh.edges),
            "polygons": len(evaluated_mesh.polygons),
        }
    finally:
        evaluated_object.to_mesh_clear()
    modifiers = []
    for modifier in active.modifiers:
        modifier_snapshot: dict[str, object] = {
            "name": modifier.name,
            "type": modifier.type,
        }
        if modifier.type == "SUBSURF":
            modifier_snapshot.update(
                {
                    "levels": modifier.levels,
                    "renderLevels": modifier.render_levels,
                    "flags": {
                        name: getattr(modifier, name)
                        for name in EXPECTED_MODIFIER_FLAGS
                    },
                }
            )
        modifiers.append(modifier_snapshot)
    factory_cube = build_factory_cube_canonical_snapshot(active)
    return {
        "formatVersion": "1.0.0",
        "target": {
            "objectName": active.name,
            "objectType": active.type,
            "meshName": active.data.name,
        },
        "context": {
            "mode": context.mode,
            "activeObjectName": active.name,
            "selectedObjectNames": sorted(obj.name for obj in context.selected_objects),
        },
        "mesh": {
            "baseTopology": base_topology,
            "evaluatedTopology": evaluated_topology,
            **factory_cube["geometry"],
        },
        "transform": factory_cube["transform"],
        "modifiers": modifiers,
    }


def _length_delimited(value: bytes) -> bytes:
    return str(len(value)).encode("ascii") + b":" + value


def _canonical_protocol_bytes(value: object, ancestors: set[int]) -> bytes:
    """Encode JSON exactly as operatingline-json-value-v1."""

    if value is None:
        return b"n"
    if value is False:
        return b"f"
    if value is True:
        return b"t"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("Canonical protocol numbers must be finite")
        return b"d" + struct.pack(">d", 0.0 if number == 0 else number).hex().encode(
            "ascii"
        )
    if isinstance(value, str):
        encoded = value.encode("utf-8", errors="strict")
        return b"s" + str(len(encoded)).encode("ascii") + b":" + encoded
    if not isinstance(value, (list, dict)):
        raise ValueError("Value is not a canonical protocol JSON value")
    identity = id(value)
    if identity in ancestors:
        raise ValueError("Canonical protocol JSON values must not contain cycles")
    ancestors.add(identity)
    try:
        if isinstance(value, list):
            items = b"".join(
                _length_delimited(_canonical_protocol_bytes(item, ancestors))
                for item in value
            )
            return b"a" + str(len(value)).encode("ascii") + b":" + items
        entries: list[tuple[bytes, object]] = []
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("Canonical protocol object keys must be strings")
            entries.append((key.encode("utf-8", errors="strict"), item))
        entries.sort(key=lambda entry: entry[0])
        parts = [b"o" + str(len(entries)).encode("ascii") + b":"]
        for key_bytes, item in entries:
            encoded_key = (
                b"s" + str(len(key_bytes)).encode("ascii") + b":" + key_bytes
            )
            parts.append(_length_delimited(encoded_key))
            parts.append(
                _length_delimited(_canonical_protocol_bytes(item, ancestors))
            )
        return b"".join(parts)
    finally:
        ancestors.remove(identity)


def _canonical_sha256(value: Mapping[str, object]) -> str:
    return hashlib.sha256(_canonical_protocol_bytes(dict(value), set())).hexdigest()


def _event_evidence_matches(
    operation_index: int,
    events: Sequence[Mapping[str, object]],
    new_value: object,
) -> bool:
    if len(events) != OPERATION_EVENT_COUNTS[operation_index]:
        return False
    digit_type = {1: "ONE", 2: "TWO", 3: "THREE"}.get(new_value)
    expected = {
        0: (("ONE", "PRESS", True, None), ("ONE", "RELEASE", True, None)),
        1: (("F9", "PRESS", False, None), ("F9", "RELEASE", False, None)),
        2: (
            ("MOUSEMOVE", "NOTHING", False, None),
            ("LEFTMOUSE", "PRESS", False, None),
            ("LEFTMOUSE", "RELEASE", False, None),
            ("LEFTMOUSE", "PRESS", False, None),
            ("LEFTMOUSE", "RELEASE", False, None),
            ("A", "PRESS", True, None),
            (digit_type, "PRESS", False, str(new_value)),
            ("RET", "PRESS", False, None),
            ("RET", "RELEASE", False, None),
        ),
        3: (("RET", "PRESS", False, None), ("RET", "RELEASE", False, None)),
    }[operation_index]
    if digit_type is None and operation_index == 2:
        return False
    for event_index, (event, signature) in enumerate(zip(events, expected)):
        event_type, value, ctrl, unicode_value = signature
        expected_keys = {"type", "value", "ctrl", "shift", "point"}
        if unicode_value is not None:
            expected_keys.add("unicode")
        point = event.get("point")
        expected_role = (
            "level_control" if operation_index == 2 and event_index < 5 else "viewport_center"
        )
        if (
            set(event) != expected_keys
            or event.get("type") != event_type
            or event.get("value") != value
            or event.get("ctrl") is not ctrl
            or event.get("shift") is not False
            or event.get("unicode") != unicode_value
            or not isinstance(point, Mapping)
            or set(point) != {"x", "y", "role"}
            or not isinstance(point.get("x"), int)
            or isinstance(point.get("x"), bool)
            or not isinstance(point.get("y"), int)
            or isinstance(point.get("y"), bool)
            or point.get("role") != expected_role
        ):
            return False
    return True


def build_operation_receipt(
    *,
    proof_id: str,
    request_id: str,
    delivery_id: str,
    binding_content_sha256: str,
    operation_index: int,
    operation_id: str,
    event_evidence: Sequence[Mapping[str, object]],
    observation: Mapping[str, object],
    previous_receipt_sha256: str | None,
    context: Mapping[str, object],
    operator_stack_before_sha256: str,
    operator_stack_after_sha256: str,
) -> dict[str, object]:
    """Build one immutable-style receipt in the fixed four-operation chain."""

    if operation_index not in range(len(OPERATION_IDS)):
        raise ValueError("Shortcut proof operation index is invalid")
    identity = {
        "proofId": proof_id,
        "requestId": request_id,
        "deliveryId": delivery_id,
        "bindingContentSha256": binding_content_sha256,
    }
    for field in ("proofId", "requestId", "deliveryId"):
        try:
            identity[field] = str(uuid.UUID(identity[field]))
        except (AttributeError, TypeError, ValueError) as error:
            raise ValueError(f"Shortcut proof receipt {field} must be a UUID") from error
    if (
        not isinstance(binding_content_sha256, str)
        or len(binding_content_sha256) != 64
        or any(
            character not in "0123456789abcdef"
            for character in binding_content_sha256
        )
    ):
        raise ValueError(
            "Shortcut proof receipt bindingContentSha256 must be a lowercase SHA-256"
        )
    if operation_id != OPERATION_IDS[operation_index]:
        raise ValueError("Shortcut proof operation does not match the fixed policy")
    if len(event_evidence) != OPERATION_EVENT_COUNTS[operation_index]:
        raise ValueError("Shortcut proof event count does not match the fixed policy")
    new_value = observation.get("viewportLevel") if operation_index == 2 else None
    if not _event_evidence_matches(operation_index, event_evidence, new_value):
        raise ValueError("Shortcut proof event evidence does not match the fixed policy")
    if operation_index == 0:
        if previous_receipt_sha256 is not _GENESIS_RECEIPT_SHA256:
            raise ValueError("First shortcut proof receipt must use the genesis link")
    elif (
        not isinstance(previous_receipt_sha256, str)
        or len(previous_receipt_sha256) != 64
    ):
        raise ValueError("Shortcut proof receipt is missing its prior hash link")
    common: dict[str, object] = {
        **identity,
        "receiptId": str(uuid.uuid4()),
        "order": operation_index + 1,
        "previousReceiptContentSha256": previous_receipt_sha256,
        "outcome": "succeeded",
        "occurredAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "operationId": operation_id,
        "eventEvidence": json.loads(
            json.dumps(event_evidence, ensure_ascii=True, allow_nan=False)
        ),
    }
    if operation_index in {0, 1, 3}:
        body = {
            **common,
            "kind": "key_input",
            "context": dict(context),
            "operatorStackBeforeSha256": operator_stack_before_sha256,
            "operatorStackAfterSha256": operator_stack_after_sha256,
        }
        if operation_index == 1:
            body.update(
                {
                    "sourceOperationId": OPERATION_IDS[0],
                    "sourceOperatorId": "object.subdivision_set",
                }
            )
        elif operation_index == 3:
            body["surfaceOperationId"] = OPERATION_IDS[1]
    else:
        if new_value not in EXPECTED_TOPOLOGY:
            raise ValueError("Shortcut proof property receipt has an invalid new value")
        body = {
            **common,
            "kind": "operator_property_update",
            "surfaceOperationId": OPERATION_IDS[1],
            "surfaceOperatorId": "object.subdivision_set",
            "controlId": "object.subdivision_set.level",
            "oldValue": 1,
            "newValue": new_value,
        }
    return {**body, "contentSha256": _canonical_sha256(body)}


def verify_operation_receipt_chain(receipts: Sequence[Mapping[str, object]]) -> bool:
    """Fail closed unless every receipt and hash link matches the fixed policy."""

    if len(receipts) > len(OPERATION_IDS):
        return False
    previous: str | None = _GENESIS_RECEIPT_SHA256
    chain_identity: tuple[object, object, object, object] | None = None
    for index, receipt in enumerate(receipts):
        body = dict(receipt)
        claimed_hash = body.pop("contentSha256", None)
        receipt_identity = tuple(
            body.get(field)
            for field in (
                "proofId",
                "requestId",
                "deliveryId",
                "bindingContentSha256",
            )
        )
        if chain_identity is None:
            chain_identity = receipt_identity
        identity_valid = True
        try:
            for value in receipt_identity[:3]:
                if str(uuid.UUID(str(value))) != value:
                    identity_valid = False
        except (AttributeError, TypeError, ValueError):
            identity_valid = False
        binding_sha256 = receipt_identity[3]
        if (
            receipt_identity != chain_identity
            or not identity_valid
            or not isinstance(binding_sha256, str)
            or len(binding_sha256) != 64
            or any(
                character not in "0123456789abcdef"
                for character in binding_sha256
            )
            or body.get("order") != index + 1
            or body.get("operationId") != OPERATION_IDS[index]
            or not isinstance(body.get("eventEvidence"), list)
            or len(body["eventEvidence"]) != OPERATION_EVENT_COUNTS[index]
            or not _event_evidence_matches(
                index,
                body["eventEvidence"],
                body.get("newValue") if index == 2 else None,
            )
            or body.get("previousReceiptContentSha256") != previous
            or body.get("outcome") != "succeeded"
            or not isinstance(claimed_hash, str)
            or _canonical_sha256(body) != claimed_hash
        ):
            return False
        previous = claimed_hash
    return True


@dataclass(frozen=True)
class _Preflight:
    object_pointer: int
    mesh_pointer: int
    mesh_datablock_count: int
    object_name: str
    mode: str


@dataclass(frozen=True)
class _Step:
    label: str
    delay: float
    action: Callable[[], None]


class SubdivisionSurfaceF9ShortcutProof:
    """Execute the one audited Subdivision Surface shortcut recipe."""

    executor_id = EXECUTOR_ID
    operation_ids = OPERATION_IDS

    def __init__(
        self,
        target_level: int,
        *,
        proof_id: str,
        request_id: str,
        delivery_id: str,
        binding_content_sha256: str,
    ) -> None:
        if (
            not isinstance(target_level, int)
            or isinstance(target_level, bool)
            or target_level not in EXPECTED_TOPOLOGY
        ):
            raise ValueError("Subdivision Surface shortcut target level must be 1, 2, or 3")
        self.target_level = target_level
        self._receipt_identity = {
            "proof_id": str(uuid.UUID(proof_id)),
            "request_id": str(uuid.UUID(request_id)),
            "delivery_id": str(uuid.UUID(delivery_id)),
            "binding_content_sha256": binding_content_sha256,
        }
        if (
            not isinstance(binding_content_sha256, str)
            or len(binding_content_sha256) != 64
            or any(
                character not in "0123456789abcdef"
                for character in binding_content_sha256
            )
        ):
            raise ValueError("Shortcut proof binding identity hash is invalid")
        self._steps: list[_Step] = []
        self._receipts: list[dict[str, object]] = []
        self._operation_event_evidence: dict[int, list[dict[str, object]]] = {
            index: [] for index in range(len(OPERATION_IDS))
        }
        self._operator_stack_before: dict[int, str] = {}
        self._context_anchor_event_evidence: dict[str, object] | None = None
        self._native_history_event_evidence: dict[str, list[dict[str, object]]] = {
            "undo": [],
            "redo": [],
        }
        self._preflight: _Preflight | None = None
        self._baseline_scene_snapshot: dict[str, object] | None = None
        self._baseline_scene_fingerprint_sha256: str | None = None
        self._final_scene_snapshot: dict[str, object] | None = None
        self._final_scene_fingerprint_sha256: str | None = None
        self._window: Any = None
        self._area: Any = None
        self._region: Any = None
        self._space: Any = None
        self._center = (0, 0)
        self._level_point = (0, 0)
        self._ui_scale = 0.0
        self._source_observation: dict[str, object] | None = None
        self._final_observation: dict[str, object] | None = None
        self._undo_observation: dict[str, object] | None = None
        self._redo_observation: dict[str, object] | None = None
        self._on_complete: Callable[[dict[str, object]], None] | None = None
        self._on_failure: Callable[[dict[str, object]], None] | None = None
        self._continuation_guard: Callable[[], bool] | None = None
        self._current_label = "preflight"
        self._preflight_hook_verified = False
        self._mutation_started = False
        self._timer_callback = self._advance
        self._timer_registered = False
        self._terminal = False

    def start(
        self,
        *,
        preflight_hook: Callable[[], bool],
        on_complete: Callable[[dict[str, object]], None],
        on_failure: Callable[[dict[str, object]], None],
    ) -> None:
        """Run strict preflight, then schedule every input on its own timer turn."""

        if self._on_complete is not None or self._steps:
            raise RuntimeError("Shortcut proof driver instances are single-use")
        if (
            not callable(preflight_hook)
            or not callable(on_complete)
            or not callable(on_failure)
        ):
            raise TypeError("Shortcut proof callbacks must be callable")
        self._on_complete = on_complete
        self._on_failure = on_failure
        self._continuation_guard = preflight_hook
        try:
            if preflight_hook() is not True:
                raise RuntimeError("Shortcut proof authorization hook rejected execution")
            self._preflight_hook_verified = True
            self._run_blender_preflight()
            self._build_fixed_steps()
        except Exception as error:
            self._fail(error)
            return
        bpy.app.timers.register(self._timer_callback, first_interval=1.0)
        self._timer_registered = True

    def cancel(self, reason: str = "Shortcut proof driver cancelled") -> bool:
        """Stop future native input and report one conservative terminal failure.

        Cancellation is intentionally idempotent.  Once the first mutation event
        may have reached Blender, the ordinary failure path retains or attempts to
        arm the native-Undo recovery checkpoint instead of silently unlocking.
        """

        if self._terminal:
            return False
        self._unregister_timer()
        self._steps.clear()
        self._fail(RuntimeError(reason))
        return True

    @property
    def mutation_started(self) -> bool:
        return self._mutation_started

    def abandon(self) -> bool:
        """Hard-stop input after the owning Blender document was replaced.

        The current ``bpy.context.scene`` now belongs to a different document,
        so it must never be inspected or used to checkpoint the old mutation.
        The old Runtime lease is responsible for entering recovery-required.
        """

        if self._terminal:
            return False
        self._terminal = True
        self._steps.clear()
        self._unregister_timer()
        return True

    abort = abandon

    def _unregister_timer(self) -> None:
        if not self._timer_registered:
            return
        timers = bpy.app.timers
        try:
            is_registered = getattr(timers, "is_registered", None)
            if not callable(is_registered) or is_registered(self._timer_callback):
                timers.unregister(self._timer_callback)
        except (ReferenceError, RuntimeError, ValueError):
            # Returning None from an in-flight callback is the second stop gate.
            pass
        finally:
            self._timer_registered = False

    def _run_blender_preflight(self) -> None:
        context = bpy.context
        supported_versions = {(4, 5, 3), (5, 1, 1)}
        if tuple(bpy.app.version) not in supported_versions:
            raise RuntimeError(
                "Shortcut proof preflight supports only Blender 4.5.3 or 5.1.1"
            )
        if bool(context.preferences.view.show_splash):
            raise RuntimeError("Shortcut proof preflight requires Blender splash disabled")
        window = context.window
        if window is None:
            raise RuntimeError("Shortcut proof preflight requires an active Blender window")
        areas = tuple(area for area in window.screen.areas if area.type == "VIEW_3D")
        if len(areas) != 1:
            raise RuntimeError("Shortcut proof preflight requires exactly one VIEW_3D area")
        area = areas[0]
        if context.workspace is None or context.workspace.name != "Layout":
            raise RuntimeError("Shortcut proof preflight requires the Layout workspace")
        regions = tuple(region for region in area.regions if region.type == "WINDOW")
        if len(regions) != 1:
            raise RuntimeError("Shortcut proof preflight requires one VIEW_3D window region")
        if area.spaces.active.type != "VIEW_3D":
            raise RuntimeError("Shortcut proof preflight requires the active VIEW_3D space")
        if not callable(getattr(window, "event_simulate", None)):
            raise RuntimeError("Shortcut proof preflight requires Window.event_simulate")
        modal_operators = tuple(getattr(window, "modal_operators", ()))
        if modal_operators:
            raise RuntimeError("Shortcut proof preflight rejects active modal operators")
        keyconfig = context.window_manager.keyconfigs.active
        if keyconfig is None or keyconfig.name != "Blender":
            raise RuntimeError("Shortcut proof preflight requires the Blender keymap")
        active = context.view_layer.objects.active
        if (
            context.mode != "OBJECT"
            or active is None
            or active.name != "Cube"
            or active.type != "MESH"
            or active.data is None
        ):
            raise RuntimeError("Shortcut proof preflight requires the active object-mode Cube mesh")
        if len(active.modifiers) != 0:
            raise RuntimeError("Shortcut proof preflight requires an unmodified target")
        topology = {
            "vertices": len(active.data.vertices),
            "edges": len(active.data.edges),
            "polygons": len(active.data.polygons),
        }
        if topology != {"vertices": 8, "edges": 12, "polygons": 6}:
            raise RuntimeError("Shortcut proof preflight requires the untouched cube topology")
        factory_cube_snapshot = build_factory_cube_canonical_snapshot(active)
        validate_factory_cube_canonical_snapshot(factory_cube_snapshot)
        if tuple(context.selected_objects) != (active,):
            raise RuntimeError("Shortcut proof preflight requires only the active Cube selected")

        ui_scale = float(context.preferences.system.ui_scale)
        if not 0.5 <= ui_scale <= 4.0:
            raise RuntimeError("Shortcut proof preflight rejected the Blender UI scale")
        center = (area.x + area.width // 2, area.y + area.height // 2)
        level_point = (
            center[0] + round(210 * ui_scale),
            center[1] - round(50 * ui_scale),
        )
        if not (
            area.x <= level_point[0] < area.x + area.width
            and area.y <= level_point[1] < area.y + area.height
        ):
            raise RuntimeError("Shortcut proof F9 coordinate is outside the VIEW_3D area")

        self._window = window
        self._area = area
        self._region = regions[0]
        self._space = area.spaces.active
        self._center = center
        self._level_point = level_point
        self._ui_scale = ui_scale
        self._preflight = _Preflight(
            object_pointer=active.as_pointer(),
            mesh_pointer=active.data.as_pointer(),
            mesh_datablock_count=len(bpy.data.meshes),
            object_name=active.name,
            mode=context.mode,
        )
        self._baseline_scene_snapshot = (
            build_subdivision_surface_scene_fingerprint_snapshot()
        )
        self._baseline_scene_fingerprint_sha256 = (
            compute_shortcut_scene_fingerprint_sha256(self._baseline_scene_snapshot)
        )

    def _event(
        self,
        event_type: str,
        value: str = "PRESS",
        *,
        unicode: str = "",
        ctrl: bool = False,
        shift: bool = False,
        point: tuple[int, int] | None = None,
        operation_index: int | None = None,
        context_anchor: bool = False,
        history_phase: str | None = None,
    ) -> Callable[[], None]:
        def dispatch() -> None:
            x, y = self._center if point is None else point
            event: dict[str, object] = {
                "type": event_type,
                "value": value,
                "x": x,
                "y": y,
                "ctrl": ctrl,
                "shift": shift,
            }
            if unicode:
                event["unicode"] = unicode
            if operation_index is not None and operation_index not in self._operator_stack_before:
                self._operator_stack_before[operation_index] = self._operator_stack_sha256()
            if operation_index == 0 and event_type == "ONE" and value == "PRESS":
                # Be conservative if event_simulate raises after Blender accepted
                # the event: from this point onward native Undo may be required.
                self._mutation_started = True
            self._window.event_simulate(**event)
            event_evidence: dict[str, object] = {
                "type": event_type,
                "value": value,
                "ctrl": ctrl,
                "shift": shift,
                "point": {
                    "x": x,
                    "y": y,
                    "role": (
                        "level_control" if (x, y) == self._level_point else "viewport_center"
                    ),
                },
            }
            if unicode:
                event_evidence["unicode"] = unicode
            if operation_index is not None:
                self._operation_event_evidence[operation_index].append(event_evidence)
            elif context_anchor:
                self._context_anchor_event_evidence = event_evidence
            elif history_phase is not None:
                self._native_history_event_evidence[history_phase].append(event_evidence)

        return dispatch

    def _append_event(
        self,
        label: str,
        event_type: str,
        value: str = "PRESS",
        *,
        delay: float = 0.1,
        unicode: str = "",
        ctrl: bool = False,
        shift: bool = False,
        point: tuple[int, int] | None = None,
        operation_index: int | None = None,
        context_anchor: bool = False,
        history_phase: str | None = None,
    ) -> None:
        self._steps.append(
            _Step(
                label,
                delay,
                self._event(
                    event_type,
                    value,
                    unicode=unicode,
                    ctrl=ctrl,
                    shift=shift,
                    point=point,
                    operation_index=operation_index,
                    context_anchor=context_anchor,
                    history_phase=history_phase,
                ),
            )
        )

    def _append_press_release(
        self,
        label: str,
        event_type: str,
        *,
        delay: float,
        ctrl: bool = False,
        shift: bool = False,
        point: tuple[int, int] | None = None,
        operation_index: int | None = None,
        history_phase: str | None = None,
    ) -> None:
        self._append_event(
            label + ":press",
            event_type,
            delay=0.04,
            ctrl=ctrl,
            shift=shift,
            point=point,
            operation_index=operation_index,
            history_phase=history_phase,
        )
        self._append_event(
            label + ":release",
            event_type,
            "RELEASE",
            delay=delay,
            ctrl=ctrl,
            shift=shift,
            point=point,
            operation_index=operation_index,
            history_phase=history_phase,
        )

    def _append_double_click(self, label: str, operation_index: int) -> None:
        point = self._level_point
        self._append_event(
            label + ":hover",
            "MOUSEMOVE",
            "NOTHING",
            point=point,
            operation_index=operation_index,
        )
        for click_index in (1, 2):
            self._append_event(
                f"{label}:{click_index}:press",
                "LEFTMOUSE",
                delay=0.03,
                point=point,
                operation_index=operation_index,
            )
            self._append_event(
                f"{label}:{click_index}:release",
                "LEFTMOUSE",
                "RELEASE",
                delay=0.15 if click_index == 2 else 0.04,
                point=point,
                operation_index=operation_index,
            )

    def _append_receipt(
        self,
        operation_index: int,
        observer: Callable[[], Mapping[str, object]],
    ) -> None:
        def capture() -> None:
            observation = dict(observer())
            previous = (
                None if not self._receipts else str(self._receipts[-1]["contentSha256"])
            )
            self._receipts.append(
                build_operation_receipt(
                    **self._receipt_identity,
                    operation_index=operation_index,
                    operation_id=OPERATION_IDS[operation_index],
                    event_evidence=self._operation_event_evidence[operation_index],
                    observation=observation,
                    previous_receipt_sha256=previous,
                    context=self._shortcut_context(),
                    operator_stack_before_sha256=self._operator_stack_before[
                        operation_index
                    ],
                    operator_stack_after_sha256=self._operator_stack_sha256(),
                )
            )

        self._steps.append(
            _Step(f"receipt:{OPERATION_IDS[operation_index]}", 0.1, capture)
        )

    def _build_fixed_steps(self) -> None:
        self._append_event(
            "anchor VIEW_3D context",
            "MOUSEMOVE",
            "NOTHING",
            delay=0.15,
            context_anchor=True,
        )

        self._append_press_release(
            "set subdivision level one",
            "ONE",
            ctrl=True,
            delay=0.7,
            operation_index=0,
        )
        self._append_receipt(0, self._observe_source_operation)

        self._append_press_release(
            "open redo panel", "F9", delay=0.5, operation_index=1
        )
        self._append_receipt(1, self._observe_open_surface)

        self._append_double_click("edit viewport level", 2)
        self._append_event(
            "select viewport level text",
            "A",
            ctrl=True,
            delay=0.08,
            operation_index=2,
        )
        event_name = {1: "ONE", 2: "TWO", 3: "THREE"}[self.target_level]
        self._append_event(
            "type viewport level",
            event_name,
            unicode=str(self.target_level),
            delay=0.08,
            operation_index=2,
        )
        self._append_press_release(
            "confirm viewport level", "RET", delay=0.5, operation_index=2
        )
        self._append_receipt(2, self._observe_final_state)

        self._append_press_release(
            "close redo panel", "RET", delay=0.5, operation_index=3
        )
        self._append_receipt(3, self._observe_final_state)
        self._steps.append(
            _Step("capture strong observation", 0.1, self._capture_strong_observation)
        )

        self._append_press_release(
            "native undo", "Z", ctrl=True, delay=0.7, history_phase="undo"
        )
        self._steps.append(_Step("verify native undo", 0.1, self._observe_native_undo))
        self._append_press_release(
            "native redo",
            "Z",
            ctrl=True,
            shift=True,
            delay=0.7,
            history_phase="redo",
        )
        self._steps.append(_Step("verify native redo", 0.1, self._observe_native_redo))
        self._steps.append(_Step("complete shortcut proof", 0.1, self._complete))

    @staticmethod
    def _operator_properties() -> dict[str, object]:
        candidates = tuple(
            operator
            for operator in bpy.context.window_manager.operators
            if operator.bl_idname == "OBJECT_OT_subdivision_set"
        )
        if not candidates:
            raise RuntimeError("OBJECT_OT_subdivision_set is absent from the operator stack")
        operator = candidates[-1]
        properties = {
            name: getattr(operator.properties, name)
            for name in ("level", "relative", "ensure_modifier")
            if hasattr(operator.properties, name)
        }
        if set(properties) != {"level", "relative", "ensure_modifier"}:
            raise RuntimeError("Subdivision operator properties are incomplete")
        return properties

    def _shortcut_context(self) -> dict[str, object]:
        return {
            "windowId": str(self._window.as_pointer()),
            "areaType": "VIEW_3D",
            "regionType": "WINDOW",
            "mode": "OBJECT",
        }

    @staticmethod
    def _operator_stack_sha256() -> str:
        stack = [
            operator.bl_idname for operator in bpy.context.window_manager.operators
        ]
        return _canonical_sha256({"operatorIds": stack})

    def _active_and_modifier(self) -> tuple[Any, Any]:
        preflight = self._require_preflight()
        active = bpy.context.view_layer.objects.active
        if (
            active is None
            or active.as_pointer() != preflight.object_pointer
            or active.data is None
            or active.data.as_pointer() != preflight.mesh_pointer
        ):
            raise RuntimeError("Shortcut proof target object or Mesh identity changed")
        modifiers = tuple(modifier for modifier in active.modifiers if modifier.type == "SUBSURF")
        if len(modifiers) != 1 or len(active.modifiers) != 1:
            raise RuntimeError("Shortcut proof requires exactly one newly-created SUBSURF modifier")
        return active, modifiers[0]

    def _observe_source_operation(self) -> dict[str, object]:
        active, modifier = self._active_and_modifier()
        properties = self._operator_properties()
        if properties != {"level": 1, "relative": False, "ensure_modifier": True}:
            raise RuntimeError("Ctrl+1 did not create the expected native operator state")
        if modifier.levels != 1 or modifier.render_levels != 2:
            raise RuntimeError("Ctrl+1 did not create the expected native modifier levels")
        observation = {
            "operatorId": "OBJECT_OT_subdivision_set",
            "operatorProperties": properties,
            "modifierPointer": modifier.as_pointer(),
            "modifierCount": len(active.modifiers),
            "viewportLevel": modifier.levels,
            "renderLevel": modifier.render_levels,
        }
        self._source_observation = observation
        return observation

    def _observe_open_surface(self) -> dict[str, object]:
        active, modifier = self._active_and_modifier()
        properties = self._operator_properties()
        if properties != {"level": 1, "relative": False, "ensure_modifier": True}:
            raise RuntimeError("F9 did not retain the source operator properties")
        return {
            "operatorId": "OBJECT_OT_subdivision_set",
            "operatorProperties": properties,
            "modifierPointer": modifier.as_pointer(),
            "modifierCount": len(active.modifiers),
            "surface": "adjust_last_operation",
        }

    def _evaluated_topology(self, active: Any) -> dict[str, int]:
        depsgraph = bpy.context.evaluated_depsgraph_get()
        evaluated_object = active.evaluated_get(depsgraph)
        evaluated_mesh = evaluated_object.to_mesh()
        try:
            return {
                "vertices": len(evaluated_mesh.vertices),
                "edges": len(evaluated_mesh.edges),
                "polygons": len(evaluated_mesh.polygons),
            }
        finally:
            evaluated_object.to_mesh_clear()

    def _observe_final_state(self) -> dict[str, object]:
        preflight = self._require_preflight()
        active, modifier = self._active_and_modifier()
        properties = self._operator_properties()
        expected_properties = {
            "level": self.target_level,
            "relative": False,
            "ensure_modifier": True,
        }
        if properties != expected_properties:
            raise RuntimeError("F9 viewport-level input did not update the native operator")
        modifier_flags = {name: getattr(modifier, name) for name in EXPECTED_MODIFIER_FLAGS}
        topology = self._evaluated_topology(active)
        if (
            bpy.context.mode != preflight.mode
            or active.name != preflight.object_name
            or len(bpy.data.meshes) != preflight.mesh_datablock_count
            or modifier.levels != self.target_level
            or modifier.render_levels != 2
            or modifier_flags != EXPECTED_MODIFIER_FLAGS
            or topology != EXPECTED_TOPOLOGY[self.target_level]
        ):
            raise RuntimeError("Subdivision Surface shortcut strong Observation failed")
        observation = {
            "kind": "subdivision_surface_shortcut_ready",
            "satisfied": True,
            "objectName": active.name,
            "objectPointer": active.as_pointer(),
            "meshPointer": active.data.as_pointer(),
            "meshDatablockCount": len(bpy.data.meshes),
            "mode": bpy.context.mode,
            "operatorId": "OBJECT_OT_subdivision_set",
            "operatorProperties": properties,
            "subsurfModifierCount": 1,
            "modifierCount": len(active.modifiers),
            "modifierName": modifier.name,
            "modifierPointer": modifier.as_pointer(),
            "viewportLevel": modifier.levels,
            "renderLevel": modifier.render_levels,
            "modifierFlags": modifier_flags,
            "evaluatedTopology": topology,
            "objectIdentityUnchanged": active.as_pointer() == preflight.object_pointer,
            "meshIdentityUnchanged": active.data.as_pointer() == preflight.mesh_pointer,
            "meshDatablockCountUnchanged": (
                len(bpy.data.meshes) == preflight.mesh_datablock_count
            ),
            "modeUnchanged": bpy.context.mode == preflight.mode,
        }
        if not all(
            observation[key] is True
            for key in (
                "objectIdentityUnchanged",
                "meshIdentityUnchanged",
                "meshDatablockCountUnchanged",
                "modeUnchanged",
            )
        ):
            raise RuntimeError("Shortcut proof identity invariant failed")
        return observation

    def _capture_strong_observation(self) -> None:
        observation = self._observe_final_state()
        self._final_scene_snapshot = (
            build_subdivision_surface_scene_fingerprint_snapshot()
        )
        self._final_scene_fingerprint_sha256 = (
            compute_shortcut_scene_fingerprint_sha256(self._final_scene_snapshot)
        )
        observation["sceneFingerprintSha256"] = self._final_scene_fingerprint_sha256
        observation["observedAt"] = (
            datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        )
        self._final_observation = observation

    def _observe_native_undo(self) -> None:
        preflight = self._require_preflight()
        active = bpy.context.view_layer.objects.active
        if (
            active is None
            or active.as_pointer() != preflight.object_pointer
            or active.data.as_pointer() != preflight.mesh_pointer
            or len(active.modifiers) != 0
            or len(bpy.data.meshes) != preflight.mesh_datablock_count
            or bpy.context.mode != preflight.mode
        ):
            raise RuntimeError("Single native Undo did not restore the preflight boundary")
        undo_snapshot = build_subdivision_surface_scene_fingerprint_snapshot()
        undo_fingerprint = compute_shortcut_scene_fingerprint_sha256(undo_snapshot)
        if undo_fingerprint != self._baseline_scene_fingerprint_sha256:
            raise RuntimeError("Single native Undo did not restore the baseline fingerprint")
        observation: dict[str, object] = {
            "satisfied": True,
            "observationId": str(uuid.uuid4()),
            "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "subsurfModifierCount": 0,
            "objectPointer": active.as_pointer(),
            "meshPointer": active.data.as_pointer(),
            "meshDatablockCount": len(bpy.data.meshes),
            "mode": bpy.context.mode,
            "sceneFingerprintSha256": undo_fingerprint,
        }
        observation["contentSha256"] = _canonical_sha256(observation)
        self._undo_observation = observation

    def _observe_native_redo(self) -> None:
        preflight = self._require_preflight()
        active, modifier = self._active_and_modifier()
        modifier_flags = {
            name: getattr(modifier, name) for name in EXPECTED_MODIFIER_FLAGS
        }
        topology = self._evaluated_topology(active)
        if (
            bpy.context.mode != preflight.mode
            or active.name != preflight.object_name
            or len(bpy.data.meshes) != preflight.mesh_datablock_count
            or modifier.levels != self.target_level
            or modifier.render_levels != 2
            or modifier_flags != EXPECTED_MODIFIER_FLAGS
            or topology != EXPECTED_TOPOLOGY[self.target_level]
        ):
            raise RuntimeError("Single native Redo did not restore the shortcut result")
        redo_snapshot = build_subdivision_surface_scene_fingerprint_snapshot()
        redo_fingerprint = compute_shortcut_scene_fingerprint_sha256(redo_snapshot)
        if redo_fingerprint != self._final_scene_fingerprint_sha256:
            raise RuntimeError("Single native Redo did not restore the final fingerprint")
        observation: dict[str, object] = {
            "satisfied": True,
            "observationId": str(uuid.uuid4()),
            "observedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "objectName": active.name,
            "objectPointer": active.as_pointer(),
            "meshPointer": active.data.as_pointer(),
            "meshDatablockCount": len(bpy.data.meshes),
            "mode": bpy.context.mode,
            "subsurfModifierCount": 1,
            "modifierCount": len(active.modifiers),
            "modifierName": modifier.name,
            "modifierPointer": modifier.as_pointer(),
            "viewportLevel": modifier.levels,
            "renderLevel": modifier.render_levels,
            "modifierFlags": modifier_flags,
            "evaluatedTopology": topology,
            "objectIdentityUnchanged": active.as_pointer() == preflight.object_pointer,
            "meshIdentityUnchanged": active.data.as_pointer() == preflight.mesh_pointer,
            "meshDatablockCountUnchanged": (
                len(bpy.data.meshes) == preflight.mesh_datablock_count
            ),
            "modeUnchanged": bpy.context.mode == preflight.mode,
            "operatorPropertiesEvidence": "operation_receipt",
            "sceneFingerprintSha256": redo_fingerprint,
        }
        observation["contentSha256"] = _canonical_sha256(observation)
        self._redo_observation = observation

    def _complete(self) -> None:
        preflight = self._require_preflight()
        if (
            len(self._receipts) != len(OPERATION_IDS)
            or not verify_operation_receipt_chain(self._receipts)
            or self._source_observation is None
            or self._final_observation is None
            or self._undo_observation is None
            or self._redo_observation is None
            or self._baseline_scene_snapshot is None
            or self._baseline_scene_fingerprint_sha256 is None
            or self._final_scene_snapshot is None
            or self._final_scene_fingerprint_sha256 is None
        ):
            raise RuntimeError("Shortcut proof terminal evidence is incomplete")
        result: dict[str, object] = {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            **execution_evidence_claims(),
            "ok": True,
            "blenderVersion": bpy.app.version_string,
            "targetLevel": self.target_level,
            "targetProfile": TARGET_PROFILE,
            "mutationStarted": True,
            "lastCompletedOperation": OPERATION_IDS[-1],
            "requiresUndoToUnlock": True,
            "uiScale": self._ui_scale,
            "levelPoint": list(self._level_point),
            "preflight": {
                "satisfied": True,
                "targetProfile": TARGET_PROFILE,
                "authorizationHookVerified": self._preflight_hook_verified,
                "blenderVersionSupported": True,
                "splashDisabled": True,
                "workspace": "Layout",
                "areaType": "VIEW_3D",
                "regionType": "WINDOW",
                "keymap": "Blender",
                "eventSimulateCapability": "callable",
                "modalOperatorCount": 0,
                "objectName": preflight.object_name,
                "objectPointer": preflight.object_pointer,
                "meshPointer": preflight.mesh_pointer,
                "meshDatablockCount": preflight.mesh_datablock_count,
                "mode": preflight.mode,
                "selectedObjectCount": 1,
                "modifierCount": 0,
                "topology": {"vertices": 8, "edges": 12, "polygons": 6},
            },
            "contextAnchorEventEvidence": self._context_anchor_event_evidence,
            "baselineSceneSnapshot": self._baseline_scene_snapshot,
            "baselineSceneFingerprintSha256": self._baseline_scene_fingerprint_sha256,
            "finalSceneSnapshot": self._final_scene_snapshot,
            "finalSceneFingerprintSha256": self._final_scene_fingerprint_sha256,
            "operationReceipts": self._receipts,
            "operationReceiptChainVerified": True,
            "observation": self._final_observation,
            "nativeHistory": {
                "availability": "verified",
                "boundary": "single_native_undo_redo",
                "eventEvidence": self._native_history_event_evidence,
                "undoObservation": self._undo_observation,
                "redoObservation": self._redo_observation,
            },
        }
        if self._terminal:
            return
        self._terminal = True
        self._steps.clear()
        self._unregister_timer()
        assert self._on_complete is not None
        self._on_complete(result)

    def _require_preflight(self) -> _Preflight:
        if self._preflight is None:
            raise RuntimeError("Shortcut proof preflight was not completed")
        return self._preflight

    @staticmethod
    def _current_scene_fingerprint() -> tuple[dict[str, object], str] | None:
        try:
            snapshot = build_subdivision_surface_scene_fingerprint_snapshot()
            return (
                snapshot,
                compute_shortcut_scene_fingerprint_sha256(snapshot),
            )
        except (AttributeError, ReferenceError, RuntimeError):
            return None

    def _advance(self) -> float | None:
        if self._terminal:
            return None
        try:
            if self._continuation_guard is None or self._continuation_guard() is not True:
                raise RuntimeError(
                    "Shortcut proof continuation authorization was revoked"
                )
        except Exception as error:
            self._fail(error)
            return None
        if not self._steps:
            self._unregister_timer()
            return None
        step = self._steps.pop(0)
        self._current_label = step.label
        try:
            with bpy.context.temp_override(
                window=self._window,
                area=self._area,
                region=self._region,
                space_data=self._space,
            ):
                step.action()
        except Exception as error:
            self._fail(error)
            return None
        if self._terminal:
            return None
        return step.delay

    def _fail(self, error: Exception) -> None:
        if self._terminal:
            return
        self._terminal = True
        self._steps.clear()
        self._unregister_timer()
        current_scene = self._current_scene_fingerprint()
        current_scene_snapshot = None if current_scene is None else current_scene[0]
        current_scene_fingerprint_sha256 = (
            None if current_scene is None else current_scene[1]
        )
        restored_to_baseline = bool(
            self._mutation_started
            and current_scene_fingerprint_sha256 is not None
            and current_scene_fingerprint_sha256
            == self._baseline_scene_fingerprint_sha256
        )
        requires_undo_recovery = self._mutation_started and not restored_to_baseline
        last_completed_operation = (
            None if not self._receipts else self._receipts[-1]["operationId"]
        )
        if not self._mutation_started:
            failure_status = "preflight_rejected"
            native_history = {
                "status": "preflight_rejected",
                "availability": "unavailable",
                "reason": "No shortcut mutation event was accepted by Blender.",
            }
        elif requires_undo_recovery:
            failure_status = "failed_checkpointed"
            native_history = {
                "status": "failed_checkpointed",
                "availability": "failed_checkpointed",
                "reason": "The shortcut mutation remains and requires native Undo recovery.",
            }
        else:
            failure_status = "failed_restored"
            native_history = {
                "status": "failed_restored",
                "availability": "restored",
                "reason": "The failed shortcut proof is currently at its preflight state.",
            }
        receipt_prefix_verified = verify_operation_receipt_chain(self._receipts)
        receipt_chain_complete = len(self._receipts) == len(OPERATION_IDS)
        failure: dict[str, object] = {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            **execution_evidence_claims(),
            "ok": False,
            "targetProfile": TARGET_PROFILE,
            "failureStatus": failure_status,
            "failedStep": self._current_label,
            "error": f"{type(error).__name__}: {error}",
            "mutationStarted": self._mutation_started,
            "lastCompletedOperation": last_completed_operation,
            "requiresUndoRecovery": requires_undo_recovery,
            "operationReceipts": self._receipts,
            "operationReceiptPrefixVerified": receipt_prefix_verified,
            "operationReceiptChainComplete": receipt_chain_complete,
            "operationReceiptChainVerified": (
                receipt_prefix_verified and receipt_chain_complete
            ),
            "nativeHistory": native_history,
        }
        if current_scene_snapshot is not None:
            failure["currentSceneSnapshot"] = current_scene_snapshot
            failure["currentSceneFingerprintSha256"] = (
                current_scene_fingerprint_sha256
            )
        if self._baseline_scene_snapshot is not None:
            failure["baselineSceneSnapshot"] = self._baseline_scene_snapshot
            failure["baselineSceneFingerprintSha256"] = (
                self._baseline_scene_fingerprint_sha256
            )
        if self._final_scene_snapshot is not None:
            failure["finalSceneSnapshot"] = self._final_scene_snapshot
            failure["finalSceneFingerprintSha256"] = (
                self._final_scene_fingerprint_sha256
            )
        if self._on_failure is None:
            raise error
        self._on_failure(failure)


__all__ = (
    "EXECUTOR_ID",
    "OPERATION_IDS",
    "OPERATION_EVENT_COUNTS",
    "TARGET_PROFILE",
    "SubdivisionSurfaceF9ShortcutProof",
    "build_operation_receipt",
    "build_subdivision_surface_scene_fingerprint_snapshot",
    "build_factory_cube_canonical_snapshot",
    "compute_shortcut_scene_fingerprint_sha256",
    "validate_factory_cube_canonical_snapshot",
    "execution_evidence_claims",
    "verify_operation_receipt_chain",
)
