import pg from "pg";

import type { AppConfig } from "./config.js";

export type Db = {
  /** readyz 用；DB 未設定時回 false */
  ping: () => Promise<boolean>;
  close: () => Promise<void>;
  pool: pg.Pool | null;
};

export function createDb(config: AppConfig): Db {
  if (!config.DATABASE_URL) {
    return { pool: null, ping: async () => false, close: async () => {} };
  }
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10, connectionTimeoutMillis: 2_000 });
  return {
    pool,
    ping: async () => {
      try {
        await pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}
