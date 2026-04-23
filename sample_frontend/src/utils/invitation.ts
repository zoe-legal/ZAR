export function buildAcceptInvitationHref(mode: "signin" | "signup", params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("mode");
  const ticket = next.get("__clerk_ticket") || next.get("ticket");
  const ticketQuery = ticket ? `__clerk_ticket=${encodeURIComponent(ticket)}` : "";
  if (mode === "signup") {
    return ticketQuery ? `/signup?${ticketQuery}` : "/signup";
  }
  return ticketQuery ? `/login?${ticketQuery}` : "/login";
}

export function extractInvitationId(ticket: string | null) {
  if (!ticket) return null;
  try {
    const payloadSegment = ticket.split(".")[1];
    if (!payloadSegment) return null;
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as Record<string, unknown>;
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return window.atob(normalized + padding);
}
