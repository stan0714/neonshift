/**
 * SKR 付款交易的 SPL 指令（不引入 @solana/spl-token，手組指令；SKR-03）。
 * - 關聯代幣帳戶（ATA）：PDA(owner, TOKEN_PROGRAM, mint) under ASSOCIATED_TOKEN_PROGRAM。
 * - `createAssociatedTokenAccountIdempotent`（data [1]）：收款 ATA 若已存在則 no-op；付款人付租金（後端建議先建好）。
 * - `transferChecked`（data [12, amount u64 LE, decimals u8]）：mint 與 decimals 由伺服器訂單給定並經核對，鏈上再驗一次。
 * - 訂單 reference 以唯讀、非簽名帳戶附在 transfer 指令上，供伺服器以 signature／reference 反查（Solana Pay 慣例）。
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID);
  return pda;
}

export function createAtaIdempotentInstruction(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  const ata = associatedTokenAddress(owner, mint);
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export function transferCheckedInstruction(args: { source: PublicKey; mint: PublicKey; destination: PublicKey; owner: PublicKey; amount: bigint; decimals: number; reference?: PublicKey }): TransactionInstruction {
  if (args.amount <= 0n || args.amount > 0xffff_ffff_ffff_ffffn) throw new Error('amount out of range');
  if (!Number.isInteger(args.decimals) || args.decimals < 0 || args.decimals > 255) throw new Error('decimals out of range');
  const data = Buffer.alloc(10);
  data[0] = 12; // TransferChecked
  let v = args.amount;
  for (let i = 1; i <= 8; i++) { data[i] = Number(v & 0xffn); v >>= 8n; } // u64 LE（RN 的 buffer polyfill 沒有 writeBigUInt64LE）
  data[9] = args.decimals;
  const keys = [
    { pubkey: args.source, isSigner: false, isWritable: true },
    { pubkey: args.mint, isSigner: false, isWritable: false },
    { pubkey: args.destination, isSigner: false, isWritable: true },
    { pubkey: args.owner, isSigner: true, isWritable: false },
  ];
  if (args.reference) keys.push({ pubkey: args.reference, isSigner: false, isWritable: false });
  return new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys, data });
}

/** 付款交易：收款 ATA idempotent 建立 ＋ transferChecked（含 reference）；順序固定 */
export function paymentInstructions(args: { payer: PublicKey; mint: PublicKey; recipient: PublicKey; recipientTokenAccount: PublicKey; amount: bigint; decimals: number; reference: PublicKey }): TransactionInstruction[] {
  const expected = associatedTokenAddress(args.recipient, args.mint);
  if (!expected.equals(args.recipientTokenAccount)) throw new Error('recipient token account is not the recipient ATA');
  return [
    createAtaIdempotentInstruction(args.payer, args.recipient, args.mint),
    transferCheckedInstruction({ source: associatedTokenAddress(args.payer, args.mint), mint: args.mint, destination: args.recipientTokenAccount, owner: args.payer, amount: args.amount, decimals: args.decimals, reference: args.reference }),
  ];
}
