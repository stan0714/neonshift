/** PG-E-06：活動權益（品項、預留代碼、徽章、錯誤）與 staff 權益交付模式。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { Perks } from '@/screens/events/Perks';
import { StaffCheckInScreen } from '@/screens/events/StaffCheckInScreen';
import { ThemeProvider } from '@/theme';

jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-2222-4333-8444-555555555555' }));
jest.mock('react-native-qrcode-svg', () => {
  const { View } = jest.requireActual('react-native');
  return (props: { value: string }) => <View testID="qr" accessibilityLabel={props.value} />;
});
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }), useRoute: () => ({ params: { eventId: 'E1', slug: 'river-5k' } }) }));
jest.mock('@/services/api/ApiClient', () => ({
  ...jest.requireActual('@/services/api/ApiClient'),
  apiClient: { eventBenefits: jest.fn(), myRedemptions: jest.fn(), reserveRedemption: jest.fn(), partnerCheckpoints: jest.fn(), partnerMe: jest.fn(), staffCheckins: jest.fn(), partnerBenefits: jest.fn(), staffFulfill: jest.fn() },
}));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'eventBenefits' | 'myRedemptions' | 'reserveRedemption' | 'partnerCheckpoints' | 'partnerMe' | 'staffCheckins' | 'partnerBenefits' | 'staffFulfill', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const towel = { benefit_id: 'b1', kind: 'physical', name: 'Towel', remaining: 3, per_person_limit: 1, requires_checkin: true, claim_deadline: null };
const badge = { benefit_id: 'b2', kind: 'digital_badge', name: 'Finisher badge', remaining: 99, per_person_limit: 1, requires_checkin: false, claim_deadline: null };
const future = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  api.eventBenefits.mockResolvedValue({ benefits: [towel, badge] });
  api.myRedemptions.mockResolvedValue({ redemptions: [] });
});

describe('Perks', () => {
  test('未報名：只看品項與剩餘量、提示報名、沒有按鈕', async () => {
    await render(<Perks eventId="E1" slug="river-5k" registration="none" signedIn={false} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('perks')).toBeTruthy());
    expect(screen.getByText('Register to claim perks.')).toBeTruthy();
    expect(screen.getByText('3 left')).toBeTruthy();
    expect(screen.queryByTestId('perk-btn-b1')).toBeNull();
    expect(api.myRedemptions).not.toHaveBeenCalled();
  });

  test('已報名未報到：實體品項按鈕停用（請先報到）、徽章可領；領徽章後顯示已發放與憑證', async () => {
    api.reserveRedemption.mockResolvedValue({ redemption_id: 'r2', benefit_id: 'b2', quantity: 1, status: 'fulfilled', claim_code: null, reserved_at: '', reserved_until: future(15), fulfilled_at: '2026-10-03T01:00:00Z', credential_id: 'badge_abc' });
    await render(<Perks eventId="E1" slug="river-5k" registration="registered" signedIn />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('perk-btn-b1')).toBeTruthy());
    expect(screen.getByTestId('perk-btn-b1').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Check in first')).toBeTruthy();
    api.myRedemptions.mockResolvedValue({ redemptions: [{ redemption_id: 'r2', benefit_id: 'b2', quantity: 1, status: 'fulfilled', claim_code: null, reserved_at: '', reserved_until: future(15), fulfilled_at: '2026-10-03T01:00:00Z', credential_id: 'badge_abc' }] });
    await fireEvent.press(screen.getByText('Claim badge'));
    await waitFor(() => expect(screen.getByText('Badge issued')).toBeTruthy());
    expect(api.reserveRedemption).toHaveBeenCalledWith('E1', { benefit_id: 'b2', idempotency_key: '11111111-2222-4333-8444-555555555555' });
    expect(screen.getByText('badge_abc')).toBeTruthy();
    expect(screen.queryByTestId('perk-btn-b2')).toBeNull();
  });

  test('已報到：預留實體品項 → 顯示 QR＋代碼與保留時間；售罄錯誤對應文案；逾期提示', async () => {
    const reserved = { redemption_id: 'r1', benefit_id: 'b1', quantity: 1, status: 'reserved', claim_code: 'ABCD2345', reserved_at: '', reserved_until: future(15), fulfilled_at: null, credential_id: null };
    api.reserveRedemption.mockResolvedValueOnce(reserved);
    await render(<Perks eventId="E1" slug="river-5k" registration="checked_in" signedIn />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('perk-btn-b1')).toBeTruthy());
    expect(screen.getByTestId('perk-btn-b1').props.accessibilityState.disabled).toBe(false);
    api.myRedemptions.mockResolvedValue({ redemptions: [reserved] });
    await fireEvent.press(screen.getByText('Reserve'));
    await waitFor(() => expect(screen.getByTestId('perk-reserved-b1')).toBeTruthy());
    expect(screen.getByText('ABCD 2345')).toBeTruthy();
    expect(screen.getByLabelText('neonshift-redeem:river-5k:ABCD2345')).toBeTruthy();
    expect(screen.getByText(/Hold expires in 1[45] min/)).toBeTruthy();
    expect(screen.queryByTestId('perk-btn-b1')).toBeNull();

    // 逾期：改回可預留，並顯示逾期提示；售罄錯誤
    api.myRedemptions.mockResolvedValue({ redemptions: [{ ...reserved, status: 'expired' }] });
    api.reserveRedemption.mockRejectedValueOnce(new ApiError(409, 'BENEFIT_OUT_OF_STOCK', 'no stock left'));
    await render(<Perks eventId="E1" slug="river-5k" registration="checked_in" signedIn />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Hold expired — reserve again if stock remains.')).toBeTruthy());
    await fireEvent.press(screen.getByText('Reserve'));
    await waitFor(() => expect(screen.getByTestId('perk-error')).toBeTruthy());
    expect(screen.getByText('Sorry, that perk just ran out.')).toBeTruthy();
  });
});

describe('StaffCheckInScreen · 權益交付', () => {
  test('切到交付模式：輸入代碼確認 → 已交付與庫存；重試 already；逾期文案', async () => {
    api.partnerCheckpoints.mockResolvedValue({ checkpoints: [{ checkpoint_id: 'c1', name: 'Gate', purpose: 'check_in' }] });
    api.partnerMe.mockResolvedValue({ organizations: [], event_roles: [{ event_id: 'E1', role: 'staff', checkpoint_id: null }] });
    api.staffCheckins.mockResolvedValue({ check_ins: [] });
    api.partnerBenefits.mockResolvedValue({ benefits: [{ ...towel, stock_total: 5, reserved_count: 2, fulfilled_count: 1 }] });
    api.staffFulfill.mockResolvedValueOnce({ redemption_id: 'r1', benefit_id: 'b1', quantity: 1, status: 'fulfilled', claim_code: null, reserved_at: '', reserved_until: '', fulfilled_at: '2026-10-03T01:00:00Z', credential_id: null, already: false });
    await render(<StaffCheckInScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('staff-mode-redeem')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('staff-mode-redeem'));
    await waitFor(() => expect(screen.getByTestId('staff-redeem-code')).toBeTruthy());
    expect(screen.getByText('Towel: 1/5 handed over, 2 on hold')).toBeTruthy();
    api.partnerBenefits.mockResolvedValue({ benefits: [{ ...towel, stock_total: 5, reserved_count: 1, fulfilled_count: 2 }] });
    await fireEvent.changeText(screen.getByTestId('staff-redeem-code'), 'abcd 2345');
    await fireEvent.press(screen.getByText('Confirm handover'));
    await waitFor(() => expect(screen.getByTestId('staff-success')).toBeTruthy());
    expect(api.staffFulfill).toHaveBeenCalledWith('E1', { claim_code: 'ABCD2345' });
    expect(screen.getByText('Handed over · Towel')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Towel: 2/5 handed over, 1 on hold')).toBeTruthy());

    api.staffFulfill.mockRejectedValueOnce(new ApiError(410, 'REDEMPTION_EXPIRED', 'expired'));
    await fireEvent.changeText(screen.getByTestId('staff-redeem-code'), 'ZZZZ9999');
    await fireEvent.press(screen.getByText('Confirm handover'));
    await waitFor(() => expect(screen.getByTestId('staff-error')).toBeTruthy());
    expect(screen.getByText('This hold expired. Ask the participant to reserve again.')).toBeTruthy();
    await act(async () => {});
  });

  test('交付帶授權站點：staff 只限權益站點 → 送出 checkpoint_id', async () => {
    api.partnerCheckpoints.mockResolvedValue({ checkpoints: [{ checkpoint_id: 'c1', name: 'Gate', purpose: 'check_in' }, { checkpoint_id: 'c2', name: 'Booth', purpose: 'redemption' }] });
    api.partnerMe.mockResolvedValue({ organizations: [], event_roles: [{ event_id: 'E1', role: 'staff', checkpoint_id: 'c2' }] });
    api.staffCheckins.mockResolvedValue({ check_ins: [] });
    api.partnerBenefits.mockResolvedValue({ benefits: [{ ...towel, stock_total: 5, reserved_count: 1, fulfilled_count: 1 }] });
    api.staffFulfill.mockResolvedValueOnce({ redemption_id: 'r1', benefit_id: 'b1', quantity: 1, status: 'fulfilled', claim_code: null, reserved_at: '', reserved_until: '', fulfilled_at: '2026-10-03T01:00:00Z', credential_id: null, already: false });
    await render(<StaffCheckInScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('staff-mode-redeem')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('staff-mode-redeem'));
    await waitFor(() => expect(screen.getByTestId('staff-redeem-code')).toBeTruthy());
    expect(screen.queryByTestId('staff-redeem-no-checkpoint')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('staff-redeem-code'), 'abcd 2345');
    await fireEvent.press(screen.getByText('Confirm handover'));
    await waitFor(() => expect(api.staffFulfill).toHaveBeenCalledWith('E1', { claim_code: 'ABCD2345', checkpoint_id: 'c2' }));
    await act(async () => {});
  });

  test('跨站點：只被指派報到站點的 staff 不能交付（按鈕停用並說明）', async () => {
    api.partnerCheckpoints.mockResolvedValue({ checkpoints: [{ checkpoint_id: 'c1', name: 'Gate', purpose: 'check_in' }, { checkpoint_id: 'c2', name: 'Booth', purpose: 'redemption' }] });
    api.partnerMe.mockResolvedValue({ organizations: [], event_roles: [{ event_id: 'E1', role: 'staff', checkpoint_id: 'c1' }] });
    api.staffCheckins.mockResolvedValue({ check_ins: [] });
    api.partnerBenefits.mockResolvedValue({ benefits: [] });
    await render(<StaffCheckInScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('staff-mode-redeem')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('staff-mode-redeem'));
    await waitFor(() => expect(screen.getByTestId('staff-redeem-no-checkpoint')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('staff-redeem-code'), 'ABCD2345');
    await fireEvent.press(screen.getByText('Confirm handover'));
    expect(api.staffFulfill).not.toHaveBeenCalled();
    await act(async () => {});
  });
});
