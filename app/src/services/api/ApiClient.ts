/**
 * ApiClient（PG-A-07，SD 4.1／4.2）：後端呼叫、JWT 續期、challenge 簽署。不做業務判定。
 * - access／refresh token 放 SecureStore（Keystore-backed），不進 AsyncStorage／log
 * - 401 時以 refresh 輪替一次再重試；refresh 失敗即清除 session（需重新 SIWS）
 * - 統一錯誤 `{ error: { code, message, rules_version? } }` → ApiError
 */
import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';

import { APP_CONFIG } from '@/config/app';
import { walletService } from '@/services/wallet/WalletService';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly rulesVersion?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Tokens = { accessToken: string; refreshToken: string; accessExpiresAt: number; wallet: string };
const STORE_KEY = 'neonshift.api.tokens.v1';

export type NonceResponse = { nonce: string; request_id: string; issued_at: string; expires_at: string; message: string };
export type TokenPair = { wallet: string; access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; refresh_expires_in: number };
export type ChallengeResponse = { challenge_b64: string; expires_at: number; purpose: string };
export type ClaimResponse = {
  attestation: { message_b64: string; signature_b64: string; attestor_pubkey: string; expires_at: number; nonce: string };
  rules_version: number;
  effective_value: number;
};
export type TournamentStatus = 'draft' | 'registration' | 'locked' | 'running' | 'settling' | 'settled' | 'cancelled';
export type TournamentView = {
  week_id: number;
  address: string;
  status: TournamentStatus;
  stake_amount: string;
  treasury_injection_cap: string;
  treasury_injection: string;
  entrant_count: number;
  valid_entrant_count: number;
  forfeited_count: number;
  min_entrants: number;
  group_a_size: number;
  group_b_size: number;
  prize_a_bps: number;
  prize_b_bps: number;
  loser_refund_bps: number;
  registration_ends_at: number;
  starts_at: number;
  ends_at: number;
  rules_version: number;
  registration_open: boolean;
  settlement: { distributable_pool: string; total_refund: string; total_prize: string; treasury_remainder: string; results_submitted: number } | null;
};
export type TournamentCurrentResponse = { tournament: TournamentView | null; player: { joined: boolean; verified_steps: number; rank: number | null } | null; server_time: number };
export type LeaderboardResponse = { week_id: number; status: TournamentStatus; generated_at: string; total_players: number; entries: { rank: number; wallet: string; verified_steps: number; first_reached_at: string | null; updated_at: string }[]; you: { rank: number | null; verified_steps: number } | null };
export type TournamentStepsResponse = { week_id: number; verified_steps: number; submitted_steps: number; accepted: boolean; first_reached_at: string | null; rank: number | null };
export type HistoryResponse = { days: number; retention_days: number; items: { task_date: number; task_type: 'steps' | 'sleep'; issued_at: string; expires_at: string; redeemed_signature: string | null }[] };

async function readTokens(): Promise<Tokens | null> {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}
async function writeTokens(t: Tokens | null) {
  if (t) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(t));
  else await SecureStore.deleteItemAsync(STORE_KEY);
}

export type FetchLike = typeof fetch;

export class ApiClient {
  private refreshing: Promise<Tokens | null> | null = null;

  constructor(
    private readonly baseUrl: string = APP_CONFIG.apiUrl,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  // ---------------- 登入（SIWS） ----------------

  /** 取 nonce → 以 MWA 簽訊息 → verify → 保存 token */
  async signIn(wallet: string): Promise<TokenPair> {
    const n = await this.request<NonceResponse>('POST', '/auth/nonce', { wallet }, { auth: false });
    const sig = await walletService.signMessage(new TextEncoder().encode(n.message));
    const pair = await this.request<TokenPair>('POST', '/auth/verify', { message: n.message, signature_b64: Buffer.from(sig).toString('base64') }, { auth: false });
    await writeTokens({ accessToken: pair.access_token, refreshToken: pair.refresh_token, accessExpiresAt: this.now() + pair.expires_in * 1000, wallet: pair.wallet });
    return pair;
  }

  async hasSession(): Promise<boolean> {
    return (await readTokens()) !== null;
  }

  async signOut(): Promise<void> {
    try {
      await this.request('POST', '/auth/logout', undefined);
    } catch {
      // 後端不可達也要清本機
    }
    await writeTokens(null);
  }

  // ---------------- claim ----------------

  /** SD 4.2：先算 request_hash → /auth/challenge → MWA 簽 `domain||nonce||request_hash||expiry_le` */
  async authorizeClaim(purpose: 'claim' | 'tournament_steps', requestHash: Uint8Array, taskDate: number, taskType: 1 | 2) {
    const c = await this.request<ChallengeResponse>('POST', '/auth/challenge', {
      purpose,
      request_hash_b64: Buffer.from(requestHash).toString('base64'),
      task_date: taskDate,
      task_type: taskType,
    });
    const nonce = Buffer.from(c.challenge_b64, 'base64');
    const expiry = new Uint8Array(8);
    new DataView(expiry.buffer).setBigInt64(0, BigInt(c.expires_at), true);
    const domain = purpose === 'claim' ? 'NEONSHIFT_CLAIM_V1' : 'NEONSHIFT_TOURNAMENT_STEPS_V1';
    const message = Buffer.concat([Buffer.from(domain, 'ascii'), nonce, Buffer.from(requestHash), Buffer.from(expiry)]);
    const sig = await walletService.signMessage(new Uint8Array(message));
    return { challenge_b64: c.challenge_b64, expires_at: c.expires_at, signature_b64: Buffer.from(sig).toString('base64') };
  }

  claim(body: Record<string, unknown>, idempotencyKey: string): Promise<ClaimResponse> {
    return this.request<ClaimResponse>('POST', '/attestation/claim', body, { headers: { 'idempotency-key': idempotencyKey } });
  }

  // ---------------- tournament（PG-A-15） ----------------

  tournamentCurrent(): Promise<TournamentCurrentResponse> {
    return this.request<TournamentCurrentResponse>('GET', '/tournament/current');
  }

  tournamentLeaderboard(weekId: number): Promise<LeaderboardResponse> {
    return this.request<LeaderboardResponse>('GET', `/tournament/${weekId}/leaderboard`);
  }

  tournamentSteps(body: Record<string, unknown>, idempotencyKey: string): Promise<TournamentStepsResponse> {
    return this.request<TournamentStepsResponse>('POST', '/tournament/steps', body, { headers: { 'idempotency-key': idempotencyKey } });
  }

  history(days = 30): Promise<HistoryResponse> {
    return this.request<HistoryResponse>('GET', `/player/history?days=${days}`);
  }

  deleteData(): Promise<{ status: number; body: unknown }> {
    return this.requestRaw('DELETE', '/player/data');
  }

  // ---------------- 底層 ----------------

  async request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}): Promise<T> {
    const r = await this.requestRaw(method, path, body, opts);
    return r.body as T;
  }

  private async requestRaw(method: string, path: string, body?: unknown, opts: { auth?: boolean; headers?: Record<string, string> } = {}, retried = false): Promise<{ status: number; body: unknown }> {
    if (!this.configured) throw new ApiError(0, 'NOT_CONFIGURED', 'EXPO_PUBLIC_API_URL is not set for this build');
    const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth !== false) {
      const t = await this.ensureAccessToken();
      if (!t) throw new ApiError(401, 'NO_SESSION', 'Sign in required');
      headers.authorization = `Bearer ${t.accessToken}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : String(e));
    }
    const text = await res.text();
    const parsed: unknown = text ? safeJson(text) : null;
    if (res.ok) return { status: res.status, body: parsed };
    const err = (parsed as { error?: { code?: string; message?: string; rules_version?: number } } | null)?.error;
    // access 過期／撤銷：refresh 一次後重試
    if (res.status === 401 && opts.auth !== false && !retried && (err?.code === 'UNAUTHORIZED' || err?.code === 'SESSION_REVOKED')) {
      const t = await this.refresh();
      if (t) return this.requestRaw(method, path, body, opts, true);
    }
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `HTTP ${res.status}`, err?.rules_version, parsed);
  }

  private async ensureAccessToken(): Promise<Tokens | null> {
    const t = await readTokens();
    if (!t) return null;
    // 提前 30 秒續期
    if (t.accessExpiresAt - this.now() > 30_000) return t;
    return this.refresh();
  }

  /** 單飛：同時多個請求只做一次 refresh；失敗即清 session */
  private refresh(): Promise<Tokens | null> {
    this.refreshing ??= (async () => {
      try {
        const cur = await readTokens();
        if (!cur) return null;
        const res = await this.fetchImpl(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ refresh_token: cur.refreshToken }),
        });
        if (!res.ok) {
          await writeTokens(null);
          return null;
        }
        const pair = (await res.json()) as TokenPair;
        const next: Tokens = { accessToken: pair.access_token, refreshToken: pair.refresh_token, accessExpiresAt: this.now() + pair.expires_in * 1000, wallet: pair.wallet };
        await writeTokens(next);
        return next;
      } catch {
        return null;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const apiClient = new ApiClient();
