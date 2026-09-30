/**
 * SKR-07（App 端）：SPL 指令位元組與 ATA 一致性、購買狀態機（目錄／訂單核對、餘額不足、錢包取消／不回覆、RPC 未見 → confirming 不重付、
 * 履約、needs_review、逾期、既有 confirming 訂單不重付）、pending 持久化與復原、Genesis 卡片各狀態與邊框套用。
 */
import { PublicKey, Transaction } from '@solana/web3.js';
import * as SecureStore from 'expo-secure-store';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { GenesisFrameCard } from '@/components/GenesisFrameCard';
import { OFFICIAL_SKR_MINT } from '@/config/app';
import type { SkrCatalog, SkrOrderView } from '@/services/api/ApiClient';
import { ApiError } from '@/services/api/ApiClient';
import { associatedTokenAddress, paymentInstructions, transferCheckedInstruction, TOKEN_PROGRAM_ID } from '@/services/skr/spl';
import { skrService, SkrPayError, assertCatalogTrusted, solNeeded, ATA_RENT_LAMPORTS, FEE_LAMPORTS, type SkrPaymentAttempt } from '@/services/skr/SkrService';
import { WalletError } from '@/services/wallet/WalletService';
import { genesisFrameActive, openAttemptFor, ownsGenesisFrame, pendingOrderFor, useSkrStore } from '@/state/skrStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

jest.mock('@/hooks/useOnline', () => ({ useOnline: jest.fn(() => true) }));

jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { skrCatalog: jest.fn(), skrCreateOrder: jest.fn(), skrConfirm: jest.fn(), skrRecover: jest.fn(), skrCancel: jest.fn(), skrOrders: jest.fn(), skrEntitlements: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'skrCatalog' | 'skrCreateOrder' | 'skrConfirm' | 'skrRecover' | 'skrCancel' | 'skrOrders', jest.Mock>;

const wallet = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
const recipient = PublicKey.unique();
const mint = new PublicKey(OFFICIAL_SKR_MINT);
const reference = PublicKey.unique();
const order = (o: Partial<SkrOrderView> = {}): SkrOrderView => ({ order_id: '11111111-1111-4111-8111-111111111111', sku: 'genesis_mint_frame', sku_version: 1, cosmetic_id: 'skr_genesis_mint_frame_v1', network: 'mainnet-beta', mint: OFFICIAL_SKR_MINT, decimals: 6, amount_base_units: '2500000', amount_display: '2.5', recipient: recipient.toBase58(), recipient_token_account: associatedTokenAddress(recipient, mint).toBase58(), reference: reference.toBase58(), status: 'awaiting_payment', signature: null, paid_amount_base_units: null, paid_at: null, failure_reason: null, expires_at: new Date(Date.now() + 600_000).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...o });
const catalog = (over: Record<string, unknown> = {}, sku: Record<string, unknown> = {}): SkrCatalog => ({ enabled: true, network: 'mainnet-beta', mint: OFFICIAL_SKR_MINT, decimals: 6, recipient: recipient.toBase58(), recipient_token_account: associatedTokenAddress(recipient, mint).toBase58(), order_ttl_sec: 900, entitlements: [], skus: [{ sku: 'genesis_mint_frame', version: 1, cosmetic_id: 'skr_genesis_mint_frame_v1', requires: { kind: 'milestone', category: 'first_5k' }, price_base_units: '2500000', price_display: '2.5', eligibility: 'eligible', achievement_id: 'a1', owned: false, open_order: null, ...sku }], ...over } as SkrCatalog);
const balancesOk = async () => ({ skr: 3_000_000n, sol: 10_000_000, payerAtaExists: true, recipientAtaExists: true });
const conn = () => ({ getLatestBlockhashAndContext: async () => ({ context: { slot: 42 }, value: { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 100 } }) }) as never;
const noSleep = async () => {};
/** 交易有效期到 lastValidBlockHeight=100；height 決定「原交易是否還可能落地」 */
const connAt = (height: number, opts: { throws?: boolean } = {}) => () => ({
  getLatestBlockhashAndContext: async () => ({ context: { slot: 42 }, value: { blockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi', lastValidBlockHeight: 100 } }),
  getBlockHeight: async () => { if (opts.throws) throw new Error('rpc unavailable'); return height; },
}) as never;
const attemptFor = (over: Partial<SkrPaymentAttempt> = {}): SkrPaymentAttempt => ({ orderId: order().order_id, network: 'mainnet-beta', blockhash: 'bh', lastValidBlockHeight: 100, at: Date.now(), signature: null, ...over });

describe('SPL 指令（不依賴 spl-token）', () => {
  test('transferChecked：data = [12, amount u64 LE, decimals]；keys 順序；reference 附為唯讀非簽名', () => {
    const src = PublicKey.unique(); const dst = PublicKey.unique();
    const ix = transferCheckedInstruction({ source: src, mint, destination: dst, owner: wallet, amount: 2_500_000n, decimals: 6, reference });
    expect(ix.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect([...ix.data]).toEqual([12, 0xa0, 0x25, 0x26, 0, 0, 0, 0, 0, 6]);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([[src.toBase58(), false, true], [mint.toBase58(), false, false], [dst.toBase58(), false, true], [wallet.toBase58(), true, false], [reference.toBase58(), false, false]]);
    expect(() => transferCheckedInstruction({ source: src, mint, destination: dst, owner: wallet, amount: 0n, decimals: 6 })).toThrow(/range/);
  });
  test('付款交易：收款 ATA idempotent 建立 ＋ 轉帳；收款帳戶必須是收款人的 ATA', () => {
    const ixs = paymentInstructions({ payer: wallet, mint, recipient, recipientTokenAccount: associatedTokenAddress(recipient, mint), amount: 1n, decimals: 6, reference });
    expect(ixs).toHaveLength(2);
    expect([...ixs[0]!.data]).toEqual([1]);
    expect(ixs[1]!.keys[0]!.pubkey.equals(associatedTokenAddress(wallet, mint))).toBe(true);
    expect(() => paymentInstructions({ payer: wallet, mint, recipient, recipientTokenAccount: PublicKey.unique(), amount: 1n, decimals: 6, reference })).toThrow(/ATA/);
  });
  test('目錄核對：主網非官方 mint 拒絕；devnet 沿用官方 mint 拒絕；SOL 需求含 ATA 租金', () => {
    expect(() => assertCatalogTrusted(catalog() as never)).not.toThrow();
    expect(() => assertCatalogTrusted(catalog({ mint: PublicKey.unique().toBase58() }) as never)).toThrow(SkrPayError);
    expect(() => assertCatalogTrusted(catalog({ network: 'devnet' }) as never)).toThrow(SkrPayError);
    expect(solNeeded({ skr: 0n, sol: 0, payerAtaExists: true, recipientAtaExists: true })).toBe(FEE_LAMPORTS);
    expect(solNeeded({ skr: 0n, sol: 0, payerAtaExists: true, recipientAtaExists: false })).toBe(FEE_LAMPORTS + ATA_RENT_LAMPORTS);
  });
});

describe('購買狀態機', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  const phases: string[] = [];
  const onPhase = (p: string) => phases.push(p);

  test('餘額不足（SKR／SOL）在開錢包前擋下，不送交易；主網 mint 不對拒絕', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    const sendTx = jest.fn();
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: async () => ({ skr: 1n, sol: 10_000_000, payerAtaExists: true, recipientAtaExists: true }), sendTx })).rejects.toMatchObject({ code: 'INSUFFICIENT_SKR' });
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: async () => ({ skr: 3_000_000n, sol: 1000, payerAtaExists: true, recipientAtaExists: true }), sendTx })).rejects.toMatchObject({ code: 'INSUFFICIENT_SOL' });
    api.skrCreateOrder.mockResolvedValue({ order: order({ mint: PublicKey.unique().toBase58() }), created: true });
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, sendTx })).rejects.toMatchObject({ code: 'MINT_MISMATCH' });
    expect(sendTx).not.toHaveBeenCalled();
  });

  test('錢包取消 → REJECTED（帶訂單）；不回覆 → WALLET_NO_REPLY；伺服器資格／已擁有錯誤對應', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: conn, sendTx: async () => { throw new WalletError('REJECTED', 'user cancelled'); } })).rejects.toMatchObject({ code: 'REJECTED', order: { order_id: order().order_id } });
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: conn, sendTx: async () => { throw new WalletError('WALLET_NO_REPLY', 'no reply'); } })).rejects.toMatchObject({ code: 'WALLET_NO_REPLY' });
    api.skrCreateOrder.mockRejectedValueOnce(new ApiError(409, 'NOT_ELIGIBLE', 'not yet'));
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, {})).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
    api.skrCreateOrder.mockRejectedValueOnce(new ApiError(409, 'ALREADY_OWNED', 'owned'));
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, {})).rejects.toMatchObject({ code: 'ALREADY_OWNED' });
    api.skrCreateOrder.mockResolvedValueOnce({ order: order({ status: 'expired' }), created: false });
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, {})).rejects.toMatchObject({ code: 'ORDER_EXPIRED' });
  });

  test('送出後：RPC 未見 → 退避重試後回 confirming（不重付）；見到且履約 → fulfilled；交易在主網 chain id 簽送、帶 minContextSlot', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    const sendTx = jest.fn(async (chain: string, tx: Transaction, opts: { minContextSlot: number }) => { expect(chain).toBe('solana:mainnet'); expect(tx.instructions).toHaveLength(2); expect(opts.minContextSlot).toBe(42); return 'sig1'; });
    api.skrConfirm.mockResolvedValue({ order: order({ status: 'confirming', signature: 'sig1' }), found: false, verify: null });
    phases.length = 0;
    let r = await skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: conn, sendTx, sleep: noSleep });
    expect(r).toMatchObject({ kind: 'confirming', signature: 'sig1' });
    expect(api.skrConfirm).toHaveBeenCalledTimes(6);
    expect(sendTx).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['creating_order', 'checking_balance', 'opening_wallet', 'sending', 'confirming']);
    api.skrConfirm.mockReset();
    api.skrConfirm.mockResolvedValueOnce({ order: order({ status: 'confirming', signature: 'sig2' }), found: false, verify: null }).mockResolvedValueOnce({ order: order({ status: 'fulfilled', signature: 'sig2' }), found: true, verify: null });
    sendTx.mockResolvedValue('sig2');
    r = await skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: conn, sendTx, sleep: noSleep });
    expect(r).toMatchObject({ kind: 'fulfilled', signature: 'sig2', order: { status: 'fulfilled' } });
  });

  test('既有 confirming 訂單（上次遺失回覆）：直接向伺服器確認，不再開錢包；needs_review 回報；鏈上失敗 → 錯誤且不重送', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order({ status: 'confirming', signature: 'sigOld' }), created: false });
    const sendTx = jest.fn();
    api.skrConfirm.mockResolvedValueOnce({ order: order({ status: 'needs_review', signature: 'sigOld' }), found: true, verify: 'payer_mismatch' });
    const r = await skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: conn, sendTx, sleep: noSleep });
    expect(r.kind).toBe('needs_review');
    expect(sendTx).not.toHaveBeenCalled();
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    api.skrConfirm.mockResolvedValueOnce({ order: order({ status: 'awaiting_payment' }), found: true, verify: 'tx_failed' });
    sendTx.mockResolvedValue('sigFail');
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: conn, sendTx, sleep: noSleep })).rejects.toMatchObject({ code: 'UNKNOWN' });
    expect(sendTx).toHaveBeenCalledTimes(1);
  });
});

/**
 * R1（implementation-review-2026-09-29）：錢包廣播成功但回覆遺失時，伺服器仍停在 awaiting_payment，
 * 舊版會直接建第二筆交易 —— 相同 order／reference 只幫助查找，SPL 轉帳本身不會據此去重，
 * 所以再批准一次就是再轉一次帳。本機的 payment_attempt 是唯一知情的一方。
 */
describe('R1：結果不明時不得重付', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  const onPhase = () => {};

  test('廣播後回覆遺失 → 第二次購買連錢包都不開（舊版會再轉一次帳）', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    const saved: SkrPaymentAttempt[] = [];
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, {
      balances: balancesOk, connection: connAt(50), onAttempt: (a) => { saved.push(a); },
      sendTx: async () => { throw new WalletError('WALLET_NO_REPLY', 'no reply'); },
    })).rejects.toMatchObject({ code: 'WALLET_NO_REPLY' });
    // 關鍵：attempt 在開錢包**之前**就寫下了，所以「沒收到回覆」也留得住證據
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ orderId: order().order_id, lastValidBlockHeight: 100 });

    // 第二次：伺服器仍回 awaiting_payment（它根本不知道有那筆交易），recover 也查不到
    api.skrRecover.mockResolvedValue({ order: order({ status: 'awaiting_payment' }), found: false, verify: null });
    const sendTx = jest.fn();
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: connAt(50), sendTx }, saved[0])).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' });
    expect(sendTx).not.toHaveBeenCalled();
  });

  test('查得到結果就照結果走：已履約 → fulfilled，不再開錢包', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    api.skrRecover.mockResolvedValue({ order: order({ status: 'fulfilled', signature: 'sigPaid' }), found: true, verify: null });
    const sendTx = jest.fn();
    const r = await skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: connAt(50), sendTx }, attemptFor());
    expect(r).toMatchObject({ kind: 'fulfilled', signature: 'sigPaid' });
    expect(sendTx).not.toHaveBeenCalled();
  });

  test('需人工處理也不重付（needs_review）', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    api.skrRecover.mockResolvedValue({ order: order({ status: 'needs_review', signature: 'sigLate' }), found: true, verify: 'late' });
    const sendTx = jest.fn();
    const r = await skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: connAt(50), sendTx }, attemptFor());
    expect(r.kind).toBe('needs_review');
    expect(sendTx).not.toHaveBeenCalled();
  });

  test('只有「原交易已不可能落地」＋失效後再查一次仍查無 → 才允許再付', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    api.skrRecover.mockResolvedValue({ order: order({ status: 'awaiting_payment' }), found: false, verify: null });
    const sendTx = jest.fn(async () => 'sigNew');
    api.skrConfirm.mockResolvedValue({ order: order({ status: 'fulfilled', signature: 'sigNew' }), found: true, verify: null });
    const r = await skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: connAt(101), sendTx, sleep: noSleep }, attemptFor());
    expect(r.kind).toBe('fulfilled');
    expect(sendTx).toHaveBeenCalledTimes(1);
    // 失效前查一次、失效後再查一次：單靠一次「查無交易」不足以證明沒付成功
    expect(api.skrRecover).toHaveBeenCalledTimes(2);
  });

  test('查不到區塊高度 → 擋住付款（寧可多等，也不要冒重複扣款）', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    api.skrRecover.mockResolvedValue({ order: order({ status: 'awaiting_payment' }), found: false, verify: null });
    const sendTx = jest.fn();
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, { balances: balancesOk, connection: connAt(50, { throws: true }), sendTx }, attemptFor())).rejects.toMatchObject({ code: 'RESULT_UNKNOWN' });
    expect(sendTx).not.toHaveBeenCalled();
  });

  test('confirm 的網路錯誤不得弄丟 signature（不然那筆付款就沒人記得了）', async () => {
    api.skrCreateOrder.mockResolvedValue({ order: order(), created: true });
    api.skrConfirm.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    const seen: string[] = [];
    await expect(skrService.purchase(wallet, 'genesis_mint_frame', onPhase, {
      balances: balancesOk, connection: connAt(50), sleep: noSleep, sendTx: async () => 'sigLost', onSignature: (_o, sig) => { seen.push(sig); },
    })).rejects.toMatchObject({ code: 'NETWORK_ERROR', signature: 'sigLost' });
    expect(seen).toEqual(['sigLost']); // 錢包一回傳就存了，不等 confirm
  });
});

describe('skrStore 與 Genesis 卡片', () => {
  const Wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;
  const online = jest.requireMock('@/hooks/useOnline').useOnline as jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    online.mockReturnValue(true);
    useSkrStore.setState({ loaded: true, persisted: { pending: {}, entitlements: {}, useGenesisFrame: {} }, catalog: null, catalogWallet: null, catalogError: null, phase: null, error: null, outcome: null });
    useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Seeker Wallet' }, error: null } as never);
  });

  test('離線：購買鍵停用並說明（建單要連伺服器，離線按下去必定在第一步失敗）', async () => {
    online.mockReturnValue(false);
    api.skrCatalog.mockResolvedValue(catalog());
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-offline')).toBeTruthy());
    expect(screen.getByTestId('genesis-frame-buy-btn').props.accessibilityState.disabled).toBe(true);
  });
  test('未開放 → 不顯示', async () => {
    api.skrCatalog.mockResolvedValueOnce({ enabled: false, reason: 'not_configured' });
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(api.skrCatalog).toHaveBeenCalled());
    await waitFor(() => expect(useSkrStore.getState().catalog).not.toBeNull());
    expect(screen.queryByTestId('genesis-frame-card')).toBeNull();
  });
  test('未達成 → 鎖定說明', async () => {
    api.skrCatalog.mockResolvedValueOnce(catalog({}, { eligibility: 'not_achieved', achievement_id: null }));
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-not_achieved')).toBeTruthy());
    expect(screen.getByText(/at least 5 km/)).toBeTruthy();
  });
  test('可購買 → 價格與主網標籤；確認框後走購買；伺服器拒絕顯示錯誤', async () => {
    api.skrCatalog.mockResolvedValue(catalog());
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-buy')).toBeTruthy());
    expect(screen.getByText('2.5 SKR')).toBeTruthy();
    expect(screen.getByText('SKR · MAINNET')).toBeTruthy();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.[1]?.onPress?.(); });
    api.skrCreateOrder.mockRejectedValueOnce(new ApiError(409, 'NOT_ELIGIBLE', 'not yet'));
    await fireEvent.press(screen.getByTestId('genesis-frame-buy-btn'));
    await waitFor(() => expect(screen.getByTestId('genesis-frame-error')).toBeTruthy());
    expect(alert.mock.calls[0]![1]).toMatch(/2\.5 SKR on Solana mainnet \(real SKR\)/);
    alert.mockRestore();
  });

  test('已擁有 → Owned 與開關；關閉後 genesisFrameActive=false；devnet 目錄標 TEST', async () => {
    api.skrCatalog.mockResolvedValue(catalog({ network: 'devnet', mint: PublicKey.unique().toBase58(), entitlements: [{ cosmetic_id: 'skr_genesis_mint_frame_v1', order_id: 'o', status: 'active', granted_at: '2026-09-22T00:00:00Z' }] }, { owned: true }));
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-owned')).toBeTruthy());
    expect(screen.getByText('TEST SKR · DEVNET')).toBeTruthy();
    expect(ownsGenesisFrame(useSkrStore.getState(), wallet.toBase58())).toBe(true);
    expect(genesisFrameActive(useSkrStore.getState(), wallet.toBase58())).toBe(true);
    await fireEvent(screen.getByTestId('genesis-frame-toggle'), 'valueChange', false);
    await waitFor(() => expect(genesisFrameActive(useSkrStore.getState(), wallet.toBase58())).toBe(false));
    expect(genesisFrameActive(useSkrStore.getState(), PublicKey.unique().toBase58())).toBe(false); // 換帳戶不共用
  });

  /**
   * R2（implementation-review-2026-09-29）：目錄是「某一個錢包」的資料——價格、資格、
   * 未完成訂單、成功訊息都綁在那個帳號上。舊版沒有 generation／session 檢查，
   * A 的內容會留在 B 的畫面上，A 的晚回請求甚至能覆蓋 B 的目錄。
   */
  const other = PublicKey.unique();
  const asWallet = (k: PublicKey) => useWalletStore.setState({ status: 'connected', session: { address: k.toBase58(), publicKey: k, walletUriBase: '', label: 'Seeker Wallet' }, error: null } as never);

  test('R2：A 的請求晚於 B 回來，不得覆蓋 B 的目錄（先發的先回從來不成立）', async () => {
    let resolveA: ((v: unknown) => void) | undefined;
    const catA = catalog({ entitlements: [{ cosmetic_id: 'skr_genesis_mint_frame_v1', order_id: 'oA', status: 'active', granted_at: '2026-09-22T00:00:00Z' }] }, { owned: true });
    const catB = catalog({}, { eligibility: 'not_achieved', achievement_id: null });
    api.skrCatalog.mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
    api.skrCatalog.mockImplementationOnce(async () => catB);
    const pA = useSkrStore.getState().refreshCatalog(wallet.toBase58());
    const pB = useSkrStore.getState().refreshCatalog(other.toBase58());
    await pB;
    resolveA!(catA);
    await pA;
    expect(useSkrStore.getState().catalogWallet).toBe(other.toBase58());
    // A 那包整個丟掉：連 entitlements 快取都不能寫進去，否則 B 會「擁有」A 買的東西
    expect(ownsGenesisFrame(useSkrStore.getState(), other.toBase58())).toBe(false);
  });

  test('R2：換帳號時清掉上一個帳號的成功訊息與錯誤', async () => {
    api.skrCatalog.mockResolvedValue(catalog());
    useSkrStore.setState({ catalog: catalog(), catalogWallet: wallet.toBase58(), outcome: { kind: 'fulfilled', order: order({ status: 'fulfilled' }), signature: 'sigA' }, error: new SkrPayError('NETWORK_ERROR', 'boom') } as never);
    await useSkrStore.getState().refreshCatalog(other.toBase58());
    expect(useSkrStore.getState().outcome).toBeNull();
    expect(useSkrStore.getState().error).toBeNull();
    expect(useSkrStore.getState().catalogWallet).toBe(other.toBase58());
  });

  test('R2：卡片不顯示不屬於目前錢包的目錄（顯示載入，不是 A 的價格與資格）', async () => {
    useSkrStore.setState({ catalog: catalog(), catalogWallet: wallet.toBase58() } as never);
    asWallet(other);
    api.skrCatalog.mockImplementation(() => new Promise(() => {})); // B 的目錄還沒回來
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-loading')).toBeTruthy());
    expect(screen.queryByTestId('genesis-frame-buy')).toBeNull();
    expect(screen.queryByText('2.5 SKR')).toBeNull();
    asWallet(wallet);
  });

  test('R2：確認框開著時換了帳號 → 不付款（確認框是非同步的）', async () => {
    api.skrCatalog.mockResolvedValue(catalog());
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-buy')).toBeTruthy());
    let pay: (() => void) | undefined;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { pay = buttons?.[1]?.onPress as () => void; });
    await fireEvent.press(screen.getByTestId('genesis-frame-buy-btn'));
    asWallet(other); // 使用者在確認框開著的時候換了帳號
    // pay!() 同步回傳，建單在 microtask 才發生——不等一拍就斷言等於什麼都沒測到
    await act(async () => { pay!(); });
    expect(api.skrCreateOrder).not.toHaveBeenCalled();
    alert.mockRestore();
    asWallet(wallet);
  });

  test('R2：目錄屬於別的錢包時 purchase 直接拒絕（拿 A 的資格替 B 買東西）', async () => {
    useSkrStore.setState({ catalog: catalog(), catalogWallet: wallet.toBase58() } as never);
    const spy = jest.spyOn(skrService, 'purchase');
    expect(await useSkrStore.getState().purchase(other, 'genesis_mint_frame')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('R1：本機有未結清的付款嘗試 → 卡片只給「查看狀態」，付款與取消都不出現', async () => {
    const k = `mainnet-beta:${wallet.toBase58()}`;
    const open = order({ status: 'awaiting_payment' });
    useSkrStore.setState({ persisted: { pending: { [k]: { orderId: open.order_id, signature: null, sku: 'genesis_mint_frame', attempt: attemptFor() } }, entitlements: {}, useGenesisFrame: {} } } as never);
    api.skrCatalog.mockResolvedValue(catalog({}, { open_order: open }));
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-attempt')).toBeTruthy());
    // 原本這裡有「Pay now」——文案寫著不要重付，按鈕卻還在。那是建議，不是保護。
    expect(screen.queryByTestId('genesis-frame-pay')).toBeNull();
    expect(screen.queryByTestId('genesis-frame-cancel')).toBeNull(); // 取消一筆可能已在鏈上的付款同樣會誤導人
    expect(screen.getByTestId('genesis-frame-recover')).toBeTruthy();
    // refreshCatalog 每次掛載都跑，不能把 attempt 洗掉（洗掉等於保護當場失效）
    expect(openAttemptFor(useSkrStore.getState(), wallet.toBase58())).toMatchObject({ orderId: open.order_id });
  });

  test('R1：attempt 撐得過 App 重啟——保護不能只活在記憶體裡', async () => {
    const k = `mainnet-beta:${wallet.toBase58()}`;
    await SecureStore.setItemAsync('neonshift.skr.v1', JSON.stringify({ pending: { [k]: { orderId: order().order_id, signature: null, sku: 'genesis_mint_frame', attempt: attemptFor() } }, entitlements: {}, useGenesisFrame: {} }));
    useSkrStore.setState({ loaded: false, persisted: { pending: {}, entitlements: {}, useGenesisFrame: {} }, catalog: null, catalogWallet: null } as never);
    await useSkrStore.getState().load();
    expect(openAttemptFor(useSkrStore.getState(), wallet.toBase58())).toMatchObject({ orderId: order().order_id });
  });

  test('R1：錢包明確回報取消 → 清掉 attempt；沒有回覆 → 留著', async () => {
    const k = `mainnet-beta:${wallet.toBase58()}`;
    const seed = () => useSkrStore.setState({ persisted: { pending: { [k]: { orderId: order().order_id, signature: null, sku: 'genesis_mint_frame', attempt: attemptFor() } }, entitlements: {}, useGenesisFrame: {} }, catalog: catalog(), catalogWallet: wallet.toBase58() } as never);
    api.skrCatalog.mockResolvedValue(catalog());
    // REJECTED 是錢包給的**確定否定答案**（沒簽名、沒廣播），與「沒有回覆」性質不同；
    // 不清掉的話，使用者按一次取消就要等交易有效期過才能再付。
    seed();
    const rejected = jest.spyOn(skrService, 'purchase').mockRejectedValue(new SkrPayError('REJECTED', 'cancelled', order()));
    await useSkrStore.getState().purchase(wallet, 'genesis_mint_frame');
    expect(openAttemptFor(useSkrStore.getState(), wallet.toBase58())).toBeNull();
    rejected.mockRestore();

    seed();
    const noReply = jest.spyOn(skrService, 'purchase').mockRejectedValue(new SkrPayError('WALLET_NO_REPLY', 'no reply', order()));
    await useSkrStore.getState().purchase(wallet, 'genesis_mint_frame');
    expect(openAttemptFor(useSkrStore.getState(), wallet.toBase58())).not.toBeNull();
    noReply.mockRestore();
  });

  test('伺服器有未終結訂單 → 寫入本機 pending，顯示查看狀態／取消；recover 履約後清 pending 並顯示成功', async () => {
    const open = order({ status: 'confirming', signature: 'sigX' });
    api.skrCatalog.mockResolvedValueOnce(catalog({}, { open_order: open }));
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-order-confirming')).toBeTruthy());
    expect(pendingOrderFor(useSkrStore.getState(), wallet.toBase58())).toMatchObject({ orderId: open.order_id, signature: 'sigX', sku: 'genesis_mint_frame' });
    expect(screen.queryByTestId('genesis-frame-cancel')).toBeNull(); // confirming 不可取消
    api.skrRecover.mockResolvedValueOnce({ order: order({ status: 'fulfilled', signature: 'sigX' }), found: true, verify: null });
    api.skrCatalog.mockResolvedValueOnce(catalog({ entitlements: [{ cosmetic_id: 'skr_genesis_mint_frame_v1', order_id: open.order_id, status: 'active', granted_at: '2026-09-22T00:00:00Z' }] }, { owned: true }));
    await fireEvent.press(screen.getByTestId('genesis-frame-recover'));
    await waitFor(() => expect(screen.getByTestId('genesis-frame-success')).toBeTruthy());
    expect(pendingOrderFor(useSkrStore.getState(), wallet.toBase58())).toBeNull();
    expect(screen.getByTestId('genesis-frame-owned')).toBeTruthy();
  });
});
