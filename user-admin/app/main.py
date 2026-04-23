from __future__ import annotations

import json
from uuid import uuid4
from datetime import UTC, datetime
from time import perf_counter
from typing import Any
from urllib import error, request

from fastapi import FastAPI, Header, HTTPException

from .config import get_settings
from .db import control_plane_connection


app = FastAPI(title="Zoe User Admin", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    settings = get_settings()
    return {
        "ok": "true",
        "service": "zoe-user-admin",
        "aws_region": settings.aws_region,
    }


@app.get("/getUserProperties")
def get_user_properties(
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    acquire_started = perf_counter()
    with control_plane_connection() as conn:
        pool_acquire_ms = elapsed_ms(acquire_started)
        fetch_started = perf_counter()
        properties = fetch_user_properties(conn, identity["internal_org_id"], identity["internal_user_id"])
        neon_ms = elapsed_ms(fetch_started)
        response_build_started = perf_counter()
        response = {
            **properties,
            "service_timings": [{
                "service": "zoe-user-admin",
                "endpoint": "/getUserProperties",
                "timings": {
                    "pool_acquire_ms": pool_acquire_ms,
                    "neon_ms": neon_ms,
                    "response_build_ms": 0.0,
                    "total_ms": 0.0,
                },
            }],
        }
        response_build_ms = elapsed_ms(response_build_started)
        response["service_timings"][0]["timings"]["response_build_ms"] = response_build_ms
        response["service_timings"][0]["timings"]["total_ms"] = round(pool_acquire_ms + neon_ms + response_build_ms, 2)
    return response


@app.put("/putUserProperties")
def put_user_properties(
    payload: dict[str, str | None],
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    acquire_started = perf_counter()
    with control_plane_connection() as conn:
        pool_acquire_ms = elapsed_ms(acquire_started)
        update_started = perf_counter()
        apply_user_property_updates(conn, identity["internal_org_id"], identity["internal_user_id"], payload)
        update_ms = elapsed_ms(update_started)
        fetch_started = perf_counter()
        properties = fetch_user_properties(conn, identity["internal_org_id"], identity["internal_user_id"])
        neon_ms = elapsed_ms(fetch_started)
        response_build_started = perf_counter()
        response = {
            **properties,
            "service_timings": [{
                "service": "zoe-user-admin",
                "endpoint": "/putUserProperties",
                "timings": {
                    "pool_acquire_ms": pool_acquire_ms,
                    "update_ms": update_ms,
                    "neon_ms": neon_ms,
                    "response_build_ms": 0.0,
                    "total_ms": 0.0,
                },
            }],
        }
        response_build_ms = elapsed_ms(response_build_started)
        response["service_timings"][0]["timings"]["response_build_ms"] = response_build_ms
        response["service_timings"][0]["timings"]["total_ms"] = round(pool_acquire_ms + update_ms + neon_ms + response_build_ms, 2)
    return response


@app.get("/getOrgProperties")
def get_org_properties(
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    acquire_started = perf_counter()
    with control_plane_connection() as conn:
        pool_acquire_ms = elapsed_ms(acquire_started)
        owner_started = perf_counter()
        ensure_owner(conn, identity["internal_org_id"], identity["internal_user_id"])
        owner_check_ms = elapsed_ms(owner_started)
        fetch_started = perf_counter()
        properties = fetch_org_properties(conn, identity["internal_org_id"])
        neon_ms = elapsed_ms(fetch_started)
        response_build_started = perf_counter()
        response = {
            **properties,
            "service_timings": [{
                "service": "zoe-user-admin",
                "endpoint": "/getOrgProperties",
                "timings": {
                    "pool_acquire_ms": pool_acquire_ms,
                    "owner_check_ms": owner_check_ms,
                    "neon_ms": neon_ms,
                    "response_build_ms": 0.0,
                    "total_ms": 0.0,
                },
            }],
        }
        response_build_ms = elapsed_ms(response_build_started)
        response["service_timings"][0]["timings"]["response_build_ms"] = response_build_ms
        response["service_timings"][0]["timings"]["total_ms"] = round(pool_acquire_ms + owner_check_ms + neon_ms + response_build_ms, 2)
    return response


@app.put("/putOrgProperties")
def put_org_properties(
    payload: dict[str, str | None],
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    acquire_started = perf_counter()
    with control_plane_connection() as conn:
        pool_acquire_ms = elapsed_ms(acquire_started)
        owner_started = perf_counter()
        ensure_owner(conn, identity["internal_org_id"], identity["internal_user_id"])
        owner_check_ms = elapsed_ms(owner_started)
        update_started = perf_counter()
        apply_org_property_updates(conn, identity["internal_org_id"], payload)
        update_ms = elapsed_ms(update_started)
        fetch_started = perf_counter()
        properties = fetch_org_properties(conn, identity["internal_org_id"])
        neon_ms = elapsed_ms(fetch_started)
        response_build_started = perf_counter()
        response = {
            **properties,
            "service_timings": [{
                "service": "zoe-user-admin",
                "endpoint": "/putOrgProperties",
                "timings": {
                    "pool_acquire_ms": pool_acquire_ms,
                    "owner_check_ms": owner_check_ms,
                    "update_ms": update_ms,
                    "neon_ms": neon_ms,
                    "response_build_ms": 0.0,
                    "total_ms": 0.0,
                },
            }],
        }
        response_build_ms = elapsed_ms(response_build_started)
        response["service_timings"][0]["timings"]["response_build_ms"] = response_build_ms
        response["service_timings"][0]["timings"]["total_ms"] = round(pool_acquire_ms + owner_check_ms + update_ms + neon_ms + response_build_ms, 2)
    return response


@app.post("/createOrgInvite")
def create_org_invite(
    payload: dict[str, str | None],
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    acquire_started = perf_counter()
    with control_plane_connection() as conn:
        pool_acquire_ms = elapsed_ms(acquire_started)
        owner_started = perf_counter()
        ensure_owner(conn, identity["internal_org_id"], identity["internal_user_id"])
        owner_check_ms = elapsed_ms(owner_started)

        email_address = required_payload_string(payload, "email_address")
        zoe_role_key = required_payload_string(payload, "role_key")
        redirect_url = optional_payload_string(payload, "redirect_url")
        zoe_invitation_id = str(uuid4())
        validate_role_started = perf_counter()
        validate_role_exists(conn, zoe_role_key)
        external_org_id = get_clerk_org_id(conn, identity["internal_org_id"])
        validate_role_ms = elapsed_ms(validate_role_started)

        clerk_started = perf_counter()
        invitation = create_clerk_org_invitation(
            organization_id=external_org_id,
            email_address=email_address,
            zoe_role_key=zoe_role_key,
            redirect_url=build_zoe_invitation_redirect_url(redirect_url, zoe_invitation_id),
        )
        clerk_api_ms = elapsed_ms(clerk_started)

        persist_started = perf_counter()
        persist_invitation(
            conn,
            zoe_invitation_id=zoe_invitation_id,
            invitation=invitation,
            clerk_org_id=external_org_id,
            invited_email=email_address,
            zoe_role_key=zoe_role_key,
            created_by_internal_user_id=identity["internal_user_id"],
            internal_org_id=identity["internal_org_id"],
        )
        persist_ms = elapsed_ms(persist_started)

        response_build_started = perf_counter()
        response = {
            "zoe_invitation_id": zoe_invitation_id,
            "id": invitation.get("id"),
            "email_address": invitation.get("email_address", email_address),
            "role": invitation.get("role"),
            "status": invitation.get("status"),
            "zoe_role_key": zoe_role_key,
            "public_metadata": invitation.get("public_metadata"),
            "service_timings": [{
                "service": "zoe-user-admin",
                "endpoint": "/createOrgInvite",
                "timings": {
                    "pool_acquire_ms": pool_acquire_ms,
                    "owner_check_ms": owner_check_ms,
                    "resolve_context_ms": validate_role_ms,
                    "clerk_api_ms": clerk_api_ms,
                    "persist_ms": persist_ms,
                    "response_build_ms": 0.0,
                    "total_ms": 0.0,
                },
            }],
        }
        response_build_ms = elapsed_ms(response_build_started)
        response["service_timings"][0]["timings"]["response_build_ms"] = response_build_ms
        response["service_timings"][0]["timings"]["total_ms"] = round(
            pool_acquire_ms + owner_check_ms + validate_role_ms + clerk_api_ms + persist_ms + response_build_ms,
            2,
        )
    return response


def require_identity(internal_user_id: str | None, internal_org_id: str | None) -> dict[str, str]:
    user_id = (internal_user_id or "").strip()
    org_id = (internal_org_id or "").strip()
    if not user_id or not org_id:
        raise HTTPException(status_code=400, detail="X-Internal-User-Id and X-Internal-Org-Id are required")
    return {
        "internal_user_id": user_id,
        "internal_org_id": org_id,
    }


def ensure_owner(conn: Any, internal_org_id: str, internal_user_id: str) -> None:
    row = conn.execute(
        """
        select 1
        from zoe_org_level_roles.user_roles
        where internal_org_id = %s::uuid
          and internal_user_id = %s::uuid
          and role_key = 'owner'
          and current_status = 'active'
        """,
        (internal_org_id, internal_user_id),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=403, detail="org_owner_required")


def validate_role_exists(conn: Any, role_key: str) -> None:
    row = conn.execute(
        """
        select 1
        from zoe_org_level_roles.roles_def
        where role_key = %s
        """,
        (role_key,),
    ).fetchone()

    if row is None:
        raise HTTPException(status_code=400, detail=f"unknown_role_key:{role_key}")


def get_clerk_org_id(conn: Any, internal_org_id: str) -> str:
    row = conn.execute(
        """
        select external_org_id
        from zoe_czar.org_ring_map
        where internal_org_id = %s::uuid
          and external_org_id_source = 'clerk'
        """,
        (internal_org_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="clerk_org_mapping_missing")
    return row[0]


def get_org_display_name(conn: Any, internal_org_id: str) -> str:
    row = conn.execute(
        """
        select property_value_text
        from zoe_customer_details.company_properties
        where internal_org_id = %s::uuid
          and property_key in ('company_display_name', 'company_name')
        order by case property_key
          when 'company_display_name' then 0
          when 'company_name' then 1
          else 2
        end
        limit 1
        """,
        (internal_org_id,),
    ).fetchone()
    if row and isinstance(row[0], str) and row[0].strip():
        return row[0].strip()
    raise HTTPException(status_code=500, detail="org_display_name_missing")


def persist_invitation(
    conn: Any,
    *,
    zoe_invitation_id: str,
    invitation: dict[str, Any],
    clerk_org_id: str,
    invited_email: str,
    zoe_role_key: str,
    created_by_internal_user_id: str,
    internal_org_id: str,
) -> None:
    clerk_invitation_id = cleaned(invitation.get("id"))
    if not clerk_invitation_id:
        raise HTTPException(status_code=500, detail="clerk_invitation_id_missing")

    conn.execute(
        """
        insert into zoe_onboarding.invitations (
          zoe_invitation_id,
          clerk_invitation_id,
          invitation_type,
          clerk_org_id,
          org_display_name,
          invited_email,
          zoe_role_key,
          created_by_internal_user_id,
          valid_until
        )
        values (%s::uuid, %s, 'invite_to_org', %s, %s, %s, %s, %s::uuid, %s)
        on conflict (clerk_invitation_id)
        do update set
          zoe_invitation_id = excluded.zoe_invitation_id,
          clerk_org_id = excluded.clerk_org_id,
          org_display_name = excluded.org_display_name,
          invited_email = excluded.invited_email,
          zoe_role_key = excluded.zoe_role_key,
          created_by_internal_user_id = excluded.created_by_internal_user_id,
          valid_until = excluded.valid_until
        """,
        (
            zoe_invitation_id,
            clerk_invitation_id,
            clerk_org_id,
            get_org_display_name(conn, internal_org_id),
            invited_email,
            zoe_role_key,
            created_by_internal_user_id,
            parse_optional_timestamp(
                invitation.get("expiresAt")
                or invitation.get("expires_at")
            ),
        ),
    )


def fetch_user_properties(conn: Any, internal_org_id: str, internal_user_id: str) -> dict[str, Any]:
    rows = conn.execute(
        """
        select
          upd.property_key,
          upd.description,
          upd.value_type,
          up.property_value_text
        from zoe_customer_details.user_property_def upd
        left join zoe_customer_details.user_properties up
          on up.property_key = upd.property_key
         and up.value_type = upd.value_type
         and up.internal_org_id = %s::uuid
         and up.internal_user_id = %s::uuid
        order by upd.property_key
        """,
        (internal_org_id, internal_user_id),
    ).fetchall()

    return {
        row[0]: {
            "property_key": row[0],
            "description": row[1],
            "value_type": row[2],
            "current_value": row[3],
        }
        for row in rows
    }


def fetch_org_properties(conn: Any, internal_org_id: str) -> dict[str, Any]:
    rows = conn.execute(
        """
        select
          cpd.property_key,
          cpd.description,
          cpd.value_type,
          cp.property_value_text
        from zoe_customer_details.company_property_def cpd
        left join zoe_customer_details.company_properties cp
          on cp.property_key = cpd.property_key
         and cp.value_type = cpd.value_type
         and cp.internal_org_id = %s::uuid
        order by cpd.property_key
        """,
        (internal_org_id,),
    ).fetchall()

    return {
        row[0]: {
            "property_key": row[0],
            "description": row[1],
            "value_type": row[2],
            "current_value": row[3],
        }
        for row in rows
    }


def apply_user_property_updates(conn: Any, internal_org_id: str, internal_user_id: str, payload: dict[str, str | None]) -> None:
    updates = normalize_updates(payload)
    if not updates:
        return

    definitions = conn.execute(
        """
        select property_key, value_type
        from zoe_customer_details.user_property_def
        where property_key = any(%s)
        """,
        (list(updates.keys()),),
    ).fetchall()
    definition_map = {row[0]: row[1] for row in definitions}
    ensure_all_keys_defined(updates, definition_map)

    with conn.transaction():
        for property_key, value in updates.items():
            conn.execute(
                """
                insert into zoe_customer_details.user_properties (
                  internal_org_id,
                  internal_user_id,
                  property_key,
                  value_type,
                  property_value_text
                )
                values (%s::uuid, %s::uuid, %s, %s, %s)
                on conflict (internal_org_id, internal_user_id, property_key)
                do update set
                  property_value_text = excluded.property_value_text,
                  updated_at = now()
                """,
                (internal_org_id, internal_user_id, property_key, definition_map[property_key], value),
            )


def apply_org_property_updates(conn: Any, internal_org_id: str, payload: dict[str, str | None]) -> None:
    updates = normalize_updates(payload)
    if not updates:
        return

    definitions = conn.execute(
        """
        select property_key, value_type
        from zoe_customer_details.company_property_def
        where property_key = any(%s)
        """,
        (list(updates.keys()),),
    ).fetchall()
    definition_map = {row[0]: row[1] for row in definitions}
    ensure_all_keys_defined(updates, definition_map)

    with conn.transaction():
        for property_key, value in updates.items():
            conn.execute(
                """
                insert into zoe_customer_details.company_properties (
                  internal_org_id,
                  property_key,
                  value_type,
                  property_value_text
                )
                values (%s::uuid, %s, %s, %s)
                on conflict (internal_org_id, property_key)
                do update set
                  property_value_text = excluded.property_value_text,
                  updated_at = now()
                """,
                (internal_org_id, property_key, definition_map[property_key], value),
            )


def create_clerk_org_invitation(
    *,
    organization_id: str,
    email_address: str,
    zoe_role_key: str,
    redirect_url: str | None,
) -> dict[str, Any]:
    settings = get_settings()
    clerk_role = "org:admin" if zoe_role_key == "owner" else "org:member"
    request_payload: dict[str, Any] = {
        "email_address": email_address,
        "role": clerk_role,
        "public_metadata": {
            "zoe_role_key": zoe_role_key,
        },
    }
    if redirect_url:
        request_payload["redirect_url"] = redirect_url

    req = request.Request(
        f"{settings.clerk_api_base_url}/organizations/{organization_id}/invitations",
        data=json.dumps(request_payload).encode(),
        headers={
            "Authorization": f"Bearer {settings.clerk_secret_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "zoe-user-admin/0.1 clerk-invite",
        },
        method="POST",
    )
    try:
        with request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except error.HTTPError as exc:
        detail = exc.read().decode()
        try:
            parsed = json.loads(detail)
        except json.JSONDecodeError:
            parsed = {"raw": detail}
        raise HTTPException(status_code=exc.code, detail={"code": "clerk_invitation_failed", "clerk": parsed}) from exc


def build_zoe_invitation_redirect_url(base_redirect_url: str | None, zoe_invitation_id: str) -> str | None:
    if not base_redirect_url:
        return None
    return f"{base_redirect_url.rstrip('/')}/{zoe_invitation_id}"


def required_payload_string(payload: dict[str, str | None], key: str) -> str:
    value = optional_payload_string(payload, key)
    if value is None:
        raise HTTPException(status_code=400, detail=f"{key}_required")
    return value


def optional_payload_string(payload: dict[str, str | None], key: str) -> str | None:
    value = payload.get(key)
    if value is None:
        return None
    cleaned_value = value.strip()
    return cleaned_value or None


def normalize_updates(payload: dict[str, str | None]) -> dict[str, str]:
    updates: dict[str, str] = {}
    for property_key, value in payload.items():
        key = property_key.strip()
        if not key:
            raise HTTPException(status_code=400, detail="property_key cannot be empty")
        if value is None:
            raise HTTPException(status_code=400, detail=f"clearing property {key} is not allowed")
        trimmed = value.strip()
        if not trimmed:
            raise HTTPException(status_code=400, detail=f"property {key} cannot be blank")
        updates[key] = trimmed
    return updates


def ensure_all_keys_defined(updates: dict[str, str], definitions: dict[str, str]) -> None:
    missing = sorted(set(updates.keys()) - set(definitions.keys()))
    if missing:
        raise HTTPException(status_code=400, detail=f"unknown property keys: {', '.join(missing)}")


def cleaned(value: Any) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def parse_optional_timestamp(value: Any) -> datetime | None:
    if isinstance(value, (int, float)):
        epoch = float(value)
        if epoch > 1_000_000_000_000:
            epoch = epoch / 1000.0
        return datetime.fromtimestamp(epoch, tz=UTC)

    text = cleaned(value)
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def elapsed_ms(started: float) -> float:
    return round((perf_counter() - started) * 1000, 2)
