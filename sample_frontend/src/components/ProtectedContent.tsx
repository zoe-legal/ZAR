import { SignOutButton } from "@clerk/clerk-react";
import { useEffect, useState } from "react";
import { userAdminBaseUrl } from "../app/constants";
import { useProtectedSession } from "../hooks/useProtectedSession";
import { DashboardPane } from "../orgAdmin/DashboardPane";
import { BriefcaseIcon, HomeIcon, MoonIcon, PanelLeftIcon, SettingsIcon, ShieldUsersIcon, SunIcon, UserIcon } from "../orgAdmin/icons";
import { MattersPane } from "../orgAdmin/MattersPane";
import { SettingsPane } from "../orgAdmin/SettingsPane";
import type { OrgAdminPane } from "../orgAdmin/types";
import { UsersRolesPane } from "../orgAdmin/UsersRolesPane";
import { YouPane } from "../orgAdmin/YouPane";

export function ProtectedContent() {
  const { auth, status, displayName } = useProtectedSession();
  const [activeSection, setActiveSection] = useState<OrgAdminPane>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!auth.orgId) return;
    let cancelled = false;

    async function loadOrgName() {
      try {
        const token = await auth.getToken({ skipCache: true });
        const response = await fetch(`${userAdminBaseUrl}/getOrgProperties`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return;
        const body = await response.json() as Record<string, { current_value?: string | null } | unknown>;
        const name =
          (body["company_display_name"] as { current_value?: string | null } | undefined)?.current_value ||
          (body["company_name"] as { current_value?: string | null } | undefined)?.current_value ||
          null;
        if (!cancelled) setOrgName(name);
      } catch {
        // sidebar falls back to empty gracefully
      }
    }

    async function loadAvailability() {
      try {
        const token = await auth.getToken({ skipCache: true });
        const response = await fetch(`${userAdminBaseUrl}/isAvailable`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok || cancelled) return;
        const body = await response.json() as { is_available?: boolean };
        if (!cancelled) setIsAvailable(body.is_available ?? false);
      } catch {
        // leave as null — don't gate the UI on a failed availability check
      }
    }

    void loadOrgName();
    void loadAvailability();
    return () => { cancelled = true; };
  }, [auth.orgId, auth.getToken]);

  return (
    <main className={`admin-page theme-${theme}`}>
      <section className={`admin-shell${sidebarCollapsed ? " admin-shell-collapsed" : ""}`}>
        <aside className={`sidebar${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
          <div className="sidebar-brand">
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((current) => !current)}
              aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            >
              <PanelLeftIcon className="nav-icon" />
            </button>
            {!sidebarCollapsed && orgName ? (
              <h2 className="sidebar-title">{orgName}</h2>
            ) : null}
          </div>
          <nav className="sidebar-nav">
            <button
              type="button"
              className={activeSection === "dashboard" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("dashboard")}
            >
              <HomeIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>Dashboard</span> : null}
            </button>
            {isAvailable !== false ? (
              <button
                type="button"
                className={activeSection === "matters" ? "nav-item nav-item-active" : "nav-item"}
                onClick={() => setActiveSection("matters")}
              >
                <BriefcaseIcon className="nav-icon" />
                {!sidebarCollapsed ? <span>Matters</span> : null}
              </button>
            ) : null}
            <div className="sidebar-nav-spacer" />
            <button
              type="button"
              className={activeSection === "you" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("you")}
            >
              <UserIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>You</span> : null}
            </button>
            {isAvailable !== false ? (
              <button
                type="button"
                className={activeSection === "users_roles" ? "nav-item nav-item-active" : "nav-item"}
                onClick={() => setActiveSection("users_roles")}
              >
                <ShieldUsersIcon className="nav-icon" />
                {!sidebarCollapsed ? <span>Users &amp; Roles</span> : null}
              </button>
            ) : null}
            <button
              type="button"
              className={activeSection === "settings" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("settings")}
            >
              <SettingsIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>Org Settings</span> : null}
            </button>
          </nav>
          <div className="sidebar-footer">
            <button
              type="button"
              className="theme-button"
              onClick={() => setTheme((current) => (current === "light" ? "dark" : "light"))}
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            >
              {theme === "light" ? <MoonIcon className="nav-icon" /> : <SunIcon className="nav-icon" />}
              {!sidebarCollapsed ? <span>{theme === "light" ? "Dark" : "Light"}</span> : null}
            </button>
            <SignOutButton>
              <button type="button">Logout</button>
            </SignOutButton>
          </div>
        </aside>

        <section className="content-pane">
          <header className="content-header">
            <p className="status">{status || (!auth.orgId ? "Activating session..." : "")}</p>
          </header>

          {auth.orgId ? (
            <>
              {activeSection === "dashboard" ? <DashboardPane displayName={displayName} isAvailable={isAvailable} onNavigate={setActiveSection} /> : null}
              {activeSection === "matters" ? <MattersPane /> : null}
              {activeSection === "settings" ? <SettingsPane userAdminBaseUrl={userAdminBaseUrl} /> : null}
              {activeSection === "you" ? <YouPane userAdminBaseUrl={userAdminBaseUrl} /> : null}
              {activeSection === "users_roles" ? <UsersRolesPane userAdminBaseUrl={userAdminBaseUrl} /> : null}
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}
