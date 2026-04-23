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
  useClerk,
  useOrganizationList,
} from "@clerk/clerk-react";
import { HomeIcon, MoonIcon, PanelLeftIcon, SettingsIcon, ShieldUsersIcon, SunIcon, UserIcon } from "./orgAdmin/icons";
import { DashboardPane } from "./orgAdmin/DashboardPane";
import { SettingsPane } from "./orgAdmin/SettingsPane";
import type { OrgAdminPane } from "./orgAdmin/types";
import { YouPane } from "./orgAdmin/YouPane";
import { UsersRolesPane } from "./orgAdmin/UsersRolesPane";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const zarBaseUrl = import.meta.env.VITE_ZAR_BASE_URL ?? "http://localhost:8788";
const userAdminBaseUrl = import.meta.env.VITE_USER_ADMIN_BASE_URL ?? "https://dev.zoe-legal.net/api/user-admin";
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

  if (path === "/accept-invitation" || path.startsWith("/accept-invitation/")) {
    return <AcceptInvitationPage />;
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

function AcceptInvitationPage() {
  const [invitation, setInvitation] = useState<{
    orgDisplayName: string | null;
    invitedEmail: string | null;
    roleKey: string | null;
  }>({
    orgDisplayName: null,
    invitedEmail: null,
    roleKey: null,
  });
  const [inviteStatus, setInviteStatus] = useState<string>("");

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode") === "signup" ? "signup" : "signin";
  const ticket = params.get("__clerk_ticket") || params.get("ticket");
  const invitationId = extractInvitationId(ticket);
  const fallbackOrgDisplayName =
    params.get("organization_name")
    || params.get("organizationName")
    || params.get("org_name")
    || params.get("org")
    || null;
  const orgDisplayName = invitation.orgDisplayName || fallbackOrgDisplayName || "this organization";

  useEffect(() => {
    let cancelled = false;

    async function loadInvitation() {
      if (!invitationId) {
        setInviteStatus("");
        return;
      }

      try {
        setInviteStatus("Loading invitation details...");
        const response = await fetch(
          `${window.location.origin}/onboarding/getInvitationDetails?clerk_invitation_id=${encodeURIComponent(invitationId)}`
        );
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.detail ?? body.error ?? "Invitation lookup failed");
        }
        if (cancelled) return;
        setInvitation({
          orgDisplayName: typeof body.org_display_name === "string" ? body.org_display_name : null,
          invitedEmail: typeof body.invited_email === "string" ? body.invited_email : null,
          roleKey: typeof body.zoe_role_key === "string" ? body.zoe_role_key : null,
        });
        setInviteStatus("");
      } catch (error) {
        if (cancelled) return;
        setInviteStatus(error instanceof Error ? error.message : String(error));
      }
    }

    void loadInvitation();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  const signInHref = buildAcceptInvitationHref("signin", params);
  const signUpHref = buildAcceptInvitationHref("signup", params);
  const authTargetHref = mode === "signup" ? signUpHref : signInHref;

  return (
    <main className="page invite-page">
      <section className="invite-shell">
        <div className="invite-hero">
          <p className="eyebrow">Invitation</p>
          <h1 className="invite-title">You&apos;ve been invited to join {orgDisplayName}.</h1>
          <p className="invite-copy">
            Sign in if you already have an account, or create one below to join the organization.
          </p>
          {invitation.invitedEmail ? (
            <p className="status">Invitation for {invitation.invitedEmail}{invitation.roleKey ? ` as ${invitation.roleKey}.` : "."}</p>
          ) : null}
          {inviteStatus ? <p className="status">{inviteStatus}</p> : null}
          <div className="invite-mode-toggle">
            <a
              className={mode === "signin" ? "invite-mode-button invite-mode-button-active" : "invite-mode-button"}
              href={signInHref}
            >
              Sign in
            </a>
            <a
              className={mode === "signup" ? "invite-mode-button invite-mode-button-active" : "invite-mode-button"}
              href={signUpHref}
            >
              Sign up
            </a>
          </div>
        </div>

        <section className="invite-auth-card">
          <SignedOut>
            <div className="invite-signed-out">
              <p className="invite-signed-in-title">
                {mode === "signup" ? "Create your account to accept the invite." : "Sign in to accept the invite."}
              </p>
              <p className="invite-copy">
                We&apos;ll carry this invitation through to Clerk and continue after authentication.
              </p>
              <a className="button" href={authTargetHref}>
                {mode === "signup" ? "Continue to sign up" : "Continue to sign in"}
              </a>
            </div>
          </SignedOut>
          <SignedIn>
            <div className="invite-signed-in">
              <p className="invite-signed-in-title">You&apos;re already signed in.</p>
              <p className="invite-copy">Continue into the app and we&apos;ll finish setting up your organization access there.</p>
              <a className="button" href="/protected">Continue</a>
            </div>
          </SignedIn>
        </section>
      </section>
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
  const auth = useAuth();
  const clerk = useClerk();
  const orgList = useOrganizationList({ userMemberships: true });
  const [status, setStatus] = useState("Checking ZAR session...");
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<OrgAdminPane>("dashboard");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (auth.orgId || !orgList.userMemberships?.data?.[0]) return;
    void clerk.setActive({ organization: orgList.userMemberships.data[0].organization });
  }, [auth.orgId, orgList.userMemberships, clerk.setActive]);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const token = await auth.getToken();
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
  }, [auth.getToken]);

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
              className={activeSection === "dashboard" ? "nav-item nav-item-active" : "nav-item"}
              onClick={() => setActiveSection("dashboard")}
            >
              <HomeIcon className="nav-icon" />
              {!sidebarCollapsed ? <span>Dashboard</span> : null}
            </button>
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
              {activeSection === "dashboard" ? <DashboardPane displayName={displayName} /> : null}
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

function buildAcceptInvitationHref(mode: "signin" | "signup", params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete("mode");
  const ticket = next.get("__clerk_ticket") || next.get("ticket");
  const ticketQuery = ticket ? `__clerk_ticket=${encodeURIComponent(ticket)}` : "";
  if (mode === "signup") {
    return ticketQuery ? `/signup?${ticketQuery}` : "/signup";
  }
  return ticketQuery ? `/login?${ticketQuery}` : "/login";
}

function extractInvitationId(ticket: string | null) {
  if (!ticket) return null;
  try {
    const payloadSegment = ticket.split(".")[1];
    if (!payloadSegment) return null;
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as Record<string, unknown>;
    return typeof payload.sid === "string" ? payload.sid : null;
  } catch {
    return null;
  }
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return window.atob(normalized + padding);
}
