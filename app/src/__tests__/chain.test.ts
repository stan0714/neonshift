import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { initPlayerInstruction } from '@/chain/instructions';
import { claimPda, configPda, discriminator, playerPda, PLAYER_PROFILE_SPACE } from '@/chain/program';

// 這些測試以 dev 建置的 program id 為準；程式端 PDA seeds 見 SD 3.1
jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf', chainConfigured: true } }));

describe('chain/program（IDL 與 PDA）', () => {
  const pid = new PublicKey('5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf');
  const wallet = PublicKey.unique();

  test('discriminator 直接取自 IDL', () => {
    expect(discriminator('init_player')).toHaveLength(8);
    expect(discriminator('clock_in')).toHaveLength(8);
    expect(() => discriminator('mint_shoe')).toThrow(/IDL 沒有指令/);
  });

  test('PDA 與 Rust seeds 一致', () => {
    expect(configPda().equals(PublicKey.findProgramAddressSync([Buffer.from('config')], pid)[0])).toBe(true);
    expect(playerPda(wallet).equals(PublicKey.findProgramAddressSync([Buffer.from('player'), wallet.toBytes()], pid)[0])).toBe(true);
    const date = Buffer.alloc(4);
    date.writeUInt32LE(20_710, 0);
    expect(claimPda(wallet, 20_710, 1).equals(PublicKey.findProgramAddressSync([Buffer.from('claim'), wallet.toBytes(), date, Buffer.from([1])], pid)[0])).toBe(true);
  });

  test('init_player 指令帳戶順序：player(signer,mut)、config、profile(mut)、system', () => {
    const ix = initPlayerInstruction(wallet);
    expect(ix.programId.equals(pid)).toBe(true);
    expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[true, true], [false, false], [false, true], [false, false]]);
    expect(ix.keys[0]!.pubkey.equals(wallet)).toBe(true);
    expect(ix.data).toEqual(discriminator('init_player'));
    expect(PLAYER_PROFILE_SPACE).toBe(85);
  });
});

describe('chain/accounts（PlayerProfile 佈局，與 state.rs 一致）', () => {
  test('decodePlayerProfile 含 max_streak_days', () => {
    const { decodePlayerProfile } = require('@/chain/accounts') as typeof import('@/chain/accounts');
    const wallet = PublicKey.unique();
    const buf = Buffer.alloc(PLAYER_PROFILE_SPACE);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let o = 8;
    wallet.toBuffer().copy(buf, o);
    o += 32;
    buf.writeUInt8(2, o++); // core_level
    buf.writeUInt8(3, o++); // shoe_level
    dv.setBigUint64(o, BigInt(1500), true); // xp
    o += 8;
    buf.writeUInt32LE(20710, o); // last_task_date
    o += 4;
    buf.writeUInt16LE(4, o); // streak_days
    o += 2;
    buf.writeUInt16LE(9, o); // max_streak_days
    o += 2;
    dv.setBigUint64(o, BigInt(12_000_000), true); // claimed_today
    o += 8;
    buf.writeUInt32LE(20710, o); // today_date
    o += 4;
    buf.writeUInt8(255, o++); // bump
    // PG-V-02 欄位
    buf.writeUInt8(4, o++); // highest_level
    buf.writeUInt32LE(20700, o); // epoch_anchor
    o += 4;
    buf.writeUInt32LE(1, o); // last_settled_epoch
    o += 4;
    buf.writeUInt16LE(250, o); // epoch_points
    o += 2;
    buf.writeUInt8(0b101, o++); // epoch_bitmap
    buf.writeUInt16LE(1, o); // rules_version
    const p = decodePlayerProfile(new Uint8Array(buf), PublicKey);
    expect(p.wallet.equals(wallet)).toBe(true);
    expect([p.coreLevel, p.shoeLevel, p.xp, p.lastTaskDate, p.streakDays, p.maxStreakDays, p.claimedToday, p.todayDate]).toEqual([2, 3, BigInt(1500), 20710, 4, 9, BigInt(12_000_000), 20710]);
    expect([p.migrated, p.highestLevel, p.epochAnchor, p.lastSettledEpoch, p.epochPoints, p.epochBitmap, p.maintenanceRulesVersion]).toEqual([true, 4, 20700, 1, 250, 0b101, 1]);
    // 舊版 71 bytes：migrated=false、highest＝max(levels)、其餘預設
    const old = decodePlayerProfile(new Uint8Array(buf.subarray(0, 71)), PublicKey);
    expect([old.migrated, old.highestLevel, old.epochAnchor, old.lastSettledEpoch]).toEqual([false, 3, 0, 0]);
    // maintenanceNeeds：舊帳戶 → migrate；anchor 20700、today 20770 → 第 10 期、已結算 1 → 落後 9
    const { maintenanceNeeds } = require('@/chain/accounts') as typeof import('@/chain/accounts');
    expect(maintenanceNeeds(old, 20770)).toEqual({ migrate: true, pendingEpochs: 0 });
    expect(maintenanceNeeds(p, 20770)).toEqual({ migrate: false, pendingEpochs: 9 });
    expect(maintenanceNeeds(p, 20710)).toEqual({ migrate: false, pendingEpochs: 0 });
    expect(maintenanceNeeds(null, 20710)).toEqual({ migrate: false, pendingEpochs: 0 });
  });
});
