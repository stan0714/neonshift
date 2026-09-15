/** 一次性清理（排程器／cron 用）：`npm run retention:once` */
import { loadConfig } from "../config.js";
import { createDb } from "../db.js";
import { PostgresStore } from "../store/postgres.js";
import { RETENTION_DAYS } from "../player/routes.js";
import { RetentionService } from "./service.js";

const config = loadConfig();
const db = createDb(config);
if (!db.pool) throw new Error("retention 需要 DATABASE_URL");
const report = await new RetentionService(new PostgresStore(db.pool), undefined, RETENTION_DAYS, config.EVENT_RETENTION_DAYS).runOnce();
console.log(JSON.stringify(report));
await db.close();
