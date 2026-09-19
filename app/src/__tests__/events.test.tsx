/** PG-E-03：活動列表、詳情（規則版本、容量、窗口）、報名／已報名／取消、需登入、額滿、規則變更。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';
import { Alert } from 'react-native';

import { EventDetailScreen, EventsScreen } from '@/screens/events/EventScreens';
import type { PartnerEventView } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

const mockNavigate = jest.fn();
const mockRoute = { params: { idOrSlug: 'river-5k', source: 'ig' } as { idOrSlug: string; source?: string; tag?: string } };
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: mockNavigate }), useRoute: () => mockRoute }));
jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { events: jest.fn(), event: jest.fn(), eventRegistration: jest.fn(), registerEvent: jest.fn(), cancelEventRegistration: jest.fn(), eventTag: jest.fn(), partnerMe: jest.fn(async () => ({ organizations: [], event_roles: [] })), partnerCheckpoints: jest.fn(async () => ({ checkpoints: [] })), checkinChallenge: jest.fn(), myEventHistory: jest.fn(async () => ({ items: [] })) } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'events' | 'event' | 'eventRegistration' | 'registerEvent' | 'cancelEventRegistration' | 'eventTag' | 'partnerMe' | 'partnerCheckpoints' | 'checkinChallenge' | 'myEventHistory', jest.Mock>;
const { ApiError } = jest.requireActual('@/services/api/ApiClient');

const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const ev = (over: Partial<PartnerEventView> = {}): PartnerEventView => ({ event_id: 'E1', slug: 'river-5k', title: 'River 5K', description: 'Sunrise run', state: 'published', timezone: 'Asia/Taipei', registration_opens_at: null, registration_closes_at: future(24), starts_at: future(48), ends_at: future(52), capacity: 100, registration_count: 40, spots_left: 60, tournament_address: null, rules: { version: 2, revision_id: 'REV2', rules: { distance_m: 5000 }, published_at: null }, cancel_reason: null, ...over });
const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'connected', session: { address: 'W', publicKey: {} as never, walletUriBase: '', label: 'Phantom' }, error: null } as never);
  api.eventRegistration.mockResolvedValue({ registration: null });
  jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => b?.find((x) => x.style === 'destructive')?.onPress?.());
});

describe('EventDetailScreen', () => {
  test('顯示規則版本與容量；報名帶宣傳來源與規則版本；成功後顯示已報名', async () => {
    api.event.mockResolvedValue(ev());
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('event-register')).toBeTruthy());
    expect(api.event).toHaveBeenCalledWith('river-5k', 'ig');
    expect(screen.getByText('Rules v2')).toBeTruthy();
    expect(screen.getByTestId('event-rule-distance_m')).toBeTruthy(); // 規則轉成跑者看得懂的欄位（review P1-4）
    expect(screen.getByText('5 km')).toBeTruthy();
    expect(screen.queryByText(/distance m: 5000/)).toBeNull();
    const registered = { status: 'registered', accepted_rule_revision: 'REV2', display_name: null, public_consent: false, registered_at: '', cancelled_at: null };
    api.registerEvent.mockResolvedValue({ registration: registered, already: false });
    api.eventRegistration.mockResolvedValue({ registration: registered }); // 報名成功後會重新 load()
    await fireEvent.press(screen.getByTestId('event-register-btn'));
    await waitFor(() => expect(screen.getByTestId('event-registered')).toBeTruthy());
    expect(api.registerEvent).toHaveBeenCalledWith('E1', { accepted_rule_revision: 'REV2', public_consent: false }, 'ig');
    expect(screen.getByTestId('event-success')).toBeTruthy();
  });

  test('額滿、規則變更、需登入、已取消', async () => {
    api.event.mockResolvedValue(ev({ spots_left: 0 }));
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Event is full')).toBeTruthy());
    await act(async () => {});

    api.event.mockResolvedValue(ev());
    api.registerEvent.mockRejectedValueOnce(new ApiError(409, 'REVISION_CONFLICT', 'rules changed'));
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('event-register-btn')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('event-register-btn'));
    await waitFor(() => expect(screen.getByText('Rules were updated')).toBeTruthy());
    await act(async () => {});

    api.eventRegistration.mockRejectedValueOnce(new ApiError(401, 'NO_SESSION', 'Sign in required'));
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('event-signin')).toBeTruthy());
    await act(async () => {});

    api.event.mockResolvedValue(ev({ state: 'cancelled', cancel_reason: 'Typhoon' }));
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('event-closed')).toBeTruthy());
    expect(screen.getAllByText(/Typhoon/).length).toBeGreaterThan(0);
  });

  test('已報名：取消需確認並釋放', async () => {
    api.event.mockResolvedValue(ev());
    api.eventRegistration.mockResolvedValue({ registration: { status: 'registered', accepted_rule_revision: 'REV2', display_name: null, public_consent: false, registered_at: '', cancelled_at: null } });
    api.cancelEventRegistration.mockResolvedValue({});
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('event-registered')).toBeTruthy());
    api.eventRegistration.mockResolvedValue({ registration: null });
    await fireEvent.press(screen.getByText('Cancel registration'));
    await waitFor(() => expect(api.cancelEventRegistration).toHaveBeenCalledWith('E1'));
    await waitFor(() => expect(screen.getByText('Registration cancelled')).toBeTruthy());
  });
});

describe('EventDetailScreen · NFC 標籤（PG-E-04）', () => {
  afterEach(() => {
    delete mockRoute.params.tag;
  });
  test('連結帶 ?tag= 時向後端查狀態：active 顯示站點；revoked／not_yours／unknown 顯示對應警示', async () => {
    mockRoute.params.tag = 'abc';
    api.event.mockResolvedValue(ev());
    api.eventTag.mockResolvedValueOnce({ status: 'active', purpose: 'checkpoint', checkpoint: { checkpoint_id: 'c1', name: 'Start gate', purpose: 'check_in' }, registered: false, event_state: 'published' });
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('tag-active')).toBeTruthy());
    expect(screen.getByText('Tag detected · Start gate')).toBeTruthy();
    expect(api.eventTag).toHaveBeenCalledWith('E1', 'abc');
    await act(async () => {});
    api.eventTag.mockResolvedValueOnce({ status: 'revoked' });
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('tag-revoked')).toBeTruthy());
    await act(async () => {});
    api.eventTag.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'tag not found'));
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('tag-unknown')).toBeTruthy());
    await act(async () => {});
  });
});

describe('EventsScreen', () => {
  test('列表與空狀態、點入詳情', async () => {
    api.events.mockResolvedValueOnce({ events: [ev()], next_cursor: null });
    await render(<EventsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('River 5K')).toBeTruthy());
    expect(screen.getByText('60 of 100 spots left')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('event-river-5k'));
    expect(mockNavigate).toHaveBeenCalledWith('EventDetail', { idOrSlug: 'river-5k' });
    await act(async () => {});
    api.events.mockResolvedValueOnce({ events: [], next_cursor: null });
    await render(<EventsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('events-empty')).toBeTruthy());
  });
});

describe('EventDetail／Events（2026-09-19 review）', () => {
  test('報名狀態查詢失敗（非未登入）→ 顯示「目前無法確認」＋再試，不顯示報名按鈕；再試成功後恢復', async () => {
    api.event.mockResolvedValue(ev());
    api.eventRegistration.mockRejectedValueOnce(new ApiError(503, 'NETWORK_ERROR', 'offline'));
    await render(<EventDetailScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('event-reg-unknown')).toBeTruthy());
    expect(screen.queryByTestId('event-register')).toBeNull();
    api.eventRegistration.mockResolvedValue({ registration: { status: 'registered', accepted_rule_revision: 'REV2', display_name: null, public_consent: false, registered_at: '', cancelled_at: null } });
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(screen.getByTestId('event-registered')).toBeTruthy());
    expect(screen.queryByTestId('event-reg-unknown')).toBeNull();
    // 進度列：報名完成、報到為目前步驟；邀請按鈕存在
    expect(screen.getByTestId('event-step-0-done')).toBeTruthy();
    expect(screen.getByTestId('event-step-1-current')).toBeTruthy();
    expect(screen.getByTestId('event-invite')).toBeTruthy();
  });

  test('列表頂部「我的活動」：今天／即將／待領取／已完成分類；今天的活動點入直接展開報到碼', async () => {
    api.events.mockResolvedValue({ events: [], next_cursor: null });
    const reg = (status: string) => ({ status, accepted_rule_revision: 'R', display_name: null, public_consent: false, registered_at: '', cancelled_at: null });
    const soon = new Date(Date.now() + 2 * 3_600_000).toISOString();
    api.myEventHistory.mockResolvedValue({ items: [
      { event: { event_id: 'E1', slug: 'today-run', title: 'Today Run', state: 'published', starts_at: soon, ends_at: new Date(Date.now() + 6 * 3_600_000).toISOString() }, registration: reg('registered'), check_ins: [], redemptions: [], results: [] },
      { event: { event_id: 'E2', slug: 'next-week', title: 'Next Week', state: 'published', starts_at: future(24 * 7), ends_at: future(24 * 7 + 4) }, registration: reg('registered'), check_ins: [], redemptions: [], results: [] },
      { event: { event_id: 'E3', slug: 'past-claim', title: 'Past Claim', state: 'completed', starts_at: future(-48), ends_at: future(-40) }, registration: reg('checked_in'), check_ins: [], redemptions: [{ status: 'reserved' }], results: [] },
      { event: { event_id: 'E4', slug: 'past-done', title: 'Past Done', state: 'completed', starts_at: future(-96), ends_at: future(-90) }, registration: reg('checked_in'), check_ins: [], redemptions: [], results: [{ rank: 3 }] },
      { event: { event_id: 'E5', slug: 'cancelled', title: 'Cancelled', state: 'published', starts_at: future(24), ends_at: future(30) }, registration: reg('cancelled'), check_ins: [], redemptions: [], results: [] },
    ] });
    await render(<EventsScreen />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByTestId('my-events')).toBeTruthy());
    expect(screen.getByTestId('my-events-today')).toBeTruthy();
    expect(screen.getByTestId('my-events-upcoming')).toBeTruthy();
    expect(screen.getByTestId('my-events-toClaim')).toBeTruthy();
    expect(screen.getByTestId('my-events-done')).toBeTruthy();
    expect(screen.queryByText('Cancelled')).toBeNull();
    await fireEvent.press(screen.getByTestId('my-event-today-run'));
    expect(mockNavigate).toHaveBeenCalledWith('EventDetail', { idOrSlug: 'today-run', showCode: true });
  });
});
