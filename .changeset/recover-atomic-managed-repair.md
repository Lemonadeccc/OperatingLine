---
'@operatingline/orchestrator': patch
'@operatingline/persistence': patch
---

Make managed repair reconciliation retry-stable when durable atomic persistence succeeds before
the coordinator applies the repaired state in memory, and verify every linked recovery artifact
before committing the SQLite transaction.
