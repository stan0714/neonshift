import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { decodeTournamentEntry } from '@/chain/accounts';
import { claimPrizeInstruction, joinTournamentInstruction, refundAllInstruction } from '@/chain/instructions';
import { discriminator, entryPda, tournamentPda, tournamentVaultPda } from '@/chain/program';
import { associatedTokenAddress } from '@/chain/txBuilder';
import { collectTournamentSteps } from '@/services/tournament/TournamentStepsCollector';

jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true } }));

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const mint = PublicKey.unique();

describe('chain：錦標賽指令（帳戶順序與 tournament.rs／settlement.rs 一致）', () => {
  test('join_tournament', () => {
    const ix = joinTournamentInstruction(wallet, 2026_38, mint);
    const t = tournamentPda(2026_38);
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([wallet, expect.anything(), t, entryPda(t, wallet), tournamentVaultPda(t), associatedTokenAddress(mint, wallet), expect.anything(), expect.anything()].map((k) => (k instanceof PublicKey ? k.toBase58() : k)));
    expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[true, true], [false, false], [false, true], [false, true], [false, true], [false, true], [false, false], [false, false]]);
    expect(ix.data).toEqual(discriminator('join_tournament'));
  });
  test('claim_prize／refund_all 共用帳戶，只差 discriminator', () => {
    const a = claimPrizeInstruction(wallet, 2026_38, mint);
    const b = refundAllInstruction(wallet, 2026_38, mint);
    expect(a.keys.map((k) => k.pubkey.toBase58())).toEqual(b.keys.map((k) => k.pubkey.toBase58()));
    expect(a.keys).toHaveLength(7);
    expect(a.data).toEqual(discriminator('claim_prize'));
    expect(b.data).toEqual(discriminator('refund_all'));
  });
  test('decodeTournamentEntry', () => {
    const buf = Buffer.alloc(8 + 64 + 8 + 8 + 4 + 3 + 32 + 8 + 1);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 72;
    dv.setBigUint64(o, BigInt(50_000_000), true); o += 8;
    dv.setBigUint64(o, BigInt(12_000), true); o += 8;
    buf.writeUInt32LE(2, o); o += 4;
    buf[o++] = 2; buf[o++] = 0; buf[o++] = 1;
    o += 32;
    dv.setBigInt64(o, BigInt(1_789_000_000), true);
    expect(decodeTournamentEntry(new Uint8Array(buf))).toEqual({ stake: BigInt(50_000_000), finalSteps: BigInt(12_000), rank: 2, group: 2, forfeited: false, settled: true, joinedAt: 1_789_000_000 });
  });
});

describe('TournamentStepsCollector（窗口逐日讀取 → 每小時桶）', () => {
  const T0 = 1_789_000_000;
  const result = (buckets: [number, number][], pkg = 'android', kind = 'android_legacy') => ({
    total: buckets.reduce((n, b) => n + b[1], 0),
    dataOrigins: [{ package: pkg, sourceKind: kind as never, steps: buckets.reduce((n, b) => n + b[1], 0), records: buckets.length }],
    stepRateSummary: { bucketMinutes: 1 as const, buckets, observedMinutes: buckets.length, maxStepsPerMinute: 0 },
    deviceSpn: null,
  });

  test('48 小時窗分兩次讀；分鐘桶折成自 starts_at 起的小時桶；來源合併；reached_at = 最後有步數的分鐘', async () => {
    const calls: [number, number][] = [];
    const read = jest.fn(async (s: number, e: number) => {
      calls.push([s, e]);
      return s === T0 ? result([[0, 100], [61, 50], [1439, 7]]) : result([[5, 20]]);
    });
    const c = await collectTournamentSteps(T0, T0 + 2 * 86_400, T0 + 2 * 86_400 + 999, read);
    expect(calls).toEqual([[T0, T0 + 86_400], [T0 + 86_400, T0 + 2 * 86_400]]);
    expect(c.buckets).toEqual([[0, 100], [1, 50], [23, 7], [24, 20]]);
    expect(c.steps).toBe(177);
    expect(c.dataOrigins).toEqual([{ package: 'android', source_kind: 'android_legacy', steps: 177, records: 4 }]);
    expect(c.reachedAt).toBe(T0 + 86_400 + 5 * 60 + 60);
  });

  test('進行中只讀到現在；沒有步數時 reached_at = starts_at', async () => {
    const now = T0 + 3 * 3600;
    const read = jest.fn(async () => result([]));
    const c = await collectTournamentSteps(T0, T0 + 2 * 86_400, now, read);
    expect(read).toHaveBeenCalledWith(T0, now);
    expect(c).toMatchObject({ steps: 0, reachedAt: T0, buckets: [] });
  });
});
