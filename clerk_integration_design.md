# Clerk Integration Design

Date: 2026-04-19

This document captures the planned Clerk integration flows for Zoe identity
onboarding and org membership. It is intentionally incremental: each flow should
be designed and implemented separately so the identity boundary stays clear.

## Current Position

Clerk is the external identity provider. Zoe keeps its own internal identity and
authorization model.

The first Clerk configuration is intentionally minimal:

- username sign-up/sign-in
- password authentication
- no email verification requirement
- no social login
- no phone auth
- no MFA

Email-based authentication and email verification will be added later after the
email integration exists.

The initial mapping rule is:

- Clerk organization ID maps to `zoe_czar.org_ring_map.external_org_id`.
- Clerk user ID maps to `zoe_czar.user_map.external_user_id`.
- `external_org_id_source = 'clerk'`.
- `external_user_id_source = 'clerk'`.
- Zoe generates and owns `internal_org_id` and `internal_user_id`.

Clerk authentication proves who the user is. Zoe authorization remains Zoe-owned
through internal IDs, org-level roles, entitlements, and later ZAR/OpenFGA checks.

## Planned Flows

The known Clerk integration flows are:

1. Greenfield signup: a new user signs up and gets a new org automatically.
2. Returning user: an existing user returns and uses an existing org membership.
3. Firm invite: a user invites another firm-side user into their org.
4. Customer invite: a user invites their customer into the org to share data,
   using the `client_customer` role.

Only flow 1 is specified here. The remaining flows are intentionally deferred.

## Flow 1: Greenfield Signup

### Scenario

A new user signs up for Zoe for the first time. They did not arrive through an
invite. No Zoe user mapping or Zoe org mapping exists yet.

For now, signup automatically creates a Clerk org for that user. There is no
separate Zoe org creation step.

### Desired Result

After signup, Zoe should have:

- one org mapping for the Clerk org
- one user mapping for the Clerk user inside that org
- one active org-level role assigning the user as `owner`
- initial org display properties
- initial user profile properties copied from Clerk
- one role audit row for the owner assignment

### Flow Shape

The preferred greenfield path is app-driven after Clerk signup completes:

1. User completes Clerk signup.
2. The app ensures there is a default Clerk organization for the user.
3. The app receives or selects that Clerk org as the user's active org.
4. The app calls Zoe's greenfield onboarding endpoint with the Clerk-authenticated
   user and org context.
5. Zoe verifies the Clerk identity and verifies that the user owns/administers
   the Clerk org.
6. Zoe performs one idempotent database transaction to create the Zoe projection.

Clerk webhooks may still be useful as reconciliation/backstop later, but they are
not the primary greenfield signup path.

### Implementation Placement

The first working implementation may live in `admin-console/server.ts` as a
bootstrap/prototype endpoint because that server already has control-plane
database access and schema bindings.

This is not the final application boundary. In the production architecture, this
flow should be handled by Zoe Authorized Router (ZAR) or by a service reachable
only through ZAR. ZAR remains the long-term owner of authentication, identity
resolution, entitlement checks, and protected route admission.

### Atomicity Rule

Zoe cannot make Clerk's external user/org creation and Zoe's database writes one
distributed transaction.

Zoe can and should make the Zoe-side projection atomic:

- `org_ring_map`
- `user_map`
- `user_roles`
- `role_changes`
- `company_properties`
- `user_properties`

All Zoe-side writes for this flow should succeed or fail together.

The operation must also be idempotent. If the frontend retries after a timeout,
Zoe should return the existing mapping rather than creating duplicates.

### Org Mapping

For greenfield signup:

- `external_org_id_source = 'clerk'`
- `external_org_id = clerk_org_id`
- `org_ring = 4`

Ring 4 is the default production ring for now.

### User Mapping

For greenfield signup:

- `external_user_id_source = 'clerk'`
- `external_user_id = clerk_user_id`
- `external_org_id_source = 'clerk'`
- `external_org_id = clerk_org_id`
- `internal_org_id` comes from the Zoe org mapping created or found above

### Owner Role

The signing user is assigned:

- `role_key = 'owner'`
- `current_status = 'active'`

The role assignment is org-scoped and lives in
`zoe_org_level_roles.user_roles`.

### Role Audit

The initial owner assignment should create a role audit row:

- `change_type = 'assigned'`
- `previous_role_key = null`
- `new_role_key = 'owner'`
- `previous_status = null`
- `new_status = 'active'`
- `actor_type = 'system'`
- `actor_id = 'greenfield_onboarding'`
- `change_reason = 'greenfield signup owner assignment'`

On an idempotent retry where the user already has active owner status, Zoe should
not create duplicate audit rows.

### Org Properties

The default org name comes from the user's name, then username:

- full name present: `{First Last}'s Firm`
- first name only: `{First}'s Firm`
- username present: `{username}'s Firm`
- no usable name: `My Firm`

For greenfield signup, Zoe stores:

- `company_name = default org name`
- `company_display_name = default org name`

These company properties should be created only if missing during onboarding
retries. This protects a Zoe-side org rename from being overwritten by a retry.

### User Properties

Zoe stores initial user properties directly from Clerk:

- `user_first_name`
- `user_last_name`
- `user_display_name`
- `user_email`, when available

Email is optional in the first username/password-only Clerk setup. The greenfield
flow must not require email until email-based authentication is enabled.

During onboarding retries, user properties may be updated from Clerk. These are
treated as cached Clerk profile fields for now.

### Security Requirements

Before this endpoint is exposed outside local development, Zoe must verify:

- the Clerk JWT is valid
- the request's Clerk user ID matches the authenticated user
- the Clerk org ID belongs to the authenticated user
- the authenticated user is the creator/admin/owner of that Clerk org for this
  greenfield flow

If any check fails, the endpoint must fail closed.

### Secret Management

Local development may use ignored local config such as
`admin-console/config.json` for `clerk_secret_key`.

Production must not load Clerk secrets from committed files or manually managed
local config. Zoe should load Clerk backend credentials from AWS Secrets Manager
or an equivalent managed secret store. This matches the broader security
principle in `zoe_security_design_overview.md`: no hardcoded credentials, and
credentials should be distributed through a controlled secret-management path.

### Deferred Questions

These are intentionally not decided in this flow:

- returning user request resolution
- ZAR active-org behavior
- invite acceptance behavior
- customer invite behavior
- Clerk webhook reconciliation details
- profile sync outside onboarding
- org rename sync between Clerk and Zoe
