# Pending Decision: Development Modes And Safety Boundaries

Note: This document responds to the accepted test/deployment strategy decision from 2026-04-13: `docs/decisions/2026-04-13-test-deploy-strategy.md`.

## Context

The accepted test/deploy strategy currently favors a single production environment, synthetic tenants in production, firm-keyed release rings, and Lambda canaries instead of a traditional staging environment.

The issue is whether the development process can survive over time.

Any process that depends on trust, memory, and repeated human correctness will eventually break. That is true for humans, and it is true for coding agents. Zoe should not build a development model that relies on every future contributor remembering every boundary, applying every scope correctly, and noticing every cross-cutting consequence during review.

This document is therefore about reducing the burden on trust and memory. The goal is not to make mistakes impossible. The goals are:

1. Limit the blast radius of potential mistakes. Tenant isolation already covers a large part of this, but it does not go far enough by itself.
2. Prevent, under as many circumstances as possible, loss or corruption of data.
3. Make recovery as quick and painless as possible.
4. Make fresh deployments as trouble-free and automated as possible.

Zoe should assume that developers and coding agents will make isolation mistakes. That assumption is not cynical; it is the only responsible default for a product that will hold privileged employment-law materials, potentially including medical records, protective-order material, settlement communications, and other highly sensitive client data.

## Proposed Development Model

Zoe should move toward a development model built around three institutional mechanisms:

1. **Scripted environment bring-up and tear-down.** Infrastructure should be reproducible through Terraform or an equivalent infrastructure-as-code system. The goal is not to maintain a permanent staging clone. The goal is to make non-production environments disposable, repeatable, and cheap enough to use when a change needs a proving ground. This strategy needs to extend to 1) Code itself (via git) 2) Physical Infrastructure (via Terraform) and 3) Data (via Neondb branches)
2. **Database branches for development and deployment validation.** [Neon branches](https://neon.com/docs/introduction/branching) should be used as a first-class development mode. Whether a branch is created with data, without data, or with synthetic/anonymized data is a deployment-time choice based on the risk of the change and the sensitivity of the data involved. The important decision is that database branching becomes part of the workflow, not that Zoe picks one branch shape permanently now.
3. **Tenant-aware routing based on deployment mode.** Institutionalize tenant-aware routing inside the Zoe Authorized Router. The router can maintain its own cache, which should be trivial in memory, to avoid almost all latency incurred by JWT resolution. After Clerk authenticates the request, the router should use trusted user/org identity plus Zoe-owned routing policy to choose the application destination and, when appropriate, the database branch.

Routing should be keyed off the authenticated JWT/session context exposed by Clerk and the Zoe Authorized Router. It does not require packet inspection, request-body parsing, or caller-supplied routing fields. Once authentication has established the user and active organization, the router can resolve the tenant/ring from trusted identity context and versioned routing policy.

In normal production, the routing policy maps everyone to the stable production application and production database. During a deployment or development cycle, selected internal or synthetic firms can be routed to a candidate application and a Neon branch. Real customer firms remain on stable production unless a change is explicitly safe for production data and has passed the required validation mode.

The two deployment modes we can foresee now are:

- **In Prod:** all protected traffic resolves to the stable production application and production database.
- **In Deployment:** selected firms or rings can resolve to candidate infrastructure, branch-backed databases, or other validated destinations while the default remains stable production.

The architecture should not hard-code these as the only possible modes. It should make the current modes simple while leaving room for the development process to evolve as Zoe's needs become clearer.

The JWT should prove identity, not carry mutable infrastructure destinations. Clerk provides the authenticated user/session, and where applicable the active organization. Zoe then resolves that identity to firm, ring, and route eligibility through a small lookup table or cached routing policy.

Conceptually:

```text
request
-> Clerk-authenticated protected route
-> user/org identity from trusted session
-> Zoe routing policy lookup
-> stable prod, candidate app, or branch-backed environment
```

The router's public behavior should be small and stable:

- authenticate first
- resolve tenant/ring from trusted identity
- choose destination from versioned policy
- default to stable production
- audit policy changes
- fail closed for ambiguous sensitive routes

## Rationale

The purpose of this model is not to replace tenant isolation, canaries, smoke tests, or release rings. It is to put them in a development system that relies less on trust and memory.

Scripted environments reduce setup drift and make risky validation repeatable. Neon branches create safer database proving grounds whose data shape can be chosen for the situation. The protected-route deployment router makes tenant/ring routing a stable institutional layer instead of a pattern that every feature path has to remember.

Together, these mechanisms create multiple development modes:

- **Local mode:** fast development against local services or a branch database.
- **Branch mode:** Neon branch with a data shape chosen for the task: empty, synthetic, anonymized, or data-bearing where policy allows.
- **Preview mode:** candidate application wired to a branch database for internal and synthetic tenants.
- **Production canary mode:** progressive traffic shift to a candidate deployment with alarms and rollback.
- **Production synthetic mode:** real-stack end-to-end checks using synthetic tenants, after tenant isolation is mechanically enforced.

These suggestions are based directly on the following concerns:

### 1. Tenant isolation is necessary, but application-level enforcement is not stable enough

Tenant isolation must be central to Zoe. Every tenant-owned data path needs a tenant boundary, and `firmId` or a richer tenant-scope object is the right conceptual starting point.

The objection is not to tenant isolation. The objection is to treating application-level tenant isolation as something that can be kept correct by convention across a fast-moving codebase.

In practice, tenant scope can be missed or inconsistently applied across:

- ORM queries
- raw SQL
- migrations
- background jobs
- queues
- caches
- search indexes
- vector embeddings
- S3 object paths
- signed URLs
- logs
- analytics events
- exports
- email handlers
- webhook handlers
- AI prompt/context assembly
- admin tools
- support workflows

Adding `firmId` to Prisma queries does not secure the system. It secures one access path - iff that path is used consistently. A real isolation model has to cover every persistence layer, every derived data layer, and every side-effect surface.

The development model must therefore assume that application code will eventually get tenant isolation wrong. The architecture should make those mistakes fail closed, fail tests, or become obviously auditable events.

### 2. Feature flags and release rings should be treated as rollout controls

Release rings are still valuable. They let Zoe expose a new feature to internal users, then friendly firms, then everyone else. Feature flags are the natural implementation mechanism for those rings.

But a feature flag does not prove that a change is isolated.

A flagged feature can still alter shared behavior through:

- database migrations
- shared components
- shared helper functions
- shared API contracts
- shared background workers
- shared cache keys
- shared queues
- shared model prompts
- shared package upgrades
- shared infrastructure configuration

The fact that only Ring 0 can see a UI path does not mean only Ring 0 can be affected by the code that supports that UI path. A migration can break all users. A shared helper can regress all users. A background job can write state that old code cannot read. A prompt or retrieval change can affect unflagged flows if it touches shared assembly logic.

Feature flags reduce exposure. They do not create a hard safety boundary.

The development model should keep release rings, but it should describe them accurately: they are progressive exposure controls and operational rollback levers. They are not tenant isolation. They are not a substitute for pre-production validation. They are not proof that non-ring users cannot be affected.

### 3. Synthetic tenants in production are useful, but they do not prove production safety

Synthetic tenants in production are good for catching bugs that only appear in the real deployed path. They can exercise CloudFront, API Gateway, Lambda, Prisma, Neon, email providers, and observability in a way local development cannot.

That makes them valuable.

It does not make them a primary safety model.

Synthetic production tests can tell us that a specific synthetic flow worked. They cannot prove that every tenant boundary still holds, that every cache key is scoped, that every S3 object path is safe, that every embedding retrieval is filtered, or that every admin bypass is audited.

Synthetic tenants should be used as real-stack health checks and end-to-end regression tests. They should not be used to justify weaker isolation architecture.

### 4. Canary deployment limits traffic blast radius, not logical blast radius

Lambda canaries are the right mechanism for deploy-level progressive rollout. Sending 10% of traffic to a new Lambda version before shifting to 100% is materially safer than an instant full cutover.

But canaries do not protect against all classes of change.

They are weak against:

- destructive database migrations
- backward-incompatible schema changes
- shared data corruption
- writes that old code cannot safely read
- webhook contract changes
- background jobs with non-idempotent side effects
- bugs that only appear after state has already been mutated

A canary can reduce the number of requests that initially hit bad code. It cannot always undo the effects of bad writes. Once shared state is corrupted, rolling traffic back to the old version may not restore correctness.

Canaries should remain part of the deployment model, but they should be treated as a traffic-control mechanism, not a complete deployment safety strategy.

### 5. Human and agent reliability should not be part of the security model

The current strategy depends too heavily on correct behavior at the edges of the codebase: developers remembering the scope object, agents preserving invariants, reviewers noticing bypasses, and tests covering the right path.

That is not enough.

Humans will miss things. Agents will miss things. Reviewers will miss things. The system should be designed with that expectation.

The practical standard should be:

- unscoped access is hard to write
- unsafe access fails CI
- tenant-owned tables default deny
- cross-tenant access is explicit
- bypasses are audited
- risky changes have a non-production proving ground
- production rollout still uses canaries and smoke tests

This does not remove the need for engineering discipline. It means discipline is backed by mechanical enforcement instead of wishful consistency.

## Implication

The accepted test/deploy strategy should not be thrown away. It contains useful mechanisms:

- production smoke tests
- Lambda canaries
- release rings
- synthetic production tenants
- tenant-aware access control

The change is in how those mechanisms are classified.

They are not all safety boundaries. Some are observability tools. Some are exposure controls. Some are rollout controls. Some are enforcement mechanisms. The development model needs to name those differences clearly so the project does not rely on the wrong tool for the wrong kind of risk.

The next section should define Zoe's development modes from that premise.
