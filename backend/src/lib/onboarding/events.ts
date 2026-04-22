import type { OnboardingDb } from "../db/onboardingDb.js";

type ClerkWebhookEvent = {
  id?: string;
  type?: string;
  created_at?: number;
  timestamp?: number;
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
  const eventType = stringOrThrow(event.type, "event.type");
  const eventId = deriveEventId(event, eventType);
  const eventTime = deriveEventTime(event);
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

export async function maybeTriggerOrganizationMembershipOnboarding(
  db: OnboardingDb,
  event: ClerkWebhookEvent
): Promise<{ triggered: boolean; reason: string }> {
  if (event.type !== "organizationMembership.created") {
    return { triggered: false, reason: "event_type_not_membership_trigger" };
  }

  const data = (event.data ?? {}) as MembershipData;
  const userId = data.public_user_data?.user_id;
  const orgId = data.organization?.id;

  if (!userId || !orgId) {
    return { triggered: false, reason: "missing_user_or_org" };
  }

  await db.query(
    `insert into onboarding.status (
       user_id,
       org_id,
       needs_onboarding,
       is_onboarded
     ) values ($1, $2, true, false)
     on conflict (user_id, org_id) do update
       set
           needs_onboarding = case
             when onboarding.status.is_onboarded then false
             else true
           end,
           updated_at = now()`,
    [userId, orgId]
  );

  return { triggered: true, reason: "membership_status_upserted" };
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

function deriveEventId(event: ClerkWebhookEvent, eventType: string): string {
  const explicitId = stringOrNull(event.id);
  if (explicitId) return explicitId;

  const data = (event.data ?? {}) as Record<string, unknown>;
  const membershipId = stringOrNull(data.id);
  const ids = extractEventIds(event);
  const timestamp = typeof event.timestamp === "number"
    ? String(event.timestamp)
    : typeof event.created_at === "number"
      ? String(event.created_at)
      : "unknown-time";

  return [
    "clerk",
    eventType,
    timestamp,
    membershipId ?? ids.userId ?? "unknown-user",
    ids.orgId ?? "unknown-org",
  ].join(":");
}

function deriveEventTime(event: ClerkWebhookEvent): Date {
  if (typeof event.created_at === "number") {
    return epochToDate(event.created_at);
  }
  if (typeof event.timestamp === "number") {
    return epochToDate(event.timestamp);
  }
  return new Date();
}

function epochToDate(value: number): Date {
  // Clerk payloads may arrive with either seconds or milliseconds.
  // Values >= 1e12 are already millisecond epoch timestamps.
  return new Date(value >= 1_000_000_000_000 ? value : value * 1000);
}

function stringOrThrow(value: unknown, name: string): string {
  const result = stringOrNull(value);
  if (!result) {
    throw new Error(`${name} is required`);
  }
  return result;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
