# User Admin

This folder is reserved for user and organization administration features that are application concerns rather than ZAR concerns.

Current intent:

- firm/user invite flows
- org membership management
- role and membership administration workflows
- user-facing or admin-facing account management endpoints and UI

Boundary rule:

- `user-admin/` owns user-management product behavior
- `backend/` remains the ZAR boundary that authenticates requests and routes them onward
- ZAR should not become the long-term home of product UI or general account administration logic

Current status:

- no code has been moved here yet
- this folder exists now to make the separation visible before implementation work resumes

Expected future shape:

- service code for org membership and invites
- UI or API artifacts for administration workflows
- tests around membership and invitation behavior
