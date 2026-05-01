# Status Note

As of May 1, 2026, `ZAR v0.2` has not yet been tested enough to be treated as the deployed development runtime. `dev` remains on `v0.1` until `v0.2` has been validated more thoroughly end-to-end.

## Goal

Build `ZAR v0.2` as a clean, config-driven router/policy layer without breaking the current working `v0.1` path.

The current code should remain in place while `v0.2` is designed and implemented beside it. We should switch only after the config-driven path is complete enough to replace the existing hardcoded routing behavior.

## Retentions From v0.1

These behaviors should remain true in `v0.2` unless deliberately changed later.

### Core runtime role
- ZAR remains the single authenticated browser-facing boundary
- downstream services remain internal-only
- clients continue to talk to ZAR, not to downstream APIs directly

### Current auth and policy path
- Clerk JWT verification remains in ZAR
- internal identity resolution remains in ZAR
- coarse entitlement fetch remains in ZAR
- fine-grained authorization checks remain in ZAR
- the availability gate remains part of the request path where required

### Current login/bootstrap behavior
- `sample_frontend` continues to bootstrap through ZAR only
- onboarding bootstrap remains a polling-based flow
- browser clients still must not receive internal Zoe IDs
- current terminal onboarding statuses remain valid:
  - `failed`
  - `internal_user_details`

### Current operational constraints
- fail closed on unknown/unconfigured paths
- downstream APIs remain internal to the shared runtime network
- ZAR remains the place where internal headers are injected before downstream calls
- Clerk webhook handling remains in ZAR

### Exact paths and behaviours retained from v0.1
- `GET /auth/session` remains a ZAR-owned authenticated session/bootstrap route
- `GET /onboarding/internal-user-and-org` remains a ZAR-owned browser-facing onboarding bootstrap route
- `POST /webhooks/clerk` remains a ZAR-owned Clerk webhook ingestion route
- Clerk webhook Svix signature verification remains in ZAR
- Clerk webhook events continue to be persisted by ZAR into onboarding event storage
- current webhook-trigger behavior is retained by default:
  - `organizationMembership.created` continues to upsert onboarding status for the `(user_id, org_id)` pair
- browser-facing onboarding bootstrap continues to strip internal Zoe ids before responding to the frontend

## Changes From v0.1

These are the deliberate design shifts relative to the current hardcoded implementation.

### Routing
- replace hardcoded per-endpoint routing with config-driven route resolution
- replace hardcoded upstream mappings with explicit upstream URL + path config
- replace hand-wired route behavior with method + path-template matching

### Policy declaration
- move route policy into config
- make availability enforcement config-driven per route
- make entitlement requirements config-driven per route
- make denial behavior config-driven instead of implicitly hardcoded

### Runtime config source
- stop treating local checked-in config as authoritative
- load the live `v0.2` schema from AWS Secrets Manager
- treat Secrets Manager as the only source of truth for the live runtime config

### Migration shape
- keep `v0.1` in place while `v0.2` is built beside it
- do not cut over all routes at once
- use temporary OpenAPI pass-through and selected-route migration first

## Additions In v0.2

These are net-new capabilities that do not exist cleanly in `v0.1` today.

### Protected config control
- add a protected endpoint to force ZAR to re-pull config from Secrets Manager at runtime
- likely protect this endpoint with an admin bearer token
- add a second protected endpoint to render / return the current loaded config
- likely protect this endpoint with the same admin bearer token
- define whether refresh is in-memory only or also persists diagnostics/logging

### Formal route config
- maintain a concrete sample schema in repo
- maintain the minimum viable entitlement inventory beside it
- keep sample config synchronized with actual container names and ports

### Temporary contract pass-through
- keep temporary OpenAPI routes during migration
- allow frontend-builder and other clients to inspect downstream contracts through ZAR while the config-driven router is coming up

## Core Design Principle

`ZAR v0.2` should be built around a real route/policy config, not around hardcoded per-endpoint logic with YAML added on top later.

The sequence should be:

1. finalize the config schema
2. gather the route inventory
3. define backend/upstream mapping
4. define entitlement and availability policy per route
5. implement a config-driven matcher/evaluator/router
6. run `v0.1` and `v0.2` side by side until cutover is safe

## Config Design

### Finalize the route schema
- decide whether the YAML remains list-based or should become key-based
- preserve full externally visible paths in config
- preserve method-specific route entries
- preserve per-route ring overrides
- preserve mandatory per-route `default`
- preserve fail-closed behavior for any unconfigured route
- preserve explicit upstream base URL plus upstream path template
- preserve `require_available`
- preserve `all_of` and `any_of` entitlement conditions
- preserve configurable denial behavior

### Finalize ring semantics
- ring resolution is org-level only
- use numeric ring ids in config
- define how ring-specific overrides fall back to `default`
- confirm that current multi-ring entries can temporarily point at the same working backend where necessary

### Finalize policy semantics
- define unconfigured route behavior
- define ring-denied behavior
- define entitlement-denied behavior
- define unavailable-denied behavior
- keep those denial choices config-driven so test and prod can differ

### Finalize path-template semantics
- support templated paths
- support precedence rules
- static paths should outrank templated ones
- more specific routes should outrank less specific routes
- define how path params are substituted into upstream paths

## Route Inventory

### Capture all current browser-facing/support routes
- auth/session
- onboarding bootstrap
- invitation lookup
- user-admin surface
- data-plane user surface
- temporary OpenAPI pass-through routes

### Capture all current internal support routes that matter to ZAR
- onboarding-api bootstrap contract
- user-admin contract
- webhook path
- downstream OpenAPI exposure for temporary discovery and frontend-builder use

## Entitlements And Policy Model

### Separate coarse entitlements from relation predicates
- keep coarse org-level feature access in `zoe_entitlements.entitlements_def`
- do not treat `org.admin`, `matter.member`, or `matter.editor` as entitlements
- treat those as role / relation / FGA predicates instead

### Finalize minimum viable entitlements
- user profile
- org profile
- invite flow
- matters
- uploads
- assets
- derivatives

### Define how route policy combines
- coarse entitlements
- availability gate
- fine-grained FGA checks
- role/relation predicates

## Router Implementation

### Add a config loader
- validate the config at startup
- fail startup cleanly on invalid config

### Add a route matcher
- match public path + method against configured templates
- resolve the winning route deterministically
- extract path params
- build the upstream path

### Add a policy evaluator
- resolve caller identity
- resolve org ring
- resolve route entry
- enforce availability when required
- enforce coarse entitlements
- enforce fine-grained FGA where required
- apply configured denial behavior

### Add an upstream dispatcher
- call the configured backend URL
- forward query params transparently
- forward body transparently
- inject internal headers only after identity resolution
- preserve response status/body/headers as appropriate

### Add observability
- log matched route id/path/method
- log chosen ring rule
- log chosen upstream
- log policy decision outcome
- include timing blocks for matcher/policy/downstream phases

## Webhooks

### Keep Clerk webhook handling in scope
- confirm current Clerk webhook path remains in ZAR
- document exactly which events are only stored vs which trigger onboarding state
- decide whether webhook behavior remains hardcoded in `v0.2` or gets partially config-described later

## OpenAPI Pass-Through

### Keep temporary OpenAPI routes during migration
- onboarding-api openapi
- user-admin-api openapi
- kms-provisioning-api openapi
- s3-provisioning-api openapi
- data-plane user/admin openapi

### Use this to support parallel consumers
- frontend-builder should be able to pull contracts from ZAR temporarily
- route coverage can be validated through pass-through before full cutover

## Migration Plan

### Keep v0.1 intact
- do not break the current login/bootstrap flow while building `v0.2`
- do not remove the current hardcoded routes until parity exists

### Build v0.2 beside v0.1
- add a separate config-driven path internally
- route selected endpoints through it first
- compare behavior against existing hardcoded flow

### Cut over incrementally
- start with low-risk pass-through routes
- then onboarding/user-admin routes
- then data-plane routes
- only remove old hardcoded routing after confidence is high

## Testing

### Config validation tests
- invalid schema
- duplicate route definitions
- missing per-route default
- bad upstream path template

### Matcher tests
- exact path vs templated path precedence
- method differentiation
- path param extraction

### Policy tests
- ring override selection
- default fallback
- availability allowed/denied
- coarse entitlement allowed/denied
- relation/FGA predicate allowed/denied
- denial-behavior shaping

### Integration tests
- auth/session through v0.2
- onboarding/internal-user-and-org through v0.2
- user-admin property routes through v0.2
- OpenAPI pass-through routes through v0.2
- representative data-plane routes through v0.2

## Deliverables
- finalized config schema
- maintained sample config in repo
- maintained minimum viable entitlement list in repo
- config-driven route matcher
- config-driven policy evaluator
- config-driven upstream dispatcher
- Secrets Manager-backed config load path
- temporary OpenAPI pass-through support
- migration plan from `v0.1` to `v0.2`
