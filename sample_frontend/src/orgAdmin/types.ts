export type OrgAdminPane = "you" | "users_roles" | "settings";

export type OrgAdminIdentity = {
  displayName: string | null;
  internalOrgId: string | null;
  internalUserId: string | null;
};
