import { useEffect, useState } from "react";
import { useAuth } from "@clerk/clerk-react";

type YouPaneProps = {
  userAdminBaseUrl: string;
};

export function YouPane({ userAdminBaseUrl }: YouPaneProps) {
  const auth = useAuth();
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const token = await auth.getToken();
        const response = await fetch(`${userAdminBaseUrl}/getUserProperties`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json();
        if (!cancelled) setResult(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [auth.getToken, userAdminBaseUrl]);

  return (
    <section className="settings-panel">
      <h2 className="settings-section-title">You</h2>
      {loading && <p className="status">Loading...</p>}
      {error && <p className="status">{error}</p>}
      {!loading && !error && (
        <pre className="debug-response">{JSON.stringify(result, null, 2)}</pre>
      )}
    </section>
  );
}
