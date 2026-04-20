# ZAR

## Overview

This repo currently contains three API surfaces plus a sample UI and local edge wiring:

- `backend/` — ZAR itself
- `onboarding/` — greenfield onboarding API
- `user-admin/` — property-editing API
- `sample_frontend/` — Clerk test UI and current org-admin surface
- `docker-compose.yml` / `nginx.edge.conf` — local and dev-machine edge composition

Only `backend/` is the actual Zoe Authorized Router. `onboarding/` and `user-admin/` are temporarily co-located here for speed while the contracts settle. They are not intended to remain in this repo for real deployment.

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
4. nginx routes to:
   - `sample-ui`
   - `zar-backend`
   - `zoe-onboarding-api`
   - `zoe-user-admin-api`
5. ZAR performs:
   - Clerk JWT verification
   - internal identity resolution from Zoe core
   - org entitlement fetch from Zoe core
   - real OpenFGA network check
6. ZAR forwards to the appropriate downstream API

### Current Stack

- public entry: `dev.zoe-legal.net`
- edge: nginx in Docker
- auth provider: Clerk
- entitlement store: Zoe control-plane Postgres / Neon
- fine-grained authorization: real OpenFGA container
- deployment target: EC2 behind ALB

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

## Onboarding API

### Purpose

`onboarding/` is the greenfield onboarding service behind ZAR.

It currently owns:

- checking whether a Clerk user is already onboarded
- checking whether the relevant onboarding event exists and is fresh
- performing the full greenfield projection into Zoe core

### Current Endpoint

- `GET /getInternalUserAndOrg`

Current success response returns:

- `internal_org_id`
- `internal_user_id`
- `org_ring`
- `display_name`

### Current Data Sources

- onboarding DB:
  - `onboarding.events`
  - `onboarding.status`
- control-plane DB:
  - `zoe_czar.*`
  - `zoe_org_level_roles.*`
  - `zoe_customer_details.*`
  - `zoe_entitlements.*`

### Temporary Repo Placement

`onboarding/` is being left in this repo for convenience while the end-to-end flow is being built and debugged.

It should be moved out into its own repo once the API contract stabilizes. It is not intended to remain co-deployed here as a permanent architectural choice.

## User Admin API

### Purpose

`user-admin/` is the settings and property-management API behind ZAR.

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

Public path routing is currently handled by `nginx.edge.conf`.

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
