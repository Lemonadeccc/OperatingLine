# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-04
- Primary product surfaces: Blender 3D View Sidebar, Blender 3D View guidance overlay, the headless Orchestrator MCP/HTTP API, and the host-neutral GuidePlan/GuideProposal protocol that supplies their content.
- Evidence reviewed: `README.md`, `docs/architecture/overview.md`, `docs/architecture/blender-companion.md`, `packages/protocol/src/guide.ts`, `packages/protocol/src/proposal.ts`, `packages/protocol/src/catalog.ts`, `packages/protocol/src/eval.ts`, `services/orchestrator/src/index.ts`, `services/orchestrator/src/eval-export.ts`, `packages/persistence/src/index.ts`, `adapters/blender/catalog/v1/action-catalog.json`, `adapters/blender/extension/operating_line/application/companion.py`, `adapters/blender/extension/operating_line/application/session.py`, `adapters/blender/extension/operating_line/presentation/panel.py`, `adapters/blender/extension/operating_line/presentation/operators.py`, `adapters/blender/extension/operating_line/infrastructure/overlay.py`, `adapters/blender/extension/operating_line/resources/snowman.plan.json`, `tests/e2e/blender/capture_overlay.py`, and `docs/assets/blender-guidance.png`.
- Product boundary: the shipped baseline is a deterministic 13-step Blender snowman vertical slice plus model-neutral ActionCatalog/PlanningContext, human-approved GuideProposal, node references, immutable revision requests, and versioned raw Eval/replay export. A Blender user may reference nodes in an active or proposed tree and queue a change request for Codex, Claude, or another MCP client; a replan always returns as a complete new GuideProposal revision. OperatingLine does not embed a model, stream a chat response, infer a quality score, or automatically sanitize exported evidence. Scoring/training governance, rigging/animation, and a second software host remain later milestones.

## Brand

- Personality: calm, precise, teachable, and visibly accountable. The UI should feel like an industrial operation guide rather than a decorative assistant.
- Trust signals: every visible state maps to an actual plan step; proposed plans are visibly distinct from accepted plans; no proposal can execute before an explicit in-host acceptance; object/world anchors point to resolved Blender data; unresolved native UI targets are described as semantic paths instead of receiving invented coordinates.
- Avoid: black primary guidance lines, color-only meaning, fake claims that deterministic data-API actions clicked Blender menus, floating desktop overlays, and visual noise that obscures the model.

## Product goals

- Goals: show what has completed, what Back will undo, what Next will execute, and what remains locked; keep the task hierarchy readable; let users inspect and explicitly accept or reject an AI-authored plan without scene mutation; let a user add stable references from active or proposed nodes to one revision-request composer; return every requested change as a reviewable full Plan revision; preserve a single hide/show control.
- Non-goals: an embedded model or automatic task-decomposition engine, streaming assistant chat, in-place mutation of an accepted/proposed Plan, applying a partial JSON patch directly in Blender, automatic Eval scoring or data sanitization, arbitrary built-in UI-element detection, arbitrary MCP execution, native Blender Undo integration, animation, and cross-host parity in this milestone.
- Success signals: a referenced revision request contains the exact base Plan, stable node IDs plus display numbers, and user message; exact retries are idempotent; an MCP client can list pending requests and attach one to a strictly newer full GuideProposal; request submission and replan creation do not mutate the scene or active session; the replacement proposal still requires explicit in-host acceptance; replay export preserves target, exact catalog, proposal, decision, observation and rollback with a stable cursor and deterministic content hash; Blender 4.5 LTS and 5.1 tests pass.

## Personas and jobs

- Primary personas: Blender beginners supervising AI-assisted work; experienced Blender users auditing or correcting a generated sequence; adapter developers implementing another host companion.
- User jobs: understand the overall task tree; review the hierarchy and executable leaves proposed by an AI; reference one or more nodes without copying fragile text; explain the desired change in host context; know which Plan revision is being discussed; accept or reject the resulting proposal inside the host; predict the next mutation before executing it; identify the exact step Back will compensate; temporarily remove guidance without losing task state.
- Key contexts of use: Blender's 3D View with a narrow Sidebar, light or dark Blender themes, rendered or solid shading, and scenes containing user-owned objects that must not be mistaken for OperatingLine resources.

## Information architecture

- Primary navigation: Blender's `N` Sidebar contains one `OperatingLine` tab. It is the stable control surface; the viewport overlay is contextual guidance, not navigation.
- Core routes/screens: connection status, pending proposal summary and decision, safety option, walkthrough controls, guidance visibility, current Back/Next status, revision-request composer, proposal tree, and accepted task tree.
- Content hierarchy: connection first; pending proposal identity and Accept/Reject decision second; safety and accepted-plan Start/Back/Next controls third; guidance visibility fourth; current status fifth; revision-request composer before the trees it references; proposed tree before accepted tree; detailed protocol/diagnostic text last.

## Design principles

- State before decoration: every color, number, icon, and line represents a deterministic state derived from `active_index`.
- Review before mutation: receiving and validating a proposal only creates an in-memory preview. Accept is the sole transition that may replace an idle active session; Reject only records the decision and clears the preview.
- Reference before revision: node numbers are readable locators, but immutable requests bind the base Plan ID/revision and stable node IDs. A model response is a new complete proposal, never an in-place tree mutation.
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
- New/changed components: shared guidance-state derivation; shared visual tokens; state-aware tree rows; node `Ref` operators for active and proposed trees; one revision-request composer with base-plan label, reference summary, message field, Clear and Send controls; Back/Next status controls; numbered viewport badges; haloed colored guide lines and arrows; semantic menu-path fallback; unified Show/Hide Guidance behavior; proposal summary; read-only proposal tree; Accept Plan and Reject Plan operators.
- Variants and states: accepted walkthrough steps use `completed`, `back`, `next`, and `locked`. Proposal lifecycle uses `available`, `accepted`, and `rejected`. Revision requests use `empty`, `draft`, `queued`, `acknowledged`, and `error`; queued/acknowledged requests never imply a model has replied. A future asynchronous executor may add transient `current`; synchronous Blender operators do not pretend to display a state that cannot be rendered during execution.
- Token/component ownership: host-neutral step/anchor, proposal/decision, node-reference, revision-request, and Eval bundle semantics stay in `packages/protocol`; proposal/revision-request persistence, idempotency, and stable event sequencing stay in `packages/persistence`; Eval relation filtering, pagination, summaries, and content hashing stay in the Orchestrator; deterministic accepted-session, proposal-preview, and local composer state stay in Blender application code; Blender RGBA and drawing constants stay in Blender presentation/infrastructure code.

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
- Proposal available: show its title, plan ID/revision, target adapter, read-only hierarchy, and explicit Accept/Reject controls. Do not draw viewport target lines for unaccepted steps because their object anchors may not exist yet.
- Proposal blocked: when the accepted session owns receipts, keep the proposal visible, disable Accept, disable Start/Next, preserve Back, and explain that the user must return the current walkthrough to its start before accepting.
- Proposal accepted: atomically replace only an idle accepted session, clear the preview, record the decision, and emit the existing `plan_loaded` state report before any action can run.
- Proposal rejected: clear the preview, record the decision, preserve the active session, receipts, scene, overlay state, and current step.
- Revision request empty: show the current base Plan and `Select Ref on a task node`; Send is disabled.
- Revision request draft: show up to eight referenced `@number title` rows and a user-editable request field. `Ref` targets the proposed tree when one is pending, otherwise the active tree; selecting a different base revision clears the older local draft and reports the change.
- Revision request queued: clear the draft only after it enters the authenticated transport queue; show the request ID and state that no scene change occurred.
- Revision request acknowledged: state that an MCP planner may now read it; do not imply a response time or completion.
- Replan proposal available: display it through the existing Proposal review UI, including its source request ID; it remains non-executable until Accept.
- Error: retain the existing explicit Operator/Companion error report; do not advance visual state when an action or rollback fails.
- Success: steps before `active_index` are blue completed; `active_index` is red Back; `active_index + 1` is green Next.
- Disabled: future steps are gray locked; Back is disabled before any step; Next is disabled after the last step.
- Offline/slow network, if applicable: offline mode continues with the last accepted or bundled plan; network state must not block accepted-plan guidance controls when no proposal decision is pending. A locally staged proposal remains a connected-session review item and is cleared on explicit disconnect.

## Content voice

- Tone: short, instructional, factual, and explicit about consequences.
- Terminology: `Plan proposal`, `Revision request`, `Reference`, `Send request`, `Accept Plan`, `Reject Plan`, `Active plan`, `Guidance`, `Back`, `Next`, `Completed`, `Locked`, `UI target unavailable`, `Menu path`, and protocol step numbers. Avoid calling the request field a live `Chat` because no embedded assistant is connected; avoid `Publish` for an unapproved AI proposal and `Undo` for OperatingLine compensation.
- Microcopy rules: Proposal and request text says that no scene change has occurred; queued only means stored for an MCP planner; Accept names the plan that will become active; Next describes the mutation that will occur; Back names the mutation that will be compensated; node references display `@number title` while payloads retain stable node IDs; English UI strings remain concise until repository-wide localization is introduced.

## Implementation constraints

- Framework/styling system: Blender Python Extension APIs only for the in-host surface. Electron is not part of the Blender visual layer.
- Design-token constraints: Sidebar colors must use APIs supported by both Blender versions; viewport colors use centralized RGBA tokens. Do not ship per-theme pixel coordinates.
- Performance constraints: draw callbacks perform no network calls or scene mutation, derive only a small relevant-step window, and avoid persistent per-frame allocations where practical.
- Compatibility constraints: use public Blender 4.5/5.1 APIs; keep host-neutral protocol anchors semantic; do not require a Blender Core PR.
- Proposal/request constraints: proposal delivery shares the existing authenticated loopback poll; proposal, decision, and revision-request payloads are strict, versioned, persisted, and idempotent per companion instance. A request carries the complete immutable base Plan so bundled/offline-origin plans can be replanned without an undocumented server cache. The background thread handles HTTP only; reference selection, request construction, plan validation, preview-session construction, acceptance, rejection, and session replacement occur on Blender's main thread.
- Eval constraints: export is an authenticated, paginated Orchestrator surface rather than Blender UI state. It scopes instance-specific decisions and reports, includes exact referenced catalogs, marks raw content as unredacted, and never upgrades observation telemetry into a quality score. Random export envelope metadata is excluded from the deterministic content digest.
- Test/screenshot expectations: targeted protocol/persistence/integration coverage for request idempotency, node/base-plan validation, pending MCP listing, and replan-to-proposal linkage; Blender coverage proving node reference and request submission do not execute actions or replace sessions; full Blender regressions; real GUI captures for a populated revision composer and linked replan proposal in addition to existing visual states.

## Open questions

- [ ] Should a later interactive milestone use a `GizmoGroup` for clickable OperatingLine-owned viewport controls? / Product / Changes interaction architecture, not this vertical slice.
- [ ] Which second open-source host will validate the protocol's cross-host semantics? / Product and adapter research / Required before claiming general host support.
- [x] Which versioned action-catalog schema should planners query before generating plans for a host? / Resolved by adapter-owned ActionCatalog plus `operatingline.planning.context`; see ADR 0005.
- [x] How should a node reference such as `1.1.5` become an immutable patch request and a new proposal revision? / Stable node ID + display number, complete immutable base Plan, persisted RevisionRequest, and a linked newer full GuideProposal; no in-place patch.
- [ ] Should localization begin with Chinese/English UI strings or wait for the second host? / Product / Affects string ownership and screenshot baselines.
- [ ] Can a future Blender-version-specific locator safely resolve selected built-in menu items without fixed pixels? / Blender adapter research / Required before promising native-menu arrows.
