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
  GameGuide: { onboarding?: boolean } | undefined;
  Onboarding: NavigatorScreenParams<OnboardingParamList>;
  Main: NavigatorScreenParams<TabParamList>;
  ActivityHistory: undefined;
  Explore: undefined;
  /** 運動紀錄（PG-R-01，FR-14.1）：匯入的跑步／健走摘要 */
  Workouts: undefined;
  /** GPS 記錄（PG-R-03／R-06，FR-18）：開始 → 記錄 → 摘要 */
  WorkoutStart: undefined;
  WorkoutRecord: undefined;
  WorkoutSummary: { sessionId: string };
  /** 藝廊（FR-13，Style 12.1）：全站排行與任意玩家公開頁 */
  Gallery: undefined;
  GalleryPlayer: { wallet: string };
  /** PB 成就 NFT 詳情（R-09） */
  AchievementDetail: { asset: string };
  /** 合作活動（FR-09～FR-12，SD 11）：列表與詳情；detail 可帶宣傳來源 */
  Events: undefined;
  EventDetail: { idOrSlug: string; source?: string; /** NFC／QR 標籤 opaque reference（`?tag=`） */ tag?: string };
  /** 工作人員報到（E-05）：需該活動 staff 角色 */
  StaffCheckIn: { eventId: string; slug: string };
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
