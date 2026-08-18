---
'@operatingline/protocol': minor
'@operatingline/orchestrator': minor
---

Add a local Desktop OAuth operator flow for YouTube caption access, store refresh credentials only
in the operating-system vault, refresh access tokens at the composition roots, and fail closed on
ambiguous or invalid authorization without replaying API requests.
