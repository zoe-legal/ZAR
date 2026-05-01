-- Seed coarse org-level entitlement definitions for the first ZAR v0.2 surface.
--
-- Intentionally excluded:
--   org.admin
--   matter.member
--   matter.editor
--
-- Those are policy / relation predicates, not entitlements_def rows.

insert into zoe_entitlements.entitlements_def (
  entitlement_key,
  description
)
values
  ('user.profile.read', 'Read caller-owned user profile properties'),
  ('user.profile.write', 'Write caller-owned user profile properties'),
  ('org.profile.read', 'Read org profile properties'),
  ('org.profile.write', 'Write org profile properties'),
  ('org.users.invite', 'Create org invitations'),
  ('matters.read', 'List and read matter metadata'),
  ('matters.create', 'Create matters'),
  ('matters.update', 'Patch matter metadata'),
  ('matters.archive', 'Archive matters'),
  ('matters.delete', 'Hard-delete matters'),
  ('matters.restore', 'Restore archived matters'),
  ('uploads.read', 'List and read upload attempts'),
  ('uploads.create', 'Create upload attempts'),
  ('uploads.finalize', 'Finalize upload attempts into canonical assets'),
  ('assets.read', 'List and read canonical asset metadata'),
  ('derivatives.read', 'List and read derivative metadata'),
  ('derivatives.create', 'Create derivatives')
on conflict (entitlement_key) do update
set
  description = excluded.description,
  updated_at = now();
