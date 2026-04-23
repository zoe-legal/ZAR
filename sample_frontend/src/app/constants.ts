export const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
export const zarBaseUrl = import.meta.env.VITE_ZAR_BASE_URL ?? "http://localhost:8788";
export const userAdminBaseUrl = import.meta.env.VITE_USER_ADMIN_BASE_URL ?? "https://dev.zoe-legal.net/api/user-admin";
export const ONBOARDING_RETRY_DELAY_MS = 30_000;
export const ONBOARDING_MAX_RETRIES = 2;
