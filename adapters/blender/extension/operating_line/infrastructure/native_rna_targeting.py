"""Safe access to Blender's optional native RNA button targeting API.

Blender 5.3 added ``WindowManager.try_activate_rna_button``.  This module
keeps that version-specific UI capability behind a small, pure-Python
boundary so older Blender hosts and test doubles can fall back without
raising during UI drawing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
from time import monotonic
from typing import Any, Literal


NativeRnaTargetStatus = Literal[
    "exact_native",
    "unsupported",
    "not_visible",
    "error",
]

NATIVE_RNA_BADGE_TTL_SECONDS = 1.5


@dataclass(frozen=True, slots=True)
class NativeRnaTargetResult:
    """Result of attempting to highlight one visible native RNA control."""

    status: NativeRnaTargetStatus
    window_xy: tuple[int, int] | None = None
    detail: str | None = None

    @property
    def is_exact(self) -> bool:
        """Whether Blender resolved and highlighted the native control."""

        return self.status == "exact_native"


@dataclass(frozen=True, slots=True)
class NativeRnaBadge:
    """Short-lived exact target bound to one cursor and live UI layout."""

    step_id: str
    operation_id: str
    ordinal: int
    cursor_token: str
    component_index: int
    region_identity: int
    window_xy: tuple[int, int]
    expires_at_monotonic: float
    layout_signature: tuple[Any, ...]
    target_node: Any = field(repr=False, compare=False)
    target_data: Any = field(repr=False, compare=False)


_native_rna_badge: NativeRnaBadge | None = None


def _region_identity(region: Any) -> int:
    pointer = getattr(region, "as_pointer", None)
    if callable(pointer):
        try:
            value = pointer()
            if isinstance(value, int) and not isinstance(value, bool) and value > 0:
                return value
        except Exception:
            pass
    return id(region)


def _rounded_pair(value: Any) -> tuple[float, float] | None:
    try:
        pair = (float(value[0]), float(value[1]))
    except (AttributeError, IndexError, KeyError, TypeError, ValueError):
        return None
    if not all(math.isfinite(component) for component in pair):
        return None
    return (round(pair[0], 6), round(pair[1], 6))


def _rna_identity(value: Any) -> int:
    pointer = getattr(value, "as_pointer", None)
    if callable(pointer):
        try:
            result = pointer()
            if isinstance(result, int) and not isinstance(result, bool) and result > 0:
                return result
        except Exception:
            pass
    return id(value)


def _socket_layout_signature(socket: Any) -> tuple[Any, ...]:
    return (
        _rna_identity(socket),
        getattr(socket, "identifier", None),
        getattr(socket, "name", None),
        bool(getattr(socket, "hide", False)),
        bool(getattr(socket, "hide_value", False)),
        bool(getattr(socket, "enabled", True)),
        bool(getattr(socket, "is_linked", False)),
    )


def _native_rna_layout_signature(
    region: Any,
    target_node: Any,
    target_data: Any,
) -> tuple[Any, ...] | None:
    """Fingerprint public layout inputs that can move or hide an RNA widget."""

    try:
        region_rect = (
            int(region.x),
            int(region.y),
            int(region.width),
            int(region.height),
        )
        if region_rect[2] <= 0 or region_rect[3] <= 0:
            return None
        view2d = getattr(region, "view2d", None)
        region_to_view = getattr(view2d, "region_to_view", None)
        view_signature = None
        if callable(region_to_view):
            view_signature = (
                _rounded_pair(region_to_view(0, 0)),
                _rounded_pair(region_to_view(region_rect[2], region_rect[3])),
            )
            if None in view_signature:
                return None
        node_location_value = getattr(target_node, "location_absolute", None)
        if node_location_value is None:
            node_location_value = getattr(target_node, "location", None)
        node_location = _rounded_pair(node_location_value)
        node_dimensions = _rounded_pair(getattr(target_node, "dimensions", None))
        if node_location is None or node_dimensions is None:
            return None
        inputs = tuple(
            _socket_layout_signature(socket)
            for socket in getattr(target_node, "inputs", ())
        )
        target_signature = _socket_layout_signature(target_data)
        if target_signature not in inputs:
            return None
        return (
            region_rect,
            view_signature,
            _rna_identity(target_node),
            getattr(target_node, "bl_idname", None),
            getattr(target_node, "name", None),
            node_location,
            node_dimensions,
            bool(getattr(target_node, "hide", False)),
            inputs,
            target_signature,
        )
    except Exception:
        return None


def remember_native_rna_badge(
    result: NativeRnaTargetResult,
    *,
    region: Any,
    step_id: str,
    operation_id: str,
    ordinal: int,
    cursor_token: str,
    component_index: int,
    target_node: Any,
    target_data: Any,
) -> bool:
    """Remember one exact result only while its public UI layout stays unchanged."""

    global _native_rna_badge
    layout_signature = _native_rna_layout_signature(region, target_node, target_data)
    if (
        not result.is_exact
        or result.window_xy is None
        or not isinstance(step_id, str)
        or not step_id
        or not isinstance(operation_id, str)
        or not operation_id
        or isinstance(ordinal, bool)
        or not isinstance(ordinal, int)
        or ordinal < 1
        or not isinstance(cursor_token, str)
        or not cursor_token
        or isinstance(component_index, bool)
        or not isinstance(component_index, int)
        or component_index not in {0, 1, 2}
        or layout_signature is None
    ):
        _native_rna_badge = None
        return False
    _native_rna_badge = NativeRnaBadge(
        step_id=step_id,
        operation_id=operation_id,
        ordinal=ordinal,
        cursor_token=cursor_token,
        component_index=component_index,
        region_identity=_region_identity(region),
        window_xy=result.window_xy,
        expires_at_monotonic=monotonic() + NATIVE_RNA_BADGE_TTL_SECONDS,
        layout_signature=layout_signature,
        target_node=target_node,
        target_data=target_data,
    )
    return True


def clear_native_rna_badge() -> None:
    global _native_rna_badge
    _native_rna_badge = None


def native_rna_badge_region_point(
    region: Any,
    snapshot: Any,
) -> tuple[float, float] | None:
    """Project the exact window-space center into its bound WINDOW region."""

    global _native_rna_badge
    badge = _native_rna_badge
    focused = getattr(snapshot, "focused_operation", None)
    if badge is None:
        return None
    if monotonic() > badge.expires_at_monotonic:
        _native_rna_badge = None
        return None
    if _region_identity(region) != badge.region_identity:
        return None
    if (
        getattr(snapshot, "step_id", None) != badge.step_id
        or getattr(snapshot, "cursor_token", None) != badge.cursor_token
        or getattr(snapshot, "focused_ordinal", None) != badge.ordinal
        or getattr(focused, "operation_id", None) != badge.operation_id
    ):
        _native_rna_badge = None
        return None
    if (
        _native_rna_layout_signature(region, badge.target_node, badge.target_data)
        != badge.layout_signature
    ):
        _native_rna_badge = None
        return None
    try:
        x = float(badge.window_xy[0] - region.x)
        y = float(badge.window_xy[1] - region.y)
        width = float(region.width)
        height = float(region.height)
    except (AttributeError, TypeError, ValueError):
        _native_rna_badge = None
        return None
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x >= width or y >= height:
        _native_rna_badge = None
        return None
    return (x, y)


def try_activate_native_rna_button(
    window_manager: Any,
    *,
    region: Any,
    data: Any,
    property: str,
    index: int = 0,
) -> NativeRnaTargetResult:
    """Highlight a visible RNA button without leaking Blender host errors.

    The returned coordinates are in Blender window coordinates.  An empty
    result from Blender means that the property exists but no matching button
    is currently visible in the requested region.
    """

    try:
        if not hasattr(window_manager, "try_activate_rna_button"):
            return NativeRnaTargetResult(
                status="unsupported",
                detail="Blender host does not expose native RNA button targeting",
            )
        activate = window_manager.try_activate_rna_button
    except Exception as exc:  # Blender RNA descriptors may fail during shutdown.
        return NativeRnaTargetResult(status="error", detail=_error_detail(exc))

    if not callable(activate):
        return NativeRnaTargetResult(
            status="unsupported",
            detail="Native RNA button targeting is not callable",
        )

    try:
        xy: Any = activate(
            region,
            data,
            property,
            "HIGHLIGHT",
            warp_cursor_at_button=False,
            index=index,
        )
    except Exception as exc:  # Never let a context-sensitive Blender error escape.
        return NativeRnaTargetResult(status="error", detail=_error_detail(exc))

    if xy is None:
        return NativeRnaTargetResult(status="not_visible")

    try:
        coordinate_count = len(xy)
    except Exception as exc:
        return NativeRnaTargetResult(status="error", detail=_error_detail(exc))

    if coordinate_count == 0:
        return NativeRnaTargetResult(status="not_visible")
    if coordinate_count != 2:
        return NativeRnaTargetResult(
            status="error",
            detail="Native RNA button targeting returned invalid coordinates",
        )
    try:
        coordinates = (xy[0], xy[1])
    except Exception as exc:
        return NativeRnaTargetResult(status="error", detail=_error_detail(exc))
    if any(
        isinstance(value, bool) or not isinstance(value, int)
        for value in coordinates
    ):
        return NativeRnaTargetResult(
            status="error",
            detail="Native RNA button targeting returned invalid coordinates",
        )

    return NativeRnaTargetResult(
        status="exact_native",
        window_xy=(coordinates[0], coordinates[1]),
    )


def _error_detail(exc: Exception) -> str:
    message = str(exc).strip()
    return type(exc).__name__ if not message else f"{type(exc).__name__}: {message}"


__all__ = (
    "clear_native_rna_badge",
    "native_rna_badge_region_point",
    "NativeRnaBadge",
    "NativeRnaTargetResult",
    "NativeRnaTargetStatus",
    "remember_native_rna_badge",
    "try_activate_native_rna_button",
)
