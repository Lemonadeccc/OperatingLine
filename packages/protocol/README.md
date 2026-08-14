# `@operatingline/protocol`

This package owns the host-neutral schemas and TypeScript contracts shared by OperatingLine adapters,
the Orchestrator, and clients.

## Procedure materialization versions

Blender InteractionCatalog `1.20.0` binds exactly to ActionCatalog `1.12.0` and freezes `1.19.0` for
exact replay. Plane keeps its exact six-step ordered menu and adds a candidate-only six-operation shortcut:
`Shift+A → Mesh → Plane` with Blender's default size 2 at the origin, GLOBAL `G X/Y/Z` moves, uniform
`S` using the existing closed `divide_by_two` transform (`size / 2`), and `F2` using `objectName`. The
declaration requires the exact Layout, 3D View, Object Mode, Blender keymap, origin cursor, and
GLOBAL-orientation preconditions. It omits internal `resourceId`; action-level MCP remains unavailable.

Plane shortcut materialization uses Result `1.2.0` and remains `candidate`/`structural_only`. Blender
4.5.3/5.1.1 operator/transform probes are not key events or full UI replay: they preserve the default
unbaked Plane mesh and object `scale = size / 2`, unlike the managed executor's baked mesh and `scale = 1`,
and do not establish managed collection, resource-tag, receipt/idempotency, or compensation equivalence.
Frozen `1.19.0` preserves Plane shortcut unavailability. Cube and UV Sphere shortcuts remain available;
Icosphere, Torus, Cone, and Cylinder shortcuts remain unavailable.
