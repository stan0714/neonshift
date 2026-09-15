import { PublicKey } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';

import { ClaimSubmitter } from '@/services/chain/ClaimSubmitter';

jest.mock('@/services/chain/ChainClient', () => ({
  buildTransaction: jest.fn(async () => ({ tx: { __tx: true }, blockhash: 'BH', lastValidBlockHeight: 100 })),
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
