import type { OnboardingDb } from "../db/onboardingDb.js";

type ClerkWebhookEvent = {
  id?: string;
  type?: string;
  created_at?: number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type MembershipData = {
  id?: string;
  role?: string;
  organization?: {
    id?: string;
    name?: string | null;
  };
  public_user_data?: {
    user_id?: string;
    identifier?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  };
};

export async function storeClerkWebhookEvent(
  db: OnboardingDb,
  event: ClerkWebhookEvent
): Promise<{ stored: boolean; userId: string | null; orgId: string | null }> {
  const eventType = requiredString(event.type, "event.type");
  const eventId = requiredString(event.id, "event.id");
  const eventTime = event.created_at
    ? new Date(event.created_at)
    : new Date();
  const ids = extractEventIds(event);

  const result = await db.query(
    `insert into onboarding.events (
       event_id,
       event_source,
       user_id,
       org_id,
       event_type,
       event_time,
       event_dict
     ) values ($1, 'clerk', $2, $3, $4, $5, $6)
     on conflict (event_id) do nothing`,
    [
      eventId,
      ids.userId ?? "unknown",
      ids.orgId,
      eventType,
      eventTime,
      event,
    ]
  );

  return {
    stored: result.rowCount === 1,
    userId: ids.userId,
    orgId: ids.orgId,
  };
}

export async function maybeTriggerGreenfieldOnboarding(
  db: OnboardingDb,
  event: ClerkWebhookEvent
): Promise<{ triggered: boolean; reason: string }> {
  if (event.type !== "organizationMembership.created") {
    return { triggered: false, reason: "event_type_not_greenfield_trigger" };
  }

  const data = (event.data ?? {}) as MembershipData;
  const userId = data.public_user_data?.user_id;
  const orgId = data.organization?.id;
  const role = data.role;

  if (!userId || !orgId) {
    return { triggered: false, reason: "missing_user_or_org" };
  }
  if (role !== "org:admin") {
    return { triggered: false, reason: "membership_role_not_admin" };
  }

  await db.query(
    `insert into onboarding.status (
       user_id,
       org_id,
       needs_onboarding,
       is_onboarded
     ) values ($1, $2, true, false)
     on conflict (user_id) do update
       set org_id = coalesce(onboarding.status.org_id, excluded.org_id),
           needs_onboarding = case
             when onboarding.status.is_onboarded then false
             else true
           end,
           updated_at = now()`,
    [userId, orgId]
  );

  return { triggered: true, reason: "greenfield_status_upserted" };
}

function extractEventIds(event: ClerkWebhookEvent): { userId: string | null; orgId: string | null } {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const publicUserData = data.public_user_data as { user_id?: unknown } | undefined;
  const organization = data.organization as { id?: unknown } | undefined;

  return {
    userId: stringOrNull(publicUserData?.user_id ?? data.user_id ?? data.id),
    orgId: stringOrNull(organization?.id ?? data.organization_id),
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
