---
'@operatingline/orchestrator': minor
'@operatingline/blender-action-catalog': minor
---

Freeze InteractionCatalog 1.34.0 and publish 1.35.0 with exact action-level MCP execution
declarations for Icosphere, Cube, and Plane. The strict accepted-replay request, immutable parameter
derivation, Companion receipt ordering, Observation gate, native Undo checkpoint, and failure
recovery requirements remain fail closed. Successful results must link their next native Undo
checkpoint directly to the CAS-bound start checkpoint. Torus, Cone, Cylinder, and all other actions
remain unavailable.
