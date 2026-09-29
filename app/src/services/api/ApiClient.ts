/**
 * ApiClient（PG-A-07，SD 4.1／4.2）：後端呼叫、JWT 續期、challenge 簽署。不做業務判定。
 * - access／refresh token 放 SecureStore（Keystore-backed），不進 AsyncStorage／log
 * - 401 時以 refresh 輪替一次再重試；只有後端**明確判定憑證失效**（REFRESH_INVALID／EXPIRED／REUSED、SESSION_REVOKED 等 401）才清除 session；
 *   離線、逾時、限流（429）與伺服器錯誤（5xx）視為暫時失敗，token 保留、以 NETWORK_ERROR／RATE_LIMITED／SERVER_ERROR 回報（review 5）。
 * - 所有請求都有逾時（預設 15 s；AbortController），網路卡住不會讓畫面無限等待（review 3）。
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
    /** NETWORK_ERROR 細分：逾時／被取消／連不上（畫面用來給人看得懂的說明，不直接印技術訊息） */
    public readonly netReason?: 'timeout' | 'aborted' | 'unreachable',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Tokens = { accessToken: string; refreshToken: string; accessExpiresAt: number; wallet: string };
const STORE_KEY = 'neonshift.api.tokens.v1';

/** 登入 verify 的網路錯誤重試間隔（ms）；已簽訊息可重用到 nonce 到期前 `SIGNIN_REUSE_MARGIN_MS` */
export const SIGNIN_VERIFY_RETRY_MS = [1_500, 3_000] as const;
export const SIGNIN_REUSE_MARGIN_MS = 15_000;
const SIGNIN_DEFAULT_TTL_MS = 5 * 60_000;
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
export type GalleryPlayerView = { rank: number | null; wallet: string; shoe_level: number; core_level: number; xp: string; streak_days: number; max_streak_days: number; last_task_date: number | null; collectible_count: number; /** PG-V-04 歷史最高（舊後端可能缺） */ highest_level?: number; updated_at: string };
export type GalleryBoard = 'active' | 'lifetime';
export type GalleryListResponse = { generated_at: string; board?: GalleryBoard; total: number; next_cursor: string | null; players: GalleryPlayerView[]; you: { rank: number } | null };
export type GalleryAchievement = { achievement_id: string; asset: string | null; kind?: 'pb' | 'milestone' | 'event'; series: 'pb_speed' | 'pb_distance' | 'genesis_distance' | 'first_finish' | 'event_check_in' | 'event_finish'; category: PbCategory | MilestoneCategory | 'event_check_in' | 'event_finish'; event?: { title: string | null; event_id: string | null } | null; verification_class: 'organizer' | 'device'; environment: string; record: 'current' | 'historical' | 'invalidated'; public: boolean; value: string | null; achieved_on: string | null; image: string; name: string; minted_at: string | null; minted_signature: string | null; metadata_uri: string };
export type GalleryAchievementDetail = GalleryAchievement & { original_achiever: string; metadata: Record<string, unknown>; network: string; explorer_url: string };
export type GalleryPlayerResponse = { player: GalleryPlayerView; is_you: boolean; hidden?: boolean; collectibles: { kind: number; asset: string; signature: string; claimed_at: string }[]; achievements?: GalleryAchievement[] };
export type PartnerEventView = {
  event_id: string; slug: string; title: string; description: string; state: 'draft' | 'published' | 'cancelled' | 'completed'; timezone: string;
  registration_opens_at: string | null; registration_closes_at: string | null; starts_at: string | null; ends_at: string | null;
  capacity: number; registration_count: number; spots_left: number | null; tournament_address: string | null;
  /** PG-M-04：主辦方是否發行報到章／完賽章；舊後端可能缺 */
  badges?: { check_in: boolean; finish: boolean };
  rules: { version: number; revision_id: string; rules: Record<string, unknown>; published_at: string | null } | null; cancel_reason: string | null;
};
export type EventRegistration = { status: 'registered' | 'cancelled' | 'checked_in'; accepted_rule_revision: string; display_name: string | null; public_consent: boolean; registered_at: string; cancelled_at: string | null };
export type TagState = { status: 'revoked' } | { status: 'not_yours' } | { status: 'active'; purpose: 'checkpoint' | 'participant'; checkpoint: { checkpoint_id: string; name: string; purpose: 'check_in' | 'redemption' | 'info' } | null; registered: boolean; event_state: string };
export type CheckinChallenge = { code: string; expires_at: string; checkpoint: { checkpoint_id: string; name: string }; qr_payload: string };
export type StaffCheckinResult = { wallet: string; checkpoint_id: string; display_name: string | null; already: boolean; confirmed_at: string };
export type EventResultRow = { display_name: string; discipline: string; division: string | null; finish_status: 'finished' | 'dnf' | 'dns' | 'dq'; distance_m: number; elapsed_ms: number; rank: number | null; rank_source: 'organizer' | null; published_at: string };
export type EventResults = { event_id: string; slug: string; total_finished: number; results: EventResultRow[]; non_finishers: EventResultRow[]; source: 'organizer' };
export type MyResult = { revision_id: string; import_id: string; discipline: string; division: string | null; finish_status: 'finished' | 'dnf' | 'dns' | 'dq'; distance_m: number; elapsed_ms: number; rank: number | null; previous_revision_id: string | null; reason: string | null; published_at: string };
// PG-R-01：運動 session 摘要（大整數以十進位字串傳遞）
export type WorkoutOrigin = 'health_connect' | 'device' | 'gps' | 'organizer' | 'manual';
export type WorkoutQuality = 'complete' | 'partial' | 'estimated' | 'needs_review' | 'invalid';
export type WorkoutIntent = 'casual' | 'brisk' | 'run';
export type WorkoutGoal = { kind: 'free' | 'time' | 'distance'; target: number; unit: 's' | 'mm'; version: number };
export type WorkoutImportInput = {
  sport: 'run' | 'walk'; environment?: 'outdoor' | 'indoor' | 'unknown'; origin: WorkoutOrigin; source_id: string; external_record_id: string; source_revision?: number;
  /** PG-U-01：使用模式與目標快照 */
  intent?: WorkoutIntent | null; goal?: WorkoutGoal | null;
  started_at: string; ended_at: string; paused_ms?: string; distance_mm?: string | null; distance_method?: 'device' | 'gps' | 'estimated' | 'organizer' | null; steps?: number | null;
  active_energy_mkcal?: string | null; energy_method?: 'device' | 'estimated' | 'total' | null; total_energy_mkcal?: string | null; step_length_mm?: number | null; client_flags?: string[]; extras?: Record<string, unknown>;
};
export type WorkoutSummary = {
  session_id: string; sport: 'run' | 'walk'; environment: 'outdoor' | 'indoor' | 'unknown'; /** PG-U-01（舊後端可能缺） */ intent?: WorkoutIntent | null; goal?: WorkoutGoal | null;
  source: { origin: WorkoutOrigin; source_id: string; external_record_id: string; source_revision: number };
  started_at: string; ended_at: string; elapsed_ms: string; paused_ms: string; status: 'saved' | 'needs_review' | 'invalid' | 'deleted'; quality: WorkoutQuality; rules_version: number; review_reasons: string[]; possible_duplicate_of: string | null;
  metrics: { distance: { value_mm: string; method: string | null } | null; steps: number | null; active_energy: { value_mkcal: string; method: string | null } | null; total_energy: { value_mkcal: string } | null; avg_pace_s_per_km: number | null; avg_speed_kmh: number | null; step_length_mm: number | null };
  pb_eligible: boolean; extras: Record<string, unknown>; revision: number; imported_at: string; updated_at: string;
};
export type PbCategory = 'fastest_1k' | 'fastest_5k' | 'fastest_10k' | 'fastest_half' | 'fastest_marathon' | 'longest_run';
export type PbView = { pb_id: string; category: PbCategory; environment: string; verification_class: 'organizer' | 'device'; timing_basis: string; rules_major: number; value: string; unit: 'ms' | 'mm'; source: { kind: 'workout' | 'result'; id: string; revision: number }; achieved_at: string; status: 'current' | 'historical' | 'invalidated'; is_baseline: boolean; previous_pb_id: string | null; invalidated_at: string | null; reason: string | null };
export type PbGroup = { key: string; category: PbCategory; environment: string; verification_class: 'organizer' | 'device'; timing_basis: string; current: PbView | null; /** PG-V-03：NFT 資格（達成日 Active level ≥ 3；舊後端可能缺） */ nft_eligibility?: { status: 'eligible' | 'level_required' | 'history_unknown'; level: number | null; required: number; effective_from: number | null } | null; history: PbView[] };
export type PersonalBests = { rules_major: number; imported_since: string | null; groups: PbGroup[] };
/** PG-M-03：首次里程碑目錄（每穩定 key 一張） */
export type MilestoneCategory = 'first_5k' | 'first_10k' | 'first_half' | 'first_marathon' | 'first_finish';
export type MilestoneStatus = 'eligible' | 'pending_review' | 'device_pending' | 'locked';
export type MilestoneSource = { source: { kind: 'workout' | 'result'; id: string; revision: number }; achieved_at: string | null; distance_mm: string; reason: string | null };
export type MilestoneItem = { key: string; category: MilestoneCategory; environment: 'outdoor' | 'indoor' | 'unknown'; verification_class: 'organizer' | 'device'; rules_major: number; threshold_mm: string | null; status: MilestoneStatus; first: MilestoneSource | null; pending: MilestoneSource | null };
/** PG-U-04 探索冊 */
/** XD-01 卡面（伺服器決定）：來源、難度、資料要求、獎勵類型、開始時帶入的目標 */
export type QuestCard = { source: 'system'; difficulty: 'easy' | 'medium'; requirements: { min_active_minutes: number; sports: readonly ('run' | 'walk')[]; gps_counts: boolean; needs_sync: boolean }; reward: { kind: 'cosmetic'; cosmetic_id: string }; start: { goal: { kind: 'time'; minutes: number | null } | { kind: 'free' } } };
export type QuestCardState = 'available' | 'accepted' | 'in_progress' | 'pending_verification' | 'claimable' | 'claimed' | 'revoked' | 'expired';
export type QuestTemplateView = { template_id: string; version: number; kind: 'active_days' | 'goal_time'; params: Record<string, unknown>; cosmetic_id: string; card?: QuestCard };
export type QuestEnrollmentView = { enrollment_id: string; template_id: string; template_version: number; goal: Record<string, unknown>; timezone: string; period_start: string; period_end: string; late_sync_until: string; accepted_at: string; status: 'active' | 'completed' | 'claimed' | 'expired' | 'revoked'; card_state?: QuestCardState; pending_review_count?: number; card?: QuestCard | null; completed_at: string | null; progress: { current: number; target: number } | null; contributions: { source: { kind: string; id: string; revision: number }; local_day: string }[] };
export type PassportEntry = { id: string; kind: 'pb' | 'milestone' | 'event_badge' | 'quest'; category: string; title_key: string; source_class: 'organizer' | 'device' | 'pending'; source: { kind: string; id: string; revision: number } | null; rules_version: string; achieved_at: string | null; validity: 'valid' | 'pending' | 'revoked' | 'locked'; reason: string | null; public: boolean; nft: { status: string; asset: string | null; achievement_id: string } | null; original_holder: 'you' };
export type PassportResponse = { entries: PassportEntry[]; counts: Record<'valid' | 'pending' | 'revoked' | 'locked', number>; trust_note: string };
export type QuestsResponse = { templates: QuestTemplateView[]; enrollments: QuestEnrollmentView[]; cosmetics: { cosmetic_id: string; receipt_id: string; status: 'active' | 'revoked'; granted_at: string }[]; rules: { min_active_minutes: number; late_sync_hours: number; gps_rewards_enabled: boolean } };
export type SkrNetwork = 'mainnet-beta' | 'devnet';
export type SkrOrderStatus = 'awaiting_payment' | 'confirming' | 'fulfilled' | 'expired' | 'needs_review' | 'cancelled';
export type SkrOrderView = { order_id: string; sku: string; sku_version: number; cosmetic_id: string; network: SkrNetwork; mint: string; decimals: number; amount_base_units: string; amount_display: string; recipient: string; recipient_token_account: string; reference: string; status: SkrOrderStatus; signature: string | null; paid_amount_base_units: string | null; paid_at: string | null; failure_reason: string | null; expires_at: string; created_at: string; updated_at: string };
export type SkrEntitlementView = { cosmetic_id: string; order_id: string; status: 'active' | 'revoked'; granted_at: string };
export type SkrSkuView = { sku: string; version: number; cosmetic_id: string; requires: { kind: 'milestone'; category: string }; price_base_units: string; price_display: string; eligibility: 'eligible' | 'not_achieved' | 'pending_registry' | 'revoked'; achievement_id: string | null; owned: boolean; open_order: SkrOrderView | null };
export type SkrCatalog = { enabled: false; reason: string | null } | { enabled: true; network: SkrNetwork; mint: string; decimals: number; recipient: string; recipient_token_account: string; order_ttl_sec: number; skus: SkrSkuView[]; entitlements: SkrEntitlementView[] };

/** PG-SEASON-01／02 節日收藏：後端只判定資格，沒有鑄造路徑（`mint_enabled` 目前一律 false） */
export type SeasonalWindowState = 'upcoming' | 'open' | 'grace' | 'closed';
export type SeasonalStatus = 'locked' | 'pending_review' | 'eligible';
export type SeasonalSource = { source: { kind: string; id: string; revision: number }; started_at: string; moving_ms: number };
export type SeasonalCampaignView = {
  campaign_id: string; theme_id: string; year: number; art_version: number; rules_version: number; prototype: boolean;
  window: { starts_at: string; ends_at: string; display_timezone: string; state: SeasonalWindowState };
  rules: { min_moving_minutes: number; grace_days: number; single_session: boolean; gps_counts: boolean };
  source: { fact: string; url: string; checked_on: string };
  mint_enabled: boolean;
};
export type MySeasonalItem = SeasonalCampaignView & { status: SeasonalStatus; first: SeasonalSource | null; pending: SeasonalSource | null; progress: { best_moving_ms: number; required_ms: number }; reason: string | null };

export type Milestones = { rules_major: number; imported_since: string | null; items: MilestoneItem[]; unlocked_by_source: { kind: 'workout' | 'result'; id: string; categories: MilestoneCategory[] }[] };
/** PG-M-04：活動留念章（報到／完賽分開；報名時鞋階承諾） */
export type EventBadgeKind = 'check_in' | 'finish';
export type EventBadgeStatus = 'eligible' | 'locked' | 'level_locked' | 'cancelled';
export type EventBadgeItem = { key: string; event_id: string; kind: EventBadgeKind; category: 'event_check_in' | 'event_finish'; rules_major: number; status: EventBadgeStatus; level_at_registration: number; min_level: number; event: { title: string; slug: string; starts_at: string | null; ends_at: string | null; state: string }; source: { kind: 'participant' | 'result'; id: string; revision: number; achieved_at: string | null } | null };
export type AchievementStatus = 'pending_registry' | 'approved' | 'minted' | 'revoke_pending' | 'revoked';
export type AchievementView = { achievement_id: string; minted: boolean; kind: 'pb' | 'milestone' | 'event'; pb_id: string | null; milestone_key: string | null; source: { kind: 'workout' | 'result'; id: string; revision: number } | null; category: PbCategory | MilestoneCategory; verification_class: 'organizer' | 'device'; source_revision: number; rules_major: number; public_consent: boolean; status: AchievementStatus; metadata_hash: string; metadata_uri: string; asset: string | null; minted_signature: string | null; minted_at: string | null; registry_updated_at: string | null; updated_at: string };
export type MintIntent = { achievement: AchievementView; pb_id: string | null; milestone_key: string | null; fee_estimate_lamports: number; metadata_preview: Record<string, unknown>; status: AchievementStatus; proof: { message_b64: string; signature_b64: string; attestor: string; expires_at: string; args: Record<string, unknown> } | null };
export type WorkoutImportResult = { imported: number; results: ({ external_record_id: string; outcome: 'created' | 'superseded' | 'same' | 'stale' | 'deleted'; session: WorkoutSummary } | { external_record_id: string; outcome: 'invalid'; reasons: string[] })[] };
export type EventBenefit = { benefit_id: string; kind: 'physical' | 'digital_badge'; name: string; remaining: number; per_person_limit: number; requires_checkin: boolean; claim_deadline: string | null };
export type RedemptionStatus = 'reserved' | 'fulfilled' | 'expired' | 'cancelled';
export type Redemption = { redemption_id: string; benefit_id: string; quantity: number; status: RedemptionStatus; claim_code: string | null; reserved_at: string; reserved_until: string; fulfilled_at: string | null; credential_id: string | null };
export type PartnerMe = { organizations: { org_id: string; role: string; name: string | null }[]; event_roles: { event_id: string; role: string; checkpoint_id: string | null }[] };
export type HistoryItem = { task_date: number; task_type: 'steps' | 'sleep' | 'workout'; issued_at: string; expires_at: string; redeemed_signature: string | null; amount: string | null; xp: number | null; shoe_level: number | null };
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
/** 預設請求逾時（ms）。同步摘要這類小請求在行動網路下 15 s 仍沒回應，等下去也不會好 */
export const DEFAULT_TIMEOUT_MS = 15_000;
export type RequestOpts = { auth?: boolean; headers?: Record<string, string>; /** 覆寫逾時；0 表示不逾時 */ timeoutMs?: number; /** 外部取消 */ signal?: AbortSignal; /** GET 逾時自動重試一次（預設 true；只有 GET 才會） */ retryOnTimeout?: boolean };

/**
 * refresh 的三種結果（review 5）：
 * - ok：拿到新 token
 * - invalid：後端明確說憑證失效 → 已清 session，需重新登入
 * - transient：離線／逾時／限流／伺服器錯誤 → token 保留，稍後可再試；不可當成「需要登入」
 */
type RefreshResult = { kind: 'ok'; tokens: Tokens } | { kind: 'invalid' } | { kind: 'transient'; error: ApiError };

/** 後端 refresh 端點會回的「憑證確實失效」代碼（backend/src/auth/service.ts） */
const REFRESH_INVALID_CODES = new Set(['REFRESH_INVALID', 'REFRESH_EXPIRED', 'REFRESH_REUSED', 'REFRESH_REVOKED', 'SESSION_REVOKED', 'UNAUTHORIZED']);

export class ApiClient {
  private refreshing: Promise<RefreshResult> | null = null;

  constructor(
    private readonly baseUrl: string = APP_CONFIG.apiUrl,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = () => Date.now(),
    private readonly defaultTimeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /** 帶逾時與外部取消的 fetch；逾時或取消 → ApiError NETWORK_ERROR（code 帶 TIMEOUT／ABORTED 於 message） */
  private async fetchWithTimeout(url: string, init: RequestInit, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort(opts.signal?.reason);
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    // 實機 2026-09-22：RN 的 AbortController 不保證帶 `signal.reason`，逾時只剩 "aborted" 字樣；用本地旗標判定
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(new Error(`timeout after ${timeoutMs} ms`)); }, timeoutMs) : null;
    try {
      // 進到這裡之前（讀 token／refresh）就已被取消：不再發請求
      if (ctrl.signal.aborted) throw new Error('aborted before request');
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (timedOut) throw new ApiError(0, 'NETWORK_ERROR', `timeout after ${timeoutMs} ms`, undefined, undefined, undefined, 'timeout');
      if (ctrl.signal.aborted) throw new ApiError(0, 'NETWORK_ERROR', ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : 'aborted', undefined, undefined, undefined, 'aborted');
      throw new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : String(e), undefined, undefined, undefined, 'unreachable');
    } finally {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  get configured(): boolean {
    return this.baseUrl.length > 0;
  }

  // ---------------- 登入（SIWS） ----------------

  /**
   * 取 nonce → 簽訊息 → verify → 保存 token。
   * `signer` 預設另開錢包 session 簽；連線流程會傳入同一個 MWA session 的簽章函式（見 WalletService.connect.afterAuthorize），
   * 讓「連線錢包」與「後端登入」一次完成，之後競技場／藝廊／活動不再要求登入（token 會續期）。
   */
  async signIn(wallet: string, signer: (message: Uint8Array) => Promise<Uint8Array> = (m) => walletService.signMessage(m)): Promise<TokenPair> {
    // 實機回饋：熱點斷斷續續時，錢包簽完 verify 卻因 DNS／離線失敗，畫面又要求再簽一次、永遠登不進去。
    // 已簽好的 (message, signature) 在 nonce 有效期內可重用：verify 失敗（網路）先短暫重試，仍失敗就留著，下次 signIn 直接 verify、不再開錢包。
    const pending = this.pendingSignIn;
    let signed: { message: string; signature_b64: string; expiresAt: number };
    if (pending && pending.wallet === wallet && pending.expiresAt - SIGNIN_REUSE_MARGIN_MS > this.now()) signed = pending;
    else {
      this.pendingSignIn = null;
      const n = await this.request<NonceResponse>('POST', '/auth/nonce', { wallet }, { auth: false });
      const sig = await signer(new TextEncoder().encode(n.message));
      const exp = Date.parse(n.expires_at);
      signed = { message: n.message, signature_b64: Buffer.from(sig).toString('base64'), expiresAt: Number.isFinite(exp) ? exp : this.now() + SIGNIN_DEFAULT_TTL_MS };
      this.pendingSignIn = { wallet, ...signed };
    }
    let pair: TokenPair | null = null;
    for (let attempt = 0; ; attempt++) {
      try {
        pair = await this.request<TokenPair>('POST', '/auth/verify', { message: signed.message, signature_b64: signed.signature_b64 }, { auth: false });
        break;
      } catch (e) {
        const transient = e instanceof ApiError && (e.code === 'NETWORK_ERROR' || e.code === 'SERVER_ERROR' || e.code === 'RATE_LIMITED');
        if (transient && attempt < SIGNIN_VERIFY_RETRY_MS.length) { await this.sleep(SIGNIN_VERIFY_RETRY_MS[attempt]!); continue; }
        if (!transient) this.pendingSignIn = null; // nonce 已用掉／過期／簽章無效：下次重新走完整流程
        throw e;
      }
    }
    this.pendingSignIn = null;
    await writeTokens({ accessToken: pair.access_token, refreshToken: pair.refresh_token, accessExpiresAt: this.now() + pair.expires_in * 1000, wallet: pair.wallet });
    return pair;
  }
  /** 已簽好、尚未 verify 成功的登入訊息（只在記憶體） */
  private pendingSignIn: { wallet: string; message: string; signature_b64: string; expiresAt: number } | null = null;
  /** 是否有可直接重用的已簽登入（畫面用來說明「不必再簽一次」） */
  hasPendingSignIn(wallet: string): boolean {
    const p = this.pendingSignIn;
    return !!p && p.wallet === wallet && p.expiresAt - SIGNIN_REUSE_MARGIN_MS > this.now();
  }
  private sleep(ms: number) {
    return new Promise<void>((res) => setTimeout(res, ms));
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
  async authorizeClaim(purpose: 'claim' | 'tournament_steps', requestHash: Uint8Array, taskDate: number, taskType: 1 | 2 | 3) {
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

  galleryPlayers(cursor: string | null = null, limit = 50, board: GalleryBoard = 'active'): Promise<GalleryListResponse> {
    return this.request<GalleryListResponse>('GET', `/gallery/players?limit=${limit}&board=${board}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
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

  // PG-R-01：運動 session
  importWorkouts(sessions: WorkoutImportInput[]): Promise<WorkoutImportResult> {
    return this.request('POST', '/workouts/import', { sessions });
  }

  /** PG-LINK-04：日誌查詢（from／to 為 [from,to) ISO；order asc＝由舊到新；cursor 分頁）；舊參數 limit／offset 仍可用 */
  myWorkouts(q: { limit?: number; offset?: number; from?: string; to?: string; sport?: 'run' | 'walk'; intent?: WorkoutIntent; source?: 'gps' | 'device' | 'manual' | 'imported'; status?: 'saved' | 'needs_review' | 'invalid'; order?: 'asc' | 'desc'; cursor?: string } = {}): Promise<{ items: WorkoutSummary[]; rules_version: number; next_cursor?: string | null; as_of?: string; total?: number }> {
    const qs = Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
    return this.request('GET', `/me/workouts${qs ? `?${qs}` : ''}`);
  }

  galleryAchievement(asset: string): Promise<GalleryAchievementDetail> {
    return this.request('GET', `/gallery/achievements/${encodeURIComponent(asset)}`);
  }

  galleryPrivacy(): Promise<{ hidden: boolean }> {
    return this.request('GET', '/me/gallery-privacy');
  }

  setGalleryPrivacy(hidden: boolean): Promise<{ hidden: boolean }> {
    return this.request('PATCH', '/me/gallery-privacy', { hidden });
  }

  mintIntent(pbId: string, publicConsent: boolean): Promise<MintIntent> {
    return this.request('POST', `/me/achievements/${encodeURIComponent(pbId)}/mint-intent`, { public_consent: publicConsent });
  }

  // PG-U-04：探索冊
  quests(): Promise<QuestsResponse> {
    return this.request('GET', '/me/quests');
  }
  acceptQuest(body: { template_id: string; goal: Record<string, unknown>; timezone: string; idempotency_key: string }): Promise<{ enrollment: QuestEnrollmentView; already: boolean }> {
    return this.request('POST', '/me/quests/accept', body);
  }
  claimQuest(enrollmentId: string): Promise<{ receipt: { receipt_id: string; cosmetic_id: string; issued_at: string }; already: boolean; enrollment: QuestEnrollmentView }> {
    return this.request('POST', `/me/quests/${encodeURIComponent(enrollmentId)}/claim`, {});
  }

  // SKR-02～05：官方 SKR 外觀付款（docs/store/competition-development-plan.md §5）
  skrCatalog(): Promise<SkrCatalog> {
    return this.request('GET', '/me/skr/catalog');
  }
  skrCreateOrder(sku: string): Promise<{ order: SkrOrderView; created: boolean }> {
    return this.request('POST', '/me/skr/orders', { sku });
  }
  skrOrder(orderId: string): Promise<{ order: SkrOrderView }> {
    return this.request('GET', `/me/skr/orders/${encodeURIComponent(orderId)}`);
  }
  skrOrders(): Promise<{ orders: SkrOrderView[] }> {
    return this.request('GET', '/me/skr/orders');
  }
  skrConfirm(orderId: string, signature: string): Promise<{ order: SkrOrderView; found: boolean; verify: string | null }> {
    return this.request('POST', `/me/skr/orders/${encodeURIComponent(orderId)}/confirm`, { signature });
  }
  skrRecover(orderId: string): Promise<{ order: SkrOrderView; found: boolean; verify: string | null }> {
    return this.request('POST', `/me/skr/orders/${encodeURIComponent(orderId)}/recover`, {});
  }
  skrCancel(orderId: string): Promise<{ order: SkrOrderView }> {
    return this.request('POST', `/me/skr/orders/${encodeURIComponent(orderId)}/cancel`, {});
  }
  skrEntitlements(): Promise<{ entitlements: SkrEntitlementView[] }> {
    return this.request('GET', '/me/skr/entitlements');
  }

  /**
   * 公開目錄（未登入也能看「即將開始／進行中」）。
   *
   * `auth: false` 是必要的，不是最佳化：`requestRaw` 在 `auth !== false` 時會先取 access token，
   * **取不到就直接丟 `NO_SESSION`、連請求都不發**。少了它的話這個「公開」端點對未登入的人
   * 永遠失敗（2026-09-29 實機就是這樣：收藏頁顯示讀取失敗，而伺服器日誌裡一筆請求都沒有）。
   */
  seasonal(): Promise<{ items: SeasonalCampaignView[] }> {
    return this.request('GET', '/seasonal', undefined, { auth: false });
  }

  mySeasonal(): Promise<{ items: MySeasonalItem[]; notes: string[] }> {
    return this.request('GET', '/me/seasonal');
  }

  milestones(): Promise<Milestones> {
    return this.request('GET', '/me/milestones');
  }

  milestoneMintIntent(key: string, publicConsent: boolean): Promise<MintIntent> {
    return this.request('POST', '/me/milestones/mint-intent', { key, public_consent: publicConsent });
  }

  eventBadges(): Promise<{ rules_major: number; items: EventBadgeItem[] }> {
    return this.request('GET', '/me/event-badges');
  }

  eventBadgeMintIntent(eventId: string, kind: EventBadgeKind, publicConsent: boolean): Promise<MintIntent> {
    return this.request('POST', '/me/event-badges/mint-intent', { event_id: eventId, kind, public_consent: publicConsent });
  }

  /**
   * PG-SEASON-04：節日收藏領取意圖。後端 `mint_enabled` 關著時回 409 SEASONAL_MINT_NOT_OPEN——
   * 那個開關代表「鏈上程式已支援 seasonal 類別且已部署」，不是活動熱度。
   */
  seasonalMintIntent(campaignId: string, publicConsent: boolean): Promise<MintIntent> {
    return this.request('POST', `/me/seasonal/${encodeURIComponent(campaignId)}/intent`, { public_consent: publicConsent });
  }

  /** XD-03 成就護照（只讀彙整；不含健康數字／路線） */
  passport(): Promise<PassportResponse> {
    return this.request('GET', '/me/passport');
  }

  myAchievements(): Promise<{ items: AchievementView[] }> {
    return this.request('GET', '/me/achievements');
  }

  personalBests(): Promise<PersonalBests> {
    return this.request('GET', '/me/personal-bests');
  }

  /** PG-LINK-04：單筆伺服器摘要（只限本人；未知或無權 → 404） */
  workout(sessionId: string): Promise<WorkoutSummary> {
    return this.request('GET', `/me/workouts/${encodeURIComponent(sessionId)}`);
  }

  deleteWorkout(sessionId: string): Promise<unknown> {
    return this.requestRaw('DELETE', `/me/workouts/${encodeURIComponent(sessionId)}`);
  }

  // PG-E-08：成績榜、個人成績冊、公開同意
  eventResults(idOrSlug: string, q: { discipline?: string; division?: string } = {}): Promise<EventResults> {
    const qs = Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
    // 後端這條路由沒有掛 requireAuth（「公開成績榜」），所以這裡必須 auth: false——
    // 同 seasonal() 的理由：否則未登入看成績榜會拿到 NO_SESSION 且請求不會送出。
    return this.request('GET', `/events/${encodeURIComponent(idOrSlug)}/results${qs ? `?${qs}` : ''}`, undefined, { auth: false });
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

  async request<T>(method: string, path: string, body?: unknown, opts: RequestOpts = {}): Promise<T> {
    const r = await this.requestRaw(method, path, body, opts);
    return r.body as T;
  }

  private async requestRaw(method: string, path: string, body?: unknown, opts: RequestOpts = {}, retried = false): Promise<{ status: number; body: unknown }> {
    if (!this.configured) throw new ApiError(0, 'NOT_CONFIGURED', 'EXPO_PUBLIC_API_URL is not set for this build');
    const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth !== false) {
      const t = await this.ensureAccessToken(opts);
      if (!t) throw new ApiError(401, 'NO_SESSION', 'Sign in required');
      headers.authorization = `Bearer ${t.accessToken}`;
    }
    let res: Response;
    try {
      res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, opts);
    } catch (e) {
      // 實機 2026-09-22：公網路徑（Cloudflare → nginx → API）偶發單次 10～20 s 停頓、下一次 0.2 s。
      // GET 冪等：逾時就立刻再試一次（只重試一次、只限 GET、外部取消不重試），避免整頁因一次抖動顯示錯誤。
      const timedOut = e instanceof ApiError && e.netReason === 'timeout';
      if (timedOut && method === 'GET' && opts.retryOnTimeout !== false && !retried && !opts.signal?.aborted) {
        return this.requestRaw(method, path, body, { ...opts, retryOnTimeout: false }, true);
      }
      throw e;
    }
    const text = await res.text();
    const parsed: unknown = text ? safeJson(text) : null;
    if (res.ok) return { status: res.status, body: parsed };
    const err = (parsed as { error?: { code?: string; message?: string; rules_version?: number; request_id?: string } } | null)?.error;
    // access 過期／撤銷：refresh 一次後重試
    if (res.status === 401 && opts.auth !== false && !retried && (err?.code === 'UNAUTHORIZED' || err?.code === 'SESSION_REVOKED')) {
      const r = await this.refresh(opts);
      if (r.kind === 'ok') return this.requestRaw(method, path, body, opts, true);
      if (r.kind === 'transient') throw r.error; // 離線／伺服器錯誤：不是登入問題
      throw new ApiError(401, 'NO_SESSION', 'Sign in required'); // 憑證確實失效
    }
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `HTTP ${res.status}`, err?.rules_version, parsed, err?.request_id);
  }

  /** 取有效 access token；null＝沒有 session（需登入）；暫時性失敗會 throw，不會誤判成需登入 */
  private async ensureAccessToken(opts: RequestOpts = {}): Promise<Tokens | null> {
    const t = await readTokens();
    if (!t) return null;
    // 提前 30 秒續期
    if (t.accessExpiresAt - this.now() > 30_000) return t;
    const r = await this.refresh(opts);
    if (r.kind === 'ok') return r.tokens;
    if (r.kind === 'transient') throw r.error;
    return null;
  }

  /**
   * 單飛：同時多個請求只做一次 refresh。
   * review 5：只有後端明確回「憑證失效」才清 session；離線、逾時、429、5xx 都保留 token 回 transient。
   */
  private refresh(opts: RequestOpts = {}): Promise<RefreshResult> {
    this.refreshing ??= (async (): Promise<RefreshResult> => {
      try {
        const cur = await readTokens();
        if (!cur) return { kind: 'invalid' };
        let res: Response;
        try {
          res = await this.fetchWithTimeout(`${this.baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ refresh_token: cur.refreshToken }),
          }, opts);
        } catch (e) {
          return { kind: 'transient', error: e instanceof ApiError ? e : new ApiError(0, 'NETWORK_ERROR', e instanceof Error ? e.message : String(e)) };
        }
        if (res.ok) {
          const pair = (await res.json()) as TokenPair;
          const next: Tokens = { accessToken: pair.access_token, refreshToken: pair.refresh_token, accessExpiresAt: this.now() + pair.expires_in * 1000, wallet: pair.wallet };
          await writeTokens(next);
          return { kind: 'ok', tokens: next };
        }
        const text = await res.text();
        const err = (safeJson(text) as { error?: { code?: string; message?: string; request_id?: string } } | null)?.error;
        const code = err?.code ?? `HTTP_${res.status}`;
        const credentialInvalid = (res.status === 401 || res.status === 403) && (err?.code === undefined || REFRESH_INVALID_CODES.has(err.code));
        if (credentialInvalid) {
          await writeTokens(null);
          return { kind: 'invalid' };
        }
        // 429／5xx／其他：暫時失敗，token 保留
        const transientCode = res.status === 429 ? 'RATE_LIMITED' : res.status >= 500 ? 'SERVER_ERROR' : code;
        return { kind: 'transient', error: new ApiError(res.status, transientCode, err?.message ?? `HTTP ${res.status}`, undefined, undefined, err?.request_id) };
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
