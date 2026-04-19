import { createServer, type IncomingMessage } from "node:http";
import { verifyToken } from "@clerk/backend";
import { Webhook } from "svix";
import { loadRuntimeConfig } from "./config.js";
import { createOnboardingDb } from "./lib/db/onboardingDb.js";
import {
  maybeTriggerGreenfieldOnboarding,
  storeClerkWebhookEvent,
} from "./lib/onboarding/events.js";

async function main() {
  const config = await loadRuntimeConfig();
  const onboardingDb = createOnboardingDb(config.onboarding_database_url);
  const clerkWebhook = new Webhook(config.clerk_webhook_signing_secret);

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
          onboarding_db: "neon",
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
          const verifiedToken = await verifyToken(token, {
            secretKey: config.clerk_secret_key,
          });
          sendJson(res, 200, {
            ok: true,
            clerk_user_id: verifiedToken.sub,
            clerk_session_id: verifiedToken.sid ?? null,
            clerk_org_id: typeof verifiedToken.org_id === "string" ? verifiedToken.org_id : null,
            issuer: verifiedToken.iss,
          });
        } catch {
          console.warn(JSON.stringify({ event: "auth.session.invalid_token" }));
          sendJson(res, 401, { error: "invalid_bearer_token" });
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
        const stored = await storeClerkWebhookEvent(onboardingDb, event);
        console.info(JSON.stringify({
          event: "webhook.clerk.stored",
          clerk_event_id: event.id ?? null,
          stored: stored.stored,
          user_id: stored.userId,
          org_id: stored.orgId,
        }));
        const greenfield = await maybeTriggerGreenfieldOnboarding(onboardingDb, event);
        console.info(JSON.stringify({
          event: "greenfield.trigger.checked",
          clerk_event_id: event.id ?? null,
          triggered: greenfield.triggered,
          reason: greenfield.reason,
        }));
        sendJson(res, 200, {
          ok: true,
          event_stored: stored.stored,
          user_id: stored.userId,
          org_id: stored.orgId,
          greenfield,
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
    await onboardingDb.end();
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (status === 204) {
    res.end();
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.end(`${JSON.stringify(payload)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
