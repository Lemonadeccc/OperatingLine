# Planning benchmark scenarios

Versioned benchmark payloads live under `protocol/fixtures/v1/planning/` because they are public,
model-neutral protocol inputs rather than private test setup. Each case binds:

- one natural-language goal;
- one exact adapter and ActionCatalog version;
- the goal-relevant planning phases selected by the caller;
- one complete reference GuidePlan.

Unit tests run the deterministic planning-quality gate against these fixtures. A host-specific integration
test may execute the same reference Plan when it can prove real resource creation, observations, artifacts,
and full compensation. A passing benchmark establishes compatibility with the declared structure and host
actions; it is not a semantic or aesthetic score for arbitrary model output.

The current benchmark is also a historical-replay fixture: `robot-preview` is pinned to Blender catalog
`1.2.0`, so it uses planning-quality baseline `1.0.0` and carries no capability coverage. Catalog `1.3.0`
introduces seven `semanticCapabilities`; capability-aware Planning and Replanning Packets use format `1.1.0`,
and provider drafts must map each declared concrete requirement through a catalog capability to executable leaf
steps. The deterministic quality/provider suites cover missing, unknown, action-mismatched, and local-replan
out-of-scope mappings. Those checks produce replayable trace evidence, not proof that a provider understood an
arbitrary goal. See [ADR 0017](../../../docs/adr/0017-catalog-grounded-goal-coverage.md).

Current cases:

- `robot-preview`: cross-target Blender geometry, materials, render setup, and output without animation;
  exercised by `tests/integration/blender/test_planning_benchmark.py` on every supported Blender binary.
