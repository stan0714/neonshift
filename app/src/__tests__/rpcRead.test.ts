/**
 * 鏈上讀取的逾時／退避與錯誤分類（2026-09-27）。
 *
 * 起因是實機上的一張錯誤卡：公用 devnet 端點對 `getAccountInfo` 不回應，手機端 gateway 回 504，
 * 而 App 沒有重試、也把整段 JSON-RPC payload 貼進使用者看的文案裡。這支測試釘住三件事：
 * 什麼樣的失敗算「等一下可能會好」、重試幾次就放棄、以及**原始訊息不會變成使用者文案**。
 */
import { classifyRpcError, rpcFailureRef, rpcRead, RpcReadError, RPC_RETRY_DELAYS_MS } from '@/services/chain/ChainClient';

jest.mock('@/services/wallet/WalletService', () => ({ walletService: {} }));

/** 實機那張卡上的原文（web3.js 把 HTTP 錯誤包成這個格式） */
const REAL = 'failed to get info about account GuS38ZFpuvvqfpWiKZ1gGWtu8RujynuNZmbVjqik6Axc: Error: 504 : {"jsonrpc":"2.0","error":{"code":504,"message":"Gateway Time-out"}, "id": null}';

describe('錯誤分類', () => {
  test('實機那筆 504 → server，狀態碼從 `Error: <ddd> :` 取，不會被位址裡的數字騙到', () => {
    const f = classifyRpcError('getMultipleAccounts', new Error(REAL));
    expect(f).toMatchObject({ reason: 'server', status: 504, label: 'getMultipleAccounts' });
    expect(rpcFailureRef(f)).toBe('504 · getMultipleAccounts');
  });

  test('限流、逾時、連不上各自分類', () => {
    expect(classifyRpcError('x', new Error('Error: 429 : Too Many Requests')).reason).toBe('rate_limited');
    expect(classifyRpcError('x', new Error('failed: -32005 node is behind')).reason).toBe('rate_limited');
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    expect(classifyRpcError('x', abort).reason).toBe('timeout');
    expect(classifyRpcError('x', new Error('Network request failed')).reason).toBe('unreachable');
  });

  test('「帳號不存在」這種再試也一樣的結果歸為 unknown', () => {
    expect(classifyRpcError('getTokenAccountBalance', new Error('failed to get token account balance: Invalid param: could not find account')).reason).toBe('unknown');
  });
});

describe('退避重試', () => {
  test('暫時性失敗會重試，總共試 1 ＋ 退避次數', async () => {
    const run = jest.fn(async () => { throw new Error(REAL); });
    await expect(rpcRead('getMultipleAccounts', run)).rejects.toBeInstanceOf(RpcReadError);
    expect(run).toHaveBeenCalledTimes(1 + RPC_RETRY_DELAYS_MS.length);
  });

  test('中途成功就不再重試', async () => {
    let n = 0;
    const run = jest.fn(async () => { if (++n === 1) throw new Error(REAL); return 'ok'; });
    await expect(rpcRead('getMultipleAccounts', run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('unknown 不重試（再試幾次都一樣，只是拖慢畫面）', async () => {
    const run = jest.fn(async () => { throw new Error('could not find account'); });
    await expect(rpcRead('getAccountInfo', run)).rejects.toBeInstanceOf(RpcReadError);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('丟出的是分類後的錯誤，原始訊息只留在 detail（不是給使用者看的）', async () => {
    const run = jest.fn(async () => { throw new Error(REAL); });
    const err = await rpcRead('getMultipleAccounts', run).catch((e: unknown) => e as RpcReadError);
    expect(err.message).not.toMatch(/jsonrpc|GuS38/);
    expect(err.failure.detail).toContain('jsonrpc'); // 診斷用的原文仍留著
  });
});
