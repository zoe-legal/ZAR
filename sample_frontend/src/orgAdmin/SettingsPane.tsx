import type { OrgAdminIdentity } from "./types";
import { useState } from "react";

type SettingsPaneProps = {
  identity: OrgAdminIdentity;
};

export function SettingsPane({ identity }: SettingsPaneProps) {
  const [copiedField, setCopiedField] = useState<"org" | "user" | null>(null);
  const orgName = identity.displayName ? `${identity.displayName}'s Firm` : "";

  async function copyValue(kind: "org" | "user", value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(kind);
    window.setTimeout(() => {
      setCopiedField((current) => (current === kind ? null : current));
    }, 1500);
  }

  return (
    <section className="settings-panel">
      <div className="settings-list">
        <label className="field field-list">
          <span className="field-label">Org Name</span>
          <input type="text" value={orgName} readOnly />
          <span className="field-subtext field-subtext-row">
            <span>internal_org_id: {identity.internalOrgId ?? ""}</span>
            <button
              type="button"
              className="copy-button"
              onClick={() => copyValue("org", identity.internalOrgId)}
            >
              {copiedField === "org" ? "Copied" : "Copy"}
            </button>
          </span>
        </label>

        <label className="field field-list">
          <span className="field-label">Display Name</span>
          <input type="text" value={orgName} readOnly />
        </label>

        <label className="field field-list">
          <span className="field-label">Primary Contact</span>
          <input type="text" value={identity.displayName ?? ""} readOnly />
          <span className="field-subtext field-subtext-row">
            <span>internal_user_id: {identity.internalUserId ?? ""}</span>
            <button
              type="button"
              className="copy-button"
              onClick={() => copyValue("user", identity.internalUserId)}
            >
              {copiedField === "user" ? "Copied" : "Copy"}
            </button>
          </span>
        </label>
      </div>
    </section>
  );
}
