import { render, screen, waitFor } from '@testing-library/react-native';
import { Keypair } from '@solana/web3.js';

import { Milestones } from '@/screens/workouts/Milestones';
import { useLocaleStore } from '@/i18n';
import { useWalletStore } from '@/state/walletStore';
import { ThemeProvider } from '@/theme';

/**
 * registry 核准是伺服器端非同步發生的（chain-admin sync-achievements）。
 * 送出申請後使用者常停在同一個分頁，若畫面不重抓就會一直停在「待核准」、鑄造鍵不出現——只能重開 App。
 */
const focusCbs: (() => void)[] = [];
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (cb: () => void) => {
    focusCbs.length = 0;
    focusCbs.push(cb);
  },
}));

jest.mock('@/services/api/ApiClient', () => ({
  ...jest.requireActual('@/services/api/ApiClient'),
  apiClient: { milestones: jest.fn(), myAchievements: jest.fn() },
}));
const api = jest.requireMock('@/services/api/ApiClient').apiClient as Record<'milestones' | 'myAchievements', jest.Mock>;

const first5k = {
  key: 'first_5k|outdoor|device',
  category: 'first_5k',
  environment: 'outdoor',
  verification_class: 'device',
  rules_major: 1,
  threshold_mm: '5000000',
  status: 'eligible',
  first: { source: { kind: 'workout', id: 'w1', revision: 1 }, achieved_at: '2026-09-22T13:09:00Z', distance_mm: '5500000', reason: null },
  pending: null,
};
const achievement = (status: string) => ({
  items: [{ achievement_id: 'a1', minted: false, kind: 'milestone', pb_id: null, milestone_key: first5k.key, source: null, category: 'first_5k', verification_class: 'device', source_revision: 1, rules_major: 1, public_consent: true, status, metadata_hash: '', metadata_uri: '', asset: null, minted_signature: null, minted_at: null, registry_updated_at: null, updated_at: '' }],
});

beforeEach(() => {
  jest.clearAllMocks();
  focusCbs.length = 0;
  useLocaleStore.setState({ setting: 'en', locale: 'en' });
  const wallet = Keypair.generate().publicKey;
  useWalletStore.setState({ status: 'connected', session: { address: wallet.toBase58(), publicKey: wallet, walletUriBase: '', label: 'Seeker Wallet' }, error: null } as never);
  api.milestones.mockResolvedValue({ rules_major: 1, imported_since: null, items: [first5k], unlocked_by_source: [] });
});

test('待核准 → 回到分頁重抓 → 核准後鑄造鍵出現（不必重開 App）', async () => {
  api.myAchievements.mockResolvedValueOnce(achievement('pending_registry'));
  await render(<ThemeProvider><Milestones /></ThemeProvider>);
  await waitFor(() => expect(screen.getByText('Awaiting approval')).toBeTruthy());
  expect(screen.queryByTestId('ms-mint-first_5k-device')).toBeNull();

  // 伺服器端核准之後回到這個分頁
  api.myAchievements.mockResolvedValueOnce(achievement('approved'));
  expect(focusCbs).toHaveLength(1);
  focusCbs[0]!();
  await waitFor(() => expect(screen.getByTestId('ms-mint-first_5k-device')).toBeTruthy());
  expect(screen.queryByText('Awaiting approval')).toBeNull();
});
