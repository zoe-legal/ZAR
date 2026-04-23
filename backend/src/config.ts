import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

export type SecretLocatorConfig = {
  aws_region: string;
  clerk_secret_id: string;
};

export type RuntimeConfig = SecretLocatorConfig & {
  clerk_secret_key: string;
  clerk_webhook_signing_secret: string;
  control_plane_database_url: string;
  port: number;
};

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const locator = readSecretLocatorConfig();
  const client = new SecretsManagerClient({ region: locator.aws_region });
  const clerkSecret = await readSecretJson(client, locator.clerk_secret_id);

  return {
    ...locator,
    clerk_secret_key: requiredString(clerkSecret.clerk_secret_key, "secret.clerk_secret_key"),
    clerk_webhook_signing_secret: requiredString(
      clerkSecret.clerk_webhook_signing_secret,
      "secret.clerk_webhook_signing_secret"
    ),
    control_plane_database_url: requiredString(
      firstPresentString(
        clerkSecret,
        ["zoe_control_plane_database_url", "control_plane_database_url", "database_url"]
      ),
      "secret.control_plane_database_url"
    ),
    port: 8788,
  };
}

function readSecretLocatorConfig(): SecretLocatorConfig {
  const configPath = resolve(process.cwd(), "config.json");
  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<SecretLocatorConfig>;
  return {
    aws_region: requiredString(parsed.aws_region, "config.aws_region"),
    clerk_secret_id: requiredString(parsed.clerk_secret_id, "config.clerk_secret_id"),
  };
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
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
