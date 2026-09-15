/** 週期執行 ChainIndexer（B-16）；由 server.ts 在 INDEXER_ENABLED 時啟動，與 API 同 process（MVP）。 */
import { resolve } from "node:path";

import type { AppConfig } from "../config.js";
import { galleryProjection } from "../gallery/projection.js";
import { EventDecoder } from "./events.js";
import { ChainIndexer, redeemedSigProjection, type Projection, type ProjectionStore } from "./indexer.js";
import { Web3IndexerRpc } from "./rpc.js";

export function startIndexer(config: AppConfig, store: ProjectionStore, log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }, extraProjections: Projection[] = []) {
  const decoder = EventDecoder.fromFile(resolve(process.cwd(), config.IDL_FILE));
  if (config.PROGRAM_ID && decoder.programId !== config.PROGRAM_ID) log.warn({ idl: decoder.programId, config: config.PROGRAM_ID }, "IDL address 與 PROGRAM_ID 不同；以 PROGRAM_ID 為準");
  const programId = config.PROGRAM_ID ?? decoder.programId;
  const indexer = new ChainIndexer(new Web3IndexerRpc(config.RPC_URL), store, Object.assign(decoder, { programId }), [redeemedSigProjection, galleryProjection, ...extraProjections], { log });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await indexer.runOnce();
    } catch (e) {
      log.error({ err: e }, "indexer tick failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), config.INDEXER_INTERVAL_MS);
  void tick();
  return { stop: () => clearInterval(timer), indexer };
}
