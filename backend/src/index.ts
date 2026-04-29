import { createServer, type IncomingMessage } from "node:http";
import { verifyToken } from "@clerk/backend";
import { Webhook } from "svix";
import { loadRuntimeConfig } from "./config.js";
import { bootstrapOpenFga, checkFgaAllowed, fetchOrgEntitlements, resolveInternalIdentity } from "./lib/authz/pipeline.js";
import { createControlPlaneDb } from "./lib/db/controlPlaneDb.js";
import {
  processClerkWebhookEvent,
} from "./lib/onboarding/events.js";

async function main() {
  const config = await loadRuntimeConfig();
  const controlPlaneDb = createControlPlaneDb(config.control_plane_database_url);
  const clerkWebhook = new Webhook(config.clerk_webhook_signing_secret);
  const onboardingServiceUrl = process.env.ONBOARDING_SERVICE_URL ?? "http://localhost:8790";
  const userAdminServiceUrl = process.env.USER_ADMIN_SERVICE_URL ?? "http://localhost:8791";
  const openFgaApiUrl = process.env.OPENFGA_API_URL ?? "http://localhost:8080";
  const openFga = await bootstrapOpenFga(openFgaApiUrl);

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
          service: "zar-backend",
          auth_provider: "clerk",
          secret_source: "aws_secrets_manager",
          onboarding_db: "zoe_control_plane/zoe_onboarding",
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/auth/session") {
        const token = bearerToken(req);
        if (!token) {
          sendJson(res, 401, { error: "missing_bearer_token" });
          return;
        }

        try {
          const totalStarted = performance.now();
          const authStarted = performance.now();
          const verifiedToken = await verifyToken(token, {
            secretKey: config.clerk_secret_key,
          });
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
          const allowed = await checkFgaAllowed(openFga, identity, url.pathname, req.method);
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
        } catch {
          console.warn(JSON.stringify({ event: "auth.session.invalid_token" }));
          sendJson(res, 401, { error: "invalid_bearer_token" });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/onboarding/internal-user-and-org") {
        const token = bearerToken(req);
        if (!token) {
          sendJson(res, 401, { error: "missing_bearer_token" });
          return;
        }

        try {
          const totalStarted = performance.now();
          const authStarted = performance.now();
          const verifiedToken = await verifyToken(token, {
            secretKey: config.clerk_secret_key,
          });
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
          const allowed = await checkFgaAllowed(openFga, identity, url.pathname, req.method);
          const fgaMs = elapsedMs(fgaStarted);

          const downstreamStarted = performance.now();
          const onboardingResponse = await fetch(
            `${onboardingServiceUrl}/getInternalUserAndOrg`,
            {
              method: "GET",
              headers: {
                "X-Clerk-User-Id": clerkUserId,
                ...(clerkOrgId ? { "X-Clerk-Org-Id": clerkOrgId } : {}),
              },
            }
          );
          const body = await onboardingResponse.json() as Record<string, unknown>;
          const {
            internal_org_id: _internalOrgId,
            internal_user_id: _internalUserId,
            service_timings: downstreamServiceTimings,
            ...publicBody
          } = body;

          let responseEntitlements = entitlements;
          let responseEntitlementsMs = entitlementsMs;
          const downstreamInternalOrgId = typeof body.internal_org_id === "string" ? body.internal_org_id : null;
          if (downstreamInternalOrgId && downstreamInternalOrgId !== identity.internal_org_id) {
            const refreshedEntitlementsStarted = performance.now();
            responseEntitlements = await fetchOrgEntitlements(controlPlaneDb, downstreamInternalOrgId);
            responseEntitlementsMs = entitlementsMs + elapsedMs(refreshedEntitlementsStarted);
          }

          sendJson(res, onboardingResponse.status, {
            ...publicBody,
            entitled: responseEntitlements.length > 0,
            fga_allowed: allowed,
            service_timings: [
              {
                service: "zar-backend",
                timings: {
                  auth_ms: authMs,
                  identity_ms: identityMs,
                  entitlements_ms: responseEntitlementsMs,
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
              entitlements_ms: responseEntitlementsMs,
              fga_ms: fgaMs,
              downstream_ms: elapsedMs(downstreamStarted),
              total_ms: elapsedMs(totalStarted),
            },
          });
        } catch {
          console.warn(JSON.stringify({ event: "auth.session.invalid_token" }));
          sendJson(res, 401, { error: "invalid_bearer_token" });
        }
        return;
      }

      if (req.method === "GET" && url.pathname === "/user-admin/openapi.json") {
        const downstreamResponse = await fetch(`${userAdminServiceUrl}/openapi.json`);
        const body = await downstreamResponse.json() as Record<string, unknown>;
        sendJson(res, downstreamResponse.status, body);
        return;
      }

      if (
        (req.method === "GET" || req.method === "PUT" || req.method === "POST")
        && (
          url.pathname === "/user-admin/getUserProperties"
          || url.pathname === "/user-admin/putUserProperties"
          || url.pathname === "/user-admin/getOrgProperties"
          || url.pathname === "/user-admin/putOrgProperties"
          || url.pathname === "/user-admin/createOrgInvite"
          || url.pathname === "/user-admin/isAvailable"
        )
      ) {
        const token = bearerToken(req);
        if (!token) {
          sendJson(res, 401, { error: "missing_bearer_token" });
          return;
        }

        let verifiedToken: Awaited<ReturnType<typeof verifyToken>>;
        let authMs = 0;
        try {
          const totalStarted = performance.now();
          const authStarted = performance.now();
          verifiedToken = await verifyToken(token, {
            secretKey: config.clerk_secret_key,
          });
          authMs = elapsedMs(authStarted);
          const clerkUserId = verifiedToken.sub;
          const clerkOrgId = clerkOrgIdFromToken(verifiedToken);

          const identityStarted = performance.now();
          const identity = await resolveInternalIdentity(controlPlaneDb, clerkUserId, clerkOrgId);
          const identityMs = elapsedMs(identityStarted);

          if (!identity.internal_user_id || !identity.internal_org_id) {
            sendJson(res, 403, { error: "internal_identity_required" });
            return;
          }

          const entitlementsStarted = performance.now();
          await fetchOrgEntitlements(controlPlaneDb, identity.internal_org_id);
          const entitlementsMs = elapsedMs(entitlementsStarted);

          const fgaStarted = performance.now();
          const allowed = await checkFgaAllowed(openFga, identity, url.pathname, req.method);
          const fgaMs = elapsedMs(fgaStarted);

          if (!allowed) {
            sendJson(res, 403, { error: "forbidden" });
            return;
          }

          const downstreamStarted = performance.now();
          const downstreamResponse = await fetch(
            `${userAdminServiceUrl}${url.pathname.replace(/^\/user-admin/, "")}`,
            {
              method: req.method,
              headers: {
                ...((req.method === "PUT" || req.method === "POST") ? { "Content-Type": "application/json" } : {}),
                "X-Internal-User-Id": identity.internal_user_id,
                "X-Internal-Org-Id": identity.internal_org_id,
              },
              body: (req.method === "PUT" || req.method === "POST") ? await readRawBody(req) : undefined,
            }
          );
          const body = await downstreamResponse.json() as Record<string, unknown>;

          sendJson(res, downstreamResponse.status, {
            ...body,
            fga_allowed: allowed,
            timings: {
              auth_ms: authMs,
              identity_ms: identityMs,
              entitlements_ms: entitlementsMs,
              fga_ms: fgaMs,
              downstream_ms: elapsedMs(downstreamStarted),
              total_ms: elapsedMs(totalStarted),
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isVerifyTokenError = /token|jwt|signature|issuer|audience|session/i.test(message);
          if (isVerifyTokenError) {
            console.warn(JSON.stringify({ event: "auth.session.invalid_token", message }));
            sendJson(res, 401, { error: "invalid_bearer_token" });
            return;
          }
          console.error(JSON.stringify({
            event: "user_admin.proxy_error",
            path: url.pathname,
            message,
          }));
          sendJson(res, 502, { error: "user_admin_proxy_error", detail: message });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/webhooks/clerk") {
        console.info(JSON.stringify({ event: "webhook.clerk.received" }));
        const rawBody = await readRawBody(req);
        let event: any;
        try {
          event = clerkWebhook.verify(rawBody, svixHeaders(req));
        } catch {
          console.warn(JSON.stringify({ event: "webhook.clerk.invalid_signature" }));
          sendJson(res, 401, { error: "invalid_webhook_signature" });
          return;
        }

        console.info(JSON.stringify({
          event: "webhook.clerk.verified",
          clerk_event_id: event.id ?? null,
          clerk_event_type: event.type ?? null,
        }));
        const processed = await processClerkWebhookEvent(controlPlaneDb, event);
        console.info(JSON.stringify({
          event: "webhook.clerk.stored",
          clerk_event_id: event.id ?? null,
          stored: processed.stored,
          user_id: processed.userId,
          org_id: processed.orgId,
        }));
        console.info(JSON.stringify({
          event: "greenfield.trigger.checked",
          clerk_event_id: event.id ?? null,
          triggered: processed.triggered,
          reason: processed.reason,
        }));
        sendJson(res, 200, {
          ok: true,
          event_stored: processed.stored,
          user_id: processed.userId,
          org_id: processed.orgId,
          greenfield: {
            triggered: processed.triggered,
            reason: processed.reason,
          },
        });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      console.error(JSON.stringify({
        event: "request.internal_error",
        message: error instanceof Error ? error.message : String(error),
      }));
      sendJson(res, 500, { error: "internal_error" });
    }
  });

  server.listen(config.port, () => {
    console.log(`ZAR backend listening on http://0.0.0.0:${config.port}`);
  });

  const shutdown = async () => {
    await controlPlaneDb.end();
    server.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

function clerkOrgIdFromToken(token: Record<string, unknown> & { org_id?: unknown; o?: { id?: unknown } }): string | null {
  if (typeof token.org_id === "string") return token.org_id;
  if (typeof token.o?.id === "string") return token.o.id;
  return null;
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
  if (typeof value === "string" && value.trim() !== "") return value;
  throw new Error(`missing ${name} header`);
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res: import("node:http").ServerResponse, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:5174");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (status === 204) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(`${JSON.stringify(payload)}\n`);
}

function elapsedMs(started: number): number {
  return Math.round((performance.now() - started) * 100) / 100;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
