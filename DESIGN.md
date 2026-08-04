# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-04
- Primary product surfaces: Blender 3D View Sidebar, Blender 3D View guidance overlay, and the host-neutral GuidePlan protocol that supplies their content.
- Evidence reviewed: `README.md`, `docs/architecture/overview.md`, `docs/architecture/blender-companion.md`, `packages/protocol/src/guide.ts`, `adapters/blender/extension/operating_line/presentation/panel.py`, `adapters/blender/extension/operating_line/infrastructure/overlay.py`, `adapters/blender/extension/operating_line/resources/snowman.plan.json`, `tests/e2e/blender/capture_overlay.py`, and `docs/assets/blender-guidance.png`.
- Product boundary: the implemented product is a deterministic 13-step Blender snowman vertical slice. Generic AI planning, node chat references, local replanning, training/Eval export, rigging/animation, and a second software host are later milestones.

## Brand

- Personality: calm, precise, teachable, and visibly accountable. The UI should feel like an industrial operation guide rather than a decorative assistant.
- Trust signals: every visible state maps to an actual plan step; object/world anchors point to resolved Blender data; unresolved native UI targets are described as semantic paths instead of receiving invented coordinates.
- Avoid: black primary guidance lines, color-only meaning, fake claims that deterministic data-API actions clicked Blender menus, floating desktop overlays, and visual noise that obscures the model.

## Product goals

- Goals: show what has completed, what Back will undo, what Next will execute, and what remains locked; keep the task hierarchy readable; make state changes visible in both the Sidebar and 3D View; preserve a single hide/show control.
- Non-goals: automatic task decomposition, arbitrary built-in UI-element detection, arbitrary MCP execution, natural-language node editing, native Blender Undo integration, animation, and cross-host parity in this milestone.
- Success signals: after Start, Next, and Back, the same semantic state appears in the tree, viewport markers, lines, and controls; the default Blender scene remains protected; Blender 4.5 LTS and 5.1 tests pass; screenshots demonstrate initial, forward, back, hidden, and unresolved-operator states.

## Personas and jobs

- Primary personas: Blender beginners supervising AI-assisted work; experienced Blender users auditing or correcting a generated sequence; adapter developers implementing another host companion.
- User jobs: understand the overall task tree; predict the next mutation before executing it; identify the exact step Back will compensate; relate a numbered instruction to its scene target or semantic menu path; temporarily remove guidance without losing task state.
- Key contexts of use: Blender's 3D View with a narrow Sidebar, light or dark Blender themes, rendered or solid shading, and scenes containing user-owned objects that must not be mistaken for OperatingLine resources.

## Information architecture

- Primary navigation: Blender's `N` Sidebar contains one `OperatingLine` tab. It is the stable control surface; the viewport overlay is contextual guidance, not navigation.
- Core routes/screens: connection status, safety option, walkthrough controls, guidance visibility, task tree, and current Back/Next status.
- Content hierarchy: connection and safety settings first; Start/Back/Next second; guidance visibility third; immediate step status before the complete tree; detailed protocol/diagnostic text last.

## Design principles

- State before decoration: every color, number, icon, and line represents a deterministic state derived from `active_index`.
- Honest anchors: resolve model/world targets when possible, show a breadcrumb for `operator.menuPath`, and explicitly label unavailable UI targets. Never draw a plausible but false line.
- Progressive focus: show at most the most relevant completed, Back, and Next steps in the viewport while retaining the complete hierarchy in the Sidebar.
- Host-native control: use Blender Panel, Operator, draw handler, `gpu`, and `blf`; do not depend on a transparent Electron window over Blender.
- Tradeoffs: Blender `UILayout` does not expose arbitrary per-button background colors or stable rectangles for every built-in widget. Use native alert state, colored node sockets, icons, text, and viewport drawing; reserve custom gizmos for a later interactive-anchor milestone.

## Visual language

- Color: `surface #101820`, `halo #071018`, `text #F5F7FA`, `completed #2F9BFF`, `current #FFC857`, `next #2DD881`, `back #FF5C6C`, and `locked #7B8494`. Black/dark halo may outline a colored line but is never the primary line.
- Typography: inherit Blender UI fonts in the Sidebar; use Blender's `blf` default font in the viewport. Global executable ordinals use two digits (`01`–`13`); tree nodes retain hierarchy numbers (`1.2.1`).
- Spacing/layout rhythm: use Blender-native row/box spacing. The viewport card keeps at least 16 px from an edge, uses a 32 px circular step marker, and prioritizes one Back and one Next item.
- Shape/radius/elevation: native Sidebar surfaces; flat, high-contrast viewport cards; circular ordinal badges with a dark outer ring and colored inner fill.
- Motion: no required animation in the deterministic slice. Any later transition must respect reduced-motion settings and must not delay execution feedback.
- Imagery/iconography: `✓`/check for completed, `↶`/Back for the reversible active step, `▶`/Next for the next executable step, and an open circle for locked. Text labels duplicate all icon meaning.

## Components

- Existing components to reuse: Blender Sidebar `Panel`, `UILayout` rows/boxes/operators, task-tree branch operator, `SpaceView3D.draw_handler_add`, `gpu` primitives, and `blf` text.
- New/changed components: shared guidance-state derivation; shared visual tokens; state-aware tree rows; Back/Next status controls; numbered viewport badges; haloed colored guide lines and arrows; semantic menu-path fallback; unified Show/Hide Guidance behavior.
- Variants and states: `completed`, `back`, `next`, and `locked` are stable states. A future asynchronous executor may add transient `current`; synchronous Blender operators do not pretend to display a state that cannot be rendered during execution.
- Token/component ownership: host-neutral step/anchor semantics stay in `packages/protocol`; deterministic state derivation stays in Blender application code; Blender RGBA and drawing constants stay in Blender presentation/infrastructure code.

## Accessibility

- Target standard: WCAG 2.2 AA contrast intent where Blender's host rendering allows it; no meaning depends on red/green alone.
- Keyboard/focus behavior: retain native Blender operators so keyboard search and focus behavior remain host-managed. The overlay itself is informational and non-interactive.
- Contrast/readability: colored lines receive a 10 px dark halo below a 4 px state-colored stroke; markers combine color, ordinal, and symbol; text uses high-contrast light foreground on the dark card.
- Screen-reader semantics: Blender's Python UI API has limited assistive-semantic controls. Operator labels and descriptions must remain explicit (`Back: ...`, `Next: ...`) and avoid icon-only controls.
- Reduced motion and sensory considerations: no flashing or required animation; status changes are immediate and persistent.

## Responsive behavior

- Supported breakpoints/devices: Blender desktop UI at supported 4.5 LTS and 5.1 versions; mouse/keyboard workflows; no mobile or touch target in this milestone.
- Layout adaptations: labels truncate through Blender-native behavior in a narrow Sidebar; viewport anchors clamp to its visible region; the card avoids the Sidebar edge and limits contextual items instead of rendering all 13 lines.
- Touch/hover differences: none for this milestone. Operator descriptions provide native hover tooltips.

## Interaction states

- Loading: Companion connection uses existing status text; deterministic local actions are synchronous and do not show a fake loading animation.
- Empty: before Start or after a full rollback, step `01` is green Next and Back is disabled.
- Error: retain the existing explicit Operator/Companion error report; do not advance visual state when an action or rollback fails.
- Success: steps before `active_index` are blue completed; `active_index` is red Back; `active_index + 1` is green Next.
- Disabled: future steps are gray locked; Back is disabled before any step; Next is disabled after the last step.
- Offline/slow network, if applicable: offline mode continues with the bundled plan; network state must not block local guidance controls.

## Content voice

- Tone: short, instructional, factual, and explicit about consequences.
- Terminology: `Guidance`, `Back`, `Next`, `Completed`, `Locked`, `UI target unavailable`, `Menu path`, and protocol step numbers. Avoid using `Undo` for OperatingLine compensation.
- Microcopy rules: Next describes the mutation that will occur; Back names the mutation that will be compensated; unavailable anchors state the limitation rather than implying a visual target; English UI strings remain concise until repository-wide localization is introduced.

## Implementation constraints

- Framework/styling system: Blender Python Extension APIs only for the in-host surface. Electron is not part of the Blender visual layer.
- Design-token constraints: Sidebar colors must use APIs supported by both Blender versions; viewport colors use centralized RGBA tokens. Do not ship per-theme pixel coordinates.
- Performance constraints: draw callbacks perform no network calls or scene mutation, derive only a small relevant-step window, and avoid persistent per-frame allocations where practical.
- Compatibility constraints: use public Blender 4.5/5.1 APIs; keep host-neutral protocol anchors semantic; do not require a Blender Core PR.
- Test/screenshot expectations: targeted unit/integration coverage for state derivation and semantic-anchor fallback, full Blender regressions, and real GUI captures for initial, forward, Back, hidden, and unresolved operator fallback states.

## Open questions

- [ ] Should a later interactive milestone use a `GizmoGroup` for clickable OperatingLine-owned viewport controls? / Product / Changes interaction architecture, not this vertical slice.
- [ ] Which second open-source host will validate the protocol's cross-host semantics? / Product and adapter research / Required before claiming general host support.
- [ ] Should localization begin with Chinese/English UI strings or wait for the second host? / Product / Affects string ownership and screenshot baselines.
- [ ] Can a future Blender-version-specific locator safely resolve selected built-in menu items without fixed pixels? / Blender adapter research / Required before promising native-menu arrows.
