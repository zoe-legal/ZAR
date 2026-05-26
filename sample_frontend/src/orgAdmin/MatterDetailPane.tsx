import { useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import { zarBaseUrl } from "../app/constants";
import type { CanonicalAsset, CanonicalAssetState } from "./types";
import { UploadModal } from "./UploadModal";

type AssetListResponse = {
  items: CanonicalAsset[];
  next_cursor?: string | null;
};

type Matter = {
  matter_id: string;
  properties: Record<string, unknown> | null;
};

function assetFilename(asset: CanonicalAsset): string {
  const name = asset.properties?.["filename"];
  return typeof name === "string" && name.trim()
    ? name.trim()
    : `Asset ${asset.canonical_asset_id.slice(0, 8)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATE_COLORS: Record<CanonicalAssetState, string> = {
  quarantined: "asset-state-quarantined",
  processing: "asset-state-processing",
  available: "asset-state-available",
  failed: "asset-state-failed",
  soft_deleted: "asset-state-soft_deleted",
  hard_deleted: "asset-state-hard_deleted",
};

export function MatterDetailPane({
  matter,
  onBack,
}: {
  matter: Matter;
  onBack: () => void;
}) {
  const auth = useAuth();
  const [assets, setAssets] = useState<CanonicalAsset[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [showUpload, setShowUpload] = useState(false);

  const matterName = (() => {
    const name = matter.properties?.["name"];
    return typeof name === "string" && name.trim()
      ? name.trim()
      : `Matter ${matter.matter_id.slice(0, 8)}`;
  })();

  async function fetchAssets(cursor?: string) {
    try {
      const token = await auth.getToken({ skipCache: true });
      const url = cursor
        ? `${zarBaseUrl}/matters/${matter.matter_id}/assets?cursor=${encodeURIComponent(cursor)}`
        : `${zarBaseUrl}/matters/${matter.matter_id}/assets`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      const body = (await res.json()) as AssetListResponse;
      setAssets((prev) => (cursor ? [...prev, ...body.items] : body.items));
      setNextCursor(body.next_cursor ?? null);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => {
    void fetchAssets();
  }, [matter.matter_id]);

  return (
    <>
      <section className="settings-panel">
        <section className="settings-card">
          <div className="matter-detail-nav">
            <button type="button" className="matter-back-button" onClick={onBack}>
              ← Matters
            </button>
          </div>
          <div className="settings-card-header">
            <h2>{matterName}</h2>
            <button type="button" className="button" onClick={() => setShowUpload(true)}>
              Upload files
            </button>
          </div>
        </section>

        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Assets</h2>
              <p className="field-subtext matters-subtext">Files uploaded to this matter.</p>
            </div>
          </div>

          {loadState === "loading" && <p className="status">Loading assets…</p>}

          {loadState === "error" && (
            <div>
              <p className="status">Failed to load assets.</p>
              <div className="settings-actions" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setLoadState("loading");
                    void fetchAssets();
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {loadState === "ready" && assets.length === 0 && (
            <p className="field-subtext">No files uploaded yet.</p>
          )}

          {loadState === "ready" && assets.length > 0 && (
            <>
              <ul className="asset-list">
                {assets.map((asset) => (
                  <li key={asset.canonical_asset_id} className="asset-row">
                    <div className="asset-row-main">
                      <span className="asset-name">{assetFilename(asset)}</span>
                      <span
                        className={`asset-state-badge ${STATE_COLORS[asset.asset_state] ?? ""}`}
                      >
                        {asset.asset_state}
                      </span>
                    </div>
                    <div className="asset-row-meta">
                      <span className="field-subtext">
                        {asset.detected_mime_type ??
                          (asset.properties?.["content_type"] as string | undefined) ??
                          "—"}
                        {asset.storage_size_bytes != null &&
                          ` · ${formatBytes(asset.storage_size_bytes)}`}
                      </span>
                      <span className="field-subtext">
                        {new Date(asset.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {nextCursor && (
                <div className="settings-actions">
                  <button
                    type="button"
                    className="copy-button"
                    onClick={() => void fetchAssets(nextCursor)}
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </section>

      {showUpload && (
        <UploadModal
          matterId={matter.matter_id}
          onClose={() => setShowUpload(false)}
          onAssetCreated={(asset) => setAssets((prev) => [asset, ...prev])}
          getToken={auth.getToken}
        />
      )}
    </>
  );
}
