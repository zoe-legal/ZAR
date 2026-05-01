import type { ControlPlaneDb } from "../db/controlPlaneDb.js";
import type { RingRouteDefinition } from "../types/schema.js";

export type ResolvedIdentity = {
  clerk_user_id: string;
  clerk_org_id: string | null;
  internal_user_id: string | null;
  internal_org_id: string | null;
  external_user_id: string;
  external_org_id: string | null;
  org_ring: number | null;
};

export type EntitlementRecord = {
  entitlement_key: string;
  current_status: string;
  available_until_date: string | null;
};

export type OpenFgaState = {
  apiUrl: string;
  storeId: string;
  authorizationModelId: string;
};

export type AvailabilityRecord = {
  is_onboarded: boolean;
  is_provisioned: boolean;
  is_available: boolean;
};

const OPENFGA_BOOTSTRAP_RETRIES = 20;
const OPENFGA_BOOTSTRAP_DELAY_MS = 1000;

export async function resolveInternalIdentity(
  db: ControlPlaneDb,
  clerkUserId: string,
  clerkOrgId: string | null
): Promise<ResolvedIdentity> {
  if (!clerkOrgId) {
    return {
      clerk_user_id: clerkUserId,
      clerk_org_id: null,
      internal_user_id: null,
      internal_org_id: null,
      external_user_id: clerkUserId,
      external_org_id: null,
      org_ring: null,
    };
  }

  const row = await db.query(
    `
    select
      um.internal_user_id::text as internal_user_id,
      um.internal_org_id::text as internal_org_id,
      um.external_user_id as external_user_id,
      um.external_org_id as external_org_id,
      orm.org_ring as org_ring
    from zoe_czar.user_map um
    join zoe_czar.org_ring_map orm
      on orm.internal_org_id = um.internal_org_id
    where um.external_user_id = $1
      and um.external_org_id = $2
    limit 1
    `,
    [clerkUserId, clerkOrgId]
  );

  return {
    clerk_user_id: clerkUserId,
    clerk_org_id: clerkOrgId,
    internal_user_id: row.rows[0]?.internal_user_id ?? null,
    internal_org_id: row.rows[0]?.internal_org_id ?? null,
    external_user_id: row.rows[0]?.external_user_id ?? clerkUserId,
    external_org_id: row.rows[0]?.external_org_id ?? clerkOrgId,
    org_ring: typeof row.rows[0]?.org_ring === "number" ? row.rows[0].org_ring : null,
  };
}

export async function fetchOrgEntitlements(
  db: ControlPlaneDb,
  internalOrgId: string | null
): Promise<EntitlementRecord[]> {
  if (!internalOrgId) {
    return [];
  }
  const result = await db.query(
    `
    select
      entitlement_key,
      current_status,
      available_until_date::text as available_until_date
    from zoe_entitlements.org_entitlements
    where internal_org_id = $1::uuid
    order by entitlement_key
    `,
    [internalOrgId]
  );
  return result.rows as EntitlementRecord[];
}

export async function fetchAvailability(
  db: ControlPlaneDb,
  identity: ResolvedIdentity
): Promise<AvailabilityRecord> {
  if (!identity.external_org_id) {
    return { is_onboarded: false, is_provisioned: false, is_available: false };
  }

  const result = await db.query(
    `
    select
      is_onboarded,
      is_provisioned
    from zoe_onboarding.status
    where user_id = $1
      and org_id = $2
    limit 1
    `,
    [identity.external_user_id, identity.external_org_id]
  );
  const row = result.rows[0];
  const is_onboarded = row?.is_onboarded === true;
  const is_provisioned = row?.is_provisioned === true;
  return {
    is_onboarded,
    is_provisioned,
    is_available: is_onboarded && is_provisioned,
  };
}

export async function isOrgAdmin(db: ControlPlaneDb, identity: ResolvedIdentity): Promise<boolean> {
  if (!identity.internal_org_id || !identity.internal_user_id) return false;
  const result = await db.query(
    `
    select 1
    from zoe_org_level_roles.user_roles
    where internal_org_id = $1::uuid
      and internal_user_id = $2::uuid
      and role_key = 'owner'
      and current_status = 'active'
    limit 1
    `,
    [identity.internal_org_id, identity.internal_user_id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function bootstrapOpenFga(apiUrl: string): Promise<OpenFgaState> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OPENFGA_BOOTSTRAP_RETRIES; attempt += 1) {
    try {
      return await bootstrapOpenFgaOnce(apiUrl);
    } catch (error) {
      lastError = error;
      if (attempt === OPENFGA_BOOTSTRAP_RETRIES) break;
      await sleep(OPENFGA_BOOTSTRAP_DELAY_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("openfga_bootstrap_failed");
}

async function bootstrapOpenFgaOnce(apiUrl: string): Promise<OpenFgaState> {
  const storeResponse = await fetch(`${apiUrl}/stores`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "zar-v0-2-dev" }),
  });
  if (!storeResponse.ok) throw new Error(`openfga_create_store_failed:${storeResponse.status}`);
  const storePayload = await storeResponse.json() as { id?: string };
  if (!storePayload.id) throw new Error("openfga_store_id_missing");

  const modelResponse = await fetch(`${apiUrl}/stores/${storePayload.id}/authorization-models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema_version: "1.1",
      type_definitions: [
        { type: "user" },
        {
          type: "route",
          relations: { allowed: { this: {} } },
          metadata: { relations: { allowed: { directly_related_user_types: [{ type: "user" }] } } },
        },
      ],
    }),
  });
  if (!modelResponse.ok) throw new Error(`openfga_write_model_failed:${modelResponse.status}`);
  const modelPayload = await modelResponse.json() as { authorization_model_id?: string };
  if (!modelPayload.authorization_model_id) throw new Error("openfga_authorization_model_id_missing");

  return { apiUrl, storeId: storePayload.id, authorizationModelId: modelPayload.authorization_model_id };
}

export async function checkFgaAllowed(state: OpenFgaState, identity: ResolvedIdentity, path: string, method: string): Promise<boolean> {
  const user = `user:${identity.internal_user_id ?? identity.clerk_user_id}`;
  const routeObject = `route:${encodeURIComponent(`${method.toLowerCase()} ${path}`)}`;
  const response = await fetch(`${state.apiUrl}/stores/${state.storeId}/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authorization_model_id: state.authorizationModelId,
      tuple_key: { user, relation: "allowed", object: routeObject },
      contextual_tuples: {
        tuple_keys: [{ user, relation: "allowed", object: routeObject }],
      },
    }),
  });
  if (!response.ok) throw new Error(`openfga_check_failed:${response.status}`);
  const payload = await response.json() as { allowed?: boolean };
  return payload.allowed === true;
}

export async function evaluateRoutePolicy(
  db: ControlPlaneDb,
  identity: ResolvedIdentity,
  routeDefinition: RingRouteDefinition,
  entitlements: EntitlementRecord[],
  availability: AvailabilityRecord,
  fgaAllowed: boolean
): Promise<{ allowed: boolean; deniedBy: "availability" | "entitlements" | null }> {
  if (routeDefinition.require_available && !availability.is_available) {
    return { allowed: false, deniedBy: "availability" };
  }

  const activeEntitlements = new Set(
    entitlements
      .filter((row) => row.current_status === "active")
      .map((row) => row.entitlement_key)
  );

  for (const key of routeDefinition.entitlements.all_of) {
    if (!(await policyConditionSatisfied(db, identity, activeEntitlements, key, fgaAllowed))) {
      return { allowed: false, deniedBy: "entitlements" };
    }
  }

  if (routeDefinition.entitlements.any_of.length > 0) {
    let satisfied = false;
    for (const key of routeDefinition.entitlements.any_of) {
      if (await policyConditionSatisfied(db, identity, activeEntitlements, key, fgaAllowed)) {
        satisfied = true;
        break;
      }
    }
    if (!satisfied) {
      return { allowed: false, deniedBy: "entitlements" };
    }
  }

  return { allowed: true, deniedBy: null };
}

async function policyConditionSatisfied(
  db: ControlPlaneDb,
  identity: ResolvedIdentity,
  activeEntitlements: Set<string>,
  key: string,
  fgaAllowed: boolean
): Promise<boolean> {
  if (activeEntitlements.has(key)) return true;
  if (key === "org.admin") return isOrgAdmin(db, identity);
  if (key === "matter.member" || key === "matter.editor") return fgaAllowed;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
