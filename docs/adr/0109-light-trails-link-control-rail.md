# ADR 0109: Light Trails link and scalar-control rail

- Status: Accepted
- Date: 2026-08-24

The catalog and control-rail decision remains current. Its original execution
boundary is extended by [ADR 0110](0110-light-trails-local-operation-execution.md),
which adds a local Blender 54-step executor while retaining action-level-only MCP.

## Context

InteractionCatalog 1.51 named every node in the bounded no-bake Light Trails graph and projected twelve accepted values beside their consuming nodes. That 35-operation rail omitted the graph's nineteen links, and the values were only container-capable references. A learner could see which nodes existed but not the complete wiring order, while the Blender panel could not stage a revision directly from those values.

Blender 4.5 and 5.1 also expose one cross-version naming difference: the Noise Texture output is displayed as `Fac` in 4.5 and `Factor` in 5.1, while its RNA socket identifier remains `Fac`. Group interface socket identifiers are generated (`Socket_1`), so their stable teaching identity remains the authored interface name `Geometry`.

## Decision

InteractionCatalog 1.53 freezes 1.52 and changes only the existing `blender.geometry_nodes.create_light_trails` recipe:

- retain the twenty receipt-authored `node-name:OperatingLine …` node operations;
- add all nineteen graph links after node/value construction and before no-bake verification;
- identify ordinary sockets by stable RNA identifier and the authored group interface by its stable `Geometry` name;
- keep the twelve accepted scalar projections next to the node that consumes them, producing 42 graph steps and 54 materialized leaf operations;
- expose those twelve values through OperatingLine-owned revision editors;
- resolve a reviewed primary socket and component for each value inside the exact receipt-bound node group;
- allow Blender 5.3+ to use `WindowManager.try_activate_rna_button` only when that primary control is visible and the receipt, leaf cursor, editor tree, node name/type, socket, and component all still match.

Named connection overlays now resolve endpoints through exact node names, not only node types, so repeated `Mesh Line` and `Instance on Points` nodes do not create ambiguous guidance.

## Execution boundary

The Light Trails menu and shortcut tracks remain unavailable. Its accepted action-level MCP still creates the complete graph atomically. At this ADR's catalog-release boundary, the new control panel staged revision parameters and showed the focused link but did not expose operation-level execute/back/abort controls. ADR 0110 subsequently added those controls to the local Blender rail without changing the action-level-only MCP boundary. Neither decision claims that Blender 4.5/5.1 can highlight native socket pixels.

This distinction is intentional: a complete ordered teaching rail is not evidence of a complete per-operation mutation executor.

## Verification

Pure tests cover catalog freezing, 54-operation materialization, twelve scalar controls, integer revision staging, exact named-node/socket resolution, wrong-type and ambiguous fail-close behavior, and named endpoint overlay projection.

Real Blender 4.5.3 LTS and 5.1.1 tests create the graph, compare all nineteen catalog links with the actual `NodeTree` link multiset, verify all twelve projected values, save/reopen the `.blend`, prove the strong no-bake Observation, reject external link/value tampering, and complete managed rollback.
