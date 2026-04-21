type DashboardPaneProps = {
  displayName: string | null;
};

export function DashboardPane({ displayName }: DashboardPaneProps) {
  return (
    <section className="settings-panel">
      <h1 className="dashboard-welcome">
        Welcome back{displayName ? `, ${displayName}` : ""}.
      </h1>
    </section>
  );
}
