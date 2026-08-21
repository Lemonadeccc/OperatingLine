# ADR 0100: Native UV Sphere menu-control proof

- Status: Accepted
- Date: 2026-08-21

## Context

ProcedureTree already stores ordered menu operations and their parameter bindings, but that
structural representation did not prove that Blender could execute the corresponding visible
controls. The first useful slice needs to cover a complete primitive leaf: opening the native Add
menu, choosing UV Sphere, entering each transform component in order, renaming the object, and
showing that Blender's own history can restore and reapply the result.

A single proof cannot safely authorize arbitrary coordinates, names, window layouts, keymaps, UI
scales, or Blender versions. It also cannot be treated as a managed Action execution because the UI
event harness does not create the normal identity-bound receipt.

## Decision

InteractionCatalog `1.41.0` freezes `1.40.0` and adds one exact menu proof declaration to
`blender.mesh.create_uv_sphere.native`:

- executor `blender.uv_sphere_menu_controls.event_simulate.v1`;
- Blender `4.5.3` and `5.1.1`, factory Layout profile, Blender keymap, Object Mode, UI scale `2`;
- ordered operations `workspace.layout`, `menu.add`, `menu.mesh`, `operator.uv_sphere`,
  `control.location`, `control.scale`, and `control.object_name`;
- accepted arguments `proof.uv_sphere.eye`, `OperatingLine.TutorialEye`, radius `1.5`, and location
  `[1.25,-2,0.75]`;
- strong observation kind `uv_sphere_menu_controls_ready` and native Undo depth `8`.

The object-name target is the control actually exercised by the proof:
`Properties → Object → Name`. The catalog and Blender extension parsers reject foreign recipes,
reordered operations, altered controls, altered arguments, wrong versions, and boolean/numeric type
confusion.

Procedure materialization copies the declaration into a menu track only when the leaf Action
arguments canonically equal the declared proof arguments. Other UV Sphere leaves retain their
ordered semantic/menu/shortcut/MCP training tracks but receive no menu proof authority.

The foreground harness uses `Window.event_simulate` for every modeling mutation. It verifies the
source operator, final `482/992/512` mesh topology, transform, name, scene fingerprints, eight native
Undo transitions back to the factory scene, and eight Redo transitions back to the exact final
state on both supported Blender versions.

## Consequences

- The project now has a real per-control menu trajectory with concrete parameter order and native
  history evidence.
- Historical InteractionCatalog `1.40.0` remains byte-frozen and does not inherit this declaration.
- The proof does not authorize arbitrary parameters, other UI profiles, OS-level HID input, managed
  Action identity, managed receipts, or a general Companion request path.
- Broadening the executor requires a new validated parameter/profile policy and fresh dual-version
  evidence; it cannot be inferred from this fixture.

## Verification

- `pnpm test:blender:menu-controls`
- `pnpm exec vitest run tests/unit/protocol/interaction-catalog.test.ts tests/unit/orchestrator/interaction-catalogs.test.ts tests/unit/orchestrator/procedure-authoring-materialization.test.ts`
- `python3 tests/unit/blender/test_interaction_catalog.py`
- `python3 tests/unit/blender/test_menu_guidance.py`
