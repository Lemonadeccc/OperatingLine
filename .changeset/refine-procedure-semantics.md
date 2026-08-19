---
'@operatingline/protocol': minor
'@operatingline/persistence': minor
'@operatingline/orchestrator': minor
---

Add evidence-bound ProcedureTree refinement that streams one authorized dialogue turn, uses completed
semantic retrieval context for a threshold-gated local tree revision, deterministically sanitizes and
compiles the scoped result, and atomically stores or discards an exact human-reviewed preview without
replaying uncertain Provider calls after restart.
