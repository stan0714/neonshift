// SafeAreaProvider 在 Jest 需要 mock 才會渲染子節點；套件的 mock 為 default export
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Jest 環境沒有真正的 native animated module；強制走 JS driver，避免 findNodeHandle 在 test renderer 崩潰
jest.mock('react-native/src/private/animated/NativeAnimatedHelper', () => {
  const actual = jest.requireActual('react-native/src/private/animated/NativeAnimatedHelper');
  return { __esModule: true, default: { ...actual.default, shouldUseNativeDriver: () => false } };
});

// 原生 Health Connect 模組在 Jest 不存在；各測試可再以 jest.mock 覆寫
jest.mock('./modules/neonshift-health/src/NeonshiftHealthModule', () => ({
  __esModule: true,
  default: {
    PERMISSION_READ_STEPS: 'android.permission.health.READ_STEPS',
    PERMISSION_READ_SLEEP: 'android.permission.health.READ_SLEEP',
    PERMISSION_READ_BACKGROUND: 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND',
    LEGACY_DEVICE_ORIGIN: 'android',
    getStatus: jest.fn(),
    getGrantedPermissions: jest.fn(),
    requestPermissions: jest.fn(),
    openSettings: jest.fn(),
    readSteps: jest.fn(),
    readSleepSessions: jest.fn(),
    scheduleBackgroundSync: jest.fn(async () => ({ scheduled: true, intervalMinutes: 15 })),
    cancelBackgroundSync: jest.fn(),
    runBackgroundSyncNow: jest.fn(),
    getCachedSummary: jest.fn(async () => null),
    setCachedSummary: jest.fn(),
    clearCache: jest.fn(),
  },
}));

jest.mock('./modules/neonshift-sensors/src/NeonshiftSensorsModule', () => ({
  __esModule: true,
  default: {
    getCapabilities: jest.fn(),
    startLiveMotionCheck: jest.fn(),
    cancelLiveMotionCheck: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// MWA 需要原生 TurboModule；Jest 一律 mock transact，個別測試再覆寫回傳
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({ transact: jest.fn() }));
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol', () => ({
  transact: jest.fn(),
  SolanaMobileWalletAdapterError: class extends Error {},
  SolanaMobileWalletAdapterErrorCode: {},
}));

// SecureStore：記憶體版
jest.mock('expo-secure-store', () => {
  const mem = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => mem.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void mem.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void mem.delete(k)),
  };
});
