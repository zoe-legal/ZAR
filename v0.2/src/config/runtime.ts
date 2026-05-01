import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import YAML from "yaml";
import type { ZarConfig } from "../types/schema.js";

export type SecretLocatorConfig = {
  aws_region: string;
  clerk_secret_id: string;
  zar_config_secret_id: string;
};

export type RuntimeSecrets = SecretLocatorConfig & {
  clerk_secret_key: string;
  clerk_webhook_signing_secret: string;
  control_plane_database_url: string;
  zar_admin_bearer_token: string | null;
  port: number;
};

export type RuntimeState = {
  secrets: RuntimeSecrets;
  schema: ZarConfig;
  schemaRaw: string;
  secretsClient: SecretsManagerClient;
};

export async function loadRuntimeState(): Promise<RuntimeState> {
  const locator = readSecretLocatorConfig();
  const secretsClient = new SecretsManagerClient({ region: locator.aws_region });
  const clerkSecret = await readSecretJson(secretsClient, locator.clerk_secret_id);
  const schemaRaw = await readSecretString(secretsClient, locator.zar_config_secret_id);
  const schema = parseZarConfig(schemaRaw);

  return {
    secretsClient,
    schema,
    schemaRaw,
    secrets: {
      ...locator,
      clerk_secret_key: requiredString(clerkSecret.clerk_secret_key, "secret.clerk_secret_key"),
      clerk_webhook_signing_secret: requiredString(
        clerkSecret.clerk_webhook_signing_secret,
        "secret.clerk_webhook_signing_secret"
      ),
      control_plane_database_url: requiredString(
        firstPresentString(clerkSecret, ["zoe_control_plane_database_url", "control_plane_database_url", "database_url"]),
        "secret.control_plane_database_url"
      ),
      zar_admin_bearer_token: optionalString(
        firstPresentString(clerkSecret, ["zar_admin_bearer_token", "admin_bearer_token"])
      ),
      port: 8788,
    },
  };
}

export async function refreshZarConfig(state: RuntimeState): Promise<void> {
  const schemaRaw = await readSecretString(state.secretsClient, state.secrets.zar_config_secret_id);
  state.schemaRaw = schemaRaw;
  state.schema = parseZarConfig(schemaRaw);
}

function readSecretLocatorConfig(): SecretLocatorConfig {
  const localPath = resolve(process.cwd(), "config.json");
  const fallbackPath = resolve(process.cwd(), "../backend/config.json");
  const parsed = JSON.parse(readFileSync(exists(localPath) ? localPath : fallbackPath, "utf8")) as Partial<SecretLocatorConfig>;
  return {
    aws_region: requiredString(parsed.aws_region, "config.aws_region"),
    clerk_secret_id: requiredString(parsed.clerk_secret_id, "config.clerk_secret_id"),
    zar_config_secret_id: optionalString(parsed.zar_config_secret_id) ?? "zar_config",
  };
}

function parseZarConfig(raw: string): ZarConfig {
  const parsed = YAML.parse(raw) as ZarConfig;
  validateZarConfig(parsed);
  return parsed;
}

function validateZarConfig(config: ZarConfig): void {
  if (!config || typeof config !== "object") throw new Error("zar_config must be an object");
  if (!Array.isArray(config.routes)) throw new Error("zar_config.routes must be an array");

  const seen = new Set<string>();
  for (const route of config.routes) {
    if (!route.path || typeof route.path !== "string") {
      throw new Error("each route must define a path");
    }
    for (const [method, methodDef] of Object.entries(route.methods ?? {})) {
      const key = `${method.toUpperCase()} ${route.path}`;
      if (seen.has(key)) throw new Error(`duplicate route definition for ${key}`);
      seen.add(key);
      if (!methodDef.rings || typeof methodDef.rings !== "object") {
        throw new Error(`route ${key} must define rings`);
      }
      if (!("default" in methodDef.rings)) {
        throw new Error(`route ${key} must define a default ring rule`);
      }
    }
  }
}

async function readSecretJson(
  client: SecretsManagerClient,
  secretId: string
): Promise<Record<string, unknown>> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error(`Secrets Manager secret ${secretId} has no SecretString`);
  }
  const parsed = JSON.parse(response.SecretString) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Secrets Manager secret ${secretId} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function readSecretString(client: SecretsManagerClient, secretId: string): Promise<string> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString || response.SecretString.trim() === "") {
    throw new Error(`Secrets Manager secret ${secretId} must contain a non-empty SecretString`);
  }
  return response.SecretString;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function firstPresentString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function exists(path: string): boolean {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
