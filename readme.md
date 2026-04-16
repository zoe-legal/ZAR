# ZoeAuthorizedRouter

## Overview

The Auth Router is the single enforced entry point for all traffic in Zoe. It owns authentication, entitlement enforcement, fine-grained authorization, and transparent PHI/PII redaction, and acts as a token exchange service for all downstream communication.

### Aims

**No unauthorized agent calls.**
Every call in the system — from any client, service, agent, or background process — must be authenticated, entitled, and authorized before it reaches any upstream. There is no path around this.

**Transparent management of PHI and PII.**
The router is the correct layer to enforce data handling obligations for protected health information and personally identifiable information. Upstreams never see raw PHI/PII — the router redacts before forwarding and unredacts before responding. This is enforced by design, not by policy.

---

## The Core Invariant

**All calls in this system — from any client, any internal service, any background worker — go through the Auth Router. There are no exceptions. No service is reachable by any other means.**

Upstream services are origin- and key-restricted to accept requests only from the Auth Router. Any call arriving from any other source is automatically 401'd. This is enforced at the network and application layer, not by convention or trust.

---

## Auth Pipeline

Every request passes through sequential checks, failing fast. On routes that require redaction, a fourth layer is added.

**All routes:**
1. **Authentication (Clerk)** — who is this user? → 401 if invalid
2. **Entitlements (DB table)** — can this org use this feature? → 402 if denied
3. **Fine-grained authorization (OpenFGA)** — can this user access this specific resource? → 403 if denied

**Routes requiring redaction:**
4. **Redaction** — strip PHI/PII from request before forwarding to upstream → 503 if redaction service unreachable

On response, for routes with redaction:
- Router sends upstream response to redaction service → receives unredacted response
- Unredacted response returned to caller

Redaction and unredaction are always a matched pair. If a route requires redaction, unredaction always follows. There is no partial exposure.

## Auth Router Architecture

```
Client / Internal Service / Background Worker / Agent
                   │
                   │  (only path in — network policy blocks everything else)
                   ▼
┌──────────────────────────────────────────┐
│  Auth Router                             │
│  1. Route match (path + method)          │
│  2. Validate incoming credential         │
│     (Clerk JWT, API key, etc.)           │
│  3. Resolve user_id, org_id      → 401   │
│  4. Entitlements check           → 402   │
│  5. FGA check                    → 403   │
│  6. [if route requires redaction]        │
│     Send payload + asset context         │
│     to redaction service         → 503   │
│     Receive redacted payload             │
│  7. Issue / retrieve internal token      │
│     bound to user_id + org_id            │
│  8. Forward (redacted) request           │
│     with internal token                  │
│     + X-User-Id, X-Org-Id, X-Verified:1 │
│  9. [if route requires redaction]        │
│     Send upstream response to            │
│     redaction service                    │
│     Receive unredacted response          │
│ 10. Return response to caller            │
└──────────────────────────────────────────┘
                   │
                   ▼
         Upstream service
    (never sees raw PHI/PII;
     validates router-issued token only;
     origin- and key-restricted to router;
     all other callers → 401)
```

## Redaction Service

The redaction service is a dedicated internal service that owns all PHI/PII intelligence. The router delegates to it entirely — the router knows only whether a route requires redaction, not what to redact or how.

**Request flow:**
- Router sends: payload + asset context (owner, unique asset ID, etc.)
- Redaction service applies redaction, maintains a conversion table keyed on asset identity
- Returns redacted payload to router

**Response flow:**
- Router sends: upstream response + asset context
- Redaction service looks up conversion table, restores original values
- Returns unredacted response to router

The conversion table — mapping redacted tokens to original PHI/PII values — is the most sensitive data store in the system.

**Failure mode:** fail closed. If the redaction service is unreachable and the route requires redaction, the request fails with 503. No degraded mode.

**Placement:** the redaction service sits behind the router like any other upstream — it is a trusted internal peer, not a public service.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Protocol | HTTP only | Sufficient for current service mesh |
| Routing | Router owns route map | Single entry point, uniform enforcement |
| Downstream token | Router-issued, longer-lived | Decouples upstreams from Clerk; solves JWT expiry for agents and long-lived processes |
| Internal service identity | Forward original user JWT | No separate identity layer needed at this stage |
| FGA resource resolution | Deferred | Let the natural shape of the system emerge from real routes |
| Redaction intelligence | Delegated to redaction service | Router stays clean; PHI/PII logic owned in one place |
| Redaction token stability | Internal to redaction service | Router doesn't care; conversion table is the redaction service's concern |

---

## Security Risks and Mitigations

The router is a single point of compromise. These risks are accepted deliberately — the same tradeoff any API gateway makes — but must be mitigated actively.

### Risks

**Router compromise = full system compromise.**
An attacker who controls the router can forge identities, bypass FGA, and reach any upstream. There is no second line of defence inside the perimeter.

**The internal token signing key is the crown jewel.**
If it leaks, an attacker can mint valid internal tokens and bypass the router entirely — without needing to compromise the router process. Key management is critical.

**Single ingress = high-value DoS target.**
Take the router down and the entire system is down.

**Token store breach = identity breach.**
A compromised token store exposes all active internal tokens for all users. Longer token lifetimes increase blast radius.

**Pipeline bugs are system-wide.**
A logic error in the entitlements or FGA check affects every route. There is no scope containment.

**Redaction service conversion table is the PHI/PII master store.**
A breach of the conversion table exposes all PHI/PII for all assets. It must be treated with the same or greater care as the token signing key.

### Mitigations

- **Short internal token lifetimes with sliding refresh** — limits the theft window without burdening callers
- **Token binding** — bind internal tokens to session properties to prevent replay from a different context
- **Signing key rotation on a schedule** — old tokens invalidated on rotation
- **Multiple router instances behind a load balancer** — eliminates the DoS single point of failure; router logic stays stateless, only the token store is stateful
- **Rate limiting and anomaly detection at the router** — it sees all traffic; it's the right place to detect abuse
- **Audit log every auth decision and token issuance** — full forensic trail if something goes wrong
- **Redaction service conversion table encrypted at rest** — treat it as the most sensitive store in the system

---

## Robustness Design

The router sits on the critical path of every request in the system. Every dependency it calls — Clerk, FGA, the entitlements DB, the token store, the redaction service — is a potential failure point. Robustness must be designed in upfront, not retrofitted.

### Availability

- **Stateless instances behind a load balancer** — any instance handles any request, no affinity needed. Only the token store is stateful.
- **Health checks and automatic instance replacement** — a failed instance is removed from rotation without manual intervention.
- **Zero-downtime deploys** — drain in-flight requests before shutdown, roll instances one at a time.

### Dependency Resilience

- **Timeouts on every outbound call** — a slow FGA, Clerk, or redaction service response cannot hold connections open indefinitely.
- **Circuit breakers on all dependencies** — if a dependency is degrading, stop hammering it and fail fast.
- **Fail closed by default** — if a dependency is unreachable, deny the request. A 503 is better than an unverified request passing through.
- **JWKS caching** — Clerk's public keys change rarely. Cache them locally so JWT verification survives a short Clerk outage.
- **Entitlements caching with TTL** — entitlements don't change per-request. A short cache (30–60s) absorbs DB blips without meaningful staleness risk.
- **FGA: no caching** — stale FGA cache after a tuple deletion means revocation doesn't take effect. Fail closed if FGA is unreachable.
- **Redaction service: no caching** — conversion table state lives in the redaction service. Fail closed if unreachable.

### Latency Budget

The router adds latency to every request in the system. Keep it tight.

- JWT verification is mostly local (signature check) — negligible cost.
- Entitlements: one DB read, cacheable — negligible with cache warm.
- FGA check: 5–20ms — the dominant cost on non-redacted routes.
- Redaction: two additional round trips (request redaction + response unredaction) on redacted routes — latency budget for the redaction service must be defined.
- **Persistent connection pools** to all dependencies — no per-request connection setup overhead.
- **Define and enforce a latency SLO** for the router itself, with a separate SLO for redacted routes.

### Observability

The router sees all traffic and makes all auth decisions. It must be the best-instrumented component in the system.

- **Structured logs for every auth decision** — credential type, identity resolved, which stage failed, latency per stage.
- **Metrics per pipeline stage** — 401/402/403/503 rates, per-stage latency. A spike in 403s could be a bug or an attack.
- **Distributed tracing** — trace IDs propagated through to upstreams so any request can be followed end-to-end.
- **Alerting** on elevated error rates and latency degradation.

### Rate Limiting

The router is the correct place for rate limiting — it sees all traffic before it reaches any upstream.

- Per-user and per-org limits protect upstreams from runaway agents or abuse.
- Per-IP limits protect against credential stuffing at the auth stage.

### Operational

- **Hot reload of route config** — adding or changing a route requires no restart.
- **Graceful shutdown** — finish in-flight requests before terminating.

---

## Route Configuration Shape

```typescript
type FgaConfig =
  | { resourceIdFrom: "path"; resourceIdParam: string; relation: string; resourceType: string }
  | { resourceIdFrom: "header"; headerName: string; relation: string; resourceType: string }
  | { resourceIdFrom: "deferred" }  // router skips FGA, handled downstream

type RouteConfig = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "*";
  path: string;               // e.g. "/documents/:id"
  upstream: string;           // e.g. "http://documents-service:3001"
  auth: {
    entitlements?: string[];  // e.g. ["documents:create"]
    fga?: FgaConfig;
  };
  redaction?: {
    enabled: true;
    assetContext: {
      ownerFrom: "path" | "header";
      ownerParam: string;
      idFrom: "path" | "header";
      idParam: string;
    };
  };
};
```

## Files to Implement

| File | Purpose |
|---|---|
| `router/index.ts` | Entry point, HTTP server setup |
| `router/config.ts` | RouteConfig type + config loader |
| `router/routes.ts` | Route definitions (the route table) |
| `router/handler.ts` | Path matching, upstream forwarding |
| `router/pipeline.ts` | Sequential auth pipeline: validate → entitlements → FGA → redact → forward → unredact |
| `router/tokens.ts` | Internal token issuance, storage, and validation |
| `router/redaction.ts` | Redaction service client — redact request, unredact response |
| `lib/auth/clerk.ts` | Clerk JWT verification |
| `lib/auth/fga.ts` | OpenFGA client — check / write / delete / list |
| `lib/entitlements/client.ts` | EntitlementsClient interface + DB implementation |

## Open / Deferred

- Internal token storage: DB table vs. Redis — either works, fully owned by us
- Internal token lifetime: to be decided based on use case requirements
- FGA resource resolution strategy — decided as real routes are written
- Redaction service latency SLO — to be defined
- Billing provider — entitlements table works standalone; sync added later