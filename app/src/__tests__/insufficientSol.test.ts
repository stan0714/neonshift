/**
 * 2026-10-02：送交易前的 SOL 餘額檢查（A-4 ⑨）。
 * 在這之前只有 SKR 付款有這道檢查。0 SOL 的錢包去領起始鞋、打卡或鑄造成就，會先開錢包、
 * 簽完才失敗，畫面只說「Something interrupted your shift」——使用者不知道是缺 SOL。
 */
import { Connection, PublicKey } from '@solana/web3.js';

const mockSign = jest.fn();
jest.mock('@/services/wallet/WalletService', () => ({
  ...jest.requireActual('@/services/wallet/WalletService'),
  walletService: { signAndSendTransaction: (...a: unknown[]) => mockSign(...a) },
}));
const mockAccountExists = jest.fn(async () => false);
jest.mock('@/services/chain/ChainClient', () => ({
  ...jest.requireActual('@/services/chain/ChainClient'),
  accountExists: () => mockAccountExists(),
}));
jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true } }));

import { PLAYER_PROFILE_SPACE } from '@/chain/program';
import { assertCanPayFee, InsufficientSolError, isInsufficientSol, MIN_FEE_LAMPORTS } from '@/services/chain/ChainClient';
import { ClaimSubmitter } from '@/services/chain/ClaimSubmitter';
import { starterShoeService } from '@/services/chain/StarterShoeService';

const payer = PublicKey.unique();
const balanceConn = (lamports: number | Error) => () => ({ getBalance: jest.fn(async () => { if (lamports instanceof Error) throw lamports; return lamports; }) }) as never;

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('assertCanPayFee', () => {
  test('付不出簽章費 → InsufficientSolError（code INSUFFICIENT_SOL），帶著有多少、要多少', async () => {
    const err = await assertCanPayFee(payer, MIN_FEE_LAMPORTS, balanceConn(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InsufficientSolError);
    expect(err).toMatchObject({ code: 'INSUFFICIENT_SOL', haveLamports: 0, needLamports: MIN_FEE_LAMPORTS });
  });
  test('付得起 → 放行', async () => {
    await expect(assertCanPayFee(payer, MIN_FEE_LAMPORTS, balanceConn(MIN_FEE_LAMPORTS))).resolves.toBeUndefined();
  });
  test('讀不到餘額 → 放行：這道檢查不能新增一種原本不存在的失敗', async () => {
    await expect(assertCanPayFee(payer, MIN_FEE_LAMPORTS, balanceConn(new Error('could not find account')))).resolves.toBeUndefined();
  });
});

describe('isInsufficientSol：只認錢包／節點的固定說法', () => {
  test.each([
    'Attempt to debit an account but found no record of a prior credit.',
    'Transfer: insufficient lamports 100, need 2039280',
    'Transaction simulation failed: InsufficientFundsForRent { account_index: 0 }',
  ])('認得：%s', (m) => expect(isInsufficientSol(new Error(m))).toBe(true));
  test.each(['Transaction failed: {"InstructionError":[0,{"Custom":1}]}', 'boom'])('不猜：%s', (m) => expect(isInsufficientSol(new Error(m))).toBe(false));
});

test('每日打卡：付不出網路費 → 不開錢包，ClaimFlow 收到 code INSUFFICIENT_SOL', async () => {
  const send = jest.fn();
  const conn = () => ({ getAccountInfo: jest.fn(async () => null), getBalance: jest.fn(async () => 0) }) as never;
  const s = new ClaimSubmitter(conn, send);
  await expect(s.submit(payer, [], PublicKey.unique(), { taskDate: 1, taskType: 1 })).rejects.toMatchObject({ code: 'INSUFFICIENT_SOL' });
  expect(send).not.toHaveBeenCalled();
});

/** devnet 10/2 實測：85 bytes 的 profile rent 免除門檻（本機照主網費率會算成 1,482,480） */
const DEVNET_PROFILE_RENT = 1_082_040;
const stubSend = () => {
  jest.spyOn(Connection.prototype, 'getLatestBlockhashAndContext').mockResolvedValue({ context: { slot: 1 }, value: { blockhash: PublicKey.unique().toBase58(), lastValidBlockHeight: 10 } } as never);
  jest.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({ context: { slot: 2 }, value: { err: null } } as never);
  mockSign.mockResolvedValue('sig');
};

test('起始鞋：門檻是簽章費＋鏈上回報的 profile rent；少 1 lamport 就擋，而且不開錢包', async () => {
  jest.spyOn(Connection.prototype, 'getMinimumBalanceForRentExemption').mockResolvedValue(DEVNET_PROFILE_RENT);
  jest.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(MIN_FEE_LAMPORTS + DEVNET_PROFILE_RENT - 1);
  await expect(starterShoeService.claim(payer)).rejects.toMatchObject({ name: 'ClaimError', code: 'INSUFFICIENT_SOL' });
  expect(mockSign).not.toHaveBeenCalled();
});

/**
 * 2026-10-02 RC v15 驗收抓到的誤擋：門檻原本用主網費率在本機算（多算 37%），
 * 餘額剛好夠付 devnet 實際 rent＋手續費的錢包，會被說成 SOL 不足。
 */
test('起始鞋：餘額剛好等於鏈上門檻 → 放行去開錢包（不得誤擋）', async () => {
  jest.spyOn(Connection.prototype, 'getMinimumBalanceForRentExemption').mockResolvedValue(DEVNET_PROFILE_RENT);
  jest.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(MIN_FEE_LAMPORTS + DEVNET_PROFILE_RENT);
  stubSend();
  await expect(starterShoeService.claim(payer)).resolves.toMatchObject({ signature: 'sig', alreadyClaimed: false });
  expect(mockSign).toHaveBeenCalledTimes(1);
});

test('起始鞋：查不到 rent → 只檢查簽章費，不因查詢失敗擋人', async () => {
  jest.spyOn(Connection.prototype, 'getMinimumBalanceForRentExemption').mockRejectedValue(new Error('could not find account'));
  jest.spyOn(Connection.prototype, 'getBalance').mockResolvedValue(MIN_FEE_LAMPORTS);
  stubSend();
  await expect(starterShoeService.claim(payer)).resolves.toMatchObject({ signature: 'sig' });
});
