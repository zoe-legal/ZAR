import { useEffect, useState } from "react";
import { useAuth, useClerk, useOrganizationList } from "@clerk/clerk-react";
import { ONBOARDING_MAX_RETRIES, ONBOARDING_RETRY_DELAY_MS, zarBaseUrl } from "../app/constants";
import { delay } from "../utils/time";

export function useProtectedSession() {
  const auth = useAuth();
  const clerk = useClerk();
  const orgList = useOrganizationList({ userMemberships: true });
  const [status, setStatus] = useState("Checking ZAR session...");
  const [displayName, setDisplayName] = useState<string | null>(null);

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

    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [auth.getToken]);

  return {
    auth,
    status,
    displayName,
  };
}
