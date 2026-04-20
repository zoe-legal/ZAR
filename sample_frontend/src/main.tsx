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
  const [greeting, setGreeting] = useState<string | null>(null);
  const [internalOrgId, setInternalOrgId] = useState<string | null>(null);
  const [internalUserId, setInternalUserId] = useState<string | null>(null);

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
              setGreeting(`Hello ${onboardingBody.display_name ?? "there"}, I'm Zoe, how can I help?`);
              setInternalUserId(onboardingBody.internal_user_id);
              setInternalOrgId(onboardingBody.internal_org_id);
              setStatus("Onboarding complete.");
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

  return (
    <main className="page">
      <section className="panel">
        {greeting ? <p>{greeting}</p> : <p>If you can see this page, you have sucessfully logged in.</p>}
        {internalUserId ? <p className="status">internal_user_id: {internalUserId}</p> : null}
        {internalOrgId ? <p className="status">internal_org_id: {internalOrgId}</p> : null}
        <p className="status">{status}</p>
        <SignOutButton>
          <button type="button">Logout</button>
        </SignOutButton>
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
