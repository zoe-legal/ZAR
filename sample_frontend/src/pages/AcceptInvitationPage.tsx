import { SignedIn, SignedOut, useSignIn, useSignUp } from "@clerk/clerk-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useInvitationDetails } from "../hooks/useInvitationDetails";

export function AcceptInvitationPage() {
  const { invitation, inviteStatus, params, fallbackOrgDisplayName } = useInvitationDetails(window.location.search);
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const clerkStatus = params.get("__clerk_status");
  const [mode, setMode] = useState<"signin" | "signup">(
    params.get("mode") === "signup" ? "signup" : clerkStatus === "sign_up" ? "signup" : "signin"
  );
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const orgDisplayName = invitation.orgDisplayName || fallbackOrgDisplayName || "this organization";
  const invitedEmail = invitation.invitedEmail;
  const canSignIn = clerkStatus === "sign_in";
  const canSignUp = clerkStatus !== "sign_in";

  useEffect(() => {
    if (clerkStatus === "sign_up") setMode("signup");
    if (clerkStatus === "sign_in") setMode("signin");
  }, [clerkStatus]);

  const title = useMemo(() => {
    if (mode === "signup") {
      return invitedEmail ? `Create your Zoe account for ${invitedEmail}.` : "Create your Zoe account to accept the invite.";
    }
    return invitedEmail ? `Sign in as ${invitedEmail}.` : "Sign in to accept the invite.";
  }, [invitedEmail, mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setIsSubmitting(true);

    try {
      const ticket = params.get("__clerk_ticket") || params.get("ticket");
      if (!ticket) {
        throw new Error("No invitation ticket found.");
      }

      if (mode === "signup") {
        if (!signUpLoaded || !signUp || !setSignUpActive) {
          throw new Error("Clerk sign-up is not ready.");
        }
        const result = await signUp.create({
          strategy: "ticket",
          ticket,
          password,
        });
        if (result.status !== "complete" || !result.createdSessionId) {
          throw new Error("Sign-up did not complete.");
        }
        await setSignUpActive({ session: result.createdSessionId });
        window.location.href = "/protected";
        return;
      }

      if (!signInLoaded || !signIn || !setSignInActive) {
        throw new Error("Clerk sign-in is not ready.");
      }
      const result = await signIn.create({ strategy: "ticket", ticket });
      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error("Sign-in did not complete.");
      }
      await setSignInActive({ session: result.createdSessionId });
      window.location.href = "/protected";
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

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
              disabled={!canSignIn}
            >
              Already on Zoe? Sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? "invite-mode-button invite-mode-button-active" : "invite-mode-button"}
              onClick={() => setMode("signup")}
              disabled={!canSignUp}
            >
              Sign up
            </button>
          </div>
        </div>

        <section className="invite-auth-card invite-auth-card-split">
          <SignedOut>
            <form className="invite-form" onSubmit={handleSubmit}>
              <div className="invite-form-header">
                <h2 className="invite-form-title">{mode === "signup" ? "Create your account" : "Sign in to Zoe"}</h2>
                <p className="invite-copy">{title}</p>
              </div>

              {mode === "signin" && !canSignIn ? (
                <p className="invite-error">
                  This invitation is for a new Zoe account. Use sign up to continue.
                </p>
              ) : null}

              {authError ? <p className="invite-error">{authError}</p> : null}

              {invitedEmail ? (
                <label className="invite-field">
                  <span className="invite-field-label">Invited email</span>
                  <input className="invite-input" value={invitedEmail} readOnly />
                </label>
              ) : null}

              {mode === "signup" ? (
                <label className="invite-field">
                  <span className="invite-field-label">Create password</span>
                  <input
                    className="invite-input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Choose a password"
                    required
                  />
                </label>
              ) : null}

              <button
                type="submit"
                className="button invite-submit"
                disabled={isSubmitting || (mode === "signin" && !canSignIn) || (mode === "signup" && password.trim() === "")}
              >
                {isSubmitting ? "Working..." : mode === "signup" ? "Create account" : "Continue"}
              </button>
            </form>
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
