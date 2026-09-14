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
import { base64ToBase58, mapWalletError, walletService } from '@/services/wallet/WalletService';

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
});
