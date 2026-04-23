import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";

type SettingsPaneProps = {
  userAdminBaseUrl: string;
};

type PropEntry = {
  property_key: string;
  value_type: string;
  current_value: string | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const US_TIMEZONES = [
  { value: "America/New_York",    label: "Eastern Time (ET)" },
  { value: "America/Chicago",     label: "Central Time (CT)" },
  { value: "America/Denver",      label: "Mountain Time (MT)" },
  { value: "America/Phoenix",     label: "Mountain Time – Arizona (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage",   label: "Alaska Time (AKT)" },
  { value: "America/Adak",        label: "Hawaii-Aleutian Time (HAT)" },
  { value: "Pacific/Honolulu",    label: "Hawaii Time (no DST)" },
  { value: "America/Puerto_Rico", label: "Atlantic Time – Puerto Rico (AT)" },
  { value: "Pacific/Guam",        label: "Chamorro Time – Guam (ChST)" },
];

const US_STATES = [
  { value: "AL", label: "Alabama" }, { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" }, { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" }, { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" }, { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" }, { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" }, { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" }, { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" }, { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" }, { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" }, { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" }, { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" }, { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" }, { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" }, { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" }, { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" }, { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" }, { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" }, { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" }, { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" }, { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" }, { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" }, { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" }, { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" }, { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" }, { value: "WY", label: "Wyoming" },
  { value: "DC", label: "District of Columbia" },
];

const ORG_PROPERTY_KEYS = [
  "company_name", "company_display_name", "company_legal_name", "company_trade_name",
  "company_primary_email", "company_primary_phone", "company_website_url",
  "company_primary_address_line_1", "company_primary_address_line_2",
  "company_primary_city", "company_primary_state_or_province",
  "company_primary_postal_code", "company_primary_country_code",
  "company_tax_id", "company_registration_number",
  "company_timezone", "company_locale",
  "company_billing_contact_name", "company_billing_contact_email", "company_billing_contact_phone",
  "company_support_contact_name", "company_support_contact_email", "company_support_contact_phone",
];

export function SettingsPane({ userAdminBaseUrl }: SettingsPaneProps) {
  const auth = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, SaveState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const savedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await auth.getToken({ skipCache: true });
        if (!token) {
          throw new Error("Authentication token is unavailable. Please sign in again.");
        }
        const response = await fetch(`${userAdminBaseUrl}/getOrgProperties`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.status === 403) {
          if (!cancelled) {
            setForbidden(true);
            setError(null);
          }
          return;
        }
        const body = await response.json() as Record<string, PropEntry | unknown>;
        if (!response.ok) throw new Error((body as { error?: string }).error ?? "Failed to load");
        if (cancelled) return;

        const initial: Record<string, string> = {};
        for (const key of ORG_PROPERTY_KEYS) {
          const entry = body[key] as PropEntry | undefined;
          initial[key] = entry?.current_value ?? "";
        }
        savedRef.current = { ...initial };
        setValues(initial);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [auth.getToken, userAdminBaseUrl]);

  async function saveField(key: string, value: string) {
    if (value === savedRef.current[key]) return;
    setSaved((s) => ({ ...s, [key]: "saving" }));
    try {
      const token = await auth.getToken({ skipCache: true });
      if (!token) {
        throw new Error("Authentication token is unavailable. Please sign in again.");
      }
      const response = await fetch(`${userAdminBaseUrl}/putOrgProperties`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [key]: value || null }),
      });
      if (!response.ok) throw new Error("save failed");
      savedRef.current[key] = value;
      setSaved((s) => ({ ...s, [key]: "saved" }));
      window.setTimeout(() => setSaved((s) => ({ ...s, [key]: "idle" })), 1500);
    } catch {
      setSaved((s) => ({ ...s, [key]: "error" }));
    }
  }

  function fieldLabel(key: string, label: string) {
    const state = saved[key] ?? "idle";
    return (
      <span className="field-label">
        {label}
        {state === "saving" && <span className="field-save-state"> · Saving…</span>}
        {state === "saved" && <span className="field-save-state field-save-state-ok"> · Saved</span>}
        {state === "error" && <span className="field-save-state field-save-state-err"> · Error</span>}
      </span>
    );
  }

  function field(key: string, label: string, opts?: { type?: string; placeholder?: string }) {
    return (
      <label key={key} className="field">
        {fieldLabel(key, label)}
        <input
          type={opts?.type ?? "text"}
          placeholder={opts?.placeholder}
          value={values[key] ?? ""}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
          onBlur={() => saveField(key, values[key] ?? "")}
        />
      </label>
    );
  }

  function selectField(key: string, label: string, options: { value: string; label: string }[]) {
    return (
      <label key={key} className="field">
        {fieldLabel(key, label)}
        <select
          value={values[key] ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            setValues((prev) => ({ ...prev, [key]: v }));
            void saveField(key, v);
          }}
        >
          <option value="">— Select —</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    );
  }

  if (loading) return <section className="settings-panel"><p className="status">Loading...</p></section>;
  if (forbidden) {
    return (
      <section className="settings-panel">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Org Settings</h2>
              <p className="field-subtext">
                Only active owners can edit organization settings for this organization.
              </p>
            </div>
          </div>
        </section>
      </section>
    );
  }
  if (error) return <section className="settings-panel"><p className="status">{error}</p></section>;

  const orgDisplayName = values["company_display_name"] || values["company_name"] || "";
  const avatarChar = orgDisplayName ? orgDisplayName.charAt(0).toUpperCase() : "O";

  return (
    <section className="settings-panel">

      <section className="settings-card you-profile-card">
        <div className="you-avatar">{avatarChar}</div>
        <div className="you-profile-meta">
          <p className="you-profile-name">{orgDisplayName || "—"}</p>
          {values["company_primary_email"] && (
            <p className="you-profile-sub">{values["company_primary_email"]}</p>
          )}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Organization</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {field("company_legal_name", "Legal name")}
            {field("company_display_name", "Display name")}
          </div>
          <div className="field-row field-row-2">
            {field("company_name", "Internal name")}
            {field("company_trade_name", "Trade name / DBA")}
          </div>
          <div className="field-row field-row-2">
            {field("company_primary_email", "Email", { type: "email" })}
            {field("company_primary_phone", "Phone")}
          </div>
          {field("company_website_url", "Website", { type: "url" })}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Primary address</h2></div>
        <div className="settings-form">
          {field("company_primary_address_line_1", "Address line 1")}
          {field("company_primary_address_line_2", "Address line 2")}
          <div className="field-row field-row-2">
            {field("company_primary_city", "City")}
            {selectField("company_primary_state_or_province", "State", US_STATES)}
          </div>
          <div className="field-row field-row-2">
            {field("company_primary_postal_code", "Postal code")}
            {field("company_primary_country_code", "Country code")}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Legal &amp; Tax</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {field("company_tax_id", "EIN / Tax ID")}
            {field("company_registration_number", "Registration number")}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Billing contact</h2></div>
        <div className="settings-form">
          {field("company_billing_contact_name", "Name")}
          <div className="field-row field-row-2">
            {field("company_billing_contact_email", "Email", { type: "email" })}
            {field("company_billing_contact_phone", "Phone")}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Support contact</h2></div>
        <div className="settings-form">
          {field("company_support_contact_name", "Name")}
          <div className="field-row field-row-2">
            {field("company_support_contact_email", "Email", { type: "email" })}
            {field("company_support_contact_phone", "Phone")}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Preferences</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {selectField("company_timezone", "Timezone", US_TIMEZONES)}
            {field("company_locale", "Locale")}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Danger zone</h2></div>
        <div className="settings-form">
          <div className="settings-actions">
            <button type="button" className="danger-button" disabled>Delete organization</button>
          </div>
        </div>
      </section>

    </section>
  );
}
