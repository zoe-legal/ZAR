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
  const pathname = window.location.pathname;
  const zoeInvitationId = useMemo(() => {
    const prefix = "/accept-invitation/";
    if (!pathname.startsWith(prefix)) {
      return null;
    }
    const value = pathname.slice(prefix.length).trim();
    return value || null;
  }, [pathname]);

  const params = useMemo(() => {
    const next = new URLSearchParams(search);
    const queryTicket = next.get("__clerk_ticket") || next.get("ticket");
    const queryStatus = next.get("__clerk_status");

    if (queryTicket) {
      window.sessionStorage.setItem("zoe_invite_ticket", queryTicket);
      if (queryStatus) {
        window.sessionStorage.setItem("zoe_invite_status", queryStatus);
      }
      return next;
    }

    const storedTicket = window.sessionStorage.getItem("zoe_invite_ticket");
    const storedStatus = window.sessionStorage.getItem("zoe_invite_status");
    if (!storedTicket) {
      return next;
    }

    next.set("__clerk_ticket", storedTicket);
    if (storedStatus && !next.get("__clerk_status")) {
      next.set("__clerk_status", storedStatus);
    }
    return next;
  }, [search]);
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
      if (!zoeInvitationId && !invitationId) {
        setInviteStatus("");
        return;
      }

      try {
        setInviteStatus("Loading invitation details...");
        const lookupQuery = zoeInvitationId
          ? `zoe_invitation_id=${encodeURIComponent(zoeInvitationId)}`
          : `clerk_invitation_id=${encodeURIComponent(invitationId!)}`
        const response = await fetch(`${window.location.origin}/onboarding/getInvitationDetails?${lookupQuery}`);
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
  }, [invitationId, zoeInvitationId]);

  return {
    invitation,
    inviteStatus,
    params,
    ticket,
    zoeInvitationId,
    invitationId,
    fallbackOrgDisplayName,
  };
}
