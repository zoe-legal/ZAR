import { useState } from "react";
import { useAuth } from "@clerk/clerk-react";

type UsersRolesPaneProps = {
  userAdminBaseUrl: string;
};

type InviteState = "idle" | "sending" | "sent" | "error";

const ROLE_OPTIONS = [
  { value: "owner", label: "Owner", blurb: "Full org authority and invite access." },
  { value: "attorney", label: "Attorney", blurb: "Licensed attorney with approval authority where policy allows." },
  { value: "paralegal", label: "Paralegal", blurb: "Legal assistant or paralegal working inside the firm." },
  { value: "staff", label: "Staff", blurb: "Operational staff, intake, or administrative support." },
  { value: "client_customer", label: "Client Customer", blurb: "Customer-side user associated with the firm." },
];

export function UsersRolesPane({ userAdminBaseUrl }: UsersRolesPaneProps) {
  const auth = useAuth();
  const [emailAddress, setEmailAddress] = useState("");
  const [roleKey, setRoleKey] = useState("attorney");
  const [inviteState, setInviteState] = useState<InviteState>("idle");
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);

  const selectedRole = ROLE_OPTIONS.find((option) => option.value === roleKey) ?? ROLE_OPTIONS[1];

  async function sendInvite() {
    setInviteState("sending");
    setInviteMessage(null);

    try {
      const token = await auth.getToken();
      const response = await fetch(`${userAdminBaseUrl}/createOrgInvite`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_address: emailAddress,
          role_key: roleKey,
          redirect_url: `${window.location.origin}/accept-invitation`,
        }),
      });

      const body = await response.json() as {
        error?: string;
        detail?: string;
        email_address?: string;
        zoe_role_key?: string;
      };

      if (!response.ok) {
        throw new Error(body.detail ?? body.error ?? "Failed to create invite");
      }

      setInviteState("sent");
      setInviteMessage(`Invite sent to ${body.email_address ?? emailAddress} as ${body.zoe_role_key ?? roleKey}.`);
      setEmailAddress("");
      window.setTimeout(() => {
        setInviteState("idle");
      }, 2500);
    } catch (error) {
      setInviteState("error");
      setInviteMessage(error instanceof Error ? error.message : "Failed to create invite");
    }
  }

  return (
    <section className="settings-panel">
      <section className="settings-card users-roles-hero">
        <div className="settings-card-header">
          <div>
            <h2>Invite a teammate</h2>
            <p className="field-subtext users-roles-copy">
              Invitations are sent through Clerk for the active organization. The Zoe role you choose here
              is carried in invitation metadata and projected during onboarding after acceptance.
            </p>
          </div>
          <span className="section-pill">{selectedRole.label}</span>
        </div>

        <div className="settings-form">
          <label className="field">
            <span className="field-label">Email address</span>
            <input
              type="email"
              placeholder="colleague@firm.com"
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Role</span>
            <select value={roleKey} onChange={(event) => setRoleKey(event.target.value)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="invite-role-preview">
            <p className="field-label">Role notes</p>
            <p className="field-subtext">{selectedRole.blurb}</p>
          </div>

          <div className="settings-actions users-roles-actions">
            <button
              type="button"
              className="button"
              disabled={inviteState === "sending" || emailAddress.trim() === ""}
              onClick={() => void sendInvite()}
            >
              {inviteState === "sending" ? "Sending…" : "Send invite"}
            </button>
            {inviteMessage ? (
              <p className={`users-roles-message users-roles-message-${inviteState}`}>
                {inviteMessage}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>What happens next</h2>
            <p className="field-subtext users-roles-copy">
              The invitee will receive a Clerk invitation email, accept into this org, and then onboarding
              will project an org-scoped Zoe identity and the selected role.
            </p>
          </div>
        </div>
        <div className="users-roles-steps">
          <div className="users-roles-step">
            <span className="users-roles-step-number">1</span>
            <div>
              <p className="users-roles-step-title">Invitation sent</p>
              <p className="field-subtext">Clerk sends the email using the active org as the target organization.</p>
            </div>
          </div>
          <div className="users-roles-step">
            <span className="users-roles-step-number">2</span>
            <div>
              <p className="users-roles-step-title">Invite accepted</p>
              <p className="field-subtext">Clerk creates the organization membership and carries the Zoe role metadata.</p>
            </div>
          </div>
          <div className="users-roles-step">
            <span className="users-roles-step-number">3</span>
            <div>
              <p className="users-roles-step-title">Org-scoped projection</p>
              <p className="field-subtext">Onboarding creates the invited user’s internal mapping and assigns the chosen role inside Zoe.</p>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
