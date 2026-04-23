import { useEffect, useMemo, useState } from "react";
import { extractInvitationId } from "../utils/invitation";

type InvitationDetails = {
  orgDisplayName: string | null;
  invitedEmail: string | null;
  roleKey: string | null;
};

export function useInvitationDetails(search: string) {
  const [invitation, setInvitation] = useState<InvitationDetails>({
    orgDisplayName: null,
    invitedEmail: null,
    roleKey: null,
  });
  const [inviteStatus, setInviteStatus] = useState("");

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const ticket = params.get("__clerk_ticket") || params.get("ticket");
  const invitationId = extractInvitationId(ticket);
  const fallbackOrgDisplayName =
    params.get("organization_name")
    || params.get("organizationName")
    || params.get("org_name")
    || params.get("org")
    || null;

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

  return {
    invitation,
    inviteStatus,
    params,
    invitationId,
    fallbackOrgDisplayName,
  };
}
