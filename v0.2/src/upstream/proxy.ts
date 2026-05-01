import type { IncomingMessage } from "node:http";

export async function proxyRequest(
  req: IncomingMessage,
  upstreamBaseUrl: string,
  upstreamPathTemplate: string,
  params: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const reqUrl = new URL(req.url ?? "/", "http://localhost");
  const upstreamPath = substituteTemplate(upstreamPathTemplate, params);
  const upstreamUrl = new URL(upstreamPath, upstreamBaseUrl);
  const mergedParams = new URLSearchParams(upstreamUrl.search);
  for (const [key, value] of reqUrl.searchParams.entries()) {
    mergedParams.set(key, value);
  }
  upstreamUrl.search = mergedParams.toString();

  const headers = new Headers();
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }
  if (req.headers["content-type"]) {
    headers.set("content-type", req.headers["content-type"]);
  }

  return fetch(upstreamUrl, {
    method: req.method,
    headers,
    body: methodAllowsBody(req.method) ? new Uint8Array(await readRawBody(req)) : undefined,
  });
}

function substituteTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
}

function methodAllowsBody(method: string | undefined): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
