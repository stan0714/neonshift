import { PublicKey } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

import { ClaimSubmitter } from '@/services/chain/ClaimSubmitter';

// 只替換要避開真連線的那兩個；`rpcRead` 用真的實作，這樣 receiptExists 的退避重試是被真正執行的
jest.mock('@/services/chain/ChainClient', () => ({
  ...jest.requireActual('@/services/chain/ChainClient'),
  buildTransaction: jest.fn(async () => ({ tx: { __tx: true }, blockhash: 'BH', lastValidBlockHeight: 100, minContextSlot: 4200 })),
  getConnection: jest.fn(),
}));

const receipt = PublicKey.unique();
const player = PublicKey.unique();

function conn(over: Partial<{ account: boolean; confirm: () => Promise<unknown>; status: unknown; height: number }>) {
  return {
    getAccountInfo: jest.fn(async () => (over.account ? {} : null)),
    confirmTransaction: jest.fn(over.confirm ?? (async () => ({ value: { err: null } }))),
    getSignatureStatus: jest.fn(async () => ({ value: over.status ?? null })),
    getBlockHeight: jest.fn(async () => over.height ?? 50),
  };
}

beforeEach(() => SecureStore.deleteItemAsync('neonshift.claim.pending.v1'));

describe('PG-A-10 交易冪等（SD 5.3）', () => {
  test('送出前 receipt 已存在 → already_claimed，不送交易', async () => {
    const send = jest.fn();
    const s = new ClaimSubmitter(() => conn({ account: true }) as never, send);
    expect(await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 })).toEqual({ kind: 'already_claimed' });
    expect(send).not.toHaveBeenCalled();
  });

  test('正常：保存 pending → 確認 → 清除', async () => {
    const c = conn({});
    const s = new ClaimSubmitter(() => c as never, async () => 'SIG');
    const r = await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 });
    expect(r).toEqual({ kind: 'confirmed', signature: 'SIG' });
    expect(await SecureStore.getItemAsync('neonshift.claim.pending.v1')).toBeNull();
    expect(c.confirmTransaction).toHaveBeenCalledWith({ signature: 'SIG', blockhash: 'BH', lastValidBlockHeight: 100 }, 'confirmed');
  });

  test('逾時但 receipt 已存在 → 視為成功，不重送', async () => {
    let calls = 0;
    const c = conn({ confirm: async () => { throw new Error('timeout'); } });
    (c as { getAccountInfo: jest.Mock }).getAccountInfo = jest.fn(async () => (calls++ === 0 ? null : {}));
    const send = jest.fn(async () => 'SIG');
    const s = new ClaimSubmitter(() => c as never, send);
    const r = await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 });
    expect(r).toEqual({ kind: 'confirmed', signature: null });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('逾時、無 receipt、簽章狀態確定失敗 → failed 可重試（同一 attestation）', async () => {
    const c = conn({ confirm: async () => { throw new Error('timeout'); }, status: { err: { InstructionError: [2, { Custom: 6010 }] }, confirmationStatus: 'confirmed' } });
    const s = new ClaimSubmitter(() => c as never, async () => 'SIG');
    const r = await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 });
    expect(r).toMatchObject({ kind: 'failed', retryable: true });
    expect(await SecureStore.getItemAsync('neonshift.claim.pending.v1')).toBeNull();
  });

  test('逾時、無 receipt、超過 lastValidBlockHeight → expired，需要新 attestation', async () => {
    const c = conn({ confirm: async () => { throw new Error('block height exceeded'); }, height: 101 });
    const s = new ClaimSubmitter(() => c as never, async () => 'SIG');
    expect(await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 })).toMatchObject({ kind: 'expired', needsNewAttestation: true });
  });

  test('逾時、無 receipt、仍在有效期 → 保留 pending，resumePending 可再判定', async () => {
    const c = conn({ confirm: async () => { throw new Error('timeout'); }, height: 50 });
    const s = new ClaimSubmitter(() => c as never, async () => 'SIG');
    expect(await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 })).toMatchObject({ kind: 'failed', retryable: true });
    expect(await SecureStore.getItemAsync('neonshift.claim.pending.v1')).not.toBeNull();
    // 恢復網路後 receipt 出現
    (c as { getAccountInfo: jest.Mock }).getAccountInfo = jest.fn(async () => ({}));
    expect(await s.resumePending()).toEqual({ kind: 'confirmed', signature: null });
    expect(await s.resumePending()).toBeNull();
  });

  test('確認回錯誤但 receipt 存在（例如 6009）→ already_claimed', async () => {
    let n = 0;
    const c = conn({ confirm: async () => ({ value: { err: { InstructionError: [2, { Custom: 6009 }] } } }) });
    (c as { getAccountInfo: jest.Mock }).getAccountInfo = jest.fn(async () => (n++ === 0 ? null : {}));
    const s = new ClaimSubmitter(() => c as never, async () => 'SIG');
    expect(await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 })).toEqual({ kind: 'already_claimed' });
  });
});


/**
 * receipt 查詢是「這筆到底有沒有上鏈」的判準，所以一次暫時性 RPC 失敗不該讓判定以例外收場。
 * 這兩項用真的 `rpcRead`（見檔頭的 mock），所以退避是真的跑過的。
 */
describe('receipt 查詢的退避重試', () => {
  test('暫時性失敗（504）重試後成功 → 仍判為 already_claimed，不送交易', async () => {
    let calls = 0;
    const c = {
      getAccountInfo: jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('failed to get info about account X: Error: 504 : {"jsonrpc":"2.0"}');
        return {};
      }),
      confirmTransaction: jest.fn(),
      getSignatureStatus: jest.fn(),
      getBlockHeight: jest.fn(),
    };
    const send = jest.fn();
    const s = new ClaimSubmitter(() => c as never, send);
    expect(await s.submit(player, [], receipt, { taskDate: 1, taskType: 1 })).toEqual({ kind: 'already_claimed' });
    expect(calls).toBe(2);
    expect(send).not.toHaveBeenCalled();
  }, 10_000);

  test('「帳號不存在」這類非暫時性錯誤不重試（再試也是一樣的結果）', async () => {
    const c = {
      getAccountInfo: jest.fn(async () => { throw new Error('could not find account'); }),
      confirmTransaction: jest.fn(),
      getSignatureStatus: jest.fn(),
      getBlockHeight: jest.fn(),
    };
    const s = new ClaimSubmitter(() => c as never, jest.fn());
    await expect(s.submit(player, [], receipt, { taskDate: 1, taskType: 1 })).rejects.toThrow();
    expect(c.getAccountInfo).toHaveBeenCalledTimes(1);
  });
});
