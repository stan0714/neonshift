import { Buffer } from 'buffer';
import * as SecureStore from 'expo-secure-store';

import { ApiClient, ApiError } from '@/services/api/ApiClient';
import { canonicalize, requestHashOf } from '@/services/api/canonical';
import { walletService } from '@/services/wallet/WalletService';

jest.mock('@/services/wallet/WalletService', () => ({ walletService: { signMessage: jest.fn(async () => new Uint8Array(64).fill(7)) } }));

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (c: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    const r = handler(c);
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

beforeEach(async () => {
  await SecureStore.deleteItemAsync('neonshift.api.tokens.v1');
});

describe('PG-A-07 ApiClient', () => {
  test('canonicalize 與 request_hash 與後端一致（RFC 8785）', () => {
    expect(canonicalize({ b: 1, a: [true, null, 'x'], c: { z: 1.5, y: 10 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":10,"z":1.5}}');
    const h = requestHashOf({ task_type: 'steps', steps: 1, claim_authorization: { x: 1 } });
    expect(h).toHaveLength(32);
    expect(Buffer.from(h).equals(Buffer.from(requestHashOf({ steps: 1, task_type: 'steps' })))).toBe(true);
  });

  test('未設定 API URL → NOT_CONFIGURED', async () => {
    const api = new ApiClient('', fakeFetch(() => ({ status: 200 })).f);
    await expect(api.history()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  test('signIn：nonce → MWA 簽 message → verify → token 存入 SecureStore', async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.url.endsWith('/auth/nonce')) return { status: 200, body: { nonce: 'n', request_id: 'r', issued_at: 'i', expires_at: 'e', message: 'neonshift.cc wants you to sign in' } };
      if (c.url.endsWith('/auth/verify')) return { status: 200, body: { wallet: 'W', access_token: 'A', token_type: 'Bearer', expires_in: 900, refresh_token: 'R', refresh_expires_in: 86400 } };
      return { status: 404 };
    });
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const pair = await api.signIn('W');
    expect(pair.access_token).toBe('A');
    expect(walletService.signMessage).toHaveBeenCalledWith(new TextEncoder().encode('neonshift.cc wants you to sign in'));
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ message: 'neonshift.cc wants you to sign in', signature_b64: Buffer.alloc(64, 7).toString('base64') });
    expect(await api.hasSession()).toBe(true);
  });

  test('signIn 實機：簽完 verify 遇網路錯誤 → 短暫重試；仍失敗保留已簽訊息，下次 signIn 不再開錢包直接 verify；非網路錯誤則重新走完整流程', async () => {
    jest.useFakeTimers();
    try {
      let verifyMode: 'down' | 'ok' | 'bad' = 'down';
      const { f, calls } = fakeFetch((c) => {
        if (c.url.endsWith('/auth/nonce')) return { status: 200, body: { nonce: 'n', request_id: 'r', issued_at: 'i', expires_at: new Date(1_000_000 + 300_000).toISOString(), message: 'msg-1' } };
        if (c.url.endsWith('/auth/verify')) {
          if (verifyMode === 'down') throw new TypeError('fetch failed: UnknownHostException');
          if (verifyMode === 'bad') return { status: 401, body: { error: { code: 'NONCE_EXPIRED', message: 'x' } } };
          return { status: 200, body: { wallet: 'W', access_token: 'A', token_type: 'Bearer', expires_in: 900, refresh_token: 'R', refresh_expires_in: 86400 } };
        }
        return { status: 404 };
      });
      const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
      const signer = jest.fn(async () => Buffer.alloc(64, 9));
      const first = api.signIn('W', signer);
      const settle = expect(first).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      await jest.advanceTimersByTimeAsync(10_000); // 1.5 s＋3 s 重試
      await settle;
      expect(calls.filter((c) => c.url.endsWith('/auth/verify'))).toHaveLength(3);
      expect(signer).toHaveBeenCalledTimes(1);
      expect(api.hasPendingSignIn('W')).toBe(true);
      // 網路恢復：不取 nonce、不再簽，直接 verify 成功
      verifyMode = 'ok';
      const pair = await api.signIn('W', signer);
      expect(pair.access_token).toBe('A');
      expect(signer).toHaveBeenCalledTimes(1);
      expect(calls.filter((c) => c.url.endsWith('/auth/nonce'))).toHaveLength(1);
      expect(api.hasPendingSignIn('W')).toBe(false);
      // 非網路錯誤（nonce 過期）：清掉保留，下一次重新取 nonce 並簽
      verifyMode = 'down';
      const second = api.signIn('W', signer);
      const settle2 = expect(second).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
      await jest.advanceTimersByTimeAsync(10_000);
      await settle2;
      expect(signer).toHaveBeenCalledTimes(2);
      verifyMode = 'bad';
      await expect(api.signIn('W', signer)).rejects.toMatchObject({ code: 'NONCE_EXPIRED' });
      expect(api.hasPendingSignIn('W')).toBe(false);
      verifyMode = 'ok';
      await api.signIn('W', signer);
      expect(signer).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  test('帶 Bearer；401 UNAUTHORIZED 時 refresh 一次並重試；refresh 失敗清 session', async () => {
    let refreshed = 0;
    const { f, calls } = fakeFetch((c) => {
      const auth = (c.init.headers as Record<string, string>).authorization;
      if (c.url.endsWith('/auth/refresh')) {
        refreshed++;
        return refreshed === 1 ? { status: 200, body: { wallet: 'W', access_token: 'A2', token_type: 'Bearer', expires_in: 900, refresh_token: 'R2', refresh_expires_in: 86400 } } : { status: 401, body: { error: { code: 'REFRESH_REVOKED', message: 'x' } } };
      }
      if (c.url.endsWith('/player/history?days=30')) {
        if (auth === 'Bearer A2') return { status: 200, body: { days: 30, retention_days: 30, items: [] } };
        return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } };
      }
      return { status: 404 };
    });
    await SecureStore.setItemAsync('neonshift.api.tokens.v1', JSON.stringify({ accessToken: 'A1', refreshToken: 'R1', accessExpiresAt: 2_000_000, wallet: 'W' }));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const h = await api.history();
    expect(h.items).toEqual([]);
    expect(calls.map((c) => c.url.split('/v1')[1])).toEqual(['/player/history?days=30', '/auth/refresh', '/player/history?days=30']);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ refresh_token: 'R1' });

    // 第二次：A2 也被撤銷 → refresh 失敗 → 清 session → NO_SESSION
    await SecureStore.setItemAsync('neonshift.api.tokens.v1', JSON.stringify({ accessToken: 'A3', refreshToken: 'R3', accessExpiresAt: 2_000_000, wallet: 'W' }));
    await expect(api.history()).rejects.toBeInstanceOf(ApiError);
    expect(await api.hasSession()).toBe(false);
  });

  test('authorizeClaim：challenge → 簽 domain||nonce||request_hash||expiry_le', async () => {
    const nonce = Buffer.alloc(32, 1).toString('base64');
    const { f } = fakeFetch((c) => (c.url.endsWith('/auth/challenge') ? { status: 200, body: { challenge_b64: nonce, expires_at: 1_789_000_300, purpose: 'claim' } } : { status: 404 }));
    await SecureStore.setItemAsync('neonshift.api.tokens.v1', JSON.stringify({ accessToken: 'A', refreshToken: 'R', accessExpiresAt: 2_000_000, wallet: 'W' }));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const rh = new Uint8Array(32).fill(2);
    const a = await api.authorizeClaim('claim', rh, 20_710, 1);
    expect(a.challenge_b64).toBe(nonce);
    const signed = (walletService.signMessage as jest.Mock).mock.calls.at(-1)![0] as Uint8Array;
    expect(Buffer.from(signed.subarray(0, 18)).toString('ascii')).toBe('NEONSHIFT_CLAIM_V1');
    expect(Buffer.from(signed.subarray(18, 50))).toEqual(Buffer.alloc(32, 1));
    expect(Buffer.from(signed.subarray(50, 82))).toEqual(Buffer.alloc(32, 2));
    expect(new DataView(signed.buffer, signed.byteOffset + 82, 8).getBigInt64(0, true)).toBe(1_789_000_300n);
  });

  test('統一錯誤：422 拒絕帶 rules_version', async () => {
    const { f } = fakeFetch(() => ({ status: 422, body: { error: { code: 'TASK_NOT_MET', message: 'no', rules_version: 3 } } }));
    await SecureStore.setItemAsync('neonshift.api.tokens.v1', JSON.stringify({ accessToken: 'A', refreshToken: 'R', accessExpiresAt: 2_000_000, wallet: 'W' }));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    await expect(api.claim({}, 'k')).rejects.toMatchObject({ status: 422, code: 'TASK_NOT_MET', rulesVersion: 3 });
  });
});

describe('2026-09-19 review：refresh 區分憑證失效與暫時失敗；請求逾時', () => {
  const TOK = 'neonshift.api.tokens.v1';
  const expiredTokens = { accessToken: 'A', refreshToken: 'R', accessExpiresAt: 1_000_000 + 10_000, wallet: 'W' }; // 10 s 內到期 → 觸發 refresh

  test('review 5：refresh 遇 5xx → SERVER_ERROR、token 保留、不是 NO_SESSION', async () => {
    const { f } = fakeFetch((c) => (c.url.endsWith('/auth/refresh') ? { status: 503, body: { error: { code: 'UNAVAILABLE', message: 'maintenance' } } } : { status: 200, body: {} }));
    await SecureStore.setItemAsync(TOK, JSON.stringify(expiredTokens));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const err = await api.history().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('SERVER_ERROR');
    expect((err as ApiError).status).toBe(503);
    expect(await api.hasSession()).toBe(true); // 之前的 bug：這裡會被清掉，畫面顯示成需要登入
  });

  test('review 5：refresh 遇 429 → RATE_LIMITED、token 保留', async () => {
    const { f } = fakeFetch((c) => (c.url.endsWith('/auth/refresh') ? { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'slow down' } } } : { status: 200, body: {} }));
    await SecureStore.setItemAsync(TOK, JSON.stringify(expiredTokens));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const err = await api.history().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('RATE_LIMITED');
    expect(await api.hasSession()).toBe(true);
  });

  test('review 5：refresh 時離線（fetch 拋錯）→ NETWORK_ERROR、token 保留', async () => {
    const f = (async (url: string) => {
      if (String(url).endsWith('/auth/refresh')) throw new TypeError('Network request failed');
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await SecureStore.setItemAsync(TOK, JSON.stringify(expiredTokens));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const err = await api.history().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('NETWORK_ERROR');
    expect((err as ApiError).message).toMatch(/Network request failed/);
    expect(await api.hasSession()).toBe(true);
  });

  test('review 5：refresh 回 401 REFRESH_EXPIRED → 清 session、NO_SESSION', async () => {
    const { f } = fakeFetch((c) => (c.url.endsWith('/auth/refresh') ? { status: 401, body: { error: { code: 'REFRESH_EXPIRED', message: 'expired' } } } : { status: 200, body: {} }));
    await SecureStore.setItemAsync(TOK, JSON.stringify(expiredTokens));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const err = await api.history().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('NO_SESSION');
    expect(await api.hasSession()).toBe(false);
  });

  test('review 5：401 重試路徑上 refresh 暫時失敗 → 丟暫時錯誤而非 NO_SESSION；token 保留', async () => {
    const { f } = fakeFetch((c) => {
      if (c.url.endsWith('/auth/refresh')) return { status: 502, body: { error: { code: 'BAD_GATEWAY', message: 'upstream' } } };
      return { status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'expired' } } };
    });
    await SecureStore.setItemAsync(TOK, JSON.stringify({ ...expiredTokens, accessExpiresAt: 2_000_000 })); // access 未到期 → 直接打 → 401 → refresh
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000);
    const err = await api.history().catch((e: unknown) => e);
    expect((err as ApiError).code).toBe('SERVER_ERROR');
    expect(await api.hasSession()).toBe(true);
  });

  test('review 3：請求逾時 → NETWORK_ERROR（message 含 timeout），fetch 收到 abort 訊號', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      const f = ((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
        init.signal?.addEventListener('abort', () => { aborted = true; rej(new Error('The operation was aborted')); });
      })) as unknown as typeof fetch;
      await SecureStore.setItemAsync(TOK, JSON.stringify({ ...expiredTokens, accessExpiresAt: 2_000_000 }));
      const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000, 500);
      const pending = api.history().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(600);
      const err = await pending;
      expect(aborted).toBe(true);
      expect((err as ApiError).code).toBe('NETWORK_ERROR');
      expect((err as ApiError).message).toMatch(/timeout after 500 ms/);
    } finally {
      jest.useRealTimers();
    }
  });

  test('review 3：外部 AbortSignal 可取消請求', async () => {
    const f = ((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    })) as unknown as typeof fetch;
    await SecureStore.setItemAsync(TOK, JSON.stringify({ ...expiredTokens, accessExpiresAt: 2_000_000 }));
    const api = new ApiClient('https://api-dev.neonshift.cc/v1', f, () => 1_000_000, 0);
    const ctrl = new AbortController();
    const pending = api.request('GET', '/player/history?days=30', undefined, { signal: ctrl.signal }).catch((e: unknown) => e);
    ctrl.abort(new Error('user left screen'));
    const err = await pending;
    expect((err as ApiError).code).toBe('NETWORK_ERROR');
    expect((err as ApiError).message).toMatch(/user left screen/);
  });
});
