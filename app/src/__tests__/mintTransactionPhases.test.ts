import { Keypair, SystemProgram } from '@solana/web3.js';
import { getConnection, getReadConnection, sendWithWallet } from '@/services/chain/ChainClient';
import { walletService } from '@/services/wallet/WalletService';

jest.mock('@/services/wallet/WalletService', () => ({ walletService: { signAndSendTransaction: jest.fn() } }));

afterEach(() => jest.restoreAllMocks());
/** 送出前多了一次餘額讀取，固定數兩拍 microtask 已不可靠；等事件迴圈清空，驗的仍是相同的先後順序 */
const flush = () => new Promise<void>((r) => setImmediate(() => r()));
test('confirming begins only after wallet returns a submitted transaction; success waits for chain', async () => {
  const payer = Keypair.generate().publicKey;
  jest.spyOn(getConnection(), 'getLatestBlockhashAndContext').mockResolvedValue({ context: { slot: 1 }, value: { blockhash: payer.toBase58(), lastValidBlockHeight: 10 } });
  jest.spyOn(getReadConnection(), 'getBalance').mockResolvedValue(1_000_000_000); // 送出前的 SOL 檢查（10/2，走讀取連線）：不打真網路
  let submitted!: (signature: string) => void;
  let confirmed!: (result: unknown) => void;
  (walletService.signAndSendTransaction as jest.Mock).mockReturnValue(new Promise(resolve => { submitted = resolve; }));
  jest.spyOn(getConnection(), 'confirmTransaction').mockImplementation(() => new Promise(resolve => { confirmed = resolve; }) as never);
  const phase = jest.fn();
  const sent = sendWithWallet(payer, [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })], phase);
  await flush();
  expect(phase.mock.calls).toEqual([['wallet']]);
  submitted('signature');
  await flush();
  expect(phase.mock.calls).toEqual([['wallet'], ['confirming']]);
  confirmed({ value: { err: null } });
  await expect(sent).resolves.toMatchObject({ signature: 'signature' });
});

test('wallet rejection never announces a submitted mint', async () => {
  const payer = Keypair.generate().publicKey;
  jest.spyOn(getConnection(), 'getLatestBlockhashAndContext').mockResolvedValue({ context: { slot: 1 }, value: { blockhash: payer.toBase58(), lastValidBlockHeight: 10 } });
  jest.spyOn(getReadConnection(), 'getBalance').mockResolvedValue(1_000_000_000); // 送出前的 SOL 檢查（10/2，走讀取連線）：不打真網路
  (walletService.signAndSendTransaction as jest.Mock).mockRejectedValue(new Error('Rejected'));
  const phase = jest.fn();
  await expect(sendWithWallet(payer, [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })], phase)).rejects.toThrow('Rejected');
  expect(phase.mock.calls).toEqual([['wallet']]);
});
