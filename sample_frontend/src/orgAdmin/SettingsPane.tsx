import type { OrgAdminIdentity } from "./types";
import { useState } from "react";
import { CopyIcon } from "./icons";

type SettingsPaneProps = {
  identity: OrgAdminIdentity;
};

export function SettingsPane({ identity }: SettingsPaneProps) {
  const [copiedField, setCopiedField] = useState<"org" | null>(null);
  const orgName = identity.displayName ? `${identity.displayName}'s Firm` : "";

  async function copyValue(kind: "org", value: string | null) {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(kind);
    window.setTimeout(() => {
      setCopiedField((current) => (current === kind ? null : current));
    }, 1500);
  }

  return (
    <section className="settings-panel">
      <section className="settings-card">
        <div className="settings-card-header">
          <h2>Organization</h2>
          <span className="field-subtext field-subtext-row">
            <span>{identity.internalOrgId ?? ""}</span>
            <button
              type="button"
              className="copy-button"
              onClick={() => copyValue("org", identity.internalOrgId)}
              aria-label={copiedField === "org" ? "Copied" : "Copy organization ID"}
            >
              <CopyIcon style={{ width: 13, height: 13 }} />
            </button>
          </span>
        </div>

        <div className="settings-form">
          <label className="field">
            <span className="field-label">Organization name</span>
            <input type="text" value={orgName} readOnly />
          </label>

          <div className="form-group">
            <span className="field-group-label">Primary business address</span>
            <div className="field-row field-row-2">
              <label className="field">
                <input type="text" value="" placeholder="Address line 1" readOnly />
              </label>
              <label className="field">
                <input type="text" value="" placeholder="Address line 2" readOnly />
              </label>
            </div>
            <div className="field-row field-row-4">
              <label className="field">
                <span className="field-label">Country</span>
                <input type="text" value="" placeholder="Country" readOnly />
              </label>
              <label className="field">
                <span className="field-label">State or province</span>
                <input type="text" value="" placeholder="State or province" readOnly />
              </label>
              <label className="field field-span-2">
                <span className="field-label">City</span>
                <input type="text" value="" placeholder="City" readOnly />
              </label>
              <label className="field">
                <span className="field-label">Postal code</span>
                <input type="text" value="" placeholder="Postal code" readOnly />
              </label>
            </div>
          </div>

          <div className="form-group">
            <span className="field-group-label">Business tax ID</span>
            <div className="field-row field-row-2">
              <label className="field">
                <span className="field-label">Tax identifier</span>
                <input type="text" value="" placeholder="Tax identifier" readOnly />
              </label>
            </div>
          </div>

          <div className="settings-divider" />

          <div className="settings-actions">
            <button type="button" className="danger-button">Delete organization</button>
          </div>
        </div>
      </section>

    </section>
  );
}
