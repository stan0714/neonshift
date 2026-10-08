import { PublicKey } from '@solana/web3.js';
import { useWalletStore } from '@/state/walletStore';
import { walletService } from '@/services/wallet/WalletService';
jest.mock('@/services/api/ApiClient', () => ({ apiClient: { configured: false } }));
jest.mock('@/services/wallet/WalletService', () => ({
  walletService: { connect: jest.fn(), peekStoredSession: jest.fn(), disconnect: jest.fn() },
  mapWalletError: (e: unknown) => ({ code: 'UNKNOWN', cause: e }),
}));
const session = { address: 'new', publicKey: PublicKey.unique(), walletUriBase: '' };
beforeEach(() => {
  jest.clearAllMocks();
  useWalletStore.setState({ status: 'idle', session: null, error: null, phase: null, loginIncomplete: false });
});
test('multiple connect presses share one wallet request', async () => {
  let finish!: (s: typeof session) => void;
  (walletService.connect as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const a = useWalletStore.getState().connect();
  const b = useWalletStore.getState().connect();
  expect(a).toBe(b);
  expect(walletService.connect).toHaveBeenCalledTimes(1);
  useWalletStore.getState().clearError();
  expect(useWalletStore.getState().status).toBe('connecting');
  finish(session);
  await a;
  expect(useWalletStore.getState().session).toBe(session);
});
test('late startup restore cannot overwrite a newly connected account', async () => {
  let finish!: (s: null) => void;
  (walletService.peekStoredSession as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const restore = useWalletStore.getState().restore();
  (walletService.connect as jest.Mock).mockResolvedValue(session);
  await useWalletStore.getState().connect();
  finish(null);
  await restore;
  expect(useWalletStore.getState().session).toBe(session);
});
test('optional login failure remains visible without discarding the authorized wallet', async () => {
  (walletService.connect as jest.Mock).mockImplementation(async opts => {
    opts.onPhase('login');
    opts.onLoginError(new Error('offline'));
    return session;
  });
  await useWalletStore.getState().connect();
  expect(useWalletStore.getState()).toMatchObject({ status: 'connected', session, loginIncomplete: true });
});
