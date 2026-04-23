import { SignedIn, SignedOut, SignIn, SignUp } from "@clerk/clerk-react";
import { useState } from "react";
import { useInvitationDetails } from "../hooks/useInvitationDetails";

export function AcceptInvitationPage() {
  const { invitation, inviteStatus, params, fallbackOrgDisplayName } = useInvitationDetails(window.location.search);
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : "signin"
  );
  const orgDisplayName = invitation.orgDisplayName || fallbackOrgDisplayName || "this organization";

  return (
    <main className="page invite-page">
      <section className="invite-shell invite-shell-split">
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
            <button
              type="button"
              className={mode === "signin" ? "invite-mode-button invite-mode-button-active" : "invite-mode-button"}
              onClick={() => setMode("signin")}
            >
              Already on Zoe? Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "invite-mode-button invite-mode-button-active" : "invite-mode-button"}
              onClick={() => setMode("signup")}
            >
              Sign up
            </button>
          </div>
        </div>

        <section className="invite-auth-card invite-auth-card-split">
          <SignedOut>
            {mode === "signup" ? (
              <SignUp routing="virtual" signInUrl={buildModeHref("signin", params)} forceRedirectUrl="/protected" />
            ) : (
              <SignIn routing="virtual" signUpUrl={buildModeHref("signup", params)} forceRedirectUrl="/protected" />
            )}
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

function buildModeHref(mode: "signin" | "signup", params: URLSearchParams) {
  const next = new URLSearchParams(params);
  if (mode === "signup") {
    next.set("mode", "signup");
  } else {
    next.delete("mode");
  }
  const query = next.toString();
  return query ? `/accept-invitation?${query}` : "/accept-invitation";
}
