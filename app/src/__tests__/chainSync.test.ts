/**
 * 首頁鏈上同步的請求數與錯誤呈現（2026-09-27）。
 *
 * 原本一次同步要打 6～7 個 `getAccountInfo`（config／profile／freeze ＋ 今日各任務 receipt），
 * 而 Home 與 Gear 每次 focus 都會同步——打在限流的公用 devnet 端點上最容易換來 429／504。
 * 這支測試釘住「一次 getMultipleAccounts 讀完」與「失敗只留分類與 Ref，不留原始 payload」。
 */
import { PublicKey } from '@solana/web3.js';

const mockFetchAccountsInfo = jest.fn();
const mockRpcRead = jest.fn();
jest.mock('@/services/chain/ChainClient', () => ({
  ...jest.requireActual('@/services/chain/ChainClient'),
  fetchAccountsInfo: (a: PublicKey[]) => mockFetchAccountsInfo(a),
  rpcRead: (label: string, run: unknown) => mockRpcRead(label, run),
}));
jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true } }));

import { RpcReadError } from '@/services/chain/ChainClient';
import { claimPda, configPda, freezePda, playerPda } from '@/chain/program';
import { TASK_CODE } from '@/domain/taskEngine';
import { useDashboardStore } from '@/state/dashboardStore';

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

beforeEach(() => {
  jest.clearAllMocks();
  useDashboardStore.setState({ profile: null, config: null, freeze: null, balance: null, chainError: null, chainSyncedAt: null });
});

test('一次 getMultipleAccounts 讀完所有帳戶，不再一個帳戶一個請求', async () => {
  mockFetchAccountsInfo.mockResolvedValue([null, null, null, null, null]);
  await useDashboardStore.getState().syncChain(wallet);
  expect(mockFetchAccountsInfo).toHaveBeenCalledTimes(1);
  const { taskDate } = useDashboardStore.getState();
  const asked = (mockFetchAccountsInfo.mock.calls[0]![0] as PublicKey[]).map((k) => k.toBase58());
  expect(asked).toEqual([
    configPda().toBase58(),
    playerPda(wallet).toBase58(),
    freezePda().toBase58(),
    claimPda(wallet, taskDate, TASK_CODE.steps).toBase58(),
    claimPda(wallet, taskDate, TASK_CODE.workout).toBase58(),
  ]); // 睡眠任務關閉 → 不多問一個帳戶
  // 帳戶都不存在是正常狀態（還沒 init_player），不是錯誤
  expect(useDashboardStore.getState().chainError).toBeNull();
  expect(useDashboardStore.getState().chainSyncedAt).not.toBeNull();
  // config 不存在就不會去問餘額（沒有 mint 可用）
  expect(mockRpcRead).not.toHaveBeenCalled();
});

test('讀失敗 → 只留分類與短 Ref，原始 JSON-RPC payload 不進狀態', async () => {
  const detail = 'failed to get info about account GuS38ZFpuvvqfpWiKZ1gGWtu8RujynuNZmbVjqik6Axc: Error: 504 : {"jsonrpc":"2.0","error":{"code":504,"message":"Gateway Time-out"}, "id": null}';
  mockFetchAccountsInfo.mockRejectedValue(new RpcReadError({ reason: 'server', label: 'getMultipleAccounts', status: 504, detail }));
  await useDashboardStore.getState().syncChain(wallet);
  const err = useDashboardStore.getState().chainError!;
  expect(err).toEqual({ reason: 'server', ref: '504 · getMultipleAccounts' });
  expect(JSON.stringify(err)).not.toMatch(/jsonrpc|GuS38/);
});

test('非 RpcReadError（例如解碼失敗）也會被分類，不會把例外字串丟給畫面', async () => {
  mockFetchAccountsInfo.mockRejectedValue(new Error('boom'));
  await useDashboardStore.getState().syncChain(wallet);
  expect(useDashboardStore.getState().chainError).toEqual({ reason: 'unknown', ref: 'unknown · syncChain' });
});
