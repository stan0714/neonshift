import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { startIndexer } from "./indexer/runner.js";
import { PostgresStore } from "./store/postgres.js";

const config = loadConfig();
const db = createDb(config);
const app = buildApp({ config, db });
// PG-B-16：需要 PostgreSQL（記憶體 store 重啟即失去游標）
const indexer = config.INDEXER_ENABLED && db.pool ? startIndexer(config, new PostgresStore(db.pool), app.log) : null;
if (config.INDEXER_ENABLED && !db.pool) app.log.warn("INDEXER_ENABLED 但未設定 DATABASE_URL，indexer 未啟動");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  indexer?.stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

app.listen({ host: config.HOST, port: config.PORT }).catch((err) => {
  app.log.fatal(err);
  process.exit(1);
});
