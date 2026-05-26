import { useAuth } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import { zarBaseUrl } from "../app/constants";
import { MatterDetailPane } from "./MatterDetailPane";

type MatterState = "active" | "archived" | "hard_deleted";

type Matter = {
  matter_id: string;
  matter_state: MatterState;
  properties: Record<string, unknown> | null;
  created_at: string;
};

type MatterListResponse = {
  items: Matter[];
  next_cursor?: string | null;
};

type ModalState =
  | { type: "create" }
  | { type: "archive"; matter: Matter }
  | { type: "delete"; matter: Matter }
  | null;

function matterName(m: Matter): string {
  const name = m.properties?.["name"];
  return typeof name === "string" && name.trim() ? name.trim() : `Matter ${m.matter_id.slice(0, 8)}`;
}

export function MattersPane() {
  const auth = useAuth();
  const [matters, setMatters] = useState<Matter[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedMatter, setSelectedMatter] = useState<Matter | null>(null);

  async function fetchMatters(cursor?: string) {
    try {
      const token = await auth.getToken({ skipCache: true });
      const url = cursor
        ? `${zarBaseUrl}/matters?cursor=${encodeURIComponent(cursor)}`
        : `${zarBaseUrl}/matters`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      const body = await res.json() as MatterListResponse;
      setMatters((prev) => cursor ? [...prev, ...body.items] : body.items);
      setNextCursor(body.next_cursor ?? null);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }

  useEffect(() => { void fetchMatters(); }, [auth.getToken]);

  if (selectedMatter) {
    return (
      <MatterDetailPane
        matter={selectedMatter}
        onBack={() => setSelectedMatter(null)}
      />
    );
  }

  if (loadState === "loading") {
    return (
      <section className="settings-panel">
        <section className="settings-card">
          <p className="status">Loading matters…</p>
        </section>
      </section>
    );
  }

  if (loadState === "error") {
    return (
      <section className="settings-panel">
        <section className="settings-card">
          <p className="status">Failed to load matters.</p>
          <div className="settings-actions">
            <button type="button" className="button" onClick={() => { setLoadState("loading"); void fetchMatters(); }}>
              Retry
            </button>
          </div>
        </section>
      </section>
    );
  }

  const visibleMatters = matters.filter((m) => m.matter_state !== "hard_deleted");

  return (
    <>
      <section className="settings-panel">
        <section className="settings-card">
          <div className="settings-card-header">
            <div>
              <h2>Matters</h2>
              <p className="field-subtext matters-subtext">Create and manage your firm's matters.</p>
            </div>
            <button type="button" className="button" onClick={() => setModal({ type: "create" })}>
              + New matter
            </button>
          </div>
        </section>

        {visibleMatters.length === 0 ? (
          <section className="settings-card matters-empty">
            <p className="field-subtext">No matters yet. Create your first one above.</p>
          </section>
        ) : (
          <section className="settings-card matters-list-card">
            <ul className="matters-list">
              {visibleMatters.map((matter) => (
                <li
                  key={matter.matter_id}
                  className="matter-row matter-row-clickable"
                  onClick={() => setSelectedMatter(matter)}
                >
                  <div className="matter-row-main">
                    <span className="matter-name">{matterName(matter)}</span>
                    <span className={`matter-state-badge matter-state-${matter.matter_state}`}>
                      {matter.matter_state}
                    </span>
                  </div>
                  <div className="matter-row-meta">
                    <span className="field-subtext">
                      Created {new Date(matter.created_at).toLocaleDateString()}
                    </span>
                    <div className="matter-row-actions">
                      {matter.matter_state === "active" && (
                        <button
                          type="button"
                          className="copy-button"
                          onClick={(e) => { e.stopPropagation(); setModal({ type: "archive", matter }); }}
                        >
                          Archive
                        </button>
                      )}
                      <button
                        type="button"
                        className="danger-button"
                        disabled
                        title="Deletion is not yet available"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {nextCursor && (
              <div className="settings-actions matters-load-more">
                <button type="button" className="copy-button" onClick={() => void fetchMatters(nextCursor)}>
                  Load more
                </button>
              </div>
            )}
          </section>
        )}
      </section>

      {modal?.type === "create" && (
        <CreateModal
          onClose={() => setModal(null)}
          onCreated={(matter) => {
            setMatters((prev) => [matter, ...prev]);
            setModal(null);
          }}
          getToken={auth.getToken}
        />
      )}

      {modal?.type === "archive" && (
        <ArchiveModal
          matter={modal.matter}
          onClose={() => setModal(null)}
          onArchived={(matterId) => {
            setMatters((prev) =>
              prev.map((m) => m.matter_id === matterId ? { ...m, matter_state: "archived" } : m)
            );
            setModal(null);
          }}
          getToken={auth.getToken}
        />
      )}

      {modal?.type === "delete" && (
        <DeleteModal
          matter={modal.matter}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

function CreateModal({
  onClose,
  onCreated,
  getToken,
}: {
  onClose: () => void;
  onCreated: (matter: Matter) => void;
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("saving");
    setError(null);
    try {
      const token = await getToken({ skipCache: true });
      const res = await fetch(`${zarBaseUrl}/matters`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties: { name: name.trim() || undefined } }),
      });
      if (!res.ok) throw new Error("Failed to create matter");
      const matter = await res.json() as Matter;
      onCreated(matter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create matter");
      setState("error");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New matter</h2>
        </div>
        <div className="modal-body">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              type="text"
              placeholder="e.g. Smith v. Jones"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void submit(); }}
            />
          </label>
        </div>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="copy-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="button"
            disabled={!name.trim() || state === "saving"}
            onClick={() => void submit()}
          >
            {state === "saving" ? "Creating…" : "Create matter"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchiveModal({
  matter,
  onClose,
  onArchived,
  getToken,
}: {
  matter: Matter;
  onClose: () => void;
  onArchived: (matterId: string) => void;
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>;
}) {
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("saving");
    setError(null);
    try {
      const token = await getToken({ skipCache: true });
      const res = await fetch(`${zarBaseUrl}/matters/${matter.matter_id}/archive`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to archive matter");
      onArchived(matter.matter_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive matter");
      setState("error");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Archive matter</h2>
        </div>
        <div className="modal-body">
          <p className="field-subtext modal-confirm-copy">
            Archive <strong>{matterName(matter)}</strong>? Archived matters can be restored at any time.
          </p>
        </div>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="copy-button" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="button"
            disabled={state === "saving"}
            onClick={() => void submit()}
          >
            {state === "saving" ? "Archiving…" : "Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({
  matter,
  onClose,
}: {
  matter: Matter;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delete matter</h2>
        </div>
        <div className="modal-body">
          <p className="field-subtext modal-confirm-copy">
            Permanently delete <strong>{matterName(matter)}</strong>? This cannot be undone.
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="copy-button" onClick={onClose}>Cancel</button>
          <button type="button" className="danger-button" disabled>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
