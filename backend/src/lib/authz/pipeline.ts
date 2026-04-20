import type { ControlPlaneDb } from "../db/controlPlaneDb.js";

export type ResolvedIdentity = {
  clerk_user_id: string;
  clerk_org_id: string | null;
  internal_user_id: string | null;
  internal_org_id: string | null;
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
    };
  }

  const row = await db.query(
    `
    select
      um.internal_user_id::text as internal_user_id,
      um.internal_org_id::text as internal_org_id
    from zoe_czar.user_map um
    where um.external_user_id_source = 'clerk'
      and um.external_user_id = $1
      and um.external_org_id_source = 'clerk'
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

export async function bootstrapOpenFga(apiUrl: string): Promise<OpenFgaState> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= OPENFGA_BOOTSTRAP_RETRIES; attempt += 1) {
    try {
      return await bootstrapOpenFgaOnce(apiUrl);
    } catch (error) {
      lastError = error;
      if (attempt === OPENFGA_BOOTSTRAP_RETRIES) {
        break;
      }
      await sleep(OPENFGA_BOOTSTRAP_DELAY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("openfga_bootstrap_failed");
}

async function bootstrapOpenFgaOnce(apiUrl: string): Promise<OpenFgaState> {
  const storeResponse = await fetch(`${apiUrl}/stores`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: "zar-dev" }),
  });
  if (!storeResponse.ok) {
    throw new Error(`openfga_create_store_failed:${storeResponse.status}`);
  }

  const storePayload = (await storeResponse.json()) as { id?: string };
  if (!storePayload.id) {
    throw new Error("openfga_store_id_missing");
  }

  const modelResponse = await fetch(`${apiUrl}/stores/${storePayload.id}/authorization-models`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      schema_version: "1.1",
      type_definitions: [
        {
          type: "user",
        },
        {
          type: "route",
          relations: {
            allowed: { this: {} },
          },
          metadata: {
            relations: {
              allowed: {
                directly_related_user_types: [{ type: "user" }],
              },
            },
          },
        },
      ],
    }),
  });
  if (!modelResponse.ok) {
    throw new Error(`openfga_write_model_failed:${modelResponse.status}`);
  }

  const modelPayload = (await modelResponse.json()) as { authorization_model_id?: string };
  if (!modelPayload.authorization_model_id) {
    throw new Error("openfga_authorization_model_id_missing");
  }

  return {
    apiUrl,
    storeId: storePayload.id,
    authorizationModelId: modelPayload.authorization_model_id,
  };
}

export async function checkFgaAllowed(
  state: OpenFgaState,
  identity: ResolvedIdentity,
  path: string,
  method: string
): Promise<boolean> {
  const user = `user:${identity.internal_user_id ?? identity.clerk_user_id}`;
  const routeObject = `route:${encodeObjectId(`${method.toLowerCase()} ${path}`)}`;

  const response = await fetch(`${state.apiUrl}/stores/${state.storeId}/check`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      authorization_model_id: state.authorizationModelId,
      tuple_key: {
        user,
        relation: "allowed",
        object: routeObject,
      },
      contextual_tuples: {
        tuple_keys: [
          {
            user,
            relation: "allowed",
            object: routeObject,
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`openfga_check_failed:${response.status}`);
  }

  const payload = (await response.json()) as { allowed?: boolean };
  return payload.allowed === true;
}

function encodeObjectId(value: string): string {
  return encodeURIComponent(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
