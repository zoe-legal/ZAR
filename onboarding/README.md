# Onboarding

This folder now contains the first Python service scaffold for Zoe onboarding.

Current scope:

- greenfield onboarding only
- read onboarding status
- inspect onboarding events
- synchronously project a new Clerk user/org into Zoe core mappings when the
  greenfield trigger event exists
- answer `GET /getInternalUserAndOrg`

Current stack:

- FastAPI
- psycopg
- boto3
- `uv`

Environment:

- checked-in `.env` stores Secrets Manager secret names only
- actual database URLs are loaded from AWS Secrets Manager at runtime

Important constraint:

- the onboarding DB and the Zoe control-plane DB are currently separate
  databases
- that means there is no true single ACID transaction covering both write sets
- the current implementation does the Zoe control-plane projection first, then
  marks onboarding complete in the onboarding database
- this is intentionally explicit so the cross-database consistency problem is
  visible instead of hidden

Run locally:

```bash
cd onboarding
uv run uvicorn app.main:app --reload --port 8790
```

Endpoints:

- `GET /health`
- `GET /getInternalUserAndOrg`

`GET /getInternalUserAndOrg` currently accepts Clerk identifiers either as query
params or forwarded headers:

- `clerk_user_id` or `X-Clerk-User-Id`
- `clerk_org_id` or `X-Clerk-Org-Id`

The long-term intent is for ZAR to provide this context after authentication
rather than for callers to supply it directly.
