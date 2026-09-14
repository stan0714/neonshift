/**
 * 極簡 i18n（PG-A-23）：兩種語言 en／zh-TW，字典 key 相同（測試強制）。
 * - `{name}` 插值；`count` 複數以 `_one`／`_other` 後綴選字（中文兩者可相同）。
 * - 語言來源：Profile 設定（system／en／zh-TW，SecureStore 持久化）→ 系統 locale（expo-localization）→ en。
 * - 只翻 App 面向使用者的文案；後端技術錯誤訊息（message）原樣附在 body，標題／說明翻譯。
 */
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { en } from './en';
import { zhTW } from './zh-TW';

export type Locale = 'en' | 'zh-TW';
export type LocaleSetting = 'system' | Locale;
export type Dict = typeof en;
export type TKey = keyof Dict;

const DICTS: Record<Locale, Record<string, string>> = { en, 'zh-TW': zhTW };
const KEY = 'neonshift.locale.v1';

export function systemLocale(): Locale {
  try {
    // 動態載入避免測試環境缺原生模組
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getLocales } = require('expo-localization') as { getLocales: () => { languageCode: string | null; languageTag: string }[] };
    const first = getLocales()[0];
    const tag = (first?.languageTag ?? first?.languageCode ?? 'en').toLowerCase();
    return tag.startsWith('zh') ? 'zh-TW' : 'en';
  } catch {
    return 'en';
  }
}

type State = { setting: LocaleSetting; locale: Locale; loaded: boolean; load: () => Promise<void>; setSetting: (s: LocaleSetting) => Promise<void> };

export const useLocaleStore = create<State>((set) => ({
  setting: 'system',
  locale: systemLocale(),
  loaded: false,
  async load() {
    try {
      const raw = (await SecureStore.getItemAsync(KEY)) as LocaleSetting | null;
      const setting: LocaleSetting = raw === 'en' || raw === 'zh-TW' ? raw : 'system';
      set({ setting, locale: setting === 'system' ? systemLocale() : setting, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  async setSetting(setting) {
    set({ setting, locale: setting === 'system' ? systemLocale() : setting });
    await SecureStore.setItemAsync(KEY, setting).catch(() => {});
  },
}));

export type TParams = Record<string, string | number> & { count?: number };

export function translate(locale: Locale, key: TKey, params?: TParams): string {
  const dict = DICTS[locale];
  let template: string | undefined;
  if (params && typeof params.count === 'number') {
    template = dict[`${key}_${params.count === 1 ? 'one' : 'other'}`] ?? DICTS.en[`${key}_${params.count === 1 ? 'one' : 'other'}`];
  }
  template ??= dict[key] ?? DICTS.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = params[name];
    return v === undefined ? `{${name}}` : typeof v === 'number' ? v.toLocaleString() : v;
  });
}

/** 非 React 程式碼（store、service）用：讀目前 locale */
export const t = (key: TKey, params?: TParams) => translate(useLocaleStore.getState().locale, key, params);

/** React 元件用：locale 變更時重繪 */
export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return { t: (key: TKey, params?: TParams) => translate(locale, key, params), locale };
}
