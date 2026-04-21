from __future__ import annotations

from datetime import UTC, datetime, timedelta
from time import perf_counter
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Query

from .config import get_settings
from .db import control_plane_connection, onboarding_connection


PENDING_WINDOW = timedelta(seconds=60)
CLERK_ORG_SOURCE = "clerk"
CLERK_USER_SOURCE = "clerk"
DEFAULT_RING = 4

app = FastAPI(title="Zoe Onboarding", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    settings = get_settings()
    return {
        "ok": "true",
        "service": "zoe-onboarding",
        "aws_region": settings.aws_region,
    }


@app.get("/getInternalUserAndOrg")
def get_internal_user_and_org(
    clerk_user_id: str | None = Query(default=None),
    clerk_org_id: str | None = Query(default=None),
    x_clerk_user_id: str | None = Header(default=None),
    x_clerk_org_id: str | None = Header(default=None),
) -> dict[str, Any]:
    total_started = perf_counter()
    service_timings: dict[str, float] = {}

    user_id = (x_clerk_user_id or clerk_user_id or "").strip()
    org_id = (x_clerk_org_id or clerk_org_id or "").strip() or None
    if not user_id:
      raise HTTPException(status_code=400, detail="clerk user id is required")

    status_started = perf_counter()
    status_row = get_status_row(user_id)
    service_timings["status_lookup_ms"] = elapsed_ms(status_started)

    if status_row and truthy(status_row["is_onboarded"]):
        mapping_started = perf_counter()
        internal = get_existing_internal_mapping(user_id, status_row["org_id"])
        service_timings["existing_mapping_ms"] = elapsed_ms(mapping_started)
        if not internal:
            raise HTTPException(
                status_code=500,
                detail="onboarding status is onboarded but Zoe core mapping is missing",
            )
        service_timings["total_ms"] = elapsed_ms(total_started)
        return {"status": "internal_user_details", **internal, "service_timings": service_timings}

    event_started = perf_counter()
    relevant_event = get_latest_greenfield_event(user_id)
    service_timings["event_lookup_ms"] = elapsed_ms(event_started)
    if not relevant_event:
        service_timings["total_ms"] = elapsed_ms(total_started)
        return {"status": "failed", "reason": "no_greenfield_event", "service_timings": service_timings}

    event_age = datetime.now(tz=UTC) - relevant_event["event_time"]
    if event_age > PENDING_WINDOW:
        service_timings["total_ms"] = elapsed_ms(total_started)
        return {"status": "failed", "reason": "greenfield_event_stale", "service_timings": service_timings}

    effective_org_id = org_id or relevant_event["org_id"]
    if not effective_org_id:
        service_timings["total_ms"] = elapsed_ms(total_started)
        return {"status": "pending", "reason": "org_id_not_available", "service_timings": service_timings}

    provision_started = perf_counter()
    internal = provision_greenfield_user(
        user_id=user_id,
        org_id=effective_org_id,
        event_dict=relevant_event["event_dict"],
    )
    service_timings["provision_ms"] = elapsed_ms(provision_started)
    service_timings["total_ms"] = elapsed_ms(total_started)
    return {"status": "internal_user_details", **internal, "service_timings": service_timings}


def get_status_row(user_id: str) -> dict[str, Any] | None:
    with onboarding_connection() as conn:
        row = conn.execute(
            """
            select
              user_id,
              org_id,
              needs_onboarding,
              is_onboarded,
              updated_at
            from onboarding.status
            where user_id = %s
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        return None

    return {
        "user_id": row[0],
        "org_id": row[1],
        "needs_onboarding": row[2],
        "is_onboarded": row[3],
        "updated_at": row[4],
    }


def get_existing_internal_mapping(user_id: str, org_id: str | None) -> dict[str, Any] | None:
    if not org_id:
        return None

    with control_plane_connection() as conn:
        row = conn.execute(
            """
            select
              orm.internal_org_id::text,
              um.internal_user_id::text,
              orm.org_ring,
              udp.property_value_text
            from zoe_czar.user_map um
            join zoe_czar.org_ring_map orm
              on orm.internal_org_id = um.internal_org_id
             and orm.external_org_id_source = um.external_org_id_source
             and orm.external_org_id = um.external_org_id
            left join zoe_customer_details.user_properties udp
              on udp.internal_org_id = um.internal_org_id
             and udp.internal_user_id = um.internal_user_id
             and udp.property_key = 'user_display_name'
            where um.external_user_id_source = %s
              and um.external_user_id = %s
              and um.external_org_id_source = %s
              and um.external_org_id = %s
            """,
            (CLERK_USER_SOURCE, user_id, CLERK_ORG_SOURCE, org_id),
        ).fetchone()

    if row is None:
        return None

    return {
        "internal_org_id": row[0],
        "internal_user_id": row[1],
        "org_ring": row[2],
        "display_name": row[3],
    }


def get_latest_greenfield_event(user_id: str) -> dict[str, Any] | None:
    with onboarding_connection() as conn:
        row = conn.execute(
            """
            select
              event_id,
              org_id,
              event_time,
              event_dict
            from onboarding.events
            where user_id = %s
              and event_type = 'organizationMembership.created'
              and coalesce(event_dict->'data'->>'role', '') = 'org:admin'
            order by event_time desc, received_at desc
            limit 1
            """,
            (user_id,),
        ).fetchone()

    if row is None:
        return None

    return {
        "event_id": row[0],
        "org_id": row[1],
        "event_time": row[2],
        "event_dict": row[3],
    }


def provision_greenfield_user(user_id: str, org_id: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    person = extract_person_details(event_dict, user_id)
    company_name = extract_company_name(event_dict, person)

    with control_plane_connection() as conn:
        with conn.transaction():
            org_row = conn.execute(
                """
                insert into zoe_czar.org_ring_map (
                  external_org_id_source,
                  external_org_id,
                  org_ring
                )
                values (%s, %s, %s)
                on conflict (external_org_id_source, external_org_id)
                do update set external_org_id = excluded.external_org_id
                returning internal_org_id::text, org_ring
                """,
                (CLERK_ORG_SOURCE, org_id, DEFAULT_RING),
            ).fetchone()
            internal_org_id = org_row[0]
            org_ring = org_row[1]

            user_row = conn.execute(
                """
                insert into zoe_czar.user_map (
                  external_user_id_source,
                  external_user_id,
                  external_org_id_source,
                  external_org_id,
                  internal_org_id
                )
                values (%s, %s, %s, %s, %s::uuid)
                on conflict (
                  external_user_id_source,
                  external_user_id,
                  external_org_id_source,
                  external_org_id
                )
                do update set internal_org_id = excluded.internal_org_id
                returning internal_user_id::text
                """,
                (CLERK_USER_SOURCE, user_id, CLERK_ORG_SOURCE, org_id, internal_org_id),
            ).fetchone()
            internal_user_id = user_row[0]

            current_role = conn.execute(
                """
                select role_key, current_status
                from zoe_org_level_roles.user_roles
                where internal_org_id = %s::uuid
                  and internal_user_id = %s::uuid
                """,
                (internal_org_id, internal_user_id),
            ).fetchone()

            if current_role is None:
                conn.execute(
                    """
                    insert into zoe_org_level_roles.user_roles (
                      internal_org_id,
                      internal_user_id,
                      role_key,
                      current_status
                    )
                    values (%s::uuid, %s::uuid, 'owner', 'active')
                    """,
                    (internal_org_id, internal_user_id),
                )
                conn.execute(
                    """
                    insert into zoe_org_level_roles.role_changes (
                      internal_org_id,
                      internal_user_id,
                      change_type,
                      previous_role_key,
                      new_role_key,
                      previous_status,
                      new_status,
                      actor_type,
                      actor_id,
                      change_reason
                    )
                    values (
                      %s::uuid,
                      %s::uuid,
                      'assigned',
                      null,
                      'owner',
                      null,
                      'active',
                      'system',
                      'greenfield_onboarding',
                      'greenfield signup owner assignment'
                    )
                    """,
                    (internal_org_id, internal_user_id),
                )
            elif current_role[0] != "owner" or current_role[1] != "active":
                conn.execute(
                    """
                    update zoe_org_level_roles.user_roles
                    set role_key = 'owner',
                        current_status = 'active',
                        last_change_date = now()
                    where internal_org_id = %s::uuid
                      and internal_user_id = %s::uuid
                    """,
                    (internal_org_id, internal_user_id),
                )
                conn.execute(
                    """
                    insert into zoe_org_level_roles.role_changes (
                      internal_org_id,
                      internal_user_id,
                      change_type,
                      previous_role_key,
                      new_role_key,
                      previous_status,
                      new_status,
                      actor_type,
                      actor_id,
                      change_reason
                    )
                    values (
                      %s::uuid,
                      %s::uuid,
                      'changed',
                      %s,
                      'owner',
                      %s,
                      'active',
                      'system',
                      'greenfield_onboarding',
                      'greenfield signup owner assignment'
                    )
                    """,
                    (internal_org_id, internal_user_id, current_role[0], current_role[1]),
                )

            upsert_company_property(conn, internal_org_id, "company_name", company_name)
            upsert_company_property(conn, internal_org_id, "company_display_name", company_name)
            upsert_user_property(conn, internal_org_id, internal_user_id, "user_first_name", person["first_name"])
            upsert_user_property(conn, internal_org_id, internal_user_id, "user_last_name", person["last_name"])
            upsert_user_property(conn, internal_org_id, internal_user_id, "user_display_name", person["display_name"])
            upsert_user_property(conn, internal_org_id, internal_user_id, "user_email", person["email"])
            grant_all_org_entitlements(conn, internal_org_id)

    with onboarding_connection() as conn:
        with conn.transaction():
            conn.execute(
                """
                insert into onboarding.status (
                  user_id,
                  org_id,
                  needs_onboarding,
                  is_onboarded,
                  updated_at
                )
                values (%s, %s, false, true, now())
                on conflict (user_id)
                do update set
                  org_id = excluded.org_id,
                  needs_onboarding = false,
                  is_onboarded = true,
                  updated_at = now()
                """,
                (user_id, org_id),
            )

    return {
        "internal_org_id": internal_org_id,
        "internal_user_id": internal_user_id,
        "org_ring": org_ring,
        "display_name": person["display_name"],
    }


def grant_all_org_entitlements(conn: Any, internal_org_id: str) -> None:
    entitlement_rows = conn.execute(
        """
        select entitlement_key
        from zoe_entitlements.entitlements_def
        order by entitlement_key asc
        """
    ).fetchall()

    if not entitlement_rows:
        return

    existing_rows = conn.execute(
        """
        select
          entitlement_key,
          current_status,
          available_until_date
        from zoe_entitlements.org_entitlements
        where internal_org_id = %s::uuid
        """,
        (internal_org_id,),
    ).fetchall()
    existing_by_key = {
        row[0]: {
            "current_status": row[1],
            "available_until_date": row[2],
        }
        for row in existing_rows
    }

    for entitlement_row in entitlement_rows:
        entitlement_key = entitlement_row[0]
        previous = existing_by_key.get(entitlement_key)

        if previous and previous["current_status"] == "active" and previous["available_until_date"] is None:
            continue

        conn.execute(
            """
            insert into zoe_entitlements.org_entitlements (
              internal_org_id,
              entitlement_key,
              available_until_date,
              current_status
            )
            values (%s::uuid, %s, null, 'active')
            on conflict (internal_org_id, entitlement_key)
            do update set
              available_until_date = null,
              current_status = 'active',
              last_change_date = now()
            """,
            (internal_org_id, entitlement_key),
        )

        conn.execute(
            """
            insert into zoe_entitlements.entitlement_changes (
              internal_org_id,
              entitlement_key,
              change_type,
              previous_status,
              new_status,
              previous_available_until_date,
              new_available_until_date,
              actor_type,
              actor_id,
              change_reason
            )
            values (
              %s::uuid,
              %s,
              %s,
              %s,
              'active',
              %s,
              null,
              'system',
              'greenfield_onboarding',
              'greenfield onboarding default entitlement grant'
            )
            """,
            (
                internal_org_id,
                entitlement_key,
                derive_entitlement_change_type(previous),
                previous["current_status"] if previous else None,
                previous["available_until_date"] if previous else None,
            ),
        )


def upsert_company_property(conn: Any, internal_org_id: str, key: str, value: str | None) -> None:
    if value is None:
        return
    conn.execute(
        """
        insert into zoe_customer_details.company_properties (
          internal_org_id,
          property_key,
          value_type,
          property_value_text
        )
        values (%s::uuid, %s, 'text', %s)
        on conflict (internal_org_id, property_key)
        do update set
          property_value_text = excluded.property_value_text,
          updated_at = now()
        """,
        (internal_org_id, key, value),
    )


def upsert_user_property(
    conn: Any,
    internal_org_id: str,
    internal_user_id: str,
    key: str,
    value: str | None,
) -> None:
    if value is None:
        return
    conn.execute(
        """
        insert into zoe_customer_details.user_properties (
          internal_org_id,
          internal_user_id,
          property_key,
          value_type,
          property_value_text
        )
        values (%s::uuid, %s::uuid, %s, 'text', %s)
        on conflict (internal_org_id, internal_user_id, property_key)
        do update set
          property_value_text = excluded.property_value_text,
          updated_at = now()
        """,
        (internal_org_id, internal_user_id, key, value),
    )


def derive_entitlement_change_type(previous: dict[str, Any] | None) -> str:
    if previous is None or previous["current_status"] is None:
        return "granted"
    if previous["current_status"] == "paused":
        return "resumed"
    if previous["current_status"] in {"revoked", "expired"}:
        return "granted"
    return "extended"


def extract_person_details(event_dict: dict[str, Any], fallback_user_id: str) -> dict[str, str | None]:
    data = event_dict.get("data") or {}
    public_user_data = data.get("public_user_data") or {}

    first_name = cleaned(public_user_data.get("first_name"))
    last_name = cleaned(public_user_data.get("last_name"))
    identifier = cleaned(public_user_data.get("identifier"))
    display_name = derive_display_name(first_name, last_name, identifier, fallback_user_id)

    return {
        "first_name": first_name,
        "last_name": last_name,
        "email": identifier if looks_like_email(identifier) else None,
        "display_name": display_name,
    }


def extract_company_name(event_dict: dict[str, Any], person: dict[str, str | None]) -> str:
    data = event_dict.get("data") or {}
    organization = data.get("organization") or {}
    org_name = cleaned(organization.get("name"))
    if org_name:
        return org_name

    display_name = person.get("display_name")
    if display_name:
        return f"{display_name}'s Firm"
    return "My Firm"


def derive_display_name(
    first_name: str | None,
    last_name: str | None,
    identifier: str | None,
    fallback_user_id: str,
) -> str:
    if first_name and last_name:
        return f"{first_name} {last_name}"
    if first_name:
        return first_name
    if identifier:
        return identifier
    return fallback_user_id


def looks_like_email(value: str | None) -> bool:
    return bool(value and "@" in value)


def cleaned(value: Any) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def truthy(value: Any) -> bool:
    return value is True


def elapsed_ms(started: float) -> float:
    return round((perf_counter() - started) * 1000, 2)
