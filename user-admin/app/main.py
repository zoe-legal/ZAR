from __future__ import annotations

from time import perf_counter
from typing import Any

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
    with control_plane_connection() as conn:
        fetch_started = perf_counter()
        properties = fetch_user_properties(conn, identity["internal_org_id"], identity["internal_user_id"])
    return {
        **properties,
        "service_timings": {
            "fetch_ms": elapsed_ms(fetch_started),
            "total_ms": elapsed_ms(total_started),
        },
    }


@app.put("/putUserProperties")
def put_user_properties(
    payload: dict[str, str | None],
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    with control_plane_connection() as conn:
        update_started = perf_counter()
        apply_user_property_updates(conn, identity["internal_org_id"], identity["internal_user_id"], payload)
        update_ms = elapsed_ms(update_started)
        fetch_started = perf_counter()
        properties = fetch_user_properties(conn, identity["internal_org_id"], identity["internal_user_id"])
    return {
        **properties,
        "service_timings": {
            "update_ms": update_ms,
            "fetch_ms": elapsed_ms(fetch_started),
            "total_ms": elapsed_ms(total_started),
        },
    }


@app.get("/getOrgProperties")
def get_org_properties(
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    with control_plane_connection() as conn:
        owner_started = perf_counter()
        ensure_owner(conn, identity["internal_org_id"], identity["internal_user_id"])
        owner_check_ms = elapsed_ms(owner_started)
        fetch_started = perf_counter()
        properties = fetch_org_properties(conn, identity["internal_org_id"])
    return {
        **properties,
        "service_timings": {
            "owner_check_ms": owner_check_ms,
            "fetch_ms": elapsed_ms(fetch_started),
            "total_ms": elapsed_ms(total_started),
        },
    }


@app.put("/putOrgProperties")
def put_org_properties(
    payload: dict[str, str | None],
    x_internal_user_id: str | None = Header(default=None),
    x_internal_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    identity = require_identity(x_internal_user_id, x_internal_org_id)
    with control_plane_connection() as conn:
        owner_started = perf_counter()
        ensure_owner(conn, identity["internal_org_id"], identity["internal_user_id"])
        owner_check_ms = elapsed_ms(owner_started)
        update_started = perf_counter()
        apply_org_property_updates(conn, identity["internal_org_id"], payload)
        update_ms = elapsed_ms(update_started)
        fetch_started = perf_counter()
        properties = fetch_org_properties(conn, identity["internal_org_id"])
    return {
        **properties,
        "service_timings": {
            "owner_check_ms": owner_check_ms,
            "update_ms": update_ms,
            "fetch_ms": elapsed_ms(fetch_started),
            "total_ms": elapsed_ms(total_started),
        },
    }


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


def elapsed_ms(started: float) -> float:
    return round((perf_counter() - started) * 1000, 2)
