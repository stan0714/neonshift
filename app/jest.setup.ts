// SafeAreaProvider 在 Jest 需要 mock 才會渲染子節點；套件的 mock 為 default export
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// Jest 環境沒有真正的 native animated module；強制走 JS driver，避免 findNodeHandle 在 test renderer 崩潰
jest.mock('react-native/src/private/animated/NativeAnimatedHelper', () => {
  const actual = jest.requireActual('react-native/src/private/animated/NativeAnimatedHelper');
  return { __esModule: true, default: { ...actual.default, shouldUseNativeDriver: () => false } };
});
