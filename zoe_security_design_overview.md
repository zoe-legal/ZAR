# Zoe Security Design

## Security framing

### Trust boundaries

Current working trust boundaries for Zoe, ordered from innermost to outermost:

1. **Cryptographic boundary** — ciphertext at rest and TLS in transit.
2. **Application enforcement boundary** — the authorized router/bridge, policy checks, transformations, and controlled access to plaintext.
3. **Network boundary** — VPC segmentation, service-to-service reachability, ingress and egress controls, and any DMZ-style zoning.
4. **Identity boundary** — the human or system principal whose identity, intent, and granted authority define the outermost access boundary.

```text
                 Data stores
                    │
                    ▼
┌───────────────────────────────┐
│ 1. Cryptographic boundary     │
│ cipher enforcement, TLS       │
│                               │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ 2. Application boundary       │
│ authorized router / bridge    │
│ policy, transform, release    │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ 3. Network boundary           │
│ reachability, ingress, egress │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ 4. Identity boundary          │
│ identity, intent, authority   │
└───────────────┬───────────────┘
                │
                ▼
 Outside world / requesting principal
```

### Notes

- These are useful design boundaries, but they are not all the same kind of thing.
- Encryption is a control boundary.
- Network is an infrastructure boundary.
- Application logic is the most important enforcement boundary for a SaaS system.

### Boundary design principle

**Working principle: one primary enforcer per boundary.**

Meaning:

- Each boundary should have a single dominant enforcement mechanism.
- Supporting controls may exist around it, but they should not create a false sense of layered security where compromise of one nearby component trivially collapses the rest.
- Security should come from a clean trust assumption, not from theatrics.

Example:

- For encryption at rest, the meaningful control is key protection and key access control.
- Splitting closely related cryptographic material across nearby systems without a real independence assumption is usually security theater.
- If an attacker who can compromise one of those systems can realistically compromise the other in the same attack path, the split did not create a meaningful boundary.

### Cryptographic Boundary

Current direction for Zoe:

- Every asset in the data plane is stored as an encrypted blob.
- This applies uniformly to files, incoming emails, synced email content, and other stored customer data objects.
- Asset metadata is stored separately in a SOC 2 Type II compliant database.
- Asset access is governed at the asset level by a separate fine-grained authorization system.
- Decryption is automatic after authorization succeeds.
- Downstream services do not perform decryption themselves and do not directly handle raw decryption keys.
- All downstream access must traverse TLS and the authorization bridge.
- After those checks pass, the caller receives the decrypted asset.

### Cryptographic boundary interpretation

This implies a specific design shape:

- The true cryptographic choke point is not storage. It is the **decrypt path**.
- Storage never holds plaintext. Assets are stored only as ciphertext.
- The only path to plaintext is through a successful call via the authorization bridge.
- That path is protected in transit with TLS.
- The service that can cause decryption is therefore part of the core trusted computing base.
- Downstream services are trusted for plaintext handling once admitted past that point.

### Application Logic Boundary

This section captures the security model of Zoe's application enforcement layer. It sits immediately outside the cryptographic boundary and governs how authority is interpreted and how requests are routed. Outside the cryptographic boundary and within application logic, assets are no longer encrypted.

The long-term architectural goal is a zero-trust implementation. Zoe will not begin at the fully elaborated version of that model, because doing so from day one would add major cost and implementation pain. This section therefore serves two purposes: first, to define the specific privacy-oriented implementations that will exist on day one; second, to define coding-discipline rules that preserve Zoe's path toward a stricter zero-trust architecture over time.

Zoe's application security model can be understood in three external modules:

1. **The Data Plane**
2. **The Execution Plane**
3. **The Authorized Router**

In addition to these, Zoe includes an internal module that enforces encryption.

Each of these is covered in detail in its own design documentation. This document does not attempt to reproduce those designs in full. Instead, it discusses the broad security implications of those modules and the security rules that govern how they interact.

#### Application security model

Zoe's application enforcement layer is built around the following security responsibilities:

- key custody and key-use policy
- identity-linked authorization decisions
- secrets distribution to trusted components
- routing of requests through the Authorized Router
- enforcement of which execution paths may cause plaintext release

#### Data Plane

The data plane relevant to this boundary is composed of:

1. **Key store**
2. **Metadata store**
3. **Blob store**

##### Key store

- The key store is the most sensitive replication domain.
- Replicating keys is not just a durability decision; it can widen the effective trust boundary.
- Key replication policy must therefore be stricter than blob replication policy.
- The governing rule is that replication must not broaden decrypt authority beyond the intended cryptographic choke points.
- Current implementation choice: **AWS KMS**.
- If Zoe later moves away from AWS or toward a multi-cloud architecture, key-store migration and trust-preserving replacement of KMS must be treated as a first-order architectural concern.

##### Metadata store

- Current implementation choice: **NeonDB**.
- Metadata replication requires more caution because metadata may reveal tenant, sender, recipient, timestamps, object size, relationships, or workflow context even when payloads remain encrypted.
- Metadata should therefore be classified and replicated according to its own sensitivity rules.

##### Blob store

- Current implementation choice: **Amazon S3**.
- Blob replication is the least sensitive from a confidentiality standpoint because stored assets are ciphertext-only.
- Replication here is primarily an availability and durability concern.
- Blob replication must not introduce plaintext persistence.

##### Inviolable Implementation Guidelines for Stores

- The AWS credentials used to access KMS should be rotated frequently.
- Updated credentials should be stored in Secrets Manager.
- The Authorized Router / Encrypt-Decrypt stack retrieves its KMS access credentials from Secrets Manager.
- Based on user identity, that stack requests the appropriate keying path in KMS for storing and retrieving that user's assets.
- User identity therefore participates in key selection and decrypt authorization.

#### Development Guidelines for Eventual Hassle-Free ZTA Transition

This subsection captures coding and design discipline intended to preserve Zoe's path toward a stricter zero-trust architecture over time. These are not merely implementation preferences; they are constraints meant to prevent day-one shortcuts from hardening into architectural dead ends.

1. **No hardcoded paths or credentials.** Both credentials and paths must be retrieved from Secrets Manager or an equivalent secret-distribution system. This preserves two properties that matter later: first, it allows path-failure behavior to be tested cleanly; second, it allows storage or service paths to be switched transparently into more protected environments without requiring application rewrites.
2. **All APIs use TLS from day one.** No internal or external API should begin life as a cleartext interface on the assumption that transport security can be added later. Encrypting API traffic from the start avoids retrofit pain and preserves a clean migration path toward stricter zero-trust enforcement.
3. **Secure paths are identified at API design time and placed behind the router from the start.** Protected routes should not begin life as loosely exposed endpoints with the expectation that they will be secured later. Fail-closed is the default stance for all secured paths: if routing, identity, policy, secret retrieval, or path validation fails, the request must not proceed.
4. **No convenience or testing endpoints in production releases.** Temporary bypass routes, debug handlers, direct-access endpoints, and test-only surfaces must not survive into production. Security exceptions created for development speed have a strong tendency to become permanent hidden ingress paths.
5. **No plaintext persistence by accident.** Logs, temp files, caches, queues, indexes, analytics sinks, and debug traces must be treated as possible exfiltration paths. If plaintext must exist in memory, it should die there unless explicitly approved. All debug traces must be sanitized before they are permitted into production systems.

#### Zoe Authorized Router

All non-trusted hooks, public-facing endpoints, and other edge-facing request surfaces terminate into calls to the Zoe Authorized Router. They do not independently enter protected application behavior. Further, all data and protected route access for agent execution also goes through the router. 

The Zoe Authorized Router (ZAR) is the core application enforcement component in Zoe's security model. It is the sole trusted application-layer ingress into protected behavior and the primary choke point through which identity, entitlement, policy, and route-level permissions are translated into actual access decisions. ZAR lives inside the VPC and is not directly reachable from the outside world.

##### Security Role

- ZAR is the sole authorized ingress into trusted application behavior.
- ZAR is the only component permitted to interpret identity, entitlement, policy, and route-level permissions into effective access decisions.
- ZAR sits between external request termination and the protected execution and data-handling paths inside Zoe.

##### Core Responsibilities

- Terminate and accept only authorized requests arriving from approved ingress paths.
- Enforce the three-layer authorization stack to determine whether a request may touch a given asset, route, tool, or transform before any protected action is allowed to proceed.
- Act as the only component that may cause release of decrypted material into the execution plane.
- Apply any required transform, redaction, minimization, or scoping before onward release.

##### Explicit Non-Responsibilities

- ZAR is not a generic dumping ground for arbitrary business logic.
- ZAR does not grant broad ambient trust to downstream services.
- ZAR does not permit bypass paths to sensitive routes.
- ZAR does not permit callers to directly access protected routes after an initial approval event.
- ZAR does not act as an unbounded orchestration engine absent explicit policy control.

##### Security Invariants

- No sensitive route is reachable except through ZAR.
- No plaintext is materialized except through a ZAR-authorized path.
- No downstream service independently decides authorization on protected assets.
- Route protection must exist at both the network layer and the application layer.
- All calls into and out of ZAR must be authenticated, authorized, logged, and protected with TLS.

##### Trust and Blast Radius

- ZAR is part of Zoe's trusted computing base.
- Compromise of ZAR is a high-severity event because it can widen access to plaintext and protected actions.
- ZAR must therefore remain small, auditable, and policy-centric.

### Network Boundary

Current direction for Zoe:

- The network foundation is a VPC.
- As far as possible, services should exist inside the VPC.
- If a service cannot exist inside the VPC, the next requirement is private reachability without traversing the public internet.
- This includes managed-service access patterns such as VPC endpoints or PrivateLink-style connectivity where available.
- In future multi-cloud configurations, Zoe should prefer encrypted private interconnects or encrypted tunnels between trust zones rather than defaulting to open internet service-to-service paths.
- Only if those options fail should Zoe permit true internet egress.
- Any such egress must be explicit, narrow, logged, policy-controlled, and protected with TLS.
- All ingress arrives through hook-style entry points.
- This includes webhooks from external systems such as email providers, and API endpoints serving direct UX surfaces.
- These ingress points sit outside the trusted zone.
- Their role is request termination, not broad internal access.
- The three-layer authorization stack is enforced at this edge-facing boundary before traffic is allowed inward.
- The authorized router sits behind these ingress points as the inner application enforcement boundary.
- No public IPs should be assigned to sensitive internal services.
- Password-based SSH is not permitted.
- As far as possible, communication should remain encrypted even within the internal network, with TLS used throughout.
- Sensitive internal routes should accept traffic only from the Authorized Router.
- This same rule must also be enforced again at the application layer; the network boundary alone is not sufficient.
- East-west traffic within the VPC should be default-deny and explicitly allowlisted.
- Outbound egress should be allowlisted rather than open by default.
- Administrative access should use a separate management path and should not share the same trust assumptions as normal application traffic.
- Edge-facing ingress services should not have direct reachability to data stores, blob stores, metadata stores, or key-management paths.
- Decrypt-capable or data-plane-adjacent services should run in private subnets, isolated from edge-facing surfaces.
- Sensitive network segments should have flow logging enabled for investigation and audit.

### Network boundary interpretation

This implies:

- Public-facing endpoints should be thin and disposable.
- They should terminate TLS, validate source and request shape, and hand off only normalized, policy-checked traffic inward.
- They should not have broad reachability into internal services or data systems.
- Internal services should not be directly reachable from the public edge.


### Identity Boundary

This boundary is already detailed in `rebac.md`. Practical and implementation concerns around it are already covered in the ZAR section in the Application Logic Boundary.
