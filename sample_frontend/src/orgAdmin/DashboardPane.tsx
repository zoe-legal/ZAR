import type { OrgAdminPane } from "./types";

type DashboardPaneProps = {
  displayName: string | null;
  isAvailable: boolean | null;
  onNavigate: (pane: OrgAdminPane) => void;
};

export function DashboardPane({ displayName, isAvailable, onNavigate }: DashboardPaneProps) {
  return (
    <section className="settings-panel">
      <h1 className="dashboard-welcome">
        Welcome back{displayName ? `, ${displayName}` : ""}.
      </h1>
      {isAvailable === false ? (
        <section className="settings-card dashboard-queue-card">
          <p className="dashboard-queue-message">
            You&apos;re still in queue to access Zoe. Why don&apos;t you take the time to tell us about{" "}
            <button type="button" className="dashboard-queue-link" onClick={() => onNavigate("you")}>
              yourself
            </button>
            , and your{" "}
            <button type="button" className="dashboard-queue-link" onClick={() => onNavigate("settings")}>
              organization
            </button>
            ?
          </p>
        </section>
      ) : null}
    </section>
  );
}
