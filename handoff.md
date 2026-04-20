# ZAR Handoff

Date: 2026-04-19

## Current Goal

ZAR is becoming the real authentication and onboarding boundary for Zoe. The current focus is Clerk-backed identity, webhook-driven greenfield onboarding, and containerized service boundaries. The sample frontend exists only to support Clerk login/session testing; the backend is the important artifact.

The repo is now beginning to enforce a stricter boundary:

- `backend/` is ZAR itself: authenticate, admit, and route
- `onboarding/` will hold onboarding business logic that sits behind ZAR
- `user-admin/` will hold user and org administration concerns that sit behind ZAR

Those two new folders are currently placeholders. Code has not been moved yet, but the repo shape should start reflecting the architecture now instead of after the codebase has already blurred the boundary.

## Repo Shape

The repo currently contains these top-level areas:

- `backend/`: ZAR backend service.
- `sample_frontend/`: minimal Clerk test frontend.
- `onboarding/`: reserved for onboarding application logic behind ZAR.
- `user-admin/`: reserved for user/org administration logic behind ZAR.

`sample_frontend/` is still only a Clerk test harness, not the long-term product UI.

The long-term direction is to keep ZAR narrow. It should authenticate and route requests, not absorb all downstream product behavior into the gateway itself.

## Backend

Location: `backend/`

Current capabilities:

- Loads non-secret locator config from `backend/config.json`.
- Fetches real secrets from AWS Secrets Manager.
- Fails startup if required secrets are missing.
- Exposes `GET /health`.
- Exposes `GET /auth/session`.
- Verifies Clerk bearer tokens using `@clerk/backend`.
- Exposes `POST /webhooks/clerk`.
- Verifies Clerk webhook signatures using Svix before processing.
- Stores every verified Clerk webhook event in Neon onboarding DB.
- Treats `organizationMembership.created` with `role = 'org:admin'` as the greenfield trigger.
- Upserts onboarding status on that trigger.

Current backend port:

```text
8788
```

### Backend Config

Committed non-secret locator config:

```json
{
  "aws_region": "us-west-1",
  "clerk_secret_id": "devconfig",
  "onboarding_database_secret_id": "zar_onboarding_db_config"
}
```

Required AWS Secrets Manager keys:

- `devconfig.clerk_secret_key`
- `devconfig.clerk_webhook_signing_secret`
- `zar_onboarding_db_config.zar_onboarding_db_url`

The ZAR onboarding DB URL is intentionally separate from the older Zoe/control-plane database URL. The onboarding DB owns pre-core onboarding workflow state such as webhook events, onboarding status, and later waitlist state.

### Backend Routes

```text
GET /health
```

Returns service health and confirms AWS Secrets Manager is the configured secret source.

```text
GET /auth/session
```

Requires:

```text
Authorization: Bearer <Clerk session token>
```

Verifies the token server-side and returns non-sensitive Clerk identity claims.

```text
POST /webhooks/clerk
```

Requires valid Svix webhook headers from Clerk. The route stores all verified Clerk events in `onboarding.events`. It then checks whether the event is the greenfield trigger.

Structured logs currently include:

- `webhook.clerk.received`
- `webhook.clerk.invalid_signature`
- `webhook.clerk.verified`
- `webhook.clerk.stored`
- `greenfield.trigger.checked`
- `auth.session.invalid_token`
- `request.internal_error`

### Backend Verification

This passes locally:

```bash
cd backend
npm run build
```

The backend has also been manually verified to start once required Secrets Manager keys are present.

## Sample Frontend

Location: `sample_frontend/`

Purpose: only to test Clerk signup/signin/session flow and frontend-to-ZAR token passing.

Current capabilities:

- `/` shows a simple Login button.
- `/login` renders Clerk `SignIn`.
- `/signup` renders Clerk `SignUp`.
- Nested Clerk routes such as `/signup/verify-email-address` are routed back into Clerk components rather than showing app-level 404.
- `/protected` is guarded by Clerk.
- Protected page shows exactly:

```text
If you can see this page, you have sucessfully logged in.
```

- Protected page calls ZAR `GET /auth/session` with a Clerk session token.
- It displays `ZAR verified Clerk user user_...` when the backend verifies the token.
- Logout works.
- Returning login works.

Current frontend port:

```text
5174
```

Local frontend env:

```text
sample_frontend/.env.local
```

This is ignored by git and currently contains the Clerk publishable key.

### Frontend Verification

This passes locally:

```bash
cd sample_frontend
npm run build
```

Manual verification completed:

- signup works
- protected page works
- logout works
- signin after logout works
- protected page can call ZAR and receive verified Clerk user ID

## Neon Onboarding DB

A Neon project named `ZAR` was created manually in the Neon console.

The onboarding schema and tables were created in the default database:

```text
neondb
```

Tables:

```text
onboarding.status
onboarding.events
```

The setup SQL and secret notes are tracked in:

```text
neon-onboarding-zar-setup.md
```

## Clerk Webhook Design

Clerk webhook ordering is not assumed. Clerk/Svix delivery may be delayed, retried, replayed, or arrive out of order.

Current design:

- verify every webhook before processing
- store every verified event in `onboarding.events`
- use `event_id` as the idempotency key
- use `organizationMembership.created` as the greenfield trigger
- require `role = 'org:admin'` for greenfield status creation
- update `onboarding.status` idempotently

Current implementation does not yet write to Zoe core identity tables.

## Not Yet Implemented

The following are not done yet:

- no Zoe core DB projection from onboarding to `zoe_czar`
- no `user_map` writes
- no `org_ring_map` writes
- no `owner` role writes in Zoe core DB
- no company/user property writes in Zoe core DB
- no entitlement checks
- no OpenFGA checks
- no redaction service
- no internal ZAR-issued downstream token
- no AWS deployment yet
- no Clerk webhook endpoint registered against a public AWS URL yet

## Next Step

The next architectural step is to deploy the ZAR backend to AWS so Clerk can call a stable public HTTPS webhook endpoint without using a local tunnel.

Recommended first deployment target:

```text
AWS App Runner
```

Reason:

- fastest path to public HTTPS for webhook testing
- container-native
- can use an AWS runtime role to read Secrets Manager
- less setup than ECS/ALB for this stage

After deployment:

1. grant the service role read access to `devconfig` and `zar_onboarding_db_config`
2. register Clerk webhook URL: `https://<app-runner-url>/webhooks/clerk`
3. subscribe to Clerk events, at minimum `organizationMembership.created`
4. create/replay a Clerk organization membership event
5. confirm rows appear in `onboarding.events`
6. confirm greenfield admin membership upserts `onboarding.status`
