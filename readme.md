# ZAR

## Overview

This repo currently contains the ZAR runtime stack, a sample config, a sample UI, and local edge wiring:

- `backend/` — ZAR itself
- `sample_frontend/` — Clerk test UI and current org-admin surface
- `sample_zar_config.yaml` — example routing/policy config only
- `docker-compose.yml` / `nginx.edge.conf` — local and dev-machine edge composition

Only `backend/` is the actual Zoe Authorized Router. Downstream support APIs such as onboarding and user-admin now live outside this repo and are consumed over the shared runtime network.

## Components

The current compose/deployment shape has these active components:

- `zar-edge-nginx`
  - role: edge reverse proxy on the instance
  - host port: `80`
  - container port: `80`
  - routes browser traffic to the internal services
- `zar-sample-ui`
  - role: sample frontend for Clerk auth, onboarding validation, and current org-admin surface
  - host port: none directly exposed in the deployed shape
  - container ports: `80`, `5174`
- `zar-backend`
  - role: the actual Zoe Authorized Router boundary
  - host port: none directly exposed
  - container port: `8788`
  - responsibilities: JWT verification, identity resolution, entitlement fetch, OpenFGA check, downstream routing, Clerk webhook handling
- `openfga`
  - role: fine-grained authorization engine
  - host port: `8080`, `8081`, `3000` exposed in the local compose shape
  - container ports: `8080`, `8081`, `3000`

The public request path is currently:

1. client hits `dev.zoe-legal.net`
2. AWS ALB terminates TLS
3. ALB forwards to EC2 on port `80`
4. `zar-edge-nginx` receives the request
5. nginx routes public `/api/*` traffic to `zar-backend` over the `zoe_czar` Docker network
6. ZAR routes downstream API calls to the internal services

### Config Note

`sample_zar_config.yaml` is only an illustrative sample for schema and routing discussion.

It is not the deployed runtime source of truth.

The real ZAR configuration is intended to be pulled from AWS Secrets Manager at runtime, and ZAR should eventually treat Secrets Manager as the authoritative config source.

## ZAR

### Role

ZAR is the single authenticated entry boundary. Its job is intentionally narrow:

- authenticate the caller
- resolve internal identity
- fetch org entitlements
- perform fine-grained authorization checks
- route to the correct downstream API

ZAR is not the home for onboarding business logic, user-admin business logic, or long-term frontend ownership.

### Current Deployed Path

The current path running on `dev.zoe-legal.net` is:

1. browser or client calls the public domain
2. ALB terminates TLS with ACM
3. EC2 edge nginx receives the request
4. nginx routes public `/api/*` traffic to `zar-backend` and browser traffic to `sample-ui`
5. ZAR performs:
   - Clerk JWT verification
   - internal identity resolution from Zoe core
   - org entitlement fetch from Zoe core
   - real OpenFGA network check
6. ZAR forwards to the appropriate internal downstream API

### Current Stack

- public entry: `dev.zoe-legal.net`
- edge: nginx in Docker
- auth provider: Clerk
- entitlement store: Zoe control-plane Postgres / Neon
- fine-grained authorization: real OpenFGA container
- deployment target: EC2 behind ALB

### Routing And Identity Contract

All downstream APIs must follow the same public shape:

- `/api/<domain>/...`

That contract is enforced for architectural reasons:

- clients talk only to ZAR
- downstream services are internal-only
- clients identify themselves only with a Clerk JWT
- clients do not send internal Zoe IDs to downstream APIs
- ZAR resolves internal identity, performs entitlement and FGA checks, and forwards only the internal context needed by the downstream service

This is now the required pattern for all subsequent APIs. `user-admin` has already been removed from the direct public path and is reachable only through ZAR.

### Current ZAR Endpoints

- `GET /health`
- `GET /auth/session`
- `GET /onboarding/internal-user-and-org`
- `POST /webhooks/clerk`

### Current Auth Baseline

The current steady-state request path includes all major enforcement hops:

- JWT verification
- internal identity resolution
- entitlements fetch
- real OpenFGA check

This is now a real measured path, not a fake placeholder pipeline. OpenFGA is currently configured permissively so the call graph is real even though the authorization semantics are intentionally relaxed for now.

### Current Timing Shape

ZAR responses currently return timing breakdowns such as:

- `auth_ms`
- `identity_ms`
- `entitlements_ms`
- `fga_ms`
- `total_ms`

On onboarding-routed calls, responses also include:

- `downstream_ms`

This gives a baseline for the actual router cost before optimization work.

### Current OpenFGA State

- real OpenFGA service in compose
- real `/check` network hop from ZAR
- currently permissive behavior through the model/check context
- no attempt yet at final tuple model design

That is deliberate. The point right now is to establish the real boundary and measure its cost before modeling gets more detailed.

### Current Entitlement Behavior

ZAR reads org entitlements on authenticated requests from:

- `zoe_entitlements.org_entitlements`

Greenfield onboarding now grants all entitlement definitions found in:

- `zoe_entitlements.entitlements_def`

and records the corresponding audit trail in:

- `zoe_entitlements.entitlement_changes`

### Clerk / Onboarding Flow

The current greenfield flow is:

1. user signs up through Clerk
2. Clerk emits `organizationMembership.created`
3. ZAR webhook verifies and stores the event in onboarding DB
4. onboarding service checks onboarding state and event recency
5. onboarding writes:
   - internal org mapping
   - internal user mapping
   - owner role
   - customer properties
   - default entitlements
6. ZAR returns internal identity plus entitlements


It should be moved out into its own repo once the API contract stabilizes. It is not intended to remain co-deployed here as a permanent architectural choice.

## User Admin API

### Purpose

`user-admin/` is the settings and property-management API behind ZAR. It is no longer on a direct public route.

It currently owns:

- fetching all user property definitions joined with caller values
- fetching all org property definitions joined with org values
- updating user properties
- updating org properties, with owner verification

### Current Endpoints

- `GET /health`
- `GET /getUserProperties`
- `PUT /putUserProperties`
- `GET /getOrgProperties`
- `PUT /putOrgProperties`

### Current Behavior

- caller identity is forwarded from ZAR using internal IDs
- browser clients never call this service directly
- browser clients send only a Clerk JWT to ZAR
- user property routes trust caller self-scope
- org property routes verify owner role in Zoe core
- GET returns all defined properties with `null` for unset values
- PUT accepts partial updates keyed by `property_key`

### Temporary Repo Placement

`user-admin/` is also being left in this repo for convenience while the API contract and screens are being built out.

It should be moved into its own repo before any real deployment shape is treated as stable.

## Sample UI

### Current Purpose

The sample UI in this repo is a working development surface, not the long-term product frontend.

It currently exists to:

- exercise Clerk signup and sign-in
- exercise the ZAR public path
- exercise onboarding
- exercise the current org-admin surface
- provide a fast way to validate end-to-end auth, routing, and downstream API behavior

### Current State

The sample UI currently acts as:

- the Clerk login and signup surface
- the first post-login org-admin surface
- the easiest way to inspect ZAR and onboarding responses in a real browser flow

It is useful for proving the workflow, but it should not be confused with the final application frontend boundary.

## Edge

### Current Composition

`docker-compose.yml` currently brings up:

- `zar-edge-nginx`
- `zar-sample-ui`
- `zar-backend`
- `zoe-onboarding-api`
- `zoe-user-admin-api`
- `openfga`

All of them run on the internal Docker network:

- `zoe_czar`

Public path routing is currently handled by `nginx.edge.conf`. Downstream APIs are expected to stay internal and be reached through ZAR routes under `/api/<domain>/...`.

## TODOs

1. Add the Invite Users to Org flow.
2. Build the User Admin CRUD fully.
3. Add persistent OpenFGA storage instead of the current in-memory dev setup.
4. Replace the permissive OpenFGA model with real authorization tuples and route-level policy.
5. Add ZAR route-to-entitlement mapping instead of returning org entitlements only as diagnostic data.
6. Add detailed downstream timing breakdowns inside `onboarding` and `user-admin`.
7. Add the first real write path from the UI into `user-admin`.
8. Replace the sample UI with the real frontend boundary.
9. Add proper error-state UX for `pending`, `failed`, `403`, and dependency failures.
10. Add deployment separation so the co-located local compose shape is no longer the implied runtime architecture.

## Greenfield Onboarding Choices

### Purpose

Greenfield onboarding is the first-time path for a newly created org owner. Its job is to translate Clerk-side signup and organization membership state into Zoe internal identity, role, property, and entitlement state.

### Current Trigger Choice

The current trigger for greenfield onboarding is:

- verified Clerk `organizationMembership.created`
- with `data.role = 'org:admin'`

This event is written into `onboarding.events` by ZAR after webhook verification.

### Current State Tables

The current onboarding flow uses two tables in the onboarding database:

- `onboarding.events`
- `onboarding.status`

They have distinct roles:

- `events` answers whether the relevant trigger event has happened
- `status` answers whether onboarding is already complete for a specific `(user_id, org_id)` pair and what the current onboarding state is

### Current Endpoint Contract

The current onboarding API contract is centered on:

- `GET /getInternalUserAndOrg`

This endpoint is called after authentication and decides whether the caller is already onboarded, should be onboarded now, should remain pending, or should be treated as failed.

### Decision Order

The current decision order is:

1. check `onboarding.status` for the current `(user_id, org_id)` tuple
2. if `is_onboarded = true`, return the existing internal identity immediately
3. if not onboarded, inspect `onboarding.events`
4. if the required event exists and is recent enough, perform greenfield onboarding synchronously
5. if the required event does not exist, or is too old, return `pending` or `failed` according to recency rules

### What Counts As Pending

Current `pending` means:

- some onboarding-related event activity exists
- but the conditions needed to complete onboarding are not yet satisfied
- and the latest relevant event is still within the 60-second pending window

This is intended to represent “wait a bit longer, the system may still become ready.”

### What Counts As Failed

Current `failed` means one of:

- no qualifying greenfield event exists
- or the latest relevant event is older than 60 seconds

This is intended to represent “the expected event did not arrive in time, or the state is stale enough that the frontend should stop waiting.”

### What Counts As Completed

Current `completed` means:

- Zoe internal org and user mappings exist
- owner role exists and is active
- customer properties have been written
- default org entitlements have been written
- onboarding status has been marked complete

In the current API shape, the success status returned to the client is:

- `internal_user_details`

with:

- `org_ring`
- `display_name`

ZAR now suppresses internal user and org IDs from the browser-visible onboarding response.

### Current Write Behavior

When greenfield onboarding runs successfully, it currently writes:

- `zoe_czar.org_ring_map`
- `zoe_czar.user_map`
- `zoe_org_level_roles.user_roles`
- `zoe_org_level_roles.role_changes`
- `zoe_customer_details.company_properties`
- `zoe_customer_details.user_properties`
- `zoe_entitlements.org_entitlements`
- `zoe_entitlements.entitlement_changes`
- `onboarding.status`

The control-plane writes are done together in the greenfield execution path, and onboarding status is then marked complete.

### Current UI Behavior

The current browser flow is expected to behave like this after signup or sign-in to a new org-owner account:

1. user authenticates through Clerk
2. frontend calls ZAR
3. ZAR authenticates the request and routes to onboarding
4. if onboarding returns `internal_user_details`, the protected org-admin surface renders
5. if onboarding returns `pending`, the frontend keeps waiting and retries
6. if onboarding returns `failed`, the frontend stops retrying and shows a failure state

### Current Retry Choice

The current retry behavior is:

- initial onboarding call immediately after auth
- retry at 30 seconds
- retry at 60 seconds
- after that, stop retrying and treat the flow as failed if onboarding has still not completed

The UI-level timeout one layer above ZAR is set expecting roughly 62 seconds total.

### Current Protected-Page Expectation

On success, the first protected page currently proves that greenfield onboarding has succeeded by rendering:

- greeting using `display_name`
- `internal_user_id`
- `internal_org_id`
- current org-admin shell

This is a deliberate diagnostic surface for now. It proves the internal identity projection worked before the fuller CRUD screens are finished.

### Current Architectural Choice

The important current architectural choice is:

- onboarding runs synchronously when the required event exists
- it is not deferred to a separate worker once the deciding request has arrived

That choice keeps the first end-to-end greenfield slice simple and makes the browser-visible success state directly prove that the Zoe-side projection has completed.

## Important Note

This repo is currently serving two different needs at once:

1. building the real ZAR boundary
2. moving quickly on adjacent downstream APIs so the full workflow can be proven

That is acceptable for this development phase, but it is not the intended final repo boundary.

The long-term expectation is:

- ZAR stays as its own tightly scoped boundary service
- onboarding moves to its own repo/service
- user-admin moves to its own repo/service
- the sample UI is replaced by the real frontend surface
