import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ClerkProvider,
  RedirectToSignIn,
  SignedIn,
  SignedOut,
  SignIn,
  SignUp,
  SignOutButton,
  useAuth,
} from "@clerk/clerk-react";
import { MoonIcon, PanelLeftIcon, SettingsIcon, ShieldUsersIcon, SunIcon, UserIcon } from "./orgAdmin/icons";
import { SettingsPane } from "./orgAdmin/SettingsPane";
import type { OrgAdminPane } from "./orgAdmin/types";
import { YouPane } from "./orgAdmin/YouPane";
import { UsersRolesPane } from "./orgAdmin/UsersRolesPane";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const zarBaseUrl = import.meta.env.VITE_ZAR_BASE_URL ?? "http://localhost:8788";
const ONBOARDING_RETRY_DELAY_MS = 30_000;
const ONBOARDING_MAX_RETRIES = 2;

if (!publishableKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <App />
    </ClerkProvider>
  </StrictMode>
);

function App() {
  const path = window.location.pathname;

  if (path === "/") {
    return <HomePage />;
  }

  if (path === "/login" || path.startsWith("/login/")) {
    return <LoginPage />;
  }

  if (path === "/signup" || path.startsWith("/signup/")) {
    return <SignupPage />;
  }

  if (path === "/protected") {
    return <ProtectedPage />;
  }

  return <NotFoundPage />;
}

function HomePage() {
  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Welcome to the offices of</p>
        <h1 className="hero-title">Sue, Grabbit, and Runne</h1>
        <a className="button hero-button" href="/login">Login</a>
      </section>
    </main>
  );
}

function LoginPage() {
  return (
    <main className="page">
      <SignIn routing="path" path="/login" signUpUrl="/signup" forceRedirectUrl="/protected" />
    </main>
  );
}

function SignupPage() {
  return (
    <main className="page">
      <SignUp routing="path" path="/signup" signInUrl="/login" forceRedirectUrl="/protected" />
    </main>
  );
}

function ProtectedPage() {
  return (
    <>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <ProtectedContent />
      </SignedIn>
    </>
  );
}

function ProtectedContent() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState("Checking ZAR session...");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [internalOrgId, setInternalOrgId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<OrgAdminPane>("settings");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const token = await getToken();
        if (!token) throw new Error("missing Clerk token");

        const response = await fetch(`${zarBaseUrl}/auth/session`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "ZAR session check failed");
        if (cancelled) return;

        setStatus(`ZAR verified Clerk user ${body.clerk_user_id}. Starting onboarding...`);

        for (let attempt = 0; attempt <= ONBOARDING_MAX_RETRIES; attempt += 1) {
          const onboardingResponse = await fetch(`${zarBaseUrl}/onboarding/internal-user-and-org`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          const onboardingBody = await onboardingResponse.json();

          if (!onboardingResponse.ok) {
            throw new Error(onboardingBody.error ?? "Onboarding request failed");
          }

          if (onboardingBody.status === "internal_user_details") {
            if (!cancelled) {
              setDisplayName(onboardingBody.display_name ?? "there");
              setInternalUserId(onboardingBody.internal_user_id);
              setInternalOrgId(onboardingBody.internal_org_id);
              setStatus("");
            }
            return;
          }

          if (!cancelled) {
            const attemptLabel = attempt < ONBOARDING_MAX_RETRIES
              ? `Retrying in 30s (${attempt + 1}/${ONBOARDING_MAX_RETRIES + 1})...`
              : "No more retries remaining.";
            setStatus(`Onboarding ${onboardingBody.status}: ${onboardingBody.reason}. ${attemptLabel}`);
          }

          if (attempt < ONBOARDING_MAX_RETRIES) {
            await delay(ONBOARDING_RETRY_DELAY_MS);
          }
        }
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : String(error));
      }
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const identity = { displayName, internalOrgId, internalUserId };

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
            {!sidebarCollapsed ? (
              <div>
                <p className="eyebrow">Org Admin</p>
                <h2 className="sidebar-title">Sue, Grabbit, and Runne</h2>
              </div>
            ) : null}
          </div>
          <nav className="sidebar-nav">
            <button
              type="button"
              className={activeSection === "you" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("you")}
            >
              <UserIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>You</span> : null}
            </button>
            <button
              type="button"
              className={activeSection === "users_roles" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("users_roles")}
            >
              <ShieldUsersIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>Users &amp; Roles</span> : null}
            </button>
            <button
              type="button"
              className={activeSection === "settings" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("settings")}
            >
              <SettingsIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>Settings</span> : null}
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
            {displayName ? (
              <h1 className="content-title">Hello {displayName}, I&apos;m Zoe, how can I help?</h1>
            ) : (
              <h1 className="content-title">If you can see this page, you have sucessfully logged in.</h1>
            )}
            <p className="status">{status}</p>
          </header>

          {activeSection === "settings" ? <SettingsPane identity={identity} /> : null}
          {activeSection === "you" ? <YouPane /> : null}
          {activeSection === "users_roles" ? <UsersRolesPane /> : null}
        </section>
      </section>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main className="page">
      <section className="panel">
        <p>Not found.</p>
      </section>
    </main>
  );
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
