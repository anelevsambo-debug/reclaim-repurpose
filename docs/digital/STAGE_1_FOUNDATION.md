# Stage 1 – Project Skeleton + Pure Validation Foundation

**Date:** 16 October 2026  
**Status:** Implemented (synthetic tests only)

## What was delivered

- Clean repository structure
- Apps Script manifest (`Africa/Gaborone`, V8, minimal scopes)
- Pure validation module that runs in both Apps Script and Node
- Country ↔ currency rules (Botswana/BWP, Eswatini/SZL)
- Money and organisation shape validation
- Node test suite
- GitHub Actions workflow that runs the tests

## What Stage 1 does **not** claim

- No Google identity or Sheets access
- No authorisation policy
- No WhatsApp integration
- No AppSheet
- No live deployment
- No operational pilot capability

All live gates remain **BLOCKED**.

## How to run the tests locally

```bash
npm test
```

## Next stage (proposed)

Stage 2 will introduce the identity adapter, central authorisation policy, and the first restricted service entry points — still with synthetic tests only.
