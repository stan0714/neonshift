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
  },
}));
