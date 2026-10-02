/**
 * 2026-10-02：讀取只能有一層重試。
 * 原本讀取與送交易共用同一條 Connection，web3.js 內建對 429 重試 5 次（0.5→1→2→4 秒指數等待），
 * rpcRead 外面又重試 3 輪——限流時一次讀取最多 15 個 HTTP 請求、可以卡上數十秒。
 * 讀取改走 getReadConnection（關掉內建 429 重試），重試只剩 rpcRead 這一層。
 */
import { PublicKey } from '@solana/web3.js';

jest.mock('@/services/wallet/WalletService', () => ({ walletService: {} }));

import { getConnection, getReadConnection, rpcRead, RPC_RETRY_DELAYS_MS } from '@/services/chain/ChainClient';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('限流（429）的讀取：總共只打 1 ＋ 退避次數 個 HTTP 請求，並分類為 rate_limited', async () => {
  const fetchMock = jest.fn(async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', headers: new Map(), text: async () => '{"error":"rate limited"}' }));
  globalThis.fetch = fetchMock as never;
  const err = await rpcRead('getBalance', (c) => c.getBalance(PublicKey.unique())).catch((e: unknown) => e);
  expect(err).toMatchObject({ failure: { reason: 'rate_limited', status: 429 } });
  expect(fetchMock).toHaveBeenCalledTimes(1 + RPC_RETRY_DELAYS_MS.length);
}, 10_000);

test('讀取與送交易是兩條不同的連線（送交易保留 web3.js 對 429 的重送）', () => {
  expect(getReadConnection()).not.toBe(getConnection());
});
