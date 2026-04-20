# Clerk Integration Design

Date: 2026-04-20

## Purpose

This document captures the current chosen Clerk integration shape for ZAR and the APIs behind it.

It is no longer a speculative greenfield-only design note. It should describe the actual boundary choices we are using now:

- Clerk is the external identity provider
- ZAR is the authenticated boundary
- onboarding is a downstream API behind ZAR
- user-admin is a downstream API behind ZAR

## Current Position

Clerk proves external identity. Zoe continues to own:

- internal user identity
- internal org identity
- org-scoped roles
- entitlements
- fine-grained authorization

The current external-to-internal mapping rule is:

- Clerk org ID maps to `zoe_czar.org_ring_map.external_org_id`
- Clerk user ID maps to `zoe_czar.user_map.external_user_id`
- `external_org_id_source = 'clerk'`
- `external_user_id_source = 'clerk'`

Zoe generates and owns:

- `internal_org_id`
- `internal_user_id`

## Boundary Choice

The current boundary split is:

- Clerk handles signup, sign-in, session management, and webhook emission
- ZAR authenticates requests and routes them
- onboarding performs Zoe-side greenfield projection
- user-admin performs Zoe-side property CRUD

ZAR is intentionally not absorbing the onboarding or user-admin business logic.

## Current Clerk Configuration

The current Clerk setup is intentionally narrow:

- username/password sign-up and sign-in
- no required email verification in the initial flow
- no social login
- no phone authentication
- no MFA

This is a deliberate first slice. The point is to get identity, routing, onboarding, and downstream APIs working before broadening the auth product surface.

## Known Clerk Flows

The known Clerk-related flows are:

1. Greenfield signup
2. Returning user sign-in
3. Invite user into existing org
4. Customer-facing invite flow later

Only flows 1 and 2 have been materially exercised so far. Invite flows are still TODO work.

## Greenfield Signup

### Current Trigger Choice

The current greenfield trigger is:

- verified Clerk `organizationMembership.created`
- with `data.role = 'org:admin'`

This event is processed by ZAR after webhook signature verification.

### Why This Trigger Was Chosen

The current design does not depend on the frontend directly constructing the full Zoe-side onboarding projection.

Instead:

- Clerk webhook delivery creates the durable event record
- onboarding uses that event to decide whether it can complete greenfield onboarding
- the browser-visible protected flow keeps retrying while onboarding is still plausibly in flight

This makes the webhook path the authoritative trigger for greenfield completion, with the browser path acting as the synchronizing request path.

## Current Webhook Handling

ZAR currently exposes:

- `POST /webhooks/clerk`

The current webhook path does:

1. receive the Clerk webhook
2. verify Svix signature
3. store every verified event into `onboarding.events`
4. treat `organizationMembership.created` with `role = 'org:admin'` as the greenfield event of interest
5. upsert `onboarding.status` as needed

The webhook path is now live and writing successfully to the onboarding database.

## Current Greenfield Decision Flow

After auth, the protected flow calls ZAR, and ZAR routes to onboarding.

The current onboarding decision sequence is:

1. check `onboarding.status`
2. if the user is already onboarded, return existing internal identity
3. if not onboarded, inspect `onboarding.events`
4. if the qualifying Clerk event exists and is recent enough, run greenfield onboarding synchronously
5. if the qualifying event is missing or stale, return `pending` or `failed`

### Current Pending Rule

Current `pending` means:

- relevant onboarding activity exists
- but the full conditions for completion are not yet satisfied
- and the latest relevant event is still within the 60-second pending window

### Current Failed Rule

Current `failed` means:

- no qualifying greenfield event exists
- or the latest relevant event is older than 60 seconds

### Current Success Rule

Current success means onboarding returns:

- `status = internal_user_details`
- `internal_org_id`
- `internal_user_id`
- `org_ring`
- `display_name`

ZAR then includes entitlements and timing breakdowns in the routed response.

## Current Greenfield Writes

When greenfield onboarding runs successfully, the current Zoe-side projection writes:

- `zoe_czar.org_ring_map`
- `zoe_czar.user_map`
- `zoe_org_level_roles.user_roles`
- `zoe_org_level_roles.role_changes`
- `zoe_customer_details.company_properties`
- `zoe_customer_details.user_properties`
- `zoe_entitlements.org_entitlements`
- `zoe_entitlements.entitlement_changes`
- `onboarding.status`

The intended result is:

- one internal org
- one internal user
- one active owner role
- initial org properties
- initial user properties
- full default entitlement set
- completed onboarding status

## Current Org Naming Choice

The current org property behavior is:

- if Clerk sends `organization.name`, use that
- otherwise fall back to a Zoe-owned synthetic firm name

The current intent is to keep the “firm” concept as a Zoe-side construct for now rather than treating Clerk org naming as the full long-term source of truth.

## Current User Property Choice

The current initial user properties copied from Clerk are:

- `user_first_name`
- `user_last_name`
- `user_display_name`
- `user_email`, when the identifier is an email

The event payload is not being treated as a rich business profile source. It is being used only for the fields that are clearly useful right now.

## Returning User Sign-In

For a returning already-onboarded user:

1. Clerk session token reaches ZAR
2. ZAR verifies JWT
3. ZAR resolves internal identity
4. ZAR reads entitlements
5. ZAR performs OpenFGA check
6. onboarding returns existing internal identity immediately from current mappings/status

This is now a real measured path with timing breakdowns.

## Current UI Behavior

The current UI behavior during the protected flow is:

1. authenticate with Clerk
2. call ZAR
3. ZAR routes to onboarding
4. if onboarding succeeds, render the protected/org-admin surface
5. if onboarding is pending, keep retrying
6. if onboarding fails after the retry window, stop and show failure

The current retry pattern is:

- initial call immediately
- retry at 30 seconds
- retry at 60 seconds
- fail after that if onboarding still has not completed

## Security Requirements

The current design assumes:

- Clerk JWT must be valid
- webhook signature must be valid
- ZAR is the only admitted application boundary
- internal identity is resolved inside Zoe, not trusted from the browser
- entitlements remain Zoe-owned
- fine-grained authorization remains Zoe-owned through OpenFGA

The browser does not get to choose internal IDs. It only carries Clerk-authenticated context.

## Secrets And Runtime Config

The current runtime secret-management path is:

- committed config files contain secret locators and non-secret config
- AWS Secrets Manager contains sensitive runtime values

Current sensitive values include:

- Clerk secret key
- Clerk webhook signing secret
- control-plane database URL
- onboarding database URL

This is already live in the current dev activation path.

## Open Questions / Deferred Work

These are still deliberately open:

- invite-user-to-org flow
- customer invite flow
- final OpenFGA model and tuples
- whether and how Clerk profile/org changes should sync after onboarding
- how much of the current sample UI remains as a long-term frontend concern
- when `onboarding` and `user-admin` move into their own repos and deployment units
