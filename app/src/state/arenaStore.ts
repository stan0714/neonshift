/** Arena 狀態（PG-A-15）：後端 current／leaderboard 快取、鏈上 entry、進行中的動作與結果。權威在鏈上與後端。 */
import type { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';

import type { TournamentEntry } from '@/chain/accounts';
import { ApiError, apiClient, type LeaderboardResponse, type TournamentCurrentResponse, type TournamentView } from '@/services/api/ApiClient';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { t as tr } from '@/i18n';
import { tournamentService } from '@/services/tournament/TournamentService';

export type ArenaAction = 'join' | 'steps' | 'claim' | 'refund';
export type ArenaOutcome = { kind: 'success'; action: ArenaAction; message: string } | { kind: 'error'; action: ArenaAction; code: string; message: string };

type State = {
  current: TournamentCurrentResponse | null;
  leaderboard: LeaderboardResponse | null;
  entry: TournamentEntry | null;
  loading: boolean;
  error: string | null;
  /** 後端 session 不存在（NO_SESSION）：顯示登入而非錯誤 */
  needsSignIn: boolean;
  busy: ArenaAction | null;
  outcome: ArenaOutcome | null;
  syncedAt: number | null;
  refresh: (wallet: PublicKey | null) => Promise<void>;
  signIn: (wallet: PublicKey) => Promise<void>;
  join: (wallet: PublicKey, mint: PublicKey) => Promise<void>;
  submitSteps: (client: { appVersion: string; deviceModel: string; osApi: number; sdkExtension: number }) => Promise<void>;
  claim: (wallet: PublicKey, mint: PublicKey, kind: 'prize' | 'refund') => Promise<void>;
  dismissOutcome: () => void;
};

const fail = (action: ArenaAction, e: unknown): ArenaOutcome => ({
  kind: 'error',
  action,
  code: e instanceof ClaimError ? e.code : e instanceof ApiError ? e.code : 'FAILED',
  message: e instanceof Error ? e.message : String(e),
});

export const useArenaStore = create<State>((set, get) => ({
  current: null,
  leaderboard: null,
  entry: null,
  loading: false,
  error: null,
  needsSignIn: false,
  busy: null,
  outcome: null,
  syncedAt: null,

  async signIn(wallet) {
    set({ loading: true });
    try {
      await apiClient.signIn(wallet.toBase58());
      set({ needsSignIn: false, error: null });
      await get().refresh(wallet);
    } catch (e) {
      set({ outcome: fail('join', e) });
    } finally {
      set({ loading: false });
    }
  },

  async refresh(wallet) {
    set({ loading: true });
    try {
      const current = await apiClient.tournamentCurrent();
      const t = current.tournament;
      const [leaderboard, entry] = await Promise.all([
        t && t.status !== 'draft' && t.status !== 'registration' ? apiClient.tournamentLeaderboard(t.week_id).catch(() => null) : Promise.resolve(null),
        t && wallet ? tournamentService.entry(wallet, t.week_id).catch(() => null) : Promise.resolve(null),
      ]);
      set({ current, leaderboard, entry, error: null, needsSignIn: false, syncedAt: Date.now() });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NO_SESSION') set({ needsSignIn: true, error: null });
      else set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ loading: false });
    }
  },

  async join(wallet, mint) {
    const t = get().current?.tournament;
    if (!t || get().busy) return;
    set({ busy: 'join', outcome: null });
    try {
      const r = await tournamentService.join(wallet, t.week_id, mint);
      set({ outcome: { kind: 'success', action: 'join', message: r.alreadyJoined ? tr('arena.msg.alreadyEntered') : tr('arena.msg.entered', { tx: r.signature?.slice(0, 8) ?? '' }) } });
      await get().refresh(wallet);
    } catch (e) {
      set({ outcome: fail('join', e) });
    } finally {
      set({ busy: null });
    }
  },

  async submitSteps(client) {
    const t = get().current?.tournament;
    if (!t || get().busy) return;
    set({ busy: 'steps', outcome: null });
    try {
      const r = await tournamentService.submitSteps(t, client);
      set({ outcome: { kind: 'success', action: 'steps', message: r.accepted ? tr('arena.msg.stepsAccepted', { n: r.verified_steps, rank: r.rank ?? '—' }) : tr('arena.msg.stepsSame', { n: r.verified_steps }) } });
      const cur = get().current;
      if (cur?.player) set({ current: { ...cur, player: { ...cur.player, verified_steps: r.verified_steps, rank: r.rank } } });
      const lb = await apiClient.tournamentLeaderboard(t.week_id).catch(() => null);
      if (lb) set({ leaderboard: lb });
    } catch (e) {
      set({ outcome: fail('steps', e) });
    } finally {
      set({ busy: null });
    }
  },

  async claim(wallet, mint, kind) {
    const t = get().current?.tournament;
    if (!t || get().busy) return;
    const action: ArenaAction = kind === 'prize' ? 'claim' : 'refund';
    set({ busy: action, outcome: null });
    try {
      const r = await tournamentService.claim(wallet, t.week_id, mint, kind);
      set({ outcome: { kind: 'success', action, message: r.alreadySettled ? tr('arena.msg.alreadyPaid') : tr(kind === 'prize' ? 'arena.msg.prizeSent' : 'arena.msg.refundSent', { tx: r.signature?.slice(0, 8) ?? '' }) } });
      await get().refresh(wallet);
    } catch (e) {
      set({ outcome: fail(action, e) });
    } finally {
      set({ busy: null });
    }
  },

  dismissOutcome: () => set({ outcome: null }),
}));

/** 顯示用估算（鏈上 tournament_math 才是權威）：最差情況損失 = 質押 × (1 − loser_refund_bps) */
export function worstCaseLoss(t: TournamentView): bigint {
  return (BigInt(t.stake_amount) * BigInt(10_000 - t.loser_refund_bps)) / 10_000n;
}
