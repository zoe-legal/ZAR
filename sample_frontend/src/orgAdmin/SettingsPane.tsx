import type { OrgAdminIdentity } from "./types";

type SettingsPaneProps = {
  identity: OrgAdminIdentity;
};

export function SettingsPane({ identity }: SettingsPaneProps) {
  const orgName = identity.displayName ? `${identity.displayName}'s Firm` : "";

  return (
    <section className="settings-panel">
      <section className="settings-card">
        <div className="settings-card-header">
          <h2>Organization</h2>
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
