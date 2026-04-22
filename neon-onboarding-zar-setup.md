# Neon Onboarding ZAR Setup

Date: 2026-04-19

## Project

Create a Neon project for ZAR.

- Project name: `ZAR`
- Region: AWS US West 1, if available
- Postgres version: 17

## Onboarding Schema And Tables

Status: completed in the default Neon database `neondb`.

Run this SQL in the ZAR Neon database:

```sql
create schema if not exists onboarding;

create table if not exists onboarding.status (
  user_id text not null,
  org_id text not null,
  needs_onboarding boolean not null default true,
  is_onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint onboarding_status_consistency_check
    check (not (needs_onboarding and is_onboarded)),

  constraint status_pkey
    primary key (user_id, org_id)
);

create table if not exists onboarding.events (
  event_id text primary key,
  event_source text not null,
  user_id text not null,
  org_id text,
  event_type text not null,
  event_time timestamptz not null,
  event_dict jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists onboarding_events_user_received_idx
  on onboarding.events (user_id, received_at desc);

create index if not exists onboarding_events_org_received_idx
  on onboarding.events (org_id, received_at desc)
  where org_id is not null;
```

## Secrets Manager

ZAR backend local/deployed startup uses AWS Secrets Manager, not local secret files.

Backend non-secret locator config:

```json
{
  "aws_region": "us-west-1",
  "clerk_secret_id": "devconfig",
  "onboarding_database_secret_id": "zar_onboarding_db_config"
}
```

Required secret keys:

- `devconfig.clerk_secret_key`
- `devconfig.clerk_webhook_signing_secret`
- `zar_onboarding_db_config.zar_onboarding_db_url`

## Clerk Webhook Endpoint

ZAR receives Clerk webhooks at:

```text
POST /webhooks/clerk
```

Behavior:

- verifies Svix webhook headers before processing
- stores every verified Clerk event in `onboarding.events`
- treats `organizationMembership.created` with `role = 'org:admin'` as the greenfield trigger
- upserts `onboarding.status` for that Clerk user/org
- does not yet write to Zoe core identity tables
