/** PG-E-05：參加者報到代碼（QR＋8 碼、倒數、重取）與工作人員報到（站點授權、代碼／手動、結果）。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { CheckInCode } from '@/screens/events/CheckInCode';
import { StaffCheckInScreen } from '@/screens/events/StaffCheckInScreen';
import { ThemeProvider } from '@/theme';

jest.mock('react-native-qrcode-svg', () => {
  const { View } = jest.requireActual('react-native');
  return (props: { value: string }) => <View testID="qr" accessibilityLabel={props.value} />;
});
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }), useRoute: () => ({ params: { eventId: 'E1', slug: 'river-5k' } }) }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { checkinChallenge: jest.fn(), partnerCheckpoints: jest.fn(), partnerMe: jest.fn(), staffCheckin: jest.fn(), staffCheckins: jest.fn(), partnerBenefits: jest.fn(async () => ({ benefits: [] })) } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'checkinChallenge' | 'partnerCheckpoints' | 'partnerMe' | 'staffCheckin' | 'staffCheckins', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => jest.clearAllMocks());

describe('CheckInCode', () => {
  test('取得代碼後顯示 QR 與 8 碼；重新取得', async () => {
    api.checkinChallenge.mockResolvedValue({ code: 'ABCD2345', expires_at: new Date(Date.now() + 120_000).toISOString(), checkpoint: { checkpoint_id: 'c1', name: 'Gate' }, qr_payload: 'neonshift-checkin:river-5k:ABCD2345' });
    await render(<CheckInCode eventId="E1" checkpointId="c1" checkpointName="Gate" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('checkin-code')).toBeTruthy());
    expect(screen.getByText('ABCD 2345')).toBeTruthy();
    expect(screen.getByLabelText('neonshift-checkin:river-5k:ABCD2345')).toBeTruthy();
    expect(screen.getByText(/Show this to staff at Gate/)).toBeTruthy();
    await fireEvent.press(screen.getByText('New code'));
    await waitFor(() => expect(api.checkinChallenge).toHaveBeenCalledTimes(2));
    await act(async () => {});
  });
  test('未報名顯示提示', async () => {
    api.checkinChallenge.mockRejectedValue(new ApiError(403, 'NOT_ELIGIBLE', 'register first'));
    await render(<CheckInCode eventId="E1" checkpointId="c1" checkpointName="Gate" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('checkin-error')).toBeTruthy());
    expect(screen.getByText('Register for this event first.')).toBeTruthy();
  });
});

describe('StaffCheckInScreen', () => {
  test('只列授權的報到站；輸入代碼確認；已報到／過期訊息；手動補登', async () => {
    api.partnerCheckpoints.mockResolvedValue({ checkpoints: [{ checkpoint_id: 'c1', name: 'Gate', purpose: 'check_in' }, { checkpoint_id: 'c2', name: 'Booth', purpose: 'redemption' }, { checkpoint_id: 'c3', name: 'Gate B', purpose: 'check_in' }] });
    api.partnerMe.mockResolvedValue({ organizations: [], event_roles: [{ event_id: 'E1', role: 'staff', checkpoint_id: 'c1' }] });
    api.staffCheckins.mockResolvedValue({ check_ins: [{ wallet: 'W', checkpoint_id: 'c1', confirmed_at: '', method: 'qr' }] });
    api.staffCheckin.mockResolvedValueOnce({ wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', checkpoint_id: 'c1', display_name: 'Alice', already: false, confirmed_at: '2026-10-03T00:10:00Z' });
    await render(<StaffCheckInScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('cp-c1')).toBeTruthy());
    expect(screen.queryByTestId('cp-c3')).toBeNull();
    expect(screen.getByText('1 checked in')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'abcd2345');
    await fireEvent.press(screen.getByText('Confirm check-in'));
    await waitFor(() => expect(screen.getByTestId('staff-success')).toBeTruthy());
    expect(api.staffCheckin).toHaveBeenCalledWith('E1', { code: 'ABCD2345', checkpoint_id: 'c1', method: 'qr' });
    expect(screen.getByText('Checked in · Alice')).toBeTruthy();
    expect(screen.getByText('2 checked in')).toBeTruthy();

    api.staffCheckin.mockRejectedValueOnce(new ApiError(410, 'CHECKIN_CHALLENGE_EXPIRED', 'expired'));
    await fireEvent.changeText(screen.getByTestId('staff-code'), 'ZZZZ9999');
    await fireEvent.press(screen.getByText('Confirm check-in'));
    await waitFor(() => expect(screen.getByTestId('staff-error')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('staff-manual-toggle'));
    api.staffCheckin.mockResolvedValueOnce({ wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', checkpoint_id: 'c1', display_name: null, already: true, confirmed_at: '' });
    await fireEvent.changeText(screen.getByTestId('staff-wallet'), '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
    await fireEvent.changeText(screen.getByTestId('staff-reason'), 'phone died');
    await fireEvent.press(screen.getByText('Confirm check-in'));
    await waitFor(() => expect(screen.getByTestId('staff-warning')).toBeTruthy());
    expect(api.staffCheckin).toHaveBeenLastCalledWith('E1', { wallet: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', checkpoint_id: 'c1', method: 'manual', reason: 'phone died' });
  });
  test('無角色', async () => {
    api.partnerCheckpoints.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'event not found'));
    api.partnerMe.mockResolvedValue({ organizations: [], event_roles: [] });
    api.staffCheckins.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'x'));
    await render(<StaffCheckInScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('staff-no-role')).toBeTruthy());
  });
});
