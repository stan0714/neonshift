/**
 * 賽事服務（PG-A-15）：報名／領獎／退款走 MWA 簽鏈上交易；步數回報走後端 challenge 簽章；
 * 現況與排行榜由後端（讀鏈上）提供。冪等：報名以 entry PDA、領獎以 entry.settled 為準（SD 5.3）。
 */
import { randomUUID } from 'expo-crypto';
import { PublicKey } from '@solana/web3.js';

import { decodeTournamentEntry, fetchAccount, type TournamentEntry } from '@/chain/accounts';
import { claimPrizeInstruction, joinTournamentInstruction, refundAllInstruction } from '@/chain/instructions';
import { entryPda, tournamentPda } from '@/chain/program';
import { createAtaIdempotentInstruction } from '@/chain/txBuilder';
import { APP_CONFIG } from '@/config/app';
import { apiClient, type TournamentStepsResponse, type TournamentView } from '@/services/api/ApiClient';
import { requestHashOf, type Json } from '@/services/api/canonical';
import { accountExists, getConnection, sendWithWallet } from '@/services/chain/ChainClient';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { healthConnect } from '@/services/health/HealthConnectService';
import { WalletError } from '@/services/wallet/WalletService';

import { collectTournamentSteps } from './TournamentStepsCollector';

const mapError = (e: unknown): never => {
  if (e instanceof WalletError) {
    if (e.code === 'REJECTED') throw new ClaimError('REJECTED', e.message);
    if (e.code === 'NETWORK_ERROR') throw new ClaimError('NETWORK_ERROR', e.message);
  }
  throw new ClaimError('FAILED', e instanceof Error ? e.message : String(e));
};

export const tournamentService = {
  async entry(wallet: PublicKey, weekId: number): Promise<TournamentEntry | null> {
    if (!APP_CONFIG.chainConfigured) return null;
    return fetchAccount(getConnection(), entryPda(tournamentPda(weekId), wallet), decodeTournamentEntry);
  },

  /** 質押報名；已存在 entry 視為已報名 */
  async join(wallet: PublicKey, weekId: number, mint: PublicKey): Promise<{ signature: string | null; alreadyJoined: boolean }> {
    if (!APP_CONFIG.chainConfigured) throw new ClaimError('NOT_AVAILABLE', 'Onchain program is not configured for this build');
    const pda = entryPda(tournamentPda(weekId), wallet);
    try {
      if (await accountExists(pda)) return { signature: null, alreadyJoined: true };
      const sent = await sendWithWallet(wallet, [createAtaIdempotentInstruction(wallet, mint, wallet), joinTournamentInstruction(wallet, weekId, mint)]);
      return { signature: sent.signature, alreadyJoined: false };
    } catch (e) {
      if (await accountExists(pda).catch(() => false)) return { signature: null, alreadyJoined: true };
      return mapError(e);
    }
  },

  /** 已 Settled：領取退款＋獎金；已 Cancelled：全額退款 */
  async claim(wallet: PublicKey, weekId: number, mint: PublicKey, kind: 'prize' | 'refund'): Promise<{ signature: string | null; alreadySettled: boolean }> {
    if (!APP_CONFIG.chainConfigured) throw new ClaimError('NOT_AVAILABLE', 'Onchain program is not configured for this build');
    const settled = async () => (await this.entry(wallet, weekId))?.settled === true;
    try {
      if (await settled()) return { signature: null, alreadySettled: true };
      const ix = kind === 'prize' ? claimPrizeInstruction(wallet, weekId, mint) : refundAllInstruction(wallet, weekId, mint);
      const sent = await sendWithWallet(wallet, [createAtaIdempotentInstruction(wallet, mint, wallet), ix]);
      return { signature: sent.signature, alreadySettled: false };
    } catch (e) {
      if (await settled().catch(() => false)) return { signature: null, alreadySettled: true };
      return mapError(e);
    }
  },

  /** 讀窗內步數 → challenge 簽章 → POST /tournament/steps */
  async submitSteps(t: TournamentView, client: { appVersion: string; deviceModel: string; osApi: number; sdkExtension: number }, nowUnix = Math.floor(Date.now() / 1000)): Promise<TournamentStepsResponse> {
    const collected = await collectTournamentSteps(t.starts_at, t.ends_at, nowUnix, (s, e) => healthConnect.readStepsInWindow(s, e));
    const body: Record<string, Json> = {
      week_id: t.week_id,
      steps: collected.steps,
      reached_at: collected.reachedAt,
      data_origins: collected.dataOrigins,
      step_rate_summary: { bucket_minutes: 60, buckets: collected.buckets.map(([h, n]) => [h, n]) },
      client: { app_version: client.appVersion, device_model: client.deviceModel, os_api: client.osApi, sdk_extension: client.sdkExtension },
    };
    const claim_authorization = await apiClient.authorizeClaim('tournament_steps', requestHashOf(body), t.week_id, 1);
    return apiClient.tournamentSteps({ ...body, claim_authorization }, randomUUID());
  },
};

export const weekIdLabel = (weekId: number) => `${Math.floor(weekId / 100)} · W${String(weekId % 100).padStart(2, '0')}`;
