import { Keypair, SystemProgram } from '@solana/web3.js';
import { getConnection, sendWithWallet } from '@/services/chain/ChainClient';
import { walletService } from '@/services/wallet/WalletService';

jest.mock('@/services/wallet/WalletService', () => ({ walletService: { signAndSendTransaction: jest.fn() } }));

afterEach(() => jest.restoreAllMocks());
test('confirming begins only after wallet returns a submitted transaction; success waits for chain', async () => {
  const payer = Keypair.generate().publicKey;
  jest.spyOn(getConnection(), 'getLatestBlockhashAndContext').mockResolvedValue({ context: { slot: 1 }, value: { blockhash: payer.toBase58(), lastValidBlockHeight: 10 } });
  let submitted!: (signature: string) => void;
  let confirmed!: (result: unknown) => void;
  (walletService.signAndSendTransaction as jest.Mock).mockReturnValue(new Promise(resolve => { submitted = resolve; }));
  jest.spyOn(getConnection(), 'confirmTransaction').mockImplementation(() => new Promise(resolve => { confirmed = resolve; }) as never);
  const phase = jest.fn();
  const sent = sendWithWallet(payer, [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })], phase);
  await Promise.resolve(); await Promise.resolve();
  expect(phase.mock.calls).toEqual([['wallet']]);
  submitted('signature');
  await Promise.resolve(); await Promise.resolve();
  expect(phase.mock.calls).toEqual([['wallet'], ['confirming']]);
  confirmed({ value: { err: null } });
  await expect(sent).resolves.toMatchObject({ signature: 'signature' });
});

test('wallet rejection never announces a submitted mint', async () => {
  const payer = Keypair.generate().publicKey;
  jest.spyOn(getConnection(), 'getLatestBlockhashAndContext').mockResolvedValue({ context: { slot: 1 }, value: { blockhash: payer.toBase58(), lastValidBlockHeight: 10 } });
  (walletService.signAndSendTransaction as jest.Mock).mockRejectedValue(new Error('Rejected'));
  const phase = jest.fn();
  await expect(sendWithWallet(payer, [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 })], phase)).rejects.toThrow('Rejected');
  expect(phase.mock.calls).toEqual([['wallet']]);
});
