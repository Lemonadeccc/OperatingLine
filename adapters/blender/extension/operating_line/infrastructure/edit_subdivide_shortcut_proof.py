"""Strict native UI proof for Edit Mode ``Subdivide`` through F3 and F9.

This module intentionally has no operator-based mutation escape hatch.  Every
state-changing input, including the four-step Undo/Redo proof, is delivered by
``Window.event_simulate``.  ``bpy`` is used only to reject an unsafe starting
state and to read evidence after UI ownership has returned to the viewport.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
from typing import Any
import uuid

import bpy

from .shortcut_proof import _canonical_sha256

EXECUTOR_ID = "blender.mesh_edit_subdivide_f3_f9.event_simulate.v1"
TARGET_PROFILE = "factory_cube_single_user_mesh_8_12_6"
NATIVE_MUTATION_KIND = "in_place_edit_mesh_subdivide"
NATIVE_UNDO_DEPTH = 4
NATIVE_REDO_DEPTH = 4
OPERATION_IDS = (
    "shortcut.enter_edit_mode",
    "shortcut.select_all_mesh_elements",
    "shortcut.search_subdivide",
    "shortcut.execute_subdivide",
    "shortcut.open_adjust_last_operation",
    "shortcut.set_number_of_cuts",
    "shortcut.set_smoothness",
    "shortcut.close_adjust_last_operation",
    "shortcut.return_to_object_mode",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _numeric_text(value: int | float) -> str:
    if isinstance(value, int):
        return str(value)
    if value == int(value):
        return str(int(value))
    return str(value)


def _mesh_geometry_sha256(mesh: Any) -> str:
    value = {
        "vertices": [
            [round(float(c), 9) for c in vertex.co] for vertex in mesh.vertices
        ],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
    }
    return hashlib.sha256(
        json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def build_edit_subdivide_scene_snapshot() -> dict[str, object]:
    active = bpy.context.view_layer.objects.active
    if active is None or active.type != "MESH" or active.data is None:
        raise RuntimeError("Edit Subdivide proof requires an active mesh")
    mesh = active.data
    topology = {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "polygons": len(mesh.polygons),
    }
    topology_sha256 = _canonical_sha256(topology)
    geometry_sha256 = _mesh_geometry_sha256(mesh)
    snapshot: dict[str, object] = {
        "target": {
            "objectName": active.name,
            "objectPointer": active.as_pointer(),
            "meshName": mesh.name,
            "meshPointer": mesh.as_pointer(),
            "meshUsers": mesh.users,
            "meshDatablockCount": len(bpy.data.meshes),
        },
        "modifierCount": len(active.modifiers),
        "shapeKeyCount": (
            0 if mesh.shape_keys is None else len(mesh.shape_keys.key_blocks)
        ),
        "activeObjectMode": bpy.context.mode,
        "selectedObjectCount": len(bpy.context.selected_objects),
        "topology": topology,
        "topologySha256": topology_sha256,
        "geometrySha256": geometry_sha256,
    }
    return snapshot


def compute_edit_subdivide_scene_fingerprint_sha256(
    snapshot: Mapping[str, object],
) -> str:
    return _canonical_sha256(snapshot)


def verify_operation_receipt_chain(receipts: Sequence[Mapping[str, object]]) -> bool:
    if len(receipts) > len(OPERATION_IDS):
        return False
    previous: str | None = None
    for index, receipt in enumerate(receipts):
        if (
            receipt.get("operationId") != OPERATION_IDS[index]
            or receipt.get("order") != index + 1
            or receipt.get("previousReceiptContentSha256") != previous
        ):
            return False
        content = {
            key: value for key, value in receipt.items() if key != "contentSha256"
        }
        if receipt.get("contentSha256") != _canonical_sha256(content):
            return False
        previous = str(receipt["contentSha256"])
    return True


@dataclass(frozen=True, slots=True)
class _Step:
    label: str
    delay: float
    action: Callable[[], None]


class EditSubdivideF3F9ShortcutProof:
    """Single-use fixed-input driver for the catalog-authorized nine operations."""

    executor_id = EXECUTOR_ID
    operation_ids = OPERATION_IDS

    def __init__(
        self,
        cuts: int,
        smooth: float,
        *,
        proof_id: str,
        request_id: str,
        delivery_id: str,
        binding_content_sha256: str,
    ) -> None:
        if isinstance(cuts, bool) or not isinstance(cuts, int) or not 1 <= cuts <= 8:
            raise ValueError("Edit Subdivide cuts must be an integer from 1 through 8")
        if isinstance(smooth, bool) or not isinstance(smooth, (int, float)):
            raise ValueError("Edit Subdivide smooth must be numeric")
        smooth = float(smooth)
        if not math.isfinite(smooth) or not 0.0 <= smooth <= 1.0:
            raise ValueError("Edit Subdivide smooth must be between 0 and 1")
        self.cuts = cuts
        self.smooth = smooth
        self.cuts_text = _numeric_text(cuts)
        self.smooth_text = _numeric_text(smooth)
        self._identity = {
            "proofId": str(uuid.UUID(proof_id)),
            "requestId": str(uuid.UUID(request_id)),
            "deliveryId": str(uuid.UUID(delivery_id)),
            "bindingContentSha256": binding_content_sha256,
        }
        if (
            not isinstance(binding_content_sha256, str)
            or len(binding_content_sha256) != 64
        ):
            raise ValueError("Edit Subdivide binding hash is invalid")
        self._steps: list[_Step] = []
        self._events: dict[int, list[dict[str, object]]] = {i: [] for i in range(9)}
        self._stack_before: dict[int, str] = {}
        self._receipts: list[dict[str, object]] = []
        self._history_events = {"undo": [], "redo": []}
        self._history_snapshots: list[dict[str, object]] = []
        self._baseline_snapshot: dict[str, object] | None = None
        self._baseline_sha256: str | None = None
        self._final_snapshot: dict[str, object] | None = None
        self._final_sha256: str | None = None
        self._operator_properties: dict[str, object] | None = None
        self._window = self._area = self._region = self._space = None
        self._center = (0, 0)
        self._number_point = (0, 0)
        self._smooth_point = (0, 0)
        self._ui_scale = 0.0
        self._object_pointer = self._mesh_pointer = self._mesh_count = 0
        self._continuation_guard: Callable[[], bool] | None = None
        self._on_complete: Callable[[dict[str, object]], None] | None = None
        self._on_failure: Callable[[dict[str, object]], None] | None = None
        self._timer_callback = self._advance
        self._timer_registered = False
        self._terminal = False
        self._mutation_started = False
        self._current_label = "preflight"

    @property
    def mutation_started(self) -> bool:
        return self._mutation_started

    def start(
        self,
        *,
        preflight_hook: Callable[[], bool],
        pre_mutation_hook: Callable[[], bool],
        on_complete: Callable[[dict[str, object]], None],
        on_failure: Callable[[dict[str, object]], None],
    ) -> None:
        if self._on_complete is not None:
            raise RuntimeError("Edit Subdivide proof drivers are single-use")
        self._continuation_guard = preflight_hook
        self._on_complete = on_complete
        self._on_failure = on_failure
        try:
            if preflight_hook() is not True:
                raise RuntimeError(
                    "Edit Subdivide authorization hook rejected execution"
                )
            self._preflight()
            self._build_steps()
            if pre_mutation_hook() is not True:
                raise RuntimeError("Edit Subdivide mutation lease was not granted")
            bpy.app.timers.register(self._timer_callback, first_interval=1.0)
            self._timer_registered = True
        except Exception as error:
            self._fail(error)

    def cancel(self, reason: str = "Edit Subdivide proof cancelled") -> bool:
        if self._terminal:
            return False
        self._fail(RuntimeError(reason))
        return True

    def abandon(self) -> bool:
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
        try:
            if not hasattr(
                bpy.app.timers, "is_registered"
            ) or bpy.app.timers.is_registered(self._timer_callback):
                bpy.app.timers.unregister(self._timer_callback)
        except (ReferenceError, RuntimeError, ValueError):
            pass
        self._timer_registered = False

    def _preflight(self) -> None:
        context = bpy.context
        if tuple(bpy.app.version) not in {(4, 5, 3), (5, 1, 1)}:
            raise RuntimeError("Edit Subdivide proof supports Blender 4.5.3 or 5.1.1")
        window = context.window
        if window is None or not callable(getattr(window, "event_simulate", None)):
            raise RuntimeError("Edit Subdivide proof requires Window.event_simulate")
        areas = tuple(area for area in window.screen.areas if area.type == "VIEW_3D")
        if (
            len(areas) != 1
            or context.workspace is None
            or context.workspace.name != "Layout"
        ):
            raise RuntimeError("Edit Subdivide proof requires one Layout VIEW_3D area")
        area = areas[0]
        regions = tuple(region for region in area.regions if region.type == "WINDOW")
        if len(regions) != 1 or area.spaces.active.type != "VIEW_3D":
            raise RuntimeError(
                "Edit Subdivide proof requires one VIEW_3D window region"
            )
        if tuple(getattr(window, "modal_operators", ())):
            raise RuntimeError("Edit Subdivide proof rejects active modal operators")
        keyconfig = context.window_manager.keyconfigs.active
        if keyconfig is None or keyconfig.name != "Blender":
            raise RuntimeError(
                "Edit Subdivide proof requires the default Blender keymap"
            )
        language = getattr(context.preferences.view, "language", "DEFAULT")
        locale = getattr(getattr(bpy.app, "translations", None), "locale", "en_US")
        if language not in {"DEFAULT", "en_US"} or locale not in {"DEFAULT", "en_US"}:
            raise RuntimeError(
                "Edit Subdivide proof requires English operator search labels"
            )
        active = context.view_layer.objects.active
        if (
            context.mode != "OBJECT"
            or active is None
            or active.name != "Cube"
            or active.type != "MESH"
            or active.data is None
        ):
            raise RuntimeError(
                "Edit Subdivide proof requires the active object-mode Cube"
            )
        mesh = active.data
        if (
            mesh.users != 1
            or len(bpy.data.meshes) != 1
            or len(active.modifiers) != 0
            or mesh.shape_keys is not None
        ):
            raise RuntimeError(
                "Edit Subdivide proof requires a single-user unmodified mesh without shape keys"
            )
        if (len(mesh.vertices), len(mesh.edges), len(mesh.polygons)) != (8, 12, 6):
            raise RuntimeError("Edit Subdivide proof requires factory Cube topology")
        if any(
            getattr(element, "hide", False)
            for collection in (mesh.vertices, mesh.edges, mesh.polygons)
            for element in collection
        ):
            raise RuntimeError(
                "Edit Subdivide proof requires every mesh element visible"
            )
        if tuple(context.selected_objects) != (active,):
            raise RuntimeError("Edit Subdivide proof requires only Cube selected")
        scale = float(context.preferences.system.ui_scale)
        center = (area.x + area.width // 2, area.y + area.height // 2)
        number = (center[0] + round(210 * scale), center[1] - round(50 * scale))
        smooth = (center[0] + round(210 * scale), center[1] - round(72.5 * scale))
        for point in (number, smooth):
            if not (
                area.x <= point[0] < area.x + area.width
                and area.y <= point[1] < area.y + area.height
            ):
                raise RuntimeError(
                    "Edit Subdivide F9 control coordinate is outside VIEW_3D"
                )
        self._window, self._area, self._region, self._space = (
            window,
            area,
            regions[0],
            area.spaces.active,
        )
        self._center, self._number_point, self._smooth_point, self._ui_scale = (
            center,
            number,
            smooth,
            scale,
        )
        self._object_pointer, self._mesh_pointer, self._mesh_count = (
            active.as_pointer(),
            mesh.as_pointer(),
            len(bpy.data.meshes),
        )
        self._baseline_snapshot = build_edit_subdivide_scene_snapshot()
        self._baseline_sha256 = compute_edit_subdivide_scene_fingerprint_sha256(
            self._baseline_snapshot
        )

    def _stack_sha256(self) -> str:
        return _canonical_sha256(
            {
                "operators": [
                    getattr(op, "bl_idname", "")
                    for op in bpy.context.window_manager.operators
                ]
            }
        )

    def _context(self, mode: str) -> dict[str, object]:
        return {
            "windowId": str(self._window.as_pointer()),
            "areaType": "VIEW_3D",
            "regionType": "WINDOW",
            "mode": mode,
        }

    def _point_role(self, point: tuple[int, int]) -> str:
        if point == self._number_point:
            return "number_cuts_control"
        if point == self._smooth_point:
            return "smoothness_control"
        return "viewport_center"

    def _event(
        self,
        event_type: str,
        value: str = "PRESS",
        *,
        unicode: str = "",
        ctrl: bool = False,
        shift: bool = False,
        point: tuple[int, int] | None = None,
        operation: int | None = None,
        history: str | None = None,
    ) -> Callable[[], None]:
        def dispatch() -> None:
            location = self._center if point is None else point
            event: dict[str, object] = {
                "type": event_type,
                "value": value,
                "x": location[0],
                "y": location[1],
                "ctrl": ctrl,
                "shift": shift,
            }
            if unicode:
                event["unicode"] = unicode
            if operation is not None and operation not in self._stack_before:
                self._stack_before[operation] = self._stack_sha256()
            if operation == 0 and event_type == "TAB" and value == "PRESS":
                self._mutation_started = True
            self._window.event_simulate(**event)
            evidence: dict[str, object] = {
                "type": event_type,
                "value": value,
                "ctrl": ctrl,
                "shift": shift,
                "point": {
                    "x": location[0],
                    "y": location[1],
                    "role": self._point_role(location),
                },
            }
            if unicode:
                evidence["unicode"] = unicode
            if operation is not None:
                self._events[operation].append(evidence)
            elif history is not None:
                self._history_events[history].append(evidence)

        return dispatch

    def _add_event(
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
        operation: int | None = None,
        history: str | None = None,
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
                    operation=operation,
                    history=history,
                ),
            )
        )

    def _press_release(
        self,
        label: str,
        event_type: str,
        *,
        delay: float,
        ctrl: bool = False,
        shift: bool = False,
        operation: int | None = None,
        history: str | None = None,
    ) -> None:
        self._add_event(
            label + ":press",
            event_type,
            delay=0.04,
            ctrl=ctrl,
            shift=shift,
            operation=operation,
            history=history,
        )
        self._add_event(
            label + ":release",
            event_type,
            "RELEASE",
            delay=delay,
            ctrl=ctrl,
            shift=shift,
            operation=operation,
            history=history,
        )

    def _text(self, label: str, text: str, operation: int) -> None:
        names = {
            ".": "PERIOD",
            **{
                str(i): (
                    "ZERO",
                    "ONE",
                    "TWO",
                    "THREE",
                    "FOUR",
                    "FIVE",
                    "SIX",
                    "SEVEN",
                    "EIGHT",
                    "NINE",
                )[i]
                for i in range(10)
            },
        }
        for index, character in enumerate(text):
            self._add_event(
                f"{label}:{index}",
                names.get(character, character.upper()),
                unicode=character,
                delay=0.04,
                operation=operation,
            )

    def _double_click(self, label: str, point: tuple[int, int], operation: int) -> None:
        self._add_event(
            label + ":hover", "MOUSEMOVE", "NOTHING", point=point, operation=operation
        )
        for index in (1, 2):
            self._add_event(
                f"{label}:{index}:press",
                "LEFTMOUSE",
                point=point,
                delay=0.03,
                operation=operation,
            )
            self._add_event(
                f"{label}:{index}:release",
                "LEFTMOUSE",
                "RELEASE",
                point=point,
                delay=0.15 if index == 2 else 0.04,
                operation=operation,
            )

    def _receipt(
        self, index: int, mode: str, extra: Mapping[str, object] | None = None
    ) -> None:
        def capture() -> None:
            self._verify_operation_readback(index)
            events = self._events[index]
            receipt: dict[str, object] = {
                **self._identity,
                "receiptId": str(uuid.uuid4()),
                "operationId": OPERATION_IDS[index],
                "order": index + 1,
                "previousReceiptContentSha256": (
                    None if not self._receipts else self._receipts[-1]["contentSha256"]
                ),
                "outcome": "succeeded",
                "occurredAt": _now(),
                "kind": "operator_property_update" if index in {5, 6} else "key_input",
                "context": self._context(mode),
            }
            if index in {5, 6}:
                receipt.update(extra or {})
                receipt["activationEventEvidence"] = events[:5]
                receipt["selectAllEventEvidence"] = events[5:6]
                receipt["textEventEvidence"] = events[6:-2]
                receipt["confirmEventEvidence"] = events[-2:]
            else:
                receipt["eventEvidence"] = events[:2]
                receipt["operatorStackBeforeSha256"] = self._stack_before[index]
                receipt["operatorStackAfterSha256"] = self._stack_sha256()
                receipt.update(extra or {})
                if index == 2:
                    receipt["queryEventEvidence"] = events[2:]
            receipt["contentSha256"] = _canonical_sha256(receipt)
            self._receipts.append(receipt)

        self._steps.append(_Step("receipt:" + OPERATION_IDS[index], 0.1, capture))

    def _verify_operation_readback(self, index: int) -> None:
        active = bpy.context.view_layer.objects.active
        if (
            active is None
            or active.as_pointer() != self._object_pointer
            or active.data.as_pointer() != self._mesh_pointer
        ):
            raise RuntimeError("Edit Subdivide operation changed the target identity")
        if index == 0 and bpy.context.mode != "EDIT_MESH":
            raise RuntimeError("Edit Subdivide TAB did not enter Edit Mode")
        if index == 1:
            if bpy.context.mode != "EDIT_MESH":
                raise RuntimeError("Edit Subdivide selection left Edit Mode")
            collections = (
                active.data.vertices,
                active.data.edges,
                active.data.polygons,
            )
            if any(
                getattr(element, "hide", False) or not getattr(element, "select", False)
                for collection in collections
                for element in collection
            ):
                raise RuntimeError(
                    "Edit Subdivide select-all did not select every visible element"
                )
        if index in {3, 4}:
            if not any(
                getattr(operator, "bl_idname", "") == "MESH_OT_subdivide"
                for operator in bpy.context.window_manager.operators
            ):
                raise RuntimeError(
                    "Edit Subdivide operator was not proven in Blender's operator stack"
                )
        if index == 8 and bpy.context.mode != "OBJECT":
            raise RuntimeError("Edit Subdivide final TAB did not return to Object Mode")

    def _capture_operator(self) -> None:
        candidates = tuple(
            op
            for op in bpy.context.window_manager.operators
            if op.bl_idname == "MESH_OT_subdivide"
        )
        if not candidates:
            raise RuntimeError("MESH_OT_subdivide is absent from the operator stack")
        properties = candidates[-1].properties
        values = {
            "number_cuts": getattr(properties, "number_cuts"),
            "smoothness": float(getattr(properties, "smoothness")),
        }
        if values["number_cuts"] != self.cuts or not math.isclose(
            values["smoothness"], self.smooth, rel_tol=0, abs_tol=1e-6
        ):
            raise RuntimeError(
                "MESH_OT_subdivide properties do not match requested values"
            )
        self._operator_properties = values

    def _capture_history(self, label: str) -> None:
        snapshot = build_edit_subdivide_scene_snapshot()
        self._history_snapshots.append(
            {
                "label": label,
                "snapshot": snapshot,
                "sceneFingerprintSha256": compute_edit_subdivide_scene_fingerprint_sha256(
                    snapshot
                ),
            }
        )

    def _build_steps(self) -> None:
        self._add_event("anchor", "MOUSEMOVE", "NOTHING", delay=0.15)
        self._press_release("enter edit mode", "TAB", delay=0.3, operation=0)
        self._receipt(0, "OBJECT", {"modeBefore": "OBJECT", "modeAfter": "EDIT_MESH"})
        self._press_release("select all", "A", delay=0.2, operation=1)
        self._receipt(1, "EDIT_MESH", {"allVisibleMeshElementsSelected": True})
        self._press_release("search", "F3", delay=0.3, operation=2)
        self._text("query", "subdivide", 2)
        self._receipt(
            2,
            "EDIT_MESH",
            {"query": "subdivide", "selectedOperatorId": "mesh.subdivide"},
        )
        self._press_release("execute", "RET", delay=0.6, operation=3)
        self._receipt(3, "EDIT_MESH", {"executedOperatorId": "mesh.subdivide"})
        self._press_release("open F9", "F9", delay=0.5, operation=4)
        self._receipt(
            4,
            "EDIT_MESH",
            {
                "sourceOperationId": OPERATION_IDS[3],
                "sourceOperatorId": "mesh.subdivide",
            },
        )
        for index, point, text, control, value in (
            (
                5,
                self._number_point,
                self.cuts_text,
                "mesh.subdivide.number_cuts",
                self.cuts,
            ),
            (
                6,
                self._smooth_point,
                self.smooth_text,
                "mesh.subdivide.smoothness",
                self.smooth,
            ),
        ):
            self._double_click("activate " + control, point, index)
            self._add_event("select text", "A", ctrl=True, delay=0.08, operation=index)
            self._text("type value", text, index)
            self._press_release("confirm value", "RET", delay=0.5, operation=index)
            self._receipt(
                index,
                "EDIT_MESH",
                {
                    "surfaceOperationId": OPERATION_IDS[4],
                    "surfaceOperatorId": "mesh.subdivide",
                    "controlId": control,
                    "newValue": value,
                    "enteredText": text,
                },
            )
        self._press_release("close F9", "RET", delay=0.5, operation=7)
        self._receipt(7, "EDIT_MESH", {"surfaceOperationId": OPERATION_IDS[4]})
        self._steps.append(_Step("capture operator", 0.1, self._capture_operator))
        self._press_release("return object mode", "TAB", delay=0.5, operation=8)
        self._receipt(
            8, "EDIT_MESH", {"modeBefore": "EDIT_MESH", "modeAfter": "OBJECT"}
        )
        self._steps.append(
            _Step("capture applied", 0.1, lambda: self._capture_history("applied"))
        )
        for index in range(1, NATIVE_UNDO_DEPTH + 1):
            self._press_release(
                f"undo {index}", "Z", ctrl=True, delay=0.5, history="undo"
            )
            self._steps.append(
                _Step(
                    f"capture undo {index}",
                    0.1,
                    lambda index=index: self._capture_history(f"undo-{index}"),
                )
            )
        for index in range(1, NATIVE_REDO_DEPTH + 1):
            self._press_release(
                f"redo {index}", "Z", ctrl=True, shift=True, delay=0.5, history="redo"
            )
            self._steps.append(
                _Step(
                    f"capture redo {index}",
                    0.1,
                    lambda index=index: self._capture_history(f"redo-{index}"),
                )
            )
        self._steps.append(_Step("complete", 0.1, self._complete))

    def _complete(self) -> None:
        if (
            self._baseline_snapshot is None
            or self._baseline_sha256 is None
            or self._operator_properties is None
        ):
            raise RuntimeError("Edit Subdivide terminal evidence is incomplete")
        if (
            len(self._receipts) != 9
            or not verify_operation_receipt_chain(self._receipts)
            or len(self._history_snapshots) != 9
        ):
            raise RuntimeError(
                "Edit Subdivide receipt or native history proof is incomplete"
            )
        applied = self._history_snapshots[0]
        restored = self._history_snapshots[4]
        final = self._history_snapshots[8]
        if (
            restored["sceneFingerprintSha256"] != self._baseline_sha256
            or final["sceneFingerprintSha256"] != applied["sceneFingerprintSha256"]
        ):
            raise RuntimeError(
                "Edit Subdivide 4/4 native history round trip did not restore both boundaries"
            )
        final_snapshot = final["snapshot"]
        assert isinstance(final_snapshot, dict)
        target = final_snapshot["target"]
        assert isinstance(target, dict)
        expected_segments = self.cuts + 1
        expected_topology = {
            "vertices": 6 * expected_segments**2 + 2,
            "edges": 12 * expected_segments**2,
            "polygons": 6 * expected_segments**2,
        }
        if (
            final_snapshot["topology"] != expected_topology
            or target["objectPointer"] != self._object_pointer
            or target["meshPointer"] != self._mesh_pointer
            or target["meshDatablockCount"] != self._mesh_count
        ):
            raise RuntimeError(
                "Edit Subdivide final topology or in-place identity is invalid"
            )
        self._final_snapshot = final_snapshot
        self._final_sha256 = str(final["sceneFingerprintSha256"])
        observation = {
            "observedAt": _now(),
            "objectName": target["objectName"],
            "objectPointer": target["objectPointer"],
            "meshName": target["meshName"],
            "meshPointer": target["meshPointer"],
            "meshUsers": target["meshUsers"],
            "meshDatablockCount": target["meshDatablockCount"],
            "sameObjectIdentity": True,
            "sameMeshIdentity": True,
            "managedReplacementMeshCreated": False,
            "modifierCount": final_snapshot["modifierCount"],
            "shapeKeyCount": final_snapshot["shapeKeyCount"],
            "activeObjectMode": final_snapshot["activeObjectMode"],
            "selectedObjectCount": final_snapshot["selectedObjectCount"],
            "operatorId": "MESH_OT_subdivide",
            "cuts": self.cuts,
            "smooth": self.smooth,
            "topology": final_snapshot["topology"],
            "topologySha256": final_snapshot["topologySha256"],
            "geometrySha256": final_snapshot["geometrySha256"],
            "sceneFingerprintSha256": self._final_sha256,
        }
        result = {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "evidenceClass": "blender_event_simulation",
            "osHidInput": False,
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "managedReplacementMeshCreated": False,
            "nativeMutationKind": NATIVE_MUTATION_KIND,
            "ok": True,
            "targetProfile": TARGET_PROFILE,
            "mutationStarted": True,
            "lastCompletedOperation": OPERATION_IDS[-1],
            "requiresUndoToUnlock": True,
            "baselineSceneSnapshot": self._baseline_snapshot,
            "baselineSceneFingerprintSha256": self._baseline_sha256,
            "finalSceneSnapshot": self._final_snapshot,
            "finalSceneFingerprintSha256": self._final_sha256,
            "operationReceipts": self._receipts,
            "operationReceiptChainVerified": True,
            "observation": observation,
            "nativeHistory": {
                "availability": "verified",
                "boundary": "full_procedure_native_undo_redo",
                "undoDepth": 4,
                "redoDepth": 4,
                "eventEvidence": self._history_events,
                "snapshots": self._history_snapshots,
            },
        }
        self._terminal = True
        self._unregister_timer()
        assert self._on_complete is not None
        self._on_complete(result)

    def _advance(self) -> float | None:
        if self._terminal:
            return None
        try:
            if (
                self._continuation_guard is None
                or self._continuation_guard() is not True
            ):
                raise RuntimeError("Edit Subdivide continuation authority was revoked")
            step = self._steps.pop(0)
            self._current_label = step.label
            with bpy.context.temp_override(
                window=self._window,
                area=self._area,
                region=self._region,
                space_data=self._space,
            ):
                step.action()
            return None if self._terminal else step.delay
        except Exception as error:
            self._fail(error)
            return None

    def _fail(self, error: Exception) -> None:
        if self._terminal:
            return
        self._terminal = True
        self._steps.clear()
        self._unregister_timer()
        snapshot = None
        fingerprint = None
        try:
            snapshot = build_edit_subdivide_scene_snapshot()
            fingerprint = compute_edit_subdivide_scene_fingerprint_sha256(snapshot)
        except Exception:
            pass
        restored = self._mutation_started and fingerprint == self._baseline_sha256
        failure = {
            "formatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "evidenceClass": "blender_event_simulation",
            "osHidInput": False,
            "managedActionResult": "not_executed",
            "managedIdentityVerified": False,
            "managedReceiptCreated": False,
            "managedReplacementMeshCreated": False,
            "nativeMutationKind": NATIVE_MUTATION_KIND,
            "ok": False,
            "failureStatus": (
                "preflight_rejected"
                if not self._mutation_started
                else ("failed_restored" if restored else "failed_checkpointed")
            ),
            "failedStep": self._current_label,
            "error": f"{type(error).__name__}: {error}",
            "mutationStarted": self._mutation_started,
            "requiresUndoRecovery": self._mutation_started and not restored,
            "operationReceipts": self._receipts,
            "operationReceiptPrefixVerified": verify_operation_receipt_chain(
                self._receipts
            ),
            "operationReceiptChainComplete": len(self._receipts) == 9,
            "operationReceiptChainVerified": len(self._receipts) == 9
            and verify_operation_receipt_chain(self._receipts),
            "lastCompletedOperation": (
                None if not self._receipts else self._receipts[-1]["operationId"]
            ),
            "baselineSceneSnapshot": self._baseline_snapshot,
            "baselineSceneFingerprintSha256": self._baseline_sha256,
            "currentSceneSnapshot": snapshot,
            "currentSceneFingerprintSha256": fingerprint,
        }
        assert self._on_failure is not None
        self._on_failure(failure)


__all__ = (
    "EXECUTOR_ID",
    "TARGET_PROFILE",
    "NATIVE_MUTATION_KIND",
    "NATIVE_UNDO_DEPTH",
    "NATIVE_REDO_DEPTH",
    "OPERATION_IDS",
    "EditSubdivideF3F9ShortcutProof",
    "build_edit_subdivide_scene_snapshot",
    "compute_edit_subdivide_scene_fingerprint_sha256",
    "verify_operation_receipt_chain",
)
