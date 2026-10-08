// jest-expo preset 加上本專案需要的調整
// 測試一律在台北時區跑（2026-10-02）：有些斷言（例如沒有記錄時區的紀錄依裝置時區命名）
// 依賴本機時區，開發機在台北所以一直綠燈，CI（ubuntu，UTC）卻會紅。設定檔在主程序執行，worker 會繼承。
process.env.TZ = 'Asia/Taipei';

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
  // 全套件並行時個別測試可能超過 5 s（RN 渲染＋機器負載）；單跑皆 < 2 s
  testTimeout: 20000,
  setupFiles: [...(preset.setupFiles ?? []), '<rootDir>/jest.setup.ts'],
};
