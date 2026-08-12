"""Version constants shared by Blender protocol producers and consumers."""

PROTOCOL_VERSION = "1.3.0"
SUPPORTED_PROTOCOL_VERSIONS = frozenset(
    {"1.0.0", "1.1.0", "1.2.0", PROTOCOL_VERSION}
)

__all__ = ("PROTOCOL_VERSION", "SUPPORTED_PROTOCOL_VERSIONS")
