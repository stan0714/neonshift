/**
 * SKR-07（App 端）：SPL 指令位元組與 ATA 一致性、購買狀態機（目錄／訂單核對、餘額不足、錢包取消／不回覆、RPC 未見 → confirming 不重付、
 * 履約、needs_review、逾期、既有 confirming 訂單不重付）、pending 持久化與復原、Genesis 卡片各狀態與邊框套用。
 */
import { PublicKey, Transaction } from '@solana/web3.js';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { GenesisFrameCard } from '@/components/GenesisFrameCard';
import { OFFICIAL_SKR_MINT } from '@/config/app';
import type { SkrCatalog, SkrOrderView } from '@/services/api/ApiClient';
import { ApiError } from '@/services/api/ApiClient';
import { associatedTokenAddress, paymentInstructions, transferCheckedInstruction, TOKEN_PROGRAM_ID } from '@/services/skr/spl';
import { skrService, SkrPayError, assertCatalogTrusted, solNeeded, ATA_RENT_LAMPORTS, FEE_LAMPORTS } from '@/services/skr/SkrService';
import { WalletError } from '@/services/wallet/WalletService';
import { genesisFrameActive, ownsGenesisFrame, pendingOrderFor, useSkrStore } from '@/state/skrStore';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

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

describe('skrStore 與 Genesis 卡片', () => {
  const Wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;
  beforeEach(() => {
    jest.clearAllMocks();
    useSkrStore.setState({ loaded: true, persisted: { pending: {}, entitlements: {}, useGenesisFrame: {} }, catalog: null, catalogWallet: null, catalogError: null, phase: null, error: null, outcome: null });
    useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Seeker Wallet' }, error: null } as never);
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

  test('伺服器有未終結訂單 → 寫入本機 pending，顯示查看狀態／取消；recover 履約後清 pending 並顯示成功', async () => {
    const open = order({ status: 'confirming', signature: 'sigX' });
    api.skrCatalog.mockResolvedValueOnce(catalog({}, { open_order: open }));
    await render(<GenesisFrameCard />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('genesis-frame-order-confirming')).toBeTruthy());
    expect(pendingOrderFor(useSkrStore.getState(), wallet.toBase58())).toEqual({ orderId: open.order_id, signature: 'sigX', sku: 'genesis_mint_frame' });
    expect(screen.queryByTestId('genesis-frame-cancel')).toBeNull(); // confirming 不可取消
    api.skrRecover.mockResolvedValueOnce({ order: order({ status: 'fulfilled', signature: 'sigX' }), found: true, verify: null });
    api.skrCatalog.mockResolvedValueOnce(catalog({ entitlements: [{ cosmetic_id: 'skr_genesis_mint_frame_v1', order_id: open.order_id, status: 'active', granted_at: '2026-09-22T00:00:00Z' }] }, { owned: true }));
    await fireEvent.press(screen.getByTestId('genesis-frame-recover'));
    await waitFor(() => expect(screen.getByTestId('genesis-frame-success')).toBeTruthy());
    expect(pendingOrderFor(useSkrStore.getState(), wallet.toBase58())).toBeNull();
    expect(screen.getByTestId('genesis-frame-owned')).toBeTruthy();
  });
});
