// jest-expo preset 加上本專案需要的調整
const preset = require('jest-expo/jest-preset');

// @solana/* 的 react-native 進入點是 .mjs；沿用 jest-expo 的 babel 選項另加一條 .mjs 轉換
const babelTransform = preset.transform['\\.[jt]sx?$'];

module.exports = {
  ...preset,
  transform: { ...preset.transform, '\\.mjs$': babelTransform },
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation|@solana|@solana-mobile|jayson|uuid|superstruct|rpc-websockets|@noble|@scure|@wallet-standard|js-base64))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/"
],
  testMatch: ["**/__tests__/**/*.test.[jt]s?(x)"],
  moduleNameMapper: {
    ...(preset.moduleNameMapper ?? {}),
    '^@/(.*)$': '<rootDir>/src/$1',
    // exports map 只有 browser／node 條件，react-native 條件下解析不到
    '^rpc-websockets$': '<rootDir>/node_modules/rpc-websockets/dist/index.browser.cjs',
    '^rpc-websockets/dist/lib/client/websocket.browser$': '<rootDir>/node_modules/rpc-websockets/dist/lib/client/websocket.browser.cjs',
  },
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/jest.setup.ts'],
};
