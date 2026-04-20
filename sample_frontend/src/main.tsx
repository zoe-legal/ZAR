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
        if (!cancelled) setStatus(`ZAR verified Clerk user ${body.clerk_user_id}`);
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
        <p>If you can see this page, you have sucessfully logged in.</p>
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
