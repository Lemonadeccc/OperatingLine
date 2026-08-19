---
'@operatingline/protocol': minor
'@operatingline/persistence': minor
'@operatingline/orchestrator': minor
---

Add an asynchronous, selection-bound YouTube caption authoring run that generates and materializes a
candidate ProcedureTree, requires an exact three-hash review, and atomically stores the immutable tree
with its complete selection, Provider descriptor, generation-event, runtime-attestation, and
materialization binding without creating a proposal or executing the host.
