import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { verifyToken } from "@clerk/backend";
import { Webhook } from "svix";
import { createControlPlaneDb } from "./db/controlPlaneDb.js";
import { loadRuntimeState, refreshZarConfig, type RuntimeState } from "./config/runtime.js";
import { compileRoutes, matchRoute } from "./router/matcher.js";
import {
  bootstrapOpenFga,
  checkFgaAllowed,
  evaluateRoutePolicy,
  type EntitlementRecord,
  fetchAvailability,
  fetchOrgEntitlements,
  resolveInternalIdentity,
} from "./policy/evaluator.js";
import { proxyRequest } from "./upstream/proxy.js";
import { processClerkWebhookEvent } from "./webhooks/clerk.js";

async function main() {
  const state = await loadRuntimeState();
  const controlPlaneDb = createControlPlaneDb(state.secrets.control_plane_database_url);
  const clerkWebhook = new Webhook(state.secrets.clerk_webhook_signing_secret);
  const openFgaApiUrl = process.env.OPENFGA_API_URL ?? "http://localhost:8080";
  const openFga = await bootstrapOpenFga(openFgaApiUrl);
  let compiledRoutes = compileRoutes(state.schema);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, null);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, {
          ok: true,
          service: "zar-v0.2",
          config_secret_id: state.secrets.zar_config_secret_id,
          auth_provider: "clerk",
          secret_source: "aws_secrets_manager",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/config/current") {
        requireAdminBearer(req, state);
        sendJson(res, 200, state.schema);
        return;
      }

      if (req.method === "POST" && url.pathname === "/config/refresh") {
        requireAdminBearer(req, state);
        await refreshZarConfig(state);
        compiledRoutes = compileRoutes(state.schema);
        sendJson(res, 200, { refreshed: true, route_count: state.schema.routes.length });
        return;
      }

      if (req.method === "GET" && url.pathname === "/auth/session") {
        await handleAuthSession(req, res, state, controlPlaneDb, openFga);
        return;
      }

      if (req.method === "GET" && url.pathname === "/onboarding/internal-user-and-org") {
        await handleOnboardingBootstrap(req, res, state, controlPlaneDb, openFga);
        return;
      }

      if (req.method === "POST" && url.pathname === "/webhooks/clerk") {
        await handleClerkWebhook(req, res, clerkWebhook, controlPlaneDb);
        return;
      }

      const publicPath = toPublicPath(url.pathname);
      const isPublic = publicPath.includes("/openapi.") || publicPath.startsWith("/api/invitations/");
      if (!isReservedInternalPath(url.pathname)) {
        const token = isPublic ? null : requiredBearerToken(req, res);
        if (!isPublic && !token) return;

        let verifiedToken: Awaited<ReturnType<typeof verifyToken>> | null = null;
        let identity = null;
        let entitlements: EntitlementRecord[] = [];
        let availability = { is_onboarded: false, is_provisioned: false, is_available: false };
        let fgaAllowed = true;

        if (!isPublic && token) {
          verifiedToken = await verifyToken(token, { secretKey: state.secrets.clerk_secret_key });
          const clerkUserId = verifiedToken.sub;
          const clerkOrgId = clerkOrgIdFromToken(verifiedToken);
          identity = await resolveInternalIdentity(controlPlaneDb, clerkUserId, clerkOrgId);
          entitlements = await fetchOrgEntitlements(controlPlaneDb, identity.internal_org_id);
          availability = await fetchAvailability(controlPlaneDb, identity);
          fgaAllowed = await checkFgaAllowed(openFga, identity, url.pathname, req.method ?? "GET");
        }

        const ringId = identity?.org_ring ?? null;
        const routeMatch = matchRoute(compiledRoutes, req.method ?? "GET", publicPath, ringId);
        if (!routeMatch) {
          sendJson(res, state.schema.policy.denial_behavior.unconfigured_route, { error: "not_found" });
          return;
        }

        if (!isPublic && identity) {
          const policy = await evaluateRoutePolicy(
            controlPlaneDb,
            identity,
            routeMatch.ringDefinition,
            entitlements,
            availability,
            fgaAllowed
          );
          if (!policy.allowed) {
            const statusCode = policy.deniedBy === "availability"
              ? state.schema.policy.denial_behavior.unavailable_denied
              : state.schema.policy.denial_behavior.entitlement_denied;
            sendJson(res, statusCode, { error: policy.deniedBy === "availability" ? "unavailable" : "forbidden" });
            return;
          }
        }

        const upstreamResponse = await proxyRequest(
          req,
          routeMatch.ringDefinition.backend.url,
          routeMatch.ringDefinition.backend.path,
          routeMatch.params,
          identity
            ? {
                "X-Internal-User-Id": identity.internal_user_id ?? "",
                "X-Internal-Org-Id": identity.internal_org_id ?? "",
              }
            : {}
        );
        await relayResponse(res, upstreamResponse);
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      const isVerifyTokenError = /token|jwt|signature|issuer|audience|session/i.test(message);
      if (isVerifyTokenError) {
        console.warn(JSON.stringify({ event: "auth.session.invalid_token", message }));
        sendJson(res, 401, { error: "invalid_bearer_token" });
        return;
      }
      console.error(JSON.stringify({ event: "zar.v0_2.error", message }));
      sendJson(res, 500, { error: "internal_error", message });
    }
  });

  server.listen(state.secrets.port, () => {
    console.info(JSON.stringify({ event: "zar.v0_2.listen", port: state.secrets.port }));
  });
}

async function handleAuthSession(
  req: IncomingMessage,
  res: ServerResponse,
  state: RuntimeState,
  controlPlaneDb: ReturnType<typeof createControlPlaneDb>,
  openFga: Awaited<ReturnType<typeof bootstrapOpenFga>>
) {
  const token = requiredBearerToken(req, res);
  if (!token) return;

  const totalStarted = performance.now();
  const authStarted = performance.now();
  const verifiedToken = await verifyToken(token, { secretKey: state.secrets.clerk_secret_key });
  const authMs = elapsedMs(authStarted);
  const clerkUserId = verifiedToken.sub;
  const clerkOrgId = clerkOrgIdFromToken(verifiedToken);

  const identityStarted = performance.now();
  const identity = await resolveInternalIdentity(controlPlaneDb, clerkUserId, clerkOrgId);
  const identityMs = elapsedMs(identityStarted);

  const entitlementsStarted = performance.now();
  const entitlements = await fetchOrgEntitlements(controlPlaneDb, identity.internal_org_id);
  const entitlementsMs = elapsedMs(entitlementsStarted);

  const fgaStarted = performance.now();
  const allowed = await checkFgaAllowed(openFga, identity, "/auth/session", "GET");
  const fgaMs = elapsedMs(fgaStarted);

  sendJson(res, 200, {
    ok: true,
    clerk_user_id: clerkUserId,
    clerk_session_id: verifiedToken.sid ?? null,
    clerk_org_id: clerkOrgId,
    internal_user_id: identity.internal_user_id,
    internal_org_id: identity.internal_org_id,
    entitlements,
    fga_allowed: allowed,
    issuer: verifiedToken.iss,
    timings: {
      auth_ms: authMs,
      identity_ms: identityMs,
      entitlements_ms: entitlementsMs,
      fga_ms: fgaMs,
      total_ms: elapsedMs(totalStarted),
    },
  });
}

async function handleOnboardingBootstrap(
  req: IncomingMessage,
  res: ServerResponse,
  state: RuntimeState,
  controlPlaneDb: ReturnType<typeof createControlPlaneDb>,
  openFga: Awaited<ReturnType<typeof bootstrapOpenFga>>
) {
  const token = requiredBearerToken(req, res);
  if (!token) return;

  const totalStarted = performance.now();
  const authStarted = performance.now();
  const verifiedToken = await verifyToken(token, { secretKey: state.secrets.clerk_secret_key });
  const authMs = elapsedMs(authStarted);
  const clerkUserId = verifiedToken.sub;
  const clerkOrgId = clerkOrgIdFromToken(verifiedToken);

  const identityStarted = performance.now();
  const identity = await resolveInternalIdentity(controlPlaneDb, clerkUserId, clerkOrgId);
  const identityMs = elapsedMs(identityStarted);

  const entitlementsStarted = performance.now();
  const entitlements = await fetchOrgEntitlements(controlPlaneDb, identity.internal_org_id);
  const entitlementsMs = elapsedMs(entitlementsStarted);

  const fgaStarted = performance.now();
  const allowed = await checkFgaAllowed(openFga, identity, "/onboarding/internal-user-and-org", "GET");
  const fgaMs = elapsedMs(fgaStarted);

  const routeMatch = matchRoute(compileRoutes(state.schema), "GET", "/api/onboarding/internal-user-and-org", identity.org_ring);
  if (!routeMatch) {
    sendJson(res, 500, { error: "bootstrap_route_missing" });
    return;
  }

  const downstreamStarted = performance.now();
  const upstreamResponse = await fetch(
    new URL(routeMatch.ringDefinition.backend.path, routeMatch.ringDefinition.backend.url),
    {
      method: "GET",
      headers: {
        "X-Clerk-User-Id": clerkUserId,
        ...(clerkOrgId ? { "X-Clerk-Org-Id": clerkOrgId } : {}),
      },
    }
  );
  const body = await upstreamResponse.json() as Record<string, unknown>;
  const {
    internal_org_id: _internalOrgId,
    internal_user_id: _internalUserId,
    service_timings: downstreamServiceTimings,
    ...publicBody
  } = body;

  sendJson(res, upstreamResponse.status, {
    ...publicBody,
    entitled: entitlements.length > 0,
    fga_allowed: allowed,
    service_timings: [
      {
        service: "zar-v0.2",
        timings: {
          auth_ms: authMs,
          identity_ms: identityMs,
          entitlements_ms: entitlementsMs,
          fga_ms: fgaMs,
          downstream_ms: elapsedMs(downstreamStarted),
          total_ms: elapsedMs(totalStarted),
        },
      },
      ...(Array.isArray(downstreamServiceTimings) ? downstreamServiceTimings : []),
    ],
    timings: {
      auth_ms: authMs,
      identity_ms: identityMs,
      entitlements_ms: entitlementsMs,
      fga_ms: fgaMs,
      downstream_ms: elapsedMs(downstreamStarted),
      total_ms: elapsedMs(totalStarted),
    },
  });
}

async function handleClerkWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  clerkWebhook: Webhook,
  controlPlaneDb: ReturnType<typeof createControlPlaneDb>
) {
  const rawBody = await readRawBody(req);
  let event: Record<string, unknown>;
  try {
    event = clerkWebhook.verify(rawBody, svixHeaders(req)) as Record<string, unknown>;
  } catch {
    sendJson(res, 401, { error: "invalid_webhook_signature" });
    return;
  }
  const processed = await processClerkWebhookEvent(controlPlaneDb, event);
  sendJson(res, 200, processed);
}

function requiredBearerToken(req: IncomingMessage, res: ServerResponse): string | null {
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "missing_bearer_token" });
    return null;
  }
  return token;
}

function toPublicPath(pathname: string): string {
  return pathname.startsWith("/api/") ? pathname : `/api${pathname}`;
}

function isReservedInternalPath(pathname: string): boolean {
  return pathname === "/health"
    || pathname === "/auth/session"
    || pathname === "/onboarding/internal-user-and-org"
    || pathname === "/webhooks/clerk"
    || pathname === "/config/current"
    || pathname === "/config/refresh";
}

function requireAdminBearer(req: IncomingMessage, state: RuntimeState): void {
  const configuredToken = state.secrets.zar_admin_bearer_token;
  if (!configuredToken) {
    throw new Error("zar_admin_bearer_token_missing");
  }
  const token = bearerToken(req);
  if (!token || token !== configuredToken) {
    const error = new Error("invalid_admin_bearer_token");
    throw error;
  }
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function clerkOrgIdFromToken(verifiedToken: Awaited<ReturnType<typeof verifyToken>>): string | null {
  const payload = verifiedToken.payload as Record<string, unknown>;
  const orgId = payload.org_id;
  return typeof orgId === "string" && orgId.trim() !== "" ? orgId : null;
}

function svixHeaders(req: IncomingMessage): Record<string, string> {
  return {
    "svix-id": requiredHeader(req, "svix-id"),
    "svix-timestamp": requiredHeader(req, "svix-timestamp"),
    "svix-signature": requiredHeader(req, "svix-signature"),
  };
}

function requiredHeader(req: IncomingMessage, name: string): string {
  const value = req.headers[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} header is required`);
  }
  return value;
}

async function relayResponse(res: ServerResponse, upstreamResponse: Response): Promise<void> {
  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  res.statusCode = upstreamResponse.status;
  upstreamResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length") return;
    res.setHeader(key, value);
  });
  res.end(body);
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = body === null ? "" : JSON.stringify(body);
  res.statusCode = statusCode;
  if (body !== null) {
    res.setHeader("content-type", "application/json");
  }
  res.end(payload);
}

function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

main().catch((error) => {
  console.error(JSON.stringify({ event: "zar.v0_2.startup_failed", message: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
