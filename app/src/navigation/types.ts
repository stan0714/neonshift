import type { NavigatorScreenParams } from '@react-navigation/native';

/** 底部四分頁（Style 2.2 / SD 5.2） */
export type TabParamList = {
  Home: undefined;
  Gear: undefined;
  Arena: undefined;
  Profile: undefined;
};

/** Onboarding：Wallet → Health → Activity → Starter Shoe（Style 10） */
export type OnboardingParamList = {
  WalletConnect: undefined;
  HealthAccess: undefined;
  ActivityRecognition: undefined;
  StarterShoe: undefined;
};

/** Root stack：Bootstrap → Landing → Onboarding → Tabs；次要頁面（Activity history 等）掛在 root */
export type RootParamList = {
  Bootstrap: undefined;
  Landing: undefined;
  DemoPreview: undefined;
  Onboarding: NavigatorScreenParams<OnboardingParamList>;
  Main: NavigatorScreenParams<TabParamList>;
  ActivityHistory: undefined;
  /** __DEV__ 專用 */
  DevHealth: undefined;
};

type AppRootParamList = RootParamList;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends AppRootParamList {}
  }
}
