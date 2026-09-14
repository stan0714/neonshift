/** 與 Kotlin NeonshiftHealthModule 一一對應的型別（PG-A-04）。 */

export type HealthAvailability = 'available' | 'unavailable' | 'update_required';

export type HealthStatus = {
  availability: HealthAvailability;
  osApi: number;
  sdkExtension: number;
  /** SD 5.1：SPN 查詢門檻 extension 11 且 framework API 存在 */
  spnQuerySupported: boolean;
  /** 裝置內建計步門檻 extension 20 */
  deviceStepsSupported: boolean;
  /** 動態取得的裝置步數來源套件名；null 表示無法取得，只接受歷史 `android` 來源 */
  deviceSpn: string | null;
  deviceModel: string;
};

/** BR-07／08 來源歸因；只有前兩者計入獎勵 */
export type SourceKind = 'android_legacy' | 'current_device_spn' | 'manual' | 'third_party';

export type DataOriginSummary = {
  package: string;
  sourceKind: SourceKind;
  steps: number;
  records: number;
};

/** SD 4.4：可重算的分鐘桶 `[minute_of_utc_day, steps]`（只含允許來源，總和等於 total） */
export type StepRateSummary = {
  bucketMinutes: 1;
  buckets: [number, number][];
  observedMinutes: number;
  maxStepsPerMinute: number;
};

export type StepsResult = {
  /** 只含可歸因來源的 aggregate 總步數 */
  total: number;
  dataOrigins: DataOriginSummary[];
  stepRateSummary: StepRateSummary;
  deviceSpn: string | null;
};

export type SleepSession = {
  startUnix: number;
  endUnix: number;
  minutes: number;
  package: string;
  recordingMethod: 'manual' | 'automatic' | 'active' | 'unknown';
};

export type SleepResult = { sessions: SleepSession[] };

/** 背景／前景同步共用的快取（SD 5.3：只存 UI 需要的最近摘要與時間） */
export type CachedHealthSummary = {
  taskDate: number;
  steps: StepsResult;
  sleep: SleepResult;
  syncedAt: number;
  source: 'background' | 'foreground';
};
