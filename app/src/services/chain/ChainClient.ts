/**
 * ChainClient（PG-A-10 起步）：送交易、確認、查帳戶。不負責 UI 狀態。
 * 冪等原則（SD 5.3）：送出前保存 signature／blockhash／lastValidBlockHeight；逾時先查目標帳戶，不盲目重送。
 */
import { Connection, PublicKey, Transaction, type TransactionInstruction } from '@solana/web3.js';

import { APP_CONFIG } from '@/config/app';
import { walletService } from '@/services/wallet/WalletService';

let connection: Connection | null = null;
export function getConnection(): Connection {
  connection ??= new Connection(APP_CONFIG.rpcUrl, 'confirmed');
  return connection;
}

export type SentTx = { signature: string; blockhash: string; lastValidBlockHeight: number };

export async function buildTransaction(feePayer: PublicKey, instructions: TransactionInstruction[]): Promise<{ tx: Transaction; blockhash: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await getConnection().getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(...instructions);
  return { tx, blockhash, lastValidBlockHeight };
}

/** 預估費用：簽章費 + 帳戶 rent（若有新帳戶） */
export async function estimateFeeLamports(feePayer: PublicKey, instructions: TransactionInstruction[], newAccountSpace = 0): Promise<number> {
  const { tx } = await buildTransaction(feePayer, instructions);
  const fee = (await getConnection().getFeeForMessage(tx.compileMessage(), 'confirmed')).value ?? 5_000;
  const rent = newAccountSpace > 0 ? await getConnection().getMinimumBalanceForRentExemption(newAccountSpace) : 0;
  return fee + rent;
}

/** 由錢包簽章送出並等待 confirmed；回傳可供冪等查詢的資訊 */
export async function sendWithWallet(feePayer: PublicKey, instructions: TransactionInstruction[]): Promise<SentTx> {
  const { tx, blockhash, lastValidBlockHeight } = await buildTransaction(feePayer, instructions);
  const signature = await walletService.signAndSendTransaction(tx);
  const result = await getConnection().confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  if (result.value.err) throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
  return { signature, blockhash, lastValidBlockHeight };
}

export async function accountExists(address: PublicKey): Promise<boolean> {
  const info = await getConnection().getAccountInfo(address, 'confirmed');
  return info !== null;
}
