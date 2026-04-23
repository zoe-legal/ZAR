# Onboarding API

This service is the Zoe onboarding projection service that sits behind ZAR.

It does not authenticate browser users directly. ZAR verifies the Clerk JWT, resolves the caller context, and then calls this service with Clerk identifiers in headers.

Current purpose:

- read org-scoped onboarding state from `zoe_control_plane.zoe_onboarding`
- read stored onboarding webhook events from `zoe_control_plane.zoe_onboarding`
- project a Clerk membership into Zoe core when the mapping does not yet exist
- return the resulting Zoe internal identity for the active org
- expose public invitation-context lookup for the accept-invitation page

## Current Stack

- FastAPI
- psycopg
- psycopg_pool
- boto3
- `uv`

## Runtime Configuration

Environment is minimal and checked in via `.env`:

- `AWS_REGION`
- `CONTROL_PLANE_SECRET_ID`

The service reads the control-plane database URL from AWS Secrets Manager at runtime. It accepts any of these keys in the secret payload:

- `zoe_control_plane_database_url`
- `control_plane_database_url`
- `database_url`

Port defaults to `8790`.

## Database Boundary

This service now uses the control-plane database only.

Relevant schemas:

- `zoe_onboarding`
- `zoe_czar`
- `zoe_org_level_roles`
- `zoe_customer_details`
- `zoe_entitlements`

This is important because onboarding state and Zoe projection now live in the same database. That allows the projection writes and onboarding completion update to happen inside one database transaction.

## Endpoints

- `GET /health`
- `GET /getInvitationDetails`
- `GET /getInternalUserAndOrg`

### `GET /health`

Simple service health response.

### `GET /getInvitationDetails`

Public lookup endpoint used by the invite landing page.

Accepted query params:

- `zoe_invitation_id`
- `clerk_invitation_id`

One of them is required.

Current behavior:

- looks up `zoe_onboarding.invitations`
- returns invite context if found
- returns `404 invitation_not_found` otherwise

Returned fields include:

- `zoe_invitation_id`
- `clerk_invitation_id`
- `invitation_type`
- `clerk_org_id`
- `org_display_name`
- `invited_email`
- `zoe_role_key`
- `valid_until`
- `accepted_at`
- `revoked_at`

### `GET /getInternalUserAndOrg`

This is the core onboarding decision endpoint.

Accepted identity inputs:

- query params:
  - `clerk_user_id`
  - `clerk_org_id`
- or forwarded headers:
  - `X-Clerk-User-Id`
  - `X-Clerk-Org-Id`

In practice, ZAR is expected to call this with headers.

## Core Decision Flow

The decision is always org-scoped.

The meaningful identity for onboarding state is:

- `(clerk_user_id, clerk_org_id)`

The service does this:

1. Require a Clerk user id.
2. If an org id is already known, check `zoe_onboarding.status` for `(user_id, org_id)`.
3. If status says `is_onboarded = true`, resolve the existing Zoe internal mapping and return it.
4. Otherwise, read the latest `organizationMembership.created` event from `zoe_onboarding.events`.
5. Reject the flow if there is no event or the event is stale.
6. Use the event org id if the request did not already include one.
7. Recheck status for the effective `(user_id, org_id)`.
8. If still not onboarded:
   - if the org already exists in Zoe, provision an invited user
   - otherwise, provision a greenfield user and org
9. Mark `zoe_onboarding.status` complete in the same database transaction as the projection.
10. Return the resulting internal identity.

The current pending window is 60 seconds.

## Status Meanings

Status is stored in:

- `zoe_onboarding.status`

Primary key:

- `(user_id, org_id)`

Important fields:

- `needs_onboarding`
- `is_onboarded`

Current interpretation:

- `is_onboarded = true`
  - Zoe core mapping should already exist for this user+org pair
- missing status row
  - the service relies on the membership event and provisions if appropriate
- no recent membership event
  - return failure

The endpoint itself can return:

- `status = "internal_user_details"`
- `status = "pending"`
- `status = "failed"`

Common failure reasons:

- `no_membership_event`
- `membership_event_stale`
- `org_id_not_available`

## Event Dependency

This service depends on Clerk membership webhook events already being stored in:

- `zoe_onboarding.events`

The triggering event type for projection is:

- `organizationMembership.created`

This service does not verify the Clerk webhook itself. ZAR receives the webhook and stores:

- event payload
- onboarding status seed/update

This service consumes that stored event later during the authenticated request path.

## Greenfield Provisioning

Greenfield means:

- the Clerk membership event references an org that does not yet exist in Zoe

Current greenfield write set:

- create or upsert org mapping in `zoe_czar.org_ring_map`
- create or upsert user mapping in `zoe_czar.user_map`
- assign owner role in `zoe_org_level_roles.user_roles`
- write corresponding role history in `zoe_org_level_roles.role_changes`
- upsert company properties:
  - `company_name`
  - `company_display_name`
- upsert user properties:
  - `user_first_name`
  - `user_last_name`
  - `user_display_name`
  - `user_email`
- grant all currently defined entitlements to the org
- mark `(user_id, org_id)` as onboarded in `zoe_onboarding.status`

Greenfield currently defaults the org ring to:

- `4`

## Invite Provisioning

Invite onboarding means:

- the Clerk membership event references an org that already exists in Zoe

Current invite write set:

- resolve the existing internal org from `zoe_czar.org_ring_map`
- create or upsert an org-scoped user mapping in `zoe_czar.user_map`
- extract the invited Zoe role from the Clerk membership event metadata
- assign that role in `zoe_org_level_roles.user_roles`
- write role history in `zoe_org_level_roles.role_changes`
- upsert user properties:
  - `user_first_name`
  - `user_last_name`
  - `user_display_name`
  - `user_email`
- mark `(user_id, org_id)` as onboarded in `zoe_onboarding.status`

This is the critical multi-org behavior:

- one Clerk human can map to multiple internal users
- there is one internal user per org context

## Invitation Lookup

The invitation lookup path is intentionally separate from the projection path.

The purpose of `zoe_onboarding.invitations` is:

- store Zoe-owned invite context
- provide stable invite-page rendering
- retain the Clerk invitation id as the bridge to Clerk

The service currently treats `zoe_invitation_id` as the preferred lookup key and keeps `clerk_invitation_id` support for fallback/transition purposes.

## Service Timings

Responses include `service_timings` with endpoint-specific timing detail.

Examples:

- `zoe_onboarding_neon_ms`
- `control_plane_neon_ms`
- `event_lookup_ms`
- `provision_ms`
- `total_ms`

These timings are used by ZAR when building the broader request timing picture.

## Local Run

```bash
cd onboarding
uv run uvicorn app.main:app --reload --port 8790
```

## Important Constraints

- This service assumes Clerk membership events have already been written to `zoe_onboarding.events`.
- It is not the source of webhook truth; ZAR is.
- It is still intentionally narrow: onboarding projection plus invitation detail lookup.
- It does not yet own broader org listing, org switching, or admin browsing concerns.
