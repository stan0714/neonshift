/** PG-E-08：公開成績榜（只有同意者、DNF 另列）、本人成績（更正原因、版本數）、公開同意／顯示名稱設定。 */
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PropsWithChildren } from 'react';

import { formatElapsed, Results } from '@/screens/events/Results';
import { ThemeProvider } from '@/theme';

jest.mock('@/services/api/ApiClient', () => ({ ...jest.requireActual('@/services/api/ApiClient'), apiClient: { eventResults: jest.fn(), myEventHistory: jest.fn(), updateEventPrivacy: jest.fn() } }));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'eventResults' | 'myEventHistory' | 'updateEventPrivacy', jest.Mock>;

const Wrapper = ({ children }: PropsWithChildren) => (
  <ThemeProvider>
    <NavigationContainer>{children}</NavigationContainer>
  </ThemeProvider>
);
const reg = { status: 'checked_in' as const, accepted_rule_revision: 'REV2', display_name: null, public_consent: false, registered_at: '', cancelled_at: null };
const row = (o: Record<string, unknown>) => ({ display_name: 'X', discipline: 'run', division: null, finish_status: 'finished', distance_m: 5000, elapsed_ms: 1500000, rank: null, rank_source: null, published_at: '', ...o });

beforeEach(() => jest.clearAllMocks());

test('formatElapsed', () => {
  expect(formatElapsed(1500000)).toBe('25:00');
  expect(formatElapsed(3725000)).toBe('1:02:05');
});

test('未登入訪客：只看公開榜；DNF 另列；沒有成績時不渲染', async () => {
  api.eventResults.mockResolvedValueOnce({ event_id: 'E1', slug: 'river-5k', total_finished: 2, results: [row({ display_name: 'Alice', rank: 1, elapsed_ms: 1400000, division: 'F30' }), row({ display_name: 'Bob', rank: 2 })], non_finishers: [row({ display_name: 'Cy', finish_status: 'dnf', elapsed_ms: 0 })], source: 'organizer' });
  await render(<Results eventId="E1" slug="river-5k" registration={null} />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('results-board')).toBeTruthy());
  expect(screen.getByText('2 finished')).toBeTruthy();
  expect(screen.getByText('Alice')).toBeTruthy();
  expect(screen.getByText('23:20')).toBeTruthy();
  expect(screen.getByText('DNF')).toBeTruthy();
  expect(screen.queryByTestId('results-privacy')).toBeNull();
  expect(api.myEventHistory).not.toHaveBeenCalled();

  api.eventResults.mockResolvedValueOnce({ event_id: 'E1', slug: 'river-5k', total_finished: 0, results: [], non_finishers: [], source: 'organizer' });
  await render(<Results eventId="E1" slug="river-5k" registration={null} />, { wrapper: Wrapper });
  await act(async () => {});
  expect(screen.queryByTestId('results')).toBeNull();
});

test('已報名：本人成績（更正原因、版本數、未公開提示）；切換公開同意與顯示名稱後儲存', async () => {
  api.eventResults.mockResolvedValue({ event_id: 'E1', slug: 'river-5k', total_finished: 0, results: [], non_finishers: [], source: 'organizer' });
  api.myEventHistory.mockResolvedValue({ items: [{ event: { event_id: 'E1', slug: 'river-5k', title: 'River 5K', state: 'published', starts_at: null, ends_at: null }, registration: reg, check_ins: [], redemptions: [], results: [
    { revision_id: 'r2', import_id: 'i2', discipline: 'run', division: 'M30', finish_status: 'finished', distance_m: 5000, elapsed_ms: 1500000, rank: 3, previous_revision_id: 'r1', reason: 'timing chip error', published_at: '' },
    { revision_id: 'r1', import_id: 'i1', discipline: 'run', division: 'M30', finish_status: 'finished', distance_m: 5000, elapsed_ms: 1600000, rank: 4, previous_revision_id: null, reason: null, published_at: '' },
  ] }] });
  api.updateEventPrivacy.mockResolvedValue({ registration: { ...reg, public_consent: true, display_name: 'Stan' } });
  const onChanged = jest.fn();
  await render(<Results eventId="E1" slug="river-5k" registration={reg} onPrivacyChanged={onChanged} />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByTestId('results-mine')).toBeTruthy());
  expect(screen.getByText('25:00')).toBeTruthy();
  expect(screen.getByText('#3')).toBeTruthy();
  expect(screen.getByText('Corrected · timing chip error')).toBeTruthy();
  expect(screen.getByText('1 earlier version')).toBeTruthy();
  expect(screen.getByText('Your result is not on the public board.')).toBeTruthy();
  expect(screen.queryByTestId('results-save')).toBeNull();
  await fireEvent(screen.getByTestId('results-consent'), 'valueChange', true);
  await fireEvent.changeText(screen.getByTestId('results-name'), 'Stan');
  await waitFor(() => expect(screen.getByTestId('results-save')).toBeTruthy());
  await fireEvent.press(screen.getByText('Save'));
  await waitFor(() => expect(screen.getByTestId('results-success')).toBeTruthy());
  expect(api.updateEventPrivacy).toHaveBeenCalledWith('E1', { public_consent: true, display_name: 'Stan' });
  expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ public_consent: true, display_name: 'Stan' }));
  await act(async () => {});
});
