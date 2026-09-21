import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({ transact: jest.fn() }));
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { base64ToBase58, isKnownNoReplyWallet, mapSignError, mapWalletError, walletService } from '@/services/wallet/WalletService';

const mockTransact = transact as jest.MockedFunction<typeof transact>;
const pk = PublicKey.unique();
const b64 = Buffer.from(pk.toBytes()).toString('base64');
const authResult = (token = 'tok-1') => ({ accounts: [{ address: b64, label: 'Seeker Wallet' }], auth_token: token, wallet_uri_base: 'https://wallet.example' });

beforeEach(() => {
  mockStore.clear();
  mockTransact.mockReset();
});

describe('WalletService（PG-A-06，FR-01）', () => {
  test('base64 位址轉 base58', () => {
    expect(base64ToBase58(b64)).toBe(pk.toBase58());
  });

  test('connect：authorize 並保存 token', async () => {
    mockTransact.mockImplementationOnce(async (cb) => cb({ authorize: async () => authResult() } as never));
    const s = await walletService.connect();
    expect(s.address).toBe(pk.toBase58());
    expect(s.label).toBe('Seeker Wallet');
    expect(await walletService.hasStoredSession()).toBe(true);
  });

  test('connect＋afterAuthorize：同一個 MWA session 內簽登入訊息；登入失敗（拒簽／後端錯）不影響連線', async () => {
    const signMessages = jest.fn(async () => [new Uint8Array([9, 9])]);
    mockTransact.mockImplementationOnce(async (cb) => cb({ authorize: async () => authResult(), signMessages } as never));
    const seen: string[] = [];
    let sig: Uint8Array | null = null;
    const s = await walletService.connect({ afterAuthorize: async (address, sign) => { seen.push(address); sig = await sign(new Uint8Array([1])); } });
    expect(s.address).toBe(pk.toBase58());
    expect(seen).toEqual([pk.toBase58()]);
    expect(signMessages).toHaveBeenCalledWith({ addresses: [b64], payloads: [new Uint8Array([1])] });
    expect(sig).toEqual(new Uint8Array([9, 9]));
    // 登入步驟失敗：連線仍成功、token 仍保存
    mockTransact.mockImplementationOnce(async (cb) => cb({ authorize: async () => authResult('tok-2'), signMessages: async () => { throw new Error('user declined'); } } as never));
    const s2 = await walletService.connect({ afterAuthorize: async (_a, sign) => { await sign(new Uint8Array([2])); } });
    expect(s2.address).toBe(pk.toBase58());
    expect(await walletService.hasStoredSession()).toBe(true);
  });

  test('restore：以保存 token 重新授權並輪替 token', async () => {
    mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'old', address: pk.toBase58(), walletUriBase: 'x' }));
    const authorize = jest.fn(async (p: { auth_token?: string }) => authResult(p.auth_token === 'old' ? 'new' : 'bad'));
    mockTransact.mockImplementationOnce(async (cb) => cb({ authorize } as never));
    const s = await walletService.restore();
    expect(s?.address).toBe(pk.toBase58());
    expect(JSON.parse(mockStore.get('neonshift.wallet.session.v1')!).authToken).toBe('new');
  });

  test('restore：授權失效 → null 並清除 token（FR-01.2 不可視為已可簽章）', async () => {
    mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'old', address: pk.toBase58(), walletUriBase: 'x' }));
    mockTransact.mockRejectedValueOnce(Object.assign(new Error('auth failed'), { code: -1 }));
    expect(await walletService.restore()).toBeNull();
    expect(await walletService.hasStoredSession()).toBe(false);
  });

  test('restore：網路錯誤保留 token 讓使用者重試', async () => {
    mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'old', address: pk.toBase58(), walletUriBase: 'x' }));
    mockTransact.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ERROR_SESSION_TIMEOUT' }));
    expect(await walletService.restore()).toBeNull();
    expect(await walletService.hasStoredSession()).toBe(true);
  });

  test('restore：沒有 token 不會呼叫錢包', async () => {
    expect(await walletService.restore()).toBeNull();
    expect(mockTransact).not.toHaveBeenCalled();
  });

  test('disconnect：deauthorize 失敗也清本機（FR-01.4）', async () => {
    mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'old', address: pk.toBase58(), walletUriBase: 'x' }));
    mockTransact.mockRejectedValueOnce(new Error('wallet gone'));
    await walletService.disconnect();
    expect(await walletService.hasStoredSession()).toBe(false);
  });

  test('錯誤分類（Style 10.1）', () => {
    expect(mapWalletError(Object.assign(new Error(), { code: 'ERROR_WALLET_NOT_FOUND' })).code).toBe('WALLET_UNAVAILABLE');
    expect(mapWalletError(Object.assign(new Error(), { code: 'ERROR_ASSOCIATION_CANCELLED' })).code).toBe('REJECTED');
    expect(mapWalletError(Object.assign(new Error(), { code: -1 })).code).toBe('REJECTED');
    expect(mapWalletError(Object.assign(new Error(), { code: 'ERROR_SESSION_CLOSED' })).code).toBe('NETWORK_ERROR');
    expect(mapWalletError(new Error('x')).code).toBe('UNKNOWN');
  });

  test('signMessage：無 session → SESSION_EXPIRED', async () => {
    await expect(walletService.signMessage(new Uint8Array([1]))).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  test('signMessage：錢包簽了卻沒回覆（Phantom on Seeker 2026-09-21）→ WALLET_NO_REPLY；授權階段的 session closed 仍走原本重試分類', async () => {
    expect(mapSignError(new Error('java.util.concurrent.CancellationException')).code).toBe('WALLET_NO_REPLY');
    expect(mapSignError(Object.assign(new Error('session closed'), { code: 'ERROR_SESSION_CLOSED' })).code).toBe('WALLET_NO_REPLY');
    expect(mapSignError(Object.assign(new Error(), { code: 'ERROR_ASSOCIATION_CANCELLED' })).code).toBe('REJECTED');
    expect(mapSignError(new Error('x')).code).toBe('UNKNOWN');
    mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'tok', address: pk.toBase58(), walletUriBase: 'https://phantom.app/ul/v1' }));
    const authorize = jest.fn(async () => authResult('tok'));
    const signMessages = jest.fn(async () => { throw new Error('java.util.concurrent.CancellationException'); });
    mockTransact.mockImplementation(async (cb) => cb({ authorize, signMessages } as never));
    await expect(walletService.signMessage(new Uint8Array([1]))).rejects.toMatchObject({ code: 'WALLET_NO_REPLY' });
    expect(signMessages).toHaveBeenCalledTimes(1); // 已送到錢包的請求不重送
    expect(isKnownNoReplyWallet({ label: 'Phantom' })).toBe(true);
    expect(isKnownNoReplyWallet({ label: 'Seeker Wallet', walletUriBase: 'https://phantom.app' })).toBe(true);
    expect(isKnownNoReplyWallet({ label: 'Seeker Wallet' })).toBe(false);
    expect(isKnownNoReplyWallet(null)).toBe(false);
  });

  describe('簽章前重新授權（實機：Phantom 撤銷舊 token 會直接關閉 session）', () => {
    const stored = () => mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'old', address: pk.toBase58(), walletUriBase: 'x' }));
    const sessionClosed = () => Object.assign(new Error('session closed'), { code: 'ERROR_SESSION_CLOSED' });

    test('舊 token 失效 → 改開全新授權（同帳戶）後才送交易，並帶 minContextSlot', async () => {
      stored();
      const authorize = jest.fn(async (p: { auth_token?: string }) => {
        if (p.auth_token) throw sessionClosed();
        return authResult('fresh');
      });
      const signAndSendTransactions = jest.fn(async (_p: { minContextSlot?: number }) => ['sig-1']);
      mockTransact.mockImplementation(async (cb) => cb({ authorize, signAndSendTransactions } as never));
      const sig = await walletService.signAndSendTransaction({ __tx: true } as never, { minContextSlot: 4200 });
      expect(sig).toBe('sig-1');
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(authorize.mock.calls[1]![0]).not.toHaveProperty('auth_token');
      expect(signAndSendTransactions).toHaveBeenCalledTimes(1);
      expect(signAndSendTransactions.mock.calls[0]![0]).toMatchObject({ minContextSlot: 4200 });
      expect(JSON.parse(mockStore.get('neonshift.wallet.session.v1')!).authToken).toBe('fresh');
    });

    test('全新授權回不同帳戶 → SESSION_EXPIRED 並清除本機 session，不送交易', async () => {
      stored();
      const other = Buffer.from(PublicKey.unique().toBytes()).toString('base64');
      const authorize = jest.fn(async (p: { auth_token?: string }) => {
        if (p.auth_token) throw sessionClosed();
        return { ...authResult('fresh'), accounts: [{ address: other }] };
      });
      const signAndSendTransactions = jest.fn(async () => ['sig-1']);
      mockTransact.mockImplementation(async (cb) => cb({ authorize, signAndSendTransactions } as never));
      await expect(walletService.signAndSendTransaction({ __tx: true } as never, { minContextSlot: 1 })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
      expect(signAndSendTransactions).not.toHaveBeenCalled();
      expect(await walletService.hasStoredSession()).toBe(false);
    });

    test('全新授權也失敗 → SESSION_EXPIRED 並清除本機 session', async () => {
      stored();
      const authorize = jest.fn(async () => { throw sessionClosed(); });
      mockTransact.mockImplementation(async (cb) => cb({ authorize } as never));
      await expect(walletService.signMessage(new Uint8Array([1]))).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(await walletService.hasStoredSession()).toBe(false);
    });

    test('授權成功後使用者拒絕簽章 → 不重試、不再開授權', async () => {
      stored();
      const authorize = jest.fn(async () => authResult('t2'));
      const signMessages = jest.fn(async () => { throw Object.assign(new Error('cancelled'), { code: 'ERROR_ASSOCIATION_CANCELLED' }); });
      mockTransact.mockImplementation(async (cb) => cb({ authorize, signMessages } as never));
      await expect(walletService.signMessage(new Uint8Array([1]))).rejects.toMatchObject({ code: 'REJECTED' });
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(await walletService.hasStoredSession()).toBe(true);
    });
  });
});

test('corrupt stored account never breaks startup', async () => {
  mockStore.set('neonshift.wallet.session.v1', JSON.stringify({ authToken: 'x', address: 'invalid!', walletUriBase: '' }));
  expect(await walletService.peekStoredSession()).toBeNull();
  expect(mockTransact).not.toHaveBeenCalled();
});

test('connection reports its stage and surfaces optional login failure', async () => {
  const phases: string[] = [];
  const onLoginError = jest.fn();
  mockTransact.mockImplementationOnce(async cb => cb({ authorize: async () => authResult() } as never));
  await walletService.connect({
    onPhase: phase => phases.push(phase),
    onLoginError,
    afterAuthorize: async () => { throw new Error('backend unavailable'); },
  });
  expect(phases).toEqual(['opening', 'authorizing', 'login', 'saving']);
  expect(onLoginError).toHaveBeenCalledTimes(1);
  expect(await walletService.hasStoredSession()).toBe(true);
});
