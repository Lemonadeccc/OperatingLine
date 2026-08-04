"""Shared visual tokens for Blender guidance presentation."""

from .application import GuidanceState

RGBA = tuple[float, float, float, float]

SURFACE: RGBA = (0.063, 0.094, 0.125, 0.94)
HALO: RGBA = (0.027, 0.063, 0.094, 0.96)
TEXT: RGBA = (0.961, 0.969, 0.980, 1.0)
MUTED_TEXT: RGBA = (0.68, 0.72, 0.78, 1.0)

STATE_COLORS: dict[GuidanceState, RGBA] = {
    GuidanceState.COMPLETED: (0.184, 0.608, 1.0, 1.0),
    GuidanceState.BACK: (1.0, 0.361, 0.424, 1.0),
    GuidanceState.NEXT: (0.176, 0.847, 0.506, 1.0),
    GuidanceState.LOCKED: (0.482, 0.518, 0.580, 0.62),
}

STATE_ICONS: dict[GuidanceState, str] = {
    GuidanceState.COMPLETED: "COLLECTION_COLOR_05",
    GuidanceState.BACK: "COLLECTION_COLOR_01",
    GuidanceState.NEXT: "COLLECTION_COLOR_04",
    GuidanceState.LOCKED: "LOCKED",
}

STATE_SYMBOLS: dict[GuidanceState, str] = {
    GuidanceState.COMPLETED: "OK",
    GuidanceState.BACK: "BACK",
    GuidanceState.NEXT: "NEXT",
    GuidanceState.LOCKED: "--",
}


def color_for(state: GuidanceState) -> RGBA:
    """Return the canonical RGBA color for a stable guidance state."""

    return STATE_COLORS[state]


__all__ = (
    "HALO",
    "MUTED_TEXT",
    "RGBA",
    "STATE_COLORS",
    "STATE_ICONS",
    "STATE_SYMBOLS",
    "SURFACE",
    "TEXT",
    "color_for",
)
