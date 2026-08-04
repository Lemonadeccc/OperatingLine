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

Current cases:

- `robot-preview`: cross-target Blender geometry, materials, render setup, and output without animation;
  exercised by `tests/integration/blender/test_planning_benchmark.py` on every supported Blender binary.
