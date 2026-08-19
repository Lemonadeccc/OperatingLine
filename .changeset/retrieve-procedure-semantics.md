---
'@operatingline/protocol': minor
'@operatingline/planner-provider-sdk': minor
'@operatingline/openai-planner-provider': minor
'@operatingline/orchestrator': minor
'@operatingline/openai-runtime': minor
---

Add provider-neutral, evidence-bound ProcedureTree semantic retrieval that embeds a bounded latest-tree
leaf corpus, computes stable cosine ranking in the core runtime, and returns vector-free RAG context
without storing a new tree, creating a proposal, or executing the host. Provider discovery and explicit
authorization bind the exact embedding model, API/runtime settings, data handling, and cost policy.
