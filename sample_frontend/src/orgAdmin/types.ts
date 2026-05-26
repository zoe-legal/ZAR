export type OrgAdminPane = "dashboard" | "matters" | "you" | "users_roles" | "settings";

export type CanonicalAssetState =
  | "quarantined"
  | "processing"
  | "available"
  | "failed"
  | "soft_deleted"
  | "hard_deleted";

export type CanonicalAsset = {
  canonical_asset_id: string;
  matter_id: string;
  upload_attempt_id: string;
  asset_state: CanonicalAssetState;
  detected_mime_type: string | null;
  storage_size_bytes: number | null;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
