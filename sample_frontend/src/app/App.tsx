import { useEffect, useState } from "react";
import { AcceptInvitationPage } from "../pages/AcceptInvitationPage";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProtectedPage } from "../pages/ProtectedPage";
import { SignupPage } from "../pages/SignupPage";

export function App() {
  const [{ pathname }, setLocation] = useState(() => ({
    pathname: window.location.pathname,
  }));

  useEffect(() => {
    const handleLocationChange = () => {
      setLocation({ pathname: window.location.pathname });
    };

    window.addEventListener("popstate", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
    };
  }, []);

  if (pathname === "/") {
    return <HomePage />;
  }

  if (pathname === "/login" || pathname.startsWith("/login/")) {
    return <LoginPage />;
  }

  if (pathname === "/signup" || pathname.startsWith("/signup/")) {
    return <SignupPage />;
  }

  if (pathname === "/accept-invitation" || pathname.startsWith("/accept-invitation/")) {
    return <AcceptInvitationPage />;
  }

  if (pathname === "/protected") {
    return <ProtectedPage />;
  }

  return <NotFoundPage />;
}
