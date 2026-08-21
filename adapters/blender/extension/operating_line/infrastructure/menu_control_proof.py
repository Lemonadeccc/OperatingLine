"""Bounded native-menu proof for Blender's UV Sphere control flow.

The driver owns the complete event and coordinate policy.  Callers can only
authorize or stop the fixed proof and receive its terminal observation; they
cannot provide events, coordinates, operators, or corrective RNA writes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import hashlib
import json
import math
from types import MappingProxyType
from typing import Any

import bpy


EXECUTOR_ID = "blender.uv_sphere_menu_controls.event_simulate.v1"
TARGET_PROFILE = "factory_layout_three_object_ui_scale_2"
OPERATION_IDS = (
    "workspace.layout",
    "menu.add",
    "menu.mesh",
    "operator.uv_sphere",
    "control.location",
    "control.scale",
    "control.object_name",
)
EXPECTED_ARGUMENTS = MappingProxyType({
    "resourceId": "proof.uv_sphere.eye",
    "objectName": "OperatingLine.TutorialEye",
    "radius": 1.5,
    "location": (1.25, -2.0, 0.75),
})
EXPECTED_TOPOLOGY = MappingProxyType(
    {"vertices": 482, "edges": 992, "polygons": 512}
)
HISTORY_DEPTH = 8
EVENT_SIMULATE_COUNT = 146
SUPPORTED_BLENDER_VERSIONS = ((4, 5, 3), (5, 1, 1))
MUTATION_STAGES = (
    "uv_sphere_created",
    "location_x_set",
    "location_y_set",
    "location_z_set",
    "scale_x_set",
    "scale_y_set",
    "scale_z_set",
    "object_name_set",
)
MINIMUM_MUTATION_STAGE_COUNT_BY_OPERATION_COUNT = (0, 0, 0, 0, 1, 4, 7, 8)


def expected_arguments_payload() -> dict[str, object]:
    """Return a caller-safe copy of the exact accepted action arguments."""

    return {
        "resourceId": EXPECTED_ARGUMENTS["resourceId"],
        "objectName": EXPECTED_ARGUMENTS["objectName"],
        "radius": EXPECTED_ARGUMENTS["radius"],
        "location": list(EXPECTED_ARGUMENTS["location"]),
    }


def _mesh_sha256(mesh: Any) -> str:
    payload = {
        "vertices": [list(vertex.co) for vertex in mesh.vertices],
        "edges": [list(edge.vertices) for edge in mesh.edges],
        "polygons": [list(polygon.vertices) for polygon in mesh.polygons],
    }
    return hashlib.sha256(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def _scene_snapshot() -> dict[str, object]:
    context = bpy.context
    return {
        "activeObject": (
            None
            if context.view_layer.objects.active is None
            else context.view_layer.objects.active.name
        ),
        "selectedObjects": sorted(item.name for item in context.selected_objects),
        "objects": [
            {
                "name": item.name,
                "type": item.type,
                "location": list(item.location),
                "rotation": list(item.rotation_euler),
                "scale": list(item.scale),
                "mesh": (
                    None
                    if item.type != "MESH"
                    else {
                        "vertices": len(item.data.vertices),
                        "edges": len(item.data.edges),
                        "polygons": len(item.data.polygons),
                        "sha256": _mesh_sha256(item.data),
                    }
                ),
            }
            for item in sorted(bpy.data.objects, key=lambda candidate: candidate.name)
        ],
    }


def compute_scene_fingerprint_sha256(snapshot: dict[str, object]) -> str:
    """Hash one pointer-free scene snapshot with canonical JSON."""

    return hashlib.sha256(
        json.dumps(snapshot, separators=(",", ":"), sort_keys=True).encode("utf-8")
    ).hexdigest()


def execution_evidence_claims() -> dict[str, object]:
    """Return fixed provenance claims without implying managed execution."""

    return {
        "evidenceClass": "blender_event_simulation",
        "osHidInput": False,
        "managedActionResult": "not_executed",
        "managedIdentityVerified": False,
    }


def _completed_mutation_stages(snapshot: dict[str, object]) -> list[str]:
    """Derive the exact current native-history prefix without guessing."""

    objects = snapshot.get("objects")
    if not isinstance(objects, list):
        raise ValueError("Menu-control failure snapshot has no object list")
    candidates = [
        item
        for item in objects
        if isinstance(item, dict)
        and item.get("name") in {"Sphere", EXPECTED_ARGUMENTS["objectName"]}
    ]
    if not candidates:
        return []
    if len(candidates) != 1:
        raise ValueError("Menu-control failure snapshot has ambiguous proof objects")
    item = candidates[0]
    mesh = item.get("mesh")
    if (
        item.get("type") != "MESH"
        or not isinstance(mesh, dict)
        or {key: mesh.get(key) for key in EXPECTED_TOPOLOGY} != dict(EXPECTED_TOPOLOGY)
    ):
        raise ValueError("Menu-control failure proof object identity is invalid")
    location = item.get("location")
    scale = item.get("scale")
    if not isinstance(location, list) or len(location) != 3:
        raise ValueError("Menu-control failure location is invalid")
    if not isinstance(scale, list) or len(scale) != 3:
        raise ValueError("Menu-control failure scale is invalid")
    values = (
        (location[0], 0.0, 1.25),
        (location[1], 0.0, -2.0),
        (location[2], 0.0, 0.75),
        (scale[0], 1.0, 1.5),
        (scale[1], 1.0, 1.5),
        (scale[2], 1.0, 1.5),
    )
    completed = [MUTATION_STAGES[0]]
    saw_incomplete = False
    for index, (actual, baseline, expected) in enumerate(values, start=1):
        if actual == expected and not saw_incomplete:
            completed.append(MUTATION_STAGES[index])
        elif actual == baseline:
            saw_incomplete = True
        else:
            raise ValueError("Menu-control failure transform is not a canonical history stage")
    expected_name = EXPECTED_ARGUMENTS["objectName"]
    if item.get("name") == expected_name and not saw_incomplete:
        completed.append(MUTATION_STAGES[-1])
    elif item.get("name") != "Sphere":
        raise ValueError("Menu-control failure object name is not canonical")
    return completed


@dataclass(frozen=True)
class _Step:
    label: str
    delay: float
    action: Callable[[], None]


class UVSphereMenuControlProof:
    """Execute the one audited UV Sphere menu-and-controls recipe."""

    executor_id = EXECUTOR_ID
    target_profile = TARGET_PROFILE
    operation_ids = OPERATION_IDS
    def __init__(self) -> None:
        self._steps: list[_Step] = []
        self._event_evidence: list[dict[str, object]] = []
        self._operation_summaries: list[dict[str, object]] = []
        self._history_snapshots: list[dict[str, object]] = []
        self._window: Any = None
        self._area: Any = None
        self._region: Any = None
        self._space: Any = None
        self._header: Any = None
        self._ui_scale = 0.0
        self._add_point = (0, 0)
        self._mesh_point = (0, 0)
        self._uv_sphere_point = (0, 0)
        self._baseline_snapshot: dict[str, object] | None = None
        self._baseline_fingerprint: str | None = None
        self._final_snapshot: dict[str, object] | None = None
        self._source_operator: dict[str, object] | None = None
        self._baseline_cube_pointer: int | None = None
        self._baseline_cube_mesh_pointer: int | None = None
        self._baseline_cube_mesh_sha256: str | None = None
        self._on_complete: Callable[[dict[str, object]], None] | None = None
        self._on_failure: Callable[[dict[str, object]], None] | None = None
        self._continuation_guard: Callable[[], bool] | None = None
        self._timer_callback = self._advance
        self._timer_registered = False
        self._preflight_completed = False
        self._mutation_started = False
        self._terminal = False
        self._current_label = "preflight"
        self._native_input_step_count = 0

    @property
    def expected_arguments(self) -> dict[str, object]:
        return expected_arguments_payload()

    @property
    def mutation_started(self) -> bool:
        return self._mutation_started

    def start(
        self,
        *,
        preflight_hook: Callable[[], bool],
        on_complete: Callable[[dict[str, object]], None],
        on_failure: Callable[[dict[str, object]], None],
        continuation_guard: Callable[[], bool] | None = None,
    ) -> None:
        """Run strict preflight before scheduling any timer or native input."""

        if self._on_complete is not None or self._steps:
            raise RuntimeError("Menu-control proof driver instances are single-use")
        continuation_guard = preflight_hook if continuation_guard is None else continuation_guard
        if not all(
            callable(item)
            for item in (
                preflight_hook,
                on_complete,
                on_failure,
                continuation_guard,
            )
        ):
            raise TypeError("Menu-control proof callbacks must be callable")
        self._on_complete = on_complete
        self._on_failure = on_failure
        self._continuation_guard = continuation_guard
        try:
            if preflight_hook() is not True:
                raise RuntimeError("Menu-control proof authorization hook rejected execution")
            self._run_blender_preflight()
            self._preflight_completed = True
            self._build_fixed_steps()
        except Exception as error:
            self._fail(error)
            return
        bpy.app.timers.register(self._timer_callback, first_interval=1.0)
        self._timer_registered = True

    def cancel(self, reason: str = "Menu-control proof driver cancelled") -> bool:
        if self._terminal:
            return False
        self._unregister_timer()
        self._steps.clear()
        self._fail(RuntimeError(reason))
        return True

    def abandon(self) -> bool:
        """Stop without inspecting a replacement Blender document."""

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
            pass
        finally:
            self._timer_registered = False

    def _run_blender_preflight(self) -> None:
        context = bpy.context
        if tuple(bpy.app.version) not in SUPPORTED_BLENDER_VERSIONS:
            raise RuntimeError("Menu-control proof supports only Blender 4.5.3 or 5.1.1")
        if context.workspace is None or context.workspace.name != "Layout":
            raise RuntimeError("Menu-control proof requires the Layout workspace")
        if context.mode != "OBJECT":
            raise RuntimeError("Menu-control proof requires Object mode")
        window = context.window
        if window is None or not callable(getattr(window, "event_simulate", None)):
            raise RuntimeError("Menu-control proof requires Window.event_simulate")
        if tuple(getattr(window, "modal_operators", ())):
            raise RuntimeError("Menu-control proof rejects active modal operators")
        keyconfig = context.window_manager.keyconfigs.active
        if keyconfig is None or keyconfig.name != "Blender":
            raise RuntimeError("Menu-control proof requires the Blender keymap")
        ui_scale = float(context.preferences.system.ui_scale)
        if not math.isclose(ui_scale, 2.0, rel_tol=0.0, abs_tol=1e-6):
            raise RuntimeError("Menu-control proof requires UI scale 2")
        if sorted(bpy.data.objects.keys()) != ["Camera", "Cube", "Light"]:
            raise RuntimeError("Menu-control proof requires the three-object factory scene")
        active = context.view_layer.objects.active
        if active is None or active.name != "Cube" or active.type != "MESH":
            raise RuntimeError("Menu-control proof requires the active factory Cube")
        if tuple(context.selected_objects) != (active,) or len(active.modifiers) != 0:
            raise RuntimeError("Menu-control proof requires only the unmodified Cube selected")
        if (len(active.data.vertices), len(active.data.edges), len(active.data.polygons)) != (8, 12, 6):
            raise RuntimeError("Menu-control proof requires factory Cube topology")
        if tuple(active.location) != (0.0, 0.0, 0.0) or tuple(active.rotation_euler) != (0.0, 0.0, 0.0) or tuple(active.scale) != (1.0, 1.0, 1.0):
            raise RuntimeError("Menu-control proof requires the factory Cube transform")
        if tuple(context.scene.cursor.location) != (0.0, 0.0, 0.0):
            raise RuntimeError("Menu-control proof requires the origin cursor")
        if context.scene.transform_orientation_slots[0].type != "GLOBAL":
            raise RuntimeError("Menu-control proof requires global transform orientation")

        view_areas = tuple(item for item in window.screen.areas if item.type == "VIEW_3D")
        outliners = tuple(item for item in window.screen.areas if item.type == "OUTLINER")
        properties = tuple(item for item in window.screen.areas if item.type == "PROPERTIES")
        if not (len(view_areas) == len(outliners) == len(properties) == 1):
            raise RuntimeError("Menu-control proof requires the factory Layout area arrangement")
        area = view_areas[0]
        window_regions = tuple(item for item in area.regions if item.type == "WINDOW")
        headers = tuple(item for item in area.regions if item.type == "HEADER")
        if len(window_regions) != 1 or len(headers) != 1 or area.spaces.active.type != "VIEW_3D":
            raise RuntimeError("Menu-control proof requires the factory VIEW_3D layout")
        properties_area = properties[0]
        if properties_area.spaces.active.context != "OBJECT":
            raise RuntimeError("Menu-control proof requires Object Properties context")

        header = headers[0]
        add_point = (area.x + round(262 * ui_scale), header.y + header.height // 2)
        mesh_point = (add_point[0] + round(60 * ui_scale), header.y - round(8 * ui_scale))
        sphere_point = (add_point[0] + round(215 * ui_scale), header.y - round(69 * ui_scale))
        for point in (add_point, mesh_point, sphere_point):
            if not (
                area.x <= point[0] < area.x + area.width
                and area.y <= point[1] < area.y + area.height
            ):
                raise RuntimeError(
                    "Menu-control proof coordinate is outside the VIEW_3D area: "
                    f"point={point}, "
                    f"area={(area.x, area.y, area.width, area.height)}, "
                    f"header={(header.x, header.y, header.width, header.height)}"
                )

        self._window = window
        self._area = area
        self._region = window_regions[0]
        self._space = area.spaces.active
        self._header = header
        self._ui_scale = ui_scale
        self._add_point = add_point
        self._mesh_point = mesh_point
        self._uv_sphere_point = sphere_point
        self._baseline_snapshot = _scene_snapshot()
        self._baseline_fingerprint = compute_scene_fingerprint_sha256(self._baseline_snapshot)
        self._baseline_cube_pointer = active.as_pointer()
        self._baseline_cube_mesh_pointer = active.data.as_pointer()
        self._baseline_cube_mesh_sha256 = _mesh_sha256(active.data)
        self._record_operation(0)

    def _simulate(
        self,
        event_type: str,
        value: str,
        point: tuple[int, int],
        *,
        unicode: str = "",
        ctrl: bool = False,
        shift: bool = False,
        mutating: bool = False,
    ) -> None:
        event: dict[str, object] = {
            "type": event_type,
            "value": value,
            "x": point[0],
            "y": point[1],
            "ctrl": ctrl,
            "shift": shift,
        }
        if unicode:
            event["unicode"] = unicode
        if mutating:
            self._mutation_started = True
        self._window.event_simulate(**event)
        self._event_evidence.append(
            {
                "index": len(self._event_evidence) + 1,
                "step": self._current_label,
                **event,
                "unicode": unicode,
            }
        )

    def _append_event(self, label: str, event_type: str, point: Callable[[], tuple[int, int]], *, value: str = "PRESS", delay: float = 0.04, unicode: str = "", ctrl: bool = False, shift: bool = False, mutating: bool = False) -> None:
        self._native_input_step_count += 1
        self._steps.append(_Step(label, delay, lambda: self._simulate(event_type, value, point(), unicode=unicode, ctrl=ctrl, shift=shift, mutating=mutating)))

    def _fixed_point(self, point: tuple[int, int]) -> Callable[[], tuple[int, int]]:
        return lambda: point

    def _transform_point(self, group: str, component: int) -> tuple[int, int]:
        regions = tuple(item for item in self._area.regions if item.type == "UI")
        if len(regions) != 1 or regions[0].width < round(250 * self._ui_scale):
            raise RuntimeError("Menu-control proof requires the expected Sidebar width")
        base_offset = 91 if group == "location" else 276
        return (
            regions[0].x + round(138 * self._ui_scale),
            self._header.y - round((base_offset + component * 20) * self._ui_scale),
        )

    def _name_point(self) -> tuple[int, int]:
        properties = next(item for item in self._window.screen.areas if item.type == "PROPERTIES")
        windows = tuple(item for item in properties.regions if item.type == "WINDOW")
        headers = tuple(item for item in properties.regions if item.type == "HEADER")
        if len(windows) != 1 or len(headers) != 1 or windows[0].width < round(180 * self._ui_scale):
            raise RuntimeError("Menu-control proof requires the expected Object Properties width")
        return (windows[0].x + round(115 * self._ui_scale), headers[0].y - round(53 * self._ui_scale))

    def _viewport_center(self) -> tuple[int, int]:
        return (self._area.x + self._area.width // 2, self._area.y + self._area.height // 2)

    def _append_numeric_edit(self, label: str, point: Callable[[], tuple[int, int]], text: str, *, first_mutation: bool = False) -> None:
        self._append_event(label + ":hover", "MOUSEMOVE", point, value="NOTHING")
        for index in (1, 2):
            self._append_event(f"{label}:click-{index}:press", "LEFTMOUSE", point, delay=0.03)
            self._append_event(f"{label}:click-{index}:release", "LEFTMOUSE", point, value="RELEASE", delay=0.12 if index == 2 else 0.04)
        self._append_event(label + ":select-all", "A", point, ctrl=True, delay=0.08)
        key_names = {"-": "MINUS", ".": "PERIOD", **{str(i): ("ZERO" if i == 0 else ("ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE")[i - 1]) for i in range(10)}}
        for index, character in enumerate(text):
            self._append_event(f"{label}:text-{index}:{character}", key_names[character], point, unicode=character, mutating=first_mutation and index == 0)
        self._append_event(label + ":confirm:press", "RET", point)
        self._append_event(label + ":confirm:release", "RET", point, value="RELEASE", delay=0.2)

    def _append_text_edit(self, label: str, point: Callable[[], tuple[int, int]], text: str) -> None:
        self._append_event(label + ":hover", "MOUSEMOVE", point, value="NOTHING")
        self._append_event(label + ":click:press", "LEFTMOUSE", point, delay=0.03)
        self._append_event(label + ":click:release", "LEFTMOUSE", point, value="RELEASE", delay=0.12)
        self._append_event(label + ":select-all", "A", point, ctrl=True, delay=0.08)
        for index, character in enumerate(text):
            self._append_event(f"{label}:text-{index}:{character}", {".": "PERIOD", "-": "MINUS"}.get(character, character.upper()), point, unicode=character)
        self._append_event(label + ":confirm:press", "RET", point)
        self._append_event(label + ":confirm:release", "RET", point, value="RELEASE", delay=0.4)

    def _record_operation(self, index: int) -> None:
        if len(self._operation_summaries) != index:
            raise RuntimeError("Menu-control operation summaries must be canonical and ordered")
        paths = (
            ["Layout"], ["Layout", "Add"], ["Layout", "Add", "Mesh"],
            ["Layout", "Add", "Mesh", "UV Sphere"],
            ["Sidebar", "Item", "Transform", "Location"],
            ["Sidebar", "Item", "Transform", "Scale"],
            ["Properties", "Object", "Name"],
        )
        parameters = ({}, {}, {}, {"radius": 1.0}, {"value": list(EXPECTED_ARGUMENTS["location"])}, {"value": [EXPECTED_ARGUMENTS["radius"]] * 3}, {"value": EXPECTED_ARGUMENTS["objectName"]})
        self._operation_summaries.append({
            "operationId": OPERATION_IDS[index],
            "status": "precondition_verified" if index == 0 else "control_executed",
            "path": paths[index],
            "parameters": parameters[index],
        })

    def _capture_source_operator(self) -> None:
        active = bpy.context.view_layer.objects.active
        if active is None or active.name != "Sphere" or active.type != "MESH":
            raise RuntimeError("UV Sphere menu action did not create the expected Mesh")
        operators = [item for item in bpy.context.window_manager.operators if item.bl_idname == "MESH_OT_primitive_uv_sphere_add"]
        if not operators:
            raise RuntimeError("UV Sphere source operator was not observable")
        properties = operators[-1].properties
        observation = {"id": operators[-1].bl_idname, "segments": int(properties.segments), "ringCount": int(properties.ring_count), "radius": float(properties.radius), "location": list(properties.location)}
        if observation != {"id": "MESH_OT_primitive_uv_sphere_add", "segments": 32, "ringCount": 16, "radius": 1.0, "location": [0.0, 0.0, 0.0]}:
            raise RuntimeError("UV Sphere source operator parameters were unexpected")
        self._source_operator = observation
        for index in (1, 2, 3):
            self._record_operation(index)

    def _observe_transform(self, operation_index: int) -> None:
        active = bpy.context.view_layer.objects.active
        expected = list(EXPECTED_ARGUMENTS["location"]) if operation_index == 4 else [EXPECTED_ARGUMENTS["radius"]] * 3
        actual = list(active.location if operation_index == 4 else active.scale) if active is not None else None
        if actual != expected:
            raise RuntimeError(f"{OPERATION_IDS[operation_index]} did not reach its observable value")
        self._record_operation(operation_index)

    def _capture_strong_observation(self) -> None:
        active = bpy.context.view_layer.objects.active
        if active is None or active.name != EXPECTED_ARGUMENTS["objectName"] or active.type != "MESH":
            raise RuntimeError("Menu-control proof strong observation rejected the target")
        if list(active.location) != list(EXPECTED_ARGUMENTS["location"]) or list(active.scale) != [EXPECTED_ARGUMENTS["radius"]] * 3:
            raise RuntimeError("Menu-control proof strong observation rejected the transform")
        topology = {"vertices": len(active.data.vertices), "edges": len(active.data.edges), "polygons": len(active.data.polygons)}
        if topology != EXPECTED_TOPOLOGY or len(active.modifiers) != 0 or self._source_operator is None:
            raise RuntimeError("Menu-control proof strong observation rejected the mesh")
        self._record_operation(6)
        self._final_snapshot = _scene_snapshot()
        self._record_history("final")

    def _record_history(self, label: str) -> None:
        proof_object = bpy.data.objects.get(EXPECTED_ARGUMENTS["objectName"]) or bpy.data.objects.get("Sphere")
        scene_snapshot = _scene_snapshot()
        self._history_snapshots.append({
            "label": label,
            "objectNames": sorted(bpy.data.objects.keys()),
            "activeObject": None if bpy.context.view_layer.objects.active is None else bpy.context.view_layer.objects.active.name,
            "proofObjectName": None if proof_object is None else proof_object.name,
            "proofObjectLocation": None if proof_object is None else list(proof_object.location),
            "proofObjectScale": None if proof_object is None else list(proof_object.scale),
            "proofMeshTopology": None if proof_object is None else {"vertices": len(proof_object.data.vertices), "edges": len(proof_object.data.edges), "polygons": len(proof_object.data.polygons)},
            "sceneSnapshot": scene_snapshot,
            "sceneFingerprintSha256": compute_scene_fingerprint_sha256(scene_snapshot),
        })

    def _build_fixed_steps(self) -> None:
        add = self._fixed_point(self._add_point)
        add_inside = self._fixed_point((self._add_point[0] + 1, self._add_point[1]))
        mesh = self._fixed_point(self._mesh_point)
        mesh_inside = self._fixed_point((self._mesh_point[0] + 1, self._mesh_point[1]))
        sphere = self._fixed_point(self._uv_sphere_point)
        sphere_inside = self._fixed_point((self._uv_sphere_point[0] + 1, self._uv_sphere_point[1]))
        self._append_event("dismiss splash press", "ESC", add)
        self._append_event("dismiss splash release", "ESC", add, value="RELEASE", delay=0.15)
        self._append_event("hover add", "MOUSEMOVE", add, value="NOTHING", delay=0.15)
        self._append_event("press add", "LEFTMOUSE", add)
        self._append_event("move within add", "MOUSEMOVE", add_inside, value="NOTHING")
        self._append_event("release add", "LEFTMOUSE", add_inside, value="RELEASE", delay=0.3)
        self._append_event("hover first menu row", "MOUSEMOVE", mesh, value="NOTHING", delay=0.2)
        self._append_event("settle mesh hover", "MOUSEMOVE", mesh_inside, value="NOTHING", delay=0.2)
        self._append_event("open mesh submenu press", "RIGHT_ARROW", add, delay=0.5)
        self._append_event("hover uv sphere", "MOUSEMOVE", sphere, value="NOTHING", delay=0.15)
        self._append_event("press uv sphere", "LEFTMOUSE", sphere)
        self._append_event("move within uv sphere", "MOUSEMOVE", sphere_inside, value="NOTHING")
        self._append_event("release uv sphere", "LEFTMOUSE", sphere_inside, value="RELEASE", delay=0.8, mutating=True)
        self._steps.append(_Step("observe sphere/menu operations", 0.1, self._capture_source_operator))
        center = self._viewport_center
        self._append_event("open sidebar press", "N", center)
        self._append_event("open sidebar release", "N", center, value="RELEASE", delay=0.6)
        for component, text in enumerate(("1.25", "-2", "0.75")):
            self._append_numeric_edit(f"set location {component}", lambda component=component: self._transform_point("location", component), text)
        self._steps.append(_Step("observe location", 0.1, lambda: self._observe_transform(4)))
        for component in range(3):
            self._append_numeric_edit(f"set scale {component}", lambda component=component: self._transform_point("scale", component), "1.5")
        self._steps.append(_Step("observe scale", 0.1, lambda: self._observe_transform(5)))
        self._append_text_edit("rename object", self._name_point, EXPECTED_ARGUMENTS["objectName"])
        self._steps.append(_Step("capture strong observation after operation 7", 0.1, self._capture_strong_observation))
        self._append_event("anchor viewport for history", "MOUSEMOVE", center, value="NOTHING", delay=0.15)
        for index in range(1, HISTORY_DEPTH + 1):
            self._append_event(f"native undo {index}:press", "Z", center, ctrl=True)
            self._append_event(f"native undo {index}:release", "Z", center, value="RELEASE", ctrl=True, delay=0.6)
            self._steps.append(_Step(f"record undo {index}", 0.05, lambda index=index: self._record_history(f"undo-{index}")))
        for index in range(1, HISTORY_DEPTH + 1):
            self._append_event(f"native redo {index}:press", "Z", center, ctrl=True, shift=True)
            self._append_event(f"native redo {index}:release", "Z", center, value="RELEASE", ctrl=True, shift=True, delay=0.6)
            self._steps.append(_Step(f"record redo {index}", 0.05, lambda index=index: self._record_history(f"redo-{index}")))
        self._steps.append(_Step("validate exact snapshots and finish", 0.1, self._finish))
        if self._native_input_step_count != EVENT_SIMULATE_COUNT:
            raise RuntimeError("Menu-control proof fixed event sequence drifted")

    def _validate_history(self) -> None:
        expected = [
            ("final", EXPECTED_ARGUMENTS["objectName"], list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.5, 1.5]),
            ("undo-1", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.5, 1.5]),
            ("undo-2", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.5, 1.0]),
            ("undo-3", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.0, 1.0]),
            ("undo-4", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.0, 1.0, 1.0]),
            ("undo-5", "Sphere", [1.25, -2.0, 0.0], [1.0, 1.0, 1.0]),
            ("undo-6", "Sphere", [1.25, 0.0, 0.0], [1.0, 1.0, 1.0]),
            ("undo-7", "Sphere", [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]),
            ("undo-8", None, None, None),
            ("redo-1", "Sphere", [0.0, 0.0, 0.0], [1.0, 1.0, 1.0]),
            ("redo-2", "Sphere", [1.25, 0.0, 0.0], [1.0, 1.0, 1.0]),
            ("redo-3", "Sphere", [1.25, -2.0, 0.0], [1.0, 1.0, 1.0]),
            ("redo-4", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.0, 1.0, 1.0]),
            ("redo-5", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.0, 1.0]),
            ("redo-6", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.5, 1.0]),
            ("redo-7", "Sphere", list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.5, 1.5]),
            ("redo-8", EXPECTED_ARGUMENTS["objectName"], list(EXPECTED_ARGUMENTS["location"]), [1.5, 1.5, 1.5]),
        ]
        if len(self._history_snapshots) != len(expected):
            raise RuntimeError("Menu-control proof history snapshot count is invalid")
        for snapshot, (label, name, location, scale) in zip(self._history_snapshots, expected, strict=True):
            if snapshot["label"] != label or snapshot["proofObjectName"] != name or snapshot["proofObjectLocation"] != location or snapshot["proofObjectScale"] != scale or snapshot["proofMeshTopology"] != (None if name is None else EXPECTED_TOPOLOGY):
                raise RuntimeError(f"Menu-control proof history stage {label} is invalid")
        baseline = self._history_snapshots[HISTORY_DEPTH]
        reapplied = self._history_snapshots[-1]
        if baseline["activeObject"] != "Cube" or baseline["objectNames"] != ["Camera", "Cube", "Light"] or baseline["sceneFingerprintSha256"] != self._baseline_fingerprint:
            raise RuntimeError("Menu-control proof native Undo did not restore the exact baseline")
        if self._final_snapshot is None or reapplied["sceneFingerprintSha256"] != compute_scene_fingerprint_sha256(self._final_snapshot):
            raise RuntimeError("Menu-control proof native Redo did not restore the exact final state")

    def _finish(self) -> None:
        self._validate_history()
        if len(self._event_evidence) != EVENT_SIMULATE_COUNT:
            raise RuntimeError("Menu-control proof event evidence count is invalid")
        active = bpy.context.view_layer.objects.active
        cube = bpy.data.objects["Cube"]
        if active is None or active.name != EXPECTED_ARGUMENTS["objectName"] or cube.as_pointer() != self._baseline_cube_pointer or cube.data.as_pointer() != self._baseline_cube_mesh_pointer or _mesh_sha256(cube.data) != self._baseline_cube_mesh_sha256 or len(bpy.data.meshes) != 2:
            raise RuntimeError("Menu-control proof final identity observation failed")
        final_fingerprint = compute_scene_fingerprint_sha256(_scene_snapshot())
        if self._final_snapshot is None or final_fingerprint != compute_scene_fingerprint_sha256(self._final_snapshot):
            raise RuntimeError("Menu-control proof final scene snapshot changed")
        payload = {
            "ok": True,
            "proofFormatVersion": "1.0.0",
            "executorId": EXECUTOR_ID,
            "targetProfile": TARGET_PROFILE,
            "executionBoundary": "blender_window_event_simulate",
            "transport": "event_simulate",
            **execution_evidence_claims(),
            "managedActionExecuted": False,
            "managedReceiptCreated": False,
            "authorization": "accepted_replay_next_step",
            "hostVersion": ".".join(str(value) for value in bpy.app.version),
            "uiScale": self._ui_scale,
            "operationIds": list(OPERATION_IDS),
            "acceptedAction": {"name": "blender.mesh.create_uv_sphere", "arguments": expected_arguments_payload()},
            "operationSummaries": list(self._operation_summaries),
            "sourceOperator": self._source_operator,
            "finalState": {
                "objectName": active.name,
                "objectType": active.type,
                "location": list(active.location),
                "scale": list(active.scale),
                "meshTopology": {
                    "vertices": len(active.data.vertices),
                    "edges": len(active.data.edges),
                    "polygons": len(active.data.polygons),
                },
                "meshSha256": _mesh_sha256(active.data),
            },
            "eventSimulateCount": len(self._event_evidence),
            "eventSequenceSha256": hashlib.sha256(json.dumps(self._event_evidence, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest(),
            "nativeUndoDepth": HISTORY_DEPTH,
            "strongObservationKind": "uv_sphere_menu_controls_ready",
            "nativeUndoCheckpointRequired": True,
            "historySnapshots": list(self._history_snapshots),
            "baselineSceneSnapshot": self._baseline_snapshot,
            "finalSceneSnapshot": self._final_snapshot,
            "baselineSceneFingerprintSha256": self._baseline_fingerprint,
            "finalSceneFingerprintSha256": final_fingerprint,
            "restoredSceneFingerprintSha256": self._history_snapshots[HISTORY_DEPTH]["sceneFingerprintSha256"],
            "reappliedSceneFingerprintSha256": self._history_snapshots[-1]["sceneFingerprintSha256"],
            "menuControlExecutionVerified": True,
            "strongCurrentStateVerified": True,
            "nativeUndoCheckpointVerified": True,
        }
        self._terminal = True
        self._timer_registered = False
        callback = self._on_complete
        if callback is not None:
            callback(payload)

    def _advance(self) -> float | None:
        if self._terminal:
            return None
        try:
            if self._continuation_guard is None or self._continuation_guard() is not True:
                raise RuntimeError("Menu-control proof authorization was revoked")
            if not self._steps:
                raise RuntimeError("Menu-control proof exhausted steps without completion")
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
        current_snapshot = None
        current_fingerprint = None
        if self._mutation_started:
            try:
                current_snapshot = _scene_snapshot()
                current_fingerprint = compute_scene_fingerprint_sha256(current_snapshot)
            except Exception:
                pass
        restored = bool(
            self._mutation_started
            and current_fingerprint is not None
            and current_fingerprint == self._baseline_fingerprint
        )
        uncertain = self._mutation_started and not restored
        current_mutation_stages: list[str] = []
        minimum_completed_stage_count = MINIMUM_MUTATION_STAGE_COUNT_BY_OPERATION_COUNT[
            len(self._operation_summaries)
        ]
        completed_mutation_stages = list(
            MUTATION_STAGES[:minimum_completed_stage_count]
        )
        native_history_cursor: int | None = 0 if not self._mutation_started else None
        evidence_derivation_error: str | None = None
        if self._mutation_started:
            if current_snapshot is None:
                evidence_derivation_error = (
                    "Menu-control failure current Scene could not be observed"
                )
            else:
                try:
                    current_mutation_stages = _completed_mutation_stages(current_snapshot)
                    native_history_cursor = len(current_mutation_stages)
                    completed_stage_count = max(
                        minimum_completed_stage_count,
                        len(current_mutation_stages),
                    )
                    if self._final_snapshot is not None:
                        completed_stage_count = len(MUTATION_STAGES)
                    completed_mutation_stages = list(
                        MUTATION_STAGES[:completed_stage_count]
                    )
                except (KeyError, TypeError, ValueError) as derivation_error:
                    evidence_derivation_error = str(derivation_error)
        if self._mutation_started and restored:
            failure_status = "failed_restored"
        elif self._mutation_started and self._final_snapshot is not None:
            failure_status = "recovery_required"
        elif self._mutation_started:
            failure_status = "failed_checkpointed"
        elif self._preflight_completed:
            failure_status = "failed_no_mutation"
        else:
            failure_status = "preflight_rejected"
        payload = {
            "ok": False,
            "executorId": EXECUTOR_ID,
            "error": str(error),
            "failedStep": self._current_label,
            "mutationStarted": self._mutation_started,
            "lastCompletedOperation": self._operation_summaries[-1]["operationId"] if self._operation_summaries else None,
            "operationSummaries": list(self._operation_summaries),
            "completedMutationStages": completed_mutation_stages,
            "nativeHistoryCursor": native_history_cursor,
            "requiresUndoRecovery": uncertain,
            "recoveryRequirement": "native_undo_checkpoint_required" if uncertain else None,
            "failureStatus": failure_status,
            "baselineSceneSnapshot": self._baseline_snapshot,
            "baselineSceneFingerprintSha256": self._baseline_fingerprint,
            "currentSceneSnapshot": current_snapshot,
            "currentSceneFingerprintSha256": current_fingerprint,
        }
        if evidence_derivation_error is not None:
            payload["failureStatus"] = "recovery_required"
            payload["evidenceDerivationError"] = evidence_derivation_error
        callback = self._on_failure
        if callback is not None:
            callback(payload)


# Compatibility-friendly spelling while keeping one implementation.
UVSphereMenuControlsProof = UVSphereMenuControlProof
