import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";

type YouPaneProps = {
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

export function YouPane({ userAdminBaseUrl }: YouPaneProps) {
  const auth = useAuth();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, SaveState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await auth.getToken({ skipCache: true });
        const response = await fetch(`${userAdminBaseUrl}/getUserProperties`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json() as Record<string, PropEntry | unknown>;
        if (!response.ok) throw new Error((body as { error?: string }).error ?? "Failed to load");
        if (cancelled) return;

        const keys = [
          "user_first_name", "user_last_name", "user_display_name", "user_title",
          "user_email", "user_phone", "user_notification_email", "user_notification_sms_number",
          "user_bar_number", "user_practice_jurisdiction", "user_department",
          "user_timezone", "user_locale",
        ];
        const initial: Record<string, string> = {};
        for (const key of keys) {
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
      const token = await auth.getToken();
      const response = await fetch(`${userAdminBaseUrl}/putUserProperties`, {
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

  function field(key: string, label: string, opts?: { type?: string }) {
    return (
      <label key={key} className="field">
        {fieldLabel(key, label)}
        <input
          type={opts?.type ?? "text"}
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
  if (error) return <section className="settings-panel"><p className="status">{error}</p></section>;

  const displayName = values["user_display_name"] || [values["user_first_name"], values["user_last_name"]].filter(Boolean).join(" ") || "—";
  const subtitle = values["user_email"] || "";

  return (
    <section className="settings-panel">

      <section className="settings-card you-profile-card">
        <div className="you-avatar">{displayName.charAt(0).toUpperCase()}</div>
        <div className="you-profile-meta">
          <p className="you-profile-name">{displayName}</p>
          {subtitle && <p className="you-profile-sub">{subtitle}</p>}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Personal details</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {field("user_first_name", "First name")}
            {field("user_last_name", "Last name")}
          </div>
          {field("user_display_name", "Display name")}
          {field("user_title", "Title")}
          {field("user_email", "Email", { type: "email" })}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Contact</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {field("user_phone", "Phone")}
            {field("user_notification_sms_number", "SMS number")}
          </div>
          {field("user_notification_email", "Notification email", { type: "email" })}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Professional</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {field("user_bar_number", "Bar number")}
            {field("user_department", "Department")}
          </div>
          {field("user_practice_jurisdiction", "Practice jurisdiction")}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header"><h2>Preferences</h2></div>
        <div className="settings-form">
          <div className="field-row field-row-2">
            {selectField("user_timezone", "Timezone", US_TIMEZONES)}
            {field("user_locale", "Locale")}
          </div>
        </div>
      </section>

    </section>
  );
}
