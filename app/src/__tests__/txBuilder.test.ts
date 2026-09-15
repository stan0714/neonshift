import { PublicKey, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js';
import { Buffer } from 'buffer';

import { decodeAttestation, encodeAttestationArgs } from '@/chain/attestation';
import { claimPda, discriminator } from '@/chain/program';
import { associatedTokenAddress, buildClaimInstructions, ED25519_PROGRAM_ID, ed25519Instruction } from '@/chain/txBuilder';

import vectors from '../../../backend/src/lib/attestation-vectors.json';

const PID = '5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf';
jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '5vTs2vGPuADyCLtxkXpWQpuK25XoTihJ41drGKmfBjAf', chainConfigured: true } }));

type Vec = { name: string; fields: Record<string, string | number>; expected_hex: string };
const vec = (vectors as { vectors: Vec[] }).vectors;

describe('PG-A-09 TxBuilder', () => {
  test('attestation 解析與 PG-B-10 向量對得起來（20 組）', () => {
    for (const v of vec) {
      const bytes = new Uint8Array(Buffer.from(v.expected_hex, 'hex'));
      const f = decodeAttestation(bytes);
      expect(f.taskDate).toBe(v.fields.task_date);
      expect(f.taskType).toBe(v.fields.task_type);
      expect(f.rulesVersion).toBe(v.fields.rules_version);
      expect(f.issuedAt).toBe(BigInt(v.fields.issued_at as string));
      expect(f.expiry).toBe(BigInt(v.fields.expiry as string));
      expect(Buffer.from(f.nonce).toString('hex')).toBe(v.fields.nonce);
      // Borsh 參數 = canonical bytes 去掉 domain（同順序、同 LE），長度 145
      const args = encodeAttestationArgs(f);
      expect(args).toHaveLength(145);
      expect(Buffer.from(args).equals(Buffer.from(bytes.subarray(19)))).toBe(true);
    }
  });

  test('ed25519 指令：單簽、offsets 自我引用（0xFFFF）、message 164 bytes、與 Rust 解析器同佈局', () => {
    const msg = new Uint8Array(Buffer.from(vec[0]!.expected_hex, 'hex'));
    const ix = ed25519Instruction(msg, new Uint8Array(64).fill(3), new Uint8Array(32).fill(4));
    expect(ix.programId.equals(ED25519_PROGRAM_ID)).toBe(true);
    expect(ix.keys).toEqual([]);
    const d = ix.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    expect(d[0]).toBe(1);
    expect([dv.getUint16(2, true), dv.getUint16(4, true), dv.getUint16(6, true), dv.getUint16(8, true), dv.getUint16(10, true), dv.getUint16(12, true), dv.getUint16(14, true)]).toEqual([48, 0xffff, 16, 0xffff, 112, 164, 0xffff]);
    expect(Buffer.from(d.subarray(16, 48))).toEqual(Buffer.alloc(32, 4));
    expect(Buffer.from(d.subarray(48, 112))).toEqual(Buffer.alloc(64, 3));
    expect(Buffer.from(d.subarray(112))).toEqual(Buffer.from(msg));
    expect(() => ed25519Instruction(msg.subarray(1), new Uint8Array(64), new Uint8Array(32))).toThrow(/164/);
  });

  test('buildClaimInstructions：順序 [ATA, ed25519, clock_in]、帳戶順序與程式一致、交易大小在上限內', () => {
    const wallet = PublicKey.unique();
    // 以向量為底，改 wallet／program 為本測試值
    const f = decodeAttestation(new Uint8Array(Buffer.from(vec[0]!.expected_hex, 'hex')));
    f.wallet = wallet;
    f.programId = new PublicKey(PID);
    const args = encodeAttestationArgs(f);
    const message = new Uint8Array(164);
    message.set(new TextEncoder().encode('NEONSHIFT_ATTEST_V1'), 0);
    message.set(args, 19);
    const mint = PublicKey.unique();
    const rewardVault = PublicKey.unique();
    const { instructions, receipt, fields } = buildClaimInstructions({
      player: wallet,
      attestation: { message_b64: Buffer.from(message).toString('base64'), signature_b64: Buffer.alloc(64, 1).toString('base64'), attestor_pubkey_bytes: new Uint8Array(32).fill(9) },
      accts: { mint, rewardVault },
    });
    expect(instructions).toHaveLength(3);
    expect(instructions[1]!.programId.equals(ED25519_PROGRAM_ID)).toBe(true);
    const ci = instructions[2]!;
    expect(ci.data.subarray(0, 8)).toEqual(discriminator('clock_in'));
    expect(ci.keys.map((k) => k.pubkey.toBase58())).toEqual([
      wallet.toBase58(),
      PublicKey.findProgramAddressSync([Buffer.from('config')], new PublicKey(PID))[0].toBase58(),
      PublicKey.findProgramAddressSync([Buffer.from('player'), wallet.toBytes()], new PublicKey(PID))[0].toBase58(),
      claimPda(wallet, fields.taskDate, fields.taskType).toBase58(),
      mint.toBase58(),
      rewardVault.toBase58(),
      associatedTokenAddress(mint, wallet).toBase58(),
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      '11111111111111111111111111111111',
      SYSVAR_INSTRUCTIONS_PUBKEY.toBase58(),
    ]);
    expect(ci.keys[0]).toMatchObject({ isSigner: true, isWritable: true });
    expect(receipt.equals(claimPda(wallet, fields.taskDate, fields.taskType))).toBe(true);
    // 粗估交易大小：header ~ 65 + 10 帳戶*32 + ed25519 data 276 + clock_in 153 + ATA 1 < 1232
    const dataBytes = instructions.reduce((n, i) => n + i.data.length, 0);
    expect(dataBytes + 12 * 32 + 128).toBeLessThan(1232);
  });

  test('錢包或 program id 不符即拒絕組裝', () => {
    const f = decodeAttestation(new Uint8Array(Buffer.from(vec[0]!.expected_hex, 'hex')));
    const message = new Uint8Array(Buffer.from(vec[0]!.expected_hex, 'hex'));
    expect(() =>
      buildClaimInstructions({ player: PublicKey.unique(), attestation: { message_b64: Buffer.from(message).toString('base64'), signature_b64: Buffer.alloc(64).toString('base64'), attestor_pubkey_bytes: new Uint8Array(32) }, accts: { mint: PublicKey.unique(), rewardVault: PublicKey.unique() } }),
    ).toThrow(/wallet/);
    expect(f.programId.toBase58()).not.toBe(PID);
  });

  test('PG-V-02 前置：舊帳戶 → [migrate_player, ATA, ed25519, clock_in]；落後 > 8 期 → [settle_player_epochs(64), …]；落後 ≤ 8 期不加', () => {
    const wallet = PublicKey.unique();
    const f = decodeAttestation(new Uint8Array(Buffer.from(vec[0]!.expected_hex, 'hex')));
    f.wallet = wallet;
    f.programId = new PublicKey(PID);
    const message = new Uint8Array(164);
    message.set(new TextEncoder().encode('NEONSHIFT_ATTEST_V1'), 0);
    message.set(encodeAttestationArgs(f), 19);
    const base = { player: wallet, attestation: { message_b64: Buffer.from(message).toString('base64'), signature_b64: Buffer.alloc(64, 1).toString('base64'), attestor_pubkey_bytes: new Uint8Array(32).fill(9) }, accts: { mint: PublicKey.unique(), rewardVault: PublicKey.unique() } };
    const mig = buildClaimInstructions({ ...base, maintenance: { migrate: true, pendingEpochs: 0 } }).instructions;
    expect(mig).toHaveLength(4);
    expect(mig[0]!.data).toEqual(discriminator('migrate_player'));
    expect(mig[0]!.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([[wallet.toBase58(), true, true], [PublicKey.findProgramAddressSync([Buffer.from('player'), wallet.toBytes()], new PublicKey(PID))[0].toBase58(), false, true], ['11111111111111111111111111111111', false, false]]);
    const settle = buildClaimInstructions({ ...base, maintenance: { migrate: false, pendingEpochs: 9 } }).instructions;
    expect(settle).toHaveLength(4);
    expect(settle[0]!.data).toEqual(Buffer.concat([discriminator('settle_player_epochs'), Buffer.from([64])]));
    expect(settle[0]!.keys[1]!.pubkey.toBase58()).toBe(PublicKey.findProgramAddressSync([Buffer.from('config')], new PublicKey(PID))[0].toBase58());
    expect(buildClaimInstructions({ ...base, maintenance: { migrate: false, pendingEpochs: 8 } }).instructions).toHaveLength(3);
  });
});
