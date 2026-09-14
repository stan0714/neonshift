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
    /** 後端 request id（Style 14 reference ID） */
    public readonly requestId?: string,
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
export type GalleryPlayerView = { rank: number | null; wallet: string; shoe_level: number; core_level: number; xp: string; streak_days: number; max_streak_days: number; last_task_date: number | null; collectible_count: number; updated_at: string };
export type GalleryListResponse = { generated_at: string; total: number; next_cursor: string | null; players: GalleryPlayerView[]; you: { rank: number } | null };
export type GalleryPlayerResponse = { player: GalleryPlayerView; is_you: boolean; collectibles: { kind: number; asset: string; signature: string; claimed_at: string }[] };
export type PartnerEventView = {
  event_id: string; slug: string; title: string; description: string; state: 'draft' | 'published' | 'cancelled' | 'completed'; timezone: string;
  registration_opens_at: string | null; registration_closes_at: string | null; starts_at: string | null; ends_at: string | null;
  capacity: number; registration_count: number; spots_left: number | null; tournament_address: string | null;
  rules: { version: number; revision_id: string; rules: Record<string, unknown>; published_at: string | null } | null; cancel_reason: string | null;
};
export type EventRegistration = { status: 'registered' | 'cancelled' | 'checked_in'; accepted_rule_revision: string; display_name: string | null; public_consent: boolean; registered_at: string; cancelled_at: string | null };
export type TagState = { status: 'revoked' } | { status: 'not_yours' } | { status: 'active'; purpose: 'checkpoint' | 'participant'; checkpoint: { checkpoint_id: string; name: string; purpose: 'check_in' | 'redemption' | 'info' } | null; registered: boolean; event_state: string };
export type CheckinChallenge = { code: string; expires_at: string; checkpoint: { checkpoint_id: string; name: string }; qr_payload: string };
export type StaffCheckinResult = { wallet: string; checkpoint_id: string; display_name: string | null; already: boolean; confirmed_at: string };
export type EventResultRow = { display_name: string; discipline: string; division: string | null; finish_status: 'finished' | 'dnf' | 'dns' | 'dq'; distance_m: number; elapsed_ms: number; rank: number | null; rank_source: 'organizer' | null; published_at: string };
export type EventResults = { event_id: string; slug: string; total_finished: number; results: EventResultRow[]; non_finishers: EventResultRow[]; source: 'organizer' };
export type MyResult = { revision_id: string; import_id: string; discipline: string; division: string | null; finish_status: 'finished' | 'dnf' | 'dns' | 'dq'; distance_m: number; elapsed_ms: number; rank: number | null; previous_revision_id: string | null; reason: string | null; published_at: string };
export type EventBenefit = { benefit_id: string; kind: 'physical' | 'digital_badge'; name: string; remaining: number; per_person_limit: number; requires_checkin: boolean; claim_deadline: string | null };
export type RedemptionStatus = 'reserved' | 'fulfilled' | 'expired' | 'cancelled';
export type Redemption = { redemption_id: string; benefit_id: string; quantity: number; status: RedemptionStatus; claim_code: string | null; reserved_at: string; reserved_until: string; fulfilled_at: string | null; credential_id: string | null };
export type PartnerMe = { organizations: { org_id: string; role: string; name: string | null }[]; event_roles: { event_id: string; role: string; checkpoint_id: string | null }[] };
export type HistoryItem = { task_date: number; task_type: 'steps' | 'sleep'; issued_at: string; expires_at: string; redeemed_signature: string | null; amount: string | null; xp: number | null; shoe_level: number | null };
export type HistoryResponse = { days: number; retention_days: number; total_earned: string; items: HistoryItem[] };

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

  // ---------------- gallery（PG-G-03） ----------------

  galleryPlayers(cursor: string | null = null, limit = 50): Promise<GalleryListResponse> {
    return this.request<GalleryListResponse>('GET', `/gallery/players?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
  }

  galleryPlayer(wallet: string): Promise<GalleryPlayerResponse> {
    return this.request<GalleryPlayerResponse>('GET', `/gallery/players/${encodeURIComponent(wallet)}`);
  }

  gallerySearch(q: string): Promise<{ players: GalleryPlayerView[] }> {
    return this.request<{ players: GalleryPlayerView[] }>('GET', `/gallery/search?q=${encodeURIComponent(q)}`);
  }

  // ---------------- partner events（PG-E-03） ----------------

  events(cursor: string | null = null): Promise<{ events: PartnerEventView[]; next_cursor: string | null }> {
    return this.request('GET', `/events?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, { auth: false });
  }

  event(idOrSlug: string, source?: string): Promise<PartnerEventView> {
    return this.request('GET', `/events/${encodeURIComponent(idOrSlug)}${source ? `?source=${encodeURIComponent(source)}` : ''}`, undefined, { auth: false });
  }

  eventRegistration(eventId: string): Promise<{ registration: EventRegistration | null }> {
    return this.request('GET', `/events/${encodeURIComponent(eventId)}/registration`);
  }

  registerEvent(eventId: string, body: { accepted_rule_revision: string; display_name?: string | null; public_consent?: boolean }, source?: string): Promise<{ registration: EventRegistration; already: boolean }> {
    return this.request('POST', `/events/${encodeURIComponent(eventId)}/registrations${source ? `?source=${encodeURIComponent(source)}` : ''}`, body);
  }

  eventTag(eventId: string, ref: string): Promise<TagState> {
    return this.request<TagState>('GET', `/events/${encodeURIComponent(eventId)}/tags/${encodeURIComponent(ref)}`);
  }

  checkinChallenge(eventId: string, checkpointId: string): Promise<CheckinChallenge> {
    return this.request('POST', `/events/${encodeURIComponent(eventId)}/check-in-challenges`, { checkpoint_id: checkpointId });
  }

  partnerMe(): Promise<PartnerMe> {
    return this.request('GET', '/partner/me');
  }

  partnerCheckpoints(eventId: string): Promise<{ checkpoints: { checkpoint_id: string; name: string; purpose: 'check_in' | 'redemption' | 'info' }[] }> {
    return this.request('GET', `/partner/events/${encodeURIComponent(eventId)}/checkpoints`);
  }

  staffCheckin(eventId: string, body: { code?: string; wallet?: string; checkpoint_id: string; method: 'qr' | 'nfc' | 'manual'; reason?: string }): Promise<StaffCheckinResult> {
    return this.request('POST', `/partner/events/${encodeURIComponent(eventId)}/check-ins`, body);
  }

  staffCheckins(eventId: string): Promise<{ check_ins: { wallet: string; checkpoint_id: string; confirmed_at: string; method: string }[] }> {
    return this.request('GET', `/partner/events/${encodeURIComponent(eventId)}/check-ins`);
  }

  // PG-E-08：成績榜、個人成績冊、公開同意
  eventResults(idOrSlug: string, q: { discipline?: string; division?: string } = {}): Promise<EventResults> {
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
    return this.request('GET', `/events/${encodeURIComponent(idOrSlug)}/results${qs ? `?${qs}` : ''}`);
  }

  myEventHistory(): Promise<{ items: { event: { event_id: string; slug: string; title: string; state: string; starts_at: string | null; ends_at: string | null } | null; registration: EventRegistration; check_ins: { checkpoint_id: string; confirmed_at: string; method: string }[]; redemptions: Redemption[]; results: MyResult[] }[] }> {
    return this.request('GET', '/me/event-history');
  }

  updateEventPrivacy(eventId: string, patch: { display_name?: string | null; public_consent?: boolean }): Promise<{ registration: EventRegistration }> {
    return this.request('PATCH', `/events/${encodeURIComponent(eventId)}/registration/privacy`, patch);
  }

  // PG-E-06：品項與核銷
  eventBenefits(idOrSlug: string): Promise<{ benefits: EventBenefit[] }> {
    return this.request('GET', `/events/${encodeURIComponent(idOrSlug)}/benefits`);
  }

  myRedemptions(eventId: string): Promise<{ redemptions: Redemption[] }> {
    return this.request('GET', `/events/${encodeURIComponent(eventId)}/redemptions`);
  }

  reserveRedemption(eventId: string, body: { benefit_id: string; quantity?: number; idempotency_key: string }): Promise<Redemption> {
    return this.request('POST', `/events/${encodeURIComponent(eventId)}/redemptions`, body);
  }

  partnerBenefits(eventId: string): Promise<{ benefits: (EventBenefit & { stock_total: number; reserved_count: number; fulfilled_count: number })[] }> {
    return this.request('GET', `/partner/events/${encodeURIComponent(eventId)}/benefits`);
  }

  staffFulfill(eventId: string, body: { claim_code?: string; redemption_id?: string; checkpoint_id?: string }): Promise<Redemption & { already: boolean }> {
    return this.request('POST', `/partner/events/${encodeURIComponent(eventId)}/redemptions/fulfill`, body);
  }

  cancelEventRegistration(eventId: string): Promise<unknown> {
    return this.requestRaw('DELETE', `/events/${encodeURIComponent(eventId)}/registration`);
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
    const err = (parsed as { error?: { code?: string; message?: string; rules_version?: number; request_id?: string } } | null)?.error;
    // access 過期／撤銷：refresh 一次後重試
    if (res.status === 401 && opts.auth !== false && !retried && (err?.code === 'UNAUTHORIZED' || err?.code === 'SESSION_REVOKED')) {
      const t = await this.refresh();
      if (t) return this.requestRaw(method, path, body, opts, true);
    }
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `HTTP ${res.status}`, err?.rules_version, parsed, err?.request_id);
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
