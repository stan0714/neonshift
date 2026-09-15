/** PG-R-08 App：claim_achievement 指令（帳戶順序、args ＝ 194-byte 訊息去 domain、向量）、鑄造服務（冪等／錯誤）、PB 區塊鑄造流程（同意 → 待核准／核准 → 費用確認 → 錢包）。 */
import { PublicKey } from '@solana/web3.js';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import bs58 from 'bs58';
import { Buffer } from 'buffer';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';
import nacl from 'tweetnacl';

import vectors from '../../../backend/src/lib/achievement-vectors.json';
import { ACHIEVEMENT_LEN, claimAchievementInstruction } from '@/chain/instructions';
import { achievementAssetPda, achievementPda, discriminator, eligibilityPda, MPL_CORE_PROGRAM_ID } from '@/chain/program';
import { Milestones } from '@/screens/workouts/Milestones';
import { PersonalBests } from '@/screens/workouts/PersonalBests';
import { achievementService } from '@/services/chain/AchievementService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { useWalletStore } from '@/state/walletStore';
import { WalletError } from '@/services/wallet/WalletService';
import { ThemeProvider } from '@/theme';

jest.mock('@/config/app', () => ({ APP_CONFIG: { ...jest.requireActual('@/config/app').APP_CONFIG, programId: '6MhVoQHdEpY2hqkaNJMkT2vHWakfnGfEYDgCtJzh6ENA', chainConfigured: true } }));
const mockAccountExists = jest.fn(async (_k: PublicKey) => false);
const mockSend = jest.fn(async (_w: PublicKey, _ixs: unknown[]) => ({ signature: 'sigMint', blockhash: 'b', lastValidBlockHeight: 1 }));
jest.mock('@/services/chain/ChainClient', () => ({ accountExists: (k: PublicKey) => mockAccountExists(k), sendWithWallet: (w: PublicKey, ixs: unknown[]) => mockSend(w, ixs), getConnection: () => ({}) }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { personalBests: jest.fn(), myAchievements: jest.fn(async () => ({ items: [] })), mintIntent: jest.fn(), milestones: jest.fn(), milestoneMintIntent: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'personalBests' | 'myAchievements' | 'mintIntent' | 'milestones' | 'milestoneMintIntent', jest.Mock>;

const kp = nacl.sign.keyPair();
const wallet = new PublicKey(kp.publicKey);
/** 依向量欄位組出 194-byte 訊息（wallet 換成測試錢包） */
const message = () => {
  const v = vectors.vectors[0]!;
  const buf = Buffer.from(v.expected_hex, 'hex');
  Buffer.from(wallet.toBytes()).copy(buf, 58);
  return new Uint8Array(buf);
};
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountExists.mockResolvedValue(false);
});

describe('claimAchievementInstruction', () => {
  test('帳戶順序與 claim_achievement.rs 一致；data ＝ discriminator ＋ 訊息去掉 24-byte domain；錢包／長度／domain 檢查', () => {
    const msg = message();
    const ix = claimAchievementInstruction(wallet, msg);
    const id = msg.subarray(90, 122);
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys[0]).toBe(wallet.toBase58());
    expect(keys.slice(2, 6)).toEqual([eligibilityPda(wallet, id), achievementPda(wallet, id), achievementAssetPda(wallet, id), MPL_CORE_PROGRAM_ID].map((k) => k.toBase58()));
    expect(ix.keys[3]!.isWritable && ix.keys[4]!.isWritable && !ix.keys[2]!.isWritable).toBe(true);
    expect(ix.keys[6]!.pubkey.toBase58()).toBe('Sysvar1nstructions1111111111111111111111111');
    expect(ix.data.subarray(0, 8)).toEqual(discriminator('claim_achievement'));
    expect(Buffer.from(ix.data.subarray(8))).toEqual(Buffer.from(msg.subarray(24)));
    expect(ix.data.length).toBe(8 + ACHIEVEMENT_LEN - 24);
    expect(() => claimAchievementInstruction(new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), msg)).toThrow(/wallet/);
    expect(() => claimAchievementInstruction(wallet, msg.subarray(1))).toThrow(/NEONSHIFT_ACHIEVEMENT_V1/);
  });
});

describe('achievementService.mint', () => {
  const intent = (over: Record<string, unknown> = {}) => {
    const msg = message();
    const sig = nacl.sign.detached(msg, kp.secretKey);
    return { achievement: { achievement_id: Buffer.from(msg.subarray(90, 122)).toString('hex'), minted: false, status: 'approved' }, pb_id: 'p1', fee_estimate_lamports: 3_500_000, metadata_preview: {}, status: 'approved', proof: { message_b64: Buffer.from(msg).toString('base64'), signature_b64: Buffer.from(sig).toString('base64'), attestor: bs58.encode(kp.publicKey), expires_at: '', args: {} }, ...over } as never;
  };
  test('[ed25519, claim_achievement] 簽送；receipt 已存在 → alreadyMinted 不送；無證明 → pending；拒絕／網路錯誤對應', async () => {
    const r = await achievementService.mint(wallet, intent());
    expect(r).toMatchObject({ kind: 'minted', signature: 'sigMint', alreadyMinted: false });
    const ixs = mockSend.mock.calls[0]![1] as { programId: PublicKey }[];
    expect(ixs).toHaveLength(2);
    expect(ixs[0]!.programId.toBase58()).toBe('Ed25519SigVerify111111111111111111111111111');
    mockAccountExists.mockResolvedValueOnce(true);
    expect(await achievementService.mint(wallet, intent())).toMatchObject({ kind: 'minted', alreadyMinted: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(await achievementService.mint(wallet, intent({ status: 'pending_registry', proof: null }))).toMatchObject({ kind: 'pending_registry' });
    mockSend.mockRejectedValueOnce(new WalletError('REJECTED', 'no'));
    await expect(achievementService.mint(wallet, intent())).rejects.toMatchObject({ code: 'REJECTED' } as ClaimError);
  });
});

describe('PersonalBests 鑄造流程', () => {
  const pb = (over: Record<string, unknown> = {}) => ({ pb_id: 'p1', category: 'fastest_5k', environment: 'outdoor', verification_class: 'device', timing_basis: 'elapsed', rules_major: 1, value: '1500000', unit: 'ms', source: { kind: 'workout', id: 's1', revision: 1 }, achieved_at: '2026-09-05T00:00:00Z', status: 'current', is_baseline: true, previous_pb_id: null, invalidated_at: null, reason: null, ...over });
  test('同意對話 → intent pending → 提示；核准 → 費用確認 → 錢包簽送 → 已鑄造', async () => {
    useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
    api.personalBests.mockResolvedValue({ rules_major: 1, imported_since: '2026-09-01T00:00:00Z', groups: [{ key: 'k', category: 'fastest_5k', environment: 'outdoor', verification_class: 'device', timing_basis: 'elapsed', current: pb(), history: [] }] });
    const alerts: { title: string; buttons: { text: string; onPress?: () => void }[] }[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((title, _m, b) => { alerts.push({ title: String(title), buttons: (b ?? []) as never }); });
    const msg = message();
    const sig = nacl.sign.detached(msg, kp.secretKey);
    api.mintIntent.mockResolvedValueOnce({ achievement: { achievement_id: 'x', status: 'pending_registry', minted: false }, pb_id: 'p1', fee_estimate_lamports: 3_500_000, metadata_preview: {}, status: 'pending_registry', proof: null });
    await render(<PersonalBests />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('pb-mint-fastest_5k-device')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('pb-mint-fastest_5k-device'));
    expect(alerts[0]!.title).toBe('Share the exact value on the NFT?');
    await act(async () => { alerts[0]!.buttons.find((b) => b.text === 'Keep private')!.onPress!(); });
    await waitFor(() => expect(screen.getByTestId('pb-info')).toBeTruthy());
    expect(api.mintIntent).toHaveBeenCalledWith('p1', false);
    // 已核准：走費用確認 → 鑄造
    api.myAchievements.mockResolvedValue({ items: [] });
    api.mintIntent.mockResolvedValueOnce({ achievement: { achievement_id: Buffer.from(msg.subarray(90, 122)).toString('hex'), status: 'approved', minted: false, pb_id: 'p1' }, pb_id: 'p1', fee_estimate_lamports: 3_500_000, metadata_preview: {}, status: 'approved', proof: { message_b64: Buffer.from(msg).toString('base64'), signature_b64: Buffer.from(sig).toString('base64'), attestor: bs58.encode(kp.publicKey), expires_at: '', args: {} } });
    await fireEvent.press(screen.getByTestId('pb-mint-fastest_5k-device'));
    await act(async () => { alerts[1]!.buttons.find((b) => b.text === 'Share value')!.onPress!(); });
    await waitFor(() => expect(alerts[2]?.title).toBe('Mint this personal best?'));
    expect(api.mintIntent).toHaveBeenLastCalledWith('p1', true);
    await act(async () => { alerts[2]!.buttons.find((b) => b.text === 'Mint')!.onPress!(); });
    await waitFor(() => expect(screen.getByTestId('pb-success')).toBeTruthy());
    expect(mockSend).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });
});

describe('Milestones 收藏（PG-M-03）', () => {
  const item = (category: string, status: string, over: Record<string, unknown> = {}) => ({ key: `${category}|outdoor|${(over.verification_class as string) ?? 'device'}`, category, environment: 'outdoor', verification_class: 'device', rules_major: 1, threshold_mm: category === 'first_finish' ? null : '5000000', status, first: status === 'eligible' ? { source: { kind: 'workout', id: 'w1', revision: 1 }, achieved_at: '2026-09-05T01:00:00Z', distance_mm: '12000000', reason: null } : null, pending: null, ...over });
  test('未連線不顯示；目錄狀態（未解鎖／裝置版待開放／待審／可領取／已領取／已撤銷）與「同一筆解鎖 N 個」；領取：同意 → 預覽列出公開內容＋費用 → 錢包簽送 → 已鑄造；未達標 409 提示', async () => {
    useWalletStore.setState({ status: 'disconnected', session: null, error: null } as never);
    await render(<Milestones />, { wrapper: Wrapper });
    await act(async () => {});
    expect(screen.queryByTestId('milestones')).toBeNull();
    useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Phantom' }, error: null } as never);
    api.milestones.mockResolvedValue({ rules_major: 1, imported_since: '2026-08-20T00:00:00Z', items: [item('first_5k', 'eligible'), item('first_10k', 'eligible'), item('first_half', 'device_pending'), item('first_marathon', 'locked'), item('first_finish', 'locked', { verification_class: 'organizer' }), item('first_5k', 'pending_review', { verification_class: 'organizer' })], unlocked_by_source: [{ kind: 'workout', id: 'w1', categories: ['first_5k', 'first_10k'] }] });
    api.myAchievements.mockResolvedValue({ items: [{ achievement_id: 'm10', kind: 'milestone', milestone_key: 'first_10k|outdoor|device', status: 'minted', minted: true }, { achievement_id: 'm5o', kind: 'milestone', milestone_key: 'first_5k|outdoor|organizer', status: 'revoked', minted: false }] });
    await render(<Milestones />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('milestones')).toBeTruthy());
    expect(screen.getByText('“First” is judged from records imported since 2026-08-20 — not necessarily your first ever.')).toBeTruthy();
    expect(screen.getByTestId('ms-multi').props.children).toBe('One record unlocked 2 milestones. Claim them one at a time.');
    expect(screen.getByTestId('ms-first_5k-device').props.accessibilityLabel).toBe('First 5K · Device · Claimable');
    expect(screen.getByTestId('ms-first_10k-device').props.accessibilityLabel).toBe('First 10K · Device · Claimed');
    expect(screen.getByTestId('ms-first_half-device').props.accessibilityLabel).toBe('First Half Marathon · Device · Device version not yet open');
    expect(screen.getByTestId('ms-first_marathon-device').props.accessibilityLabel).toBe('First Marathon · Device · Locked');
    expect(screen.getByTestId('ms-first_finish-organizer').props.accessibilityLabel).toBe('First Finish · Official · Locked');
    expect(screen.getByTestId('ms-first_5k-organizer').props.accessibilityLabel).toBe('First 5K · Official · Revoked'); // 成就撤銷優先於待審
    expect(screen.queryByTestId('ms-mint-first_10k-device')).toBeNull();
    // 領取流程
    const alerts: { title: string; message: string; buttons: { text: string; onPress?: () => void }[] }[] = [];
    jest.spyOn(Alert, 'alert').mockImplementation((title, m, b) => { alerts.push({ title: String(title), message: String(m), buttons: (b ?? []) as never }); });
    const msg = message();
    const sig = nacl.sign.detached(msg, kp.secretKey);
    const id = Buffer.from(msg.subarray(90, 122)).toString('hex');
    api.milestoneMintIntent.mockResolvedValueOnce({ achievement: { achievement_id: id, kind: 'milestone', milestone_key: 'first_5k|outdoor|device', status: 'approved', minted: false, pb_id: null }, pb_id: null, milestone_key: 'first_5k|outdoor|device', fee_estimate_lamports: 3_500_000, metadata_preview: { attributes: [{ trait_type: 'Milestone', value: 'First 5K' }, { trait_type: 'Threshold', value: '5.000 km' }] }, status: 'approved', proof: { message_b64: Buffer.from(msg).toString('base64'), signature_b64: Buffer.from(sig).toString('base64'), attestor: bs58.encode(kp.publicKey), expires_at: '', args: {} } });
    await fireEvent.press(screen.getByTestId('ms-mint-first_5k-device'));
    expect(alerts[0]!.title).toBe('Share the exact distance and date on the NFT?');
    await act(async () => { alerts[0]!.buttons.find((b) => b.text === 'Keep private')!.onPress!(); });
    await waitFor(() => expect(alerts[1]?.title).toBe('Claim preview'));
    expect(api.milestoneMintIntent).toHaveBeenCalledWith('first_5k|outdoor|device', false);
    expect(alerts[1]!.message).toContain('• Milestone: First 5K');
    expect(alerts[1]!.message).toContain('• Threshold: 5.000 km');
    expect(alerts[1]!.message).toContain('0.0035 SOL');
    await act(async () => { alerts[1]!.buttons.find((b) => b.text === 'Mint')!.onPress!(); });
    await waitFor(() => expect(screen.getByTestId('ms-success')).toBeTruthy());
    expect(mockSend).toHaveBeenCalledTimes(1);
    // 409：資格不再
    api.milestoneMintIntent.mockRejectedValueOnce(new Error('MILESTONE_NOT_ELIGIBLE: milestone is locked'));
    await fireEvent.press(screen.getByTestId('ms-mint-first_5k-device'));
    await act(async () => { alerts[2]!.buttons.find((b) => b.text === 'Share value')!.onPress!(); });
    await waitFor(() => expect(screen.getByTestId('ms-error').props.accessibilityLabel ?? screen.getByText('No qualifying record to claim right now.')).toBeTruthy());
    await act(async () => {});
  });
});
