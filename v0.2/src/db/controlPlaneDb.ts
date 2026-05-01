import pg from "pg";

const { Pool } = pg;

export type ControlPlaneDb = pg.Pool;

export function createControlPlaneDb(connectionString: string): ControlPlaneDb {
  return new Pool({ connectionString });
}
