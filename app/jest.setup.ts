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
    PERMISSION_READ_EXERCISE: 'android.permission.health.READ_EXERCISE',
    PERMISSION_READ_DISTANCE: 'android.permission.health.READ_DISTANCE',
    PERMISSION_READ_ACTIVE_CALORIES: 'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
    PERMISSION_READ_TOTAL_CALORIES: 'android.permission.health.READ_TOTAL_CALORIES_BURNED',
    readExerciseSessions: jest.fn(async () => ({ sessions: [], permissions: { distance: true, steps: true, activeCalories: true, totalCalories: true } })),
    scheduleBackgroundSync: jest.fn(async () => ({ scheduled: true, intervalMinutes: 15 })),
    cancelBackgroundSync: jest.fn(),
    runBackgroundSyncNow: jest.fn(),
    getCachedSummary: jest.fn(async () => null),
    setCachedSummary: jest.fn(),
    clearCache: jest.fn(),
  },
}));

jest.mock('./modules/neonshift-notify/src/NeonshiftNotifyModule', () => ({
  __esModule: true,
  default: { ensureChannel: jest.fn(() => ({ importance: 3, silenced: false, appNotificationsEnabled: true })) },
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

// expo-network（PG-A-16 離線提示）：預設在線；測試可 mockReturnValue 切換
jest.mock('expo-network', () => ({
  useNetworkState: jest.fn(() => ({ isConnected: true, isInternetReachable: true, type: 'WIFI' })),
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true, type: 'WIFI' })),
  NetworkStateType: { WIFI: 'WIFI', NONE: 'NONE' },
}));

// PG-R-03：定位／背景任務／檔案系統在 Jest 無原生實作；recorder 測試以注入替代
jest.mock('expo-keep-awake', () => ({ useKeepAwake: () => {}, activateKeepAwakeAsync: jest.fn(async () => {}), deactivateKeepAwake: jest.fn(async () => {}) }));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskDefined: jest.fn(() => true) }));
jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  startLocationUpdatesAsync: jest.fn(async () => {}),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  hasStartedLocationUpdatesAsync: jest.fn(async () => true),
}));
jest.mock('expo-file-system', () => {
  // 記憶體檔案系統：只實作 LocalWorkoutStore 用到的 File／Directory API
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/').replace(/\/+/g, '/');
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return dirs.has(this.uri); }
    get name() { return this.uri.split('/').pop()!; }
    create() { dirs.add(this.uri); }
    delete() { dirs.delete(this.uri); for (const k of [...files.keys()]) if (k.startsWith(`${this.uri}/`)) files.delete(k); for (const d of [...dirs]) if (d.startsWith(`${this.uri}/`)) dirs.delete(d); }
    list() { return [...dirs].filter((d) => d.startsWith(`${this.uri}/`) && !d.slice(this.uri.length + 1).includes('/')).map((d) => new Directory(d)); }
  }
  class File {
    uri: string;
    constructor(...parts: unknown[]) { this.uri = join(parts); }
    get exists() { return files.has(this.uri); }
    create() { if (!files.has(this.uri)) files.set(this.uri, ''); }
    write(content: string, opts?: { append?: boolean }) { files.set(this.uri, (opts?.append ? (files.get(this.uri) ?? '') : '') + content); }
    async text() { return files.get(this.uri) ?? ''; }
    textSync() { return files.get(this.uri) ?? ''; }
    delete() { files.delete(this.uri); }
  }
  return { Paths: { document: { uri: 'mem://doc' }, cache: { uri: 'mem://cache' } }, Directory, File, __reset: () => { files.clear(); dirs.clear(); } };
});
