import pg from "pg";

const { Pool } = pg;

export type OnboardingDb = pg.Pool;

export function createOnboardingDb(connectionString: string): OnboardingDb {
  return new Pool({ connectionString });
}
