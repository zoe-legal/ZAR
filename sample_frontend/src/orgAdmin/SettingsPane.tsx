import type { OrgAdminIdentity } from "./types";

type SettingsPaneProps = {
  identity: OrgAdminIdentity;
};

export function SettingsPane({ identity }: SettingsPaneProps) {
  const orgName = identity.displayName ? `${identity.displayName}'s Firm` : "";

  return (
    <section className="settings-panel">
      <div className="settings-section">
        <div className="section-heading">
          <h2>Org Details</h2>
          <span className="section-pill">Editable Soon</span>
        </div>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Org Name</span>
            <input type="text" value={orgName} readOnly />
            <span className="field-subtext">internal_org_id: {identity.internalOrgId ?? ""}</span>
          </label>
          <label className="field">
            <span className="field-label">Display Name</span>
            <input type="text" value={orgName} readOnly />
          </label>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-heading">
          <h2>Primary Contact</h2>
          <span className="section-pill">Editable Soon</span>
        </div>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Display Name</span>
            <input type="text" value={identity.displayName ?? ""} readOnly />
            <span className="field-subtext">internal_user_id: {identity.internalUserId ?? ""}</span>
          </label>
        </div>
      </div>
    </section>
  );
}
