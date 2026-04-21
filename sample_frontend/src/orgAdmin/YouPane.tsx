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

const FIELD_GROUPS = [
  {
    label: "Profile",
    fields: [
      { key: "user_first_name", label: "First name" },
      { key: "user_last_name", label: "Last name" },
      { key: "user_display_name", label: "Display name" },
      { key: "user_title", label: "Title" },
      { key: "user_email", label: "Email" },
    ],
  },
  {
    label: "Contact",
    fields: [
      { key: "user_phone", label: "Phone" },
      { key: "user_notification_email", label: "Notification email" },
      { key: "user_notification_sms_number", label: "SMS number" },
    ],
  },
  {
    label: "Professional",
    fields: [
      { key: "user_bar_number", label: "Bar number" },
      { key: "user_practice_jurisdiction", label: "Practice jurisdiction" },
      { key: "user_department", label: "Department" },
    ],
  },
  {
    label: "Preferences",
    fields: [
      { key: "user_timezone", label: "Timezone" },
      { key: "user_locale", label: "Locale" },
    ],
  },
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

        const initial: Record<string, string> = {};
        for (const group of FIELD_GROUPS) {
          for (const field of group.fields) {
            const entry = body[field.key] as PropEntry | undefined;
            initial[field.key] = entry?.current_value ?? "";
          }
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

  if (loading) return <section className="settings-panel"><p className="status">Loading...</p></section>;
  if (error) return <section className="settings-panel"><p className="status">{error}</p></section>;

  return (
    <section className="settings-panel">
      {FIELD_GROUPS.map((group) => (
        <section key={group.label} className="settings-card">
          <div className="settings-card-header">
            <h2>{group.label}</h2>
          </div>
          <div className="settings-form">
            {group.fields.map((field) => {
              const state = saved[field.key] ?? "idle";
              return (
                <label key={field.key} className="field">
                  <span className="field-label">
                    {field.label}
                    {state === "saving" && <span className="field-save-state"> · Saving…</span>}
                    {state === "saved" && <span className="field-save-state field-save-state-ok"> · Saved</span>}
                    {state === "error" && <span className="field-save-state field-save-state-err"> · Error</span>}
                  </span>
                  <input
                    type="text"
                    value={values[field.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    onBlur={() => saveField(field.key, values[field.key] ?? "")}
                  />
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}
