# User Admin

This folder now contains the first Python service scaffold for Zoe user and
organization property administration.

Current scope:

- caller-scoped user property reads and writes
- owner-only org property reads and writes
- all property definitions returned, even when current values are unset
- writes are in-place updates only for now

Current stack:

- FastAPI
- psycopg
- boto3
- `uv`

Identity model:

- ZAR forwards `X-Internal-User-Id`
- ZAR forwards `X-Internal-Org-Id`
- `user-admin` trusts those for self-property targeting
- `user-admin` still verifies org-owner status for org-property routes

Endpoints:

- `GET /health`
- `GET /getUserProperties`
- `PUT /putUserProperties`
- `GET /getOrgProperties`
- `PUT /putOrgProperties`

GET response shape:

- object keyed by `property_key`
- each entry includes:
  - `property_key`
  - `description`
  - `value_type`
  - `current_value`

Runtime config:

- checked-in `.env` stores secret names only
- actual DB URL is fetched from AWS Secrets Manager at runtime
