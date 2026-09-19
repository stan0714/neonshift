/**
 * 提示控制器（2026-09-19 review 7）：以 session 為單位驅動 WorkoutCues，訂閱 recorder 而不是記錄頁。
 * - 記錄頁卸載（切到其他 Tab、鎖屏）仍照常播報；返回記錄頁不會重設播報基準。
 * - session 開始時 reset 一次；之後每次 recorder 更新都交給 cues 判斷是否跨界線。
 * - 自動暫停／繼續事件 → 震動／語音確認（review 4）。
 * 偏好與語言直接讀 store，不經 React。App 啟動時 install 一次。
 */
import { useLocaleStore } from '@/i18n';
import { useWorkoutPrefs, type WorkoutPrefs } from '@/state/workoutPrefsStore';
import { workoutCues, type CuePrefs, type WorkoutCues } from './WorkoutCues';
import { workoutRecorder, type WorkoutRecorder } from './WorkoutRecorder';

type Deps = { recorder?: WorkoutRecorder; cues?: WorkoutCues; prefsOf?: () => Pick<WorkoutPrefs, 'voice' | 'haptic' | 'cueEvery'>; localeOf?: () => 'zh-TW' | 'en' };

const cuePrefs = (p: Pick<WorkoutPrefs, 'voice' | 'haptic' | 'cueEvery'>, locale: 'zh-TW' | 'en'): CuePrefs => ({ voice: p.voice, haptic: p.haptic, locale, cueEvery: p.cueEvery });

let installed: (() => void) | null = null;

/** 安裝一次；回傳解除函式（測試用）。重複呼叫會先解除前一次 */
export function installWorkoutCues(deps: Deps = {}): () => void {
  installed?.();
  const recorder = deps.recorder ?? workoutRecorder;
  const cues = deps.cues ?? workoutCues;
  const prefsOf = deps.prefsOf ?? (() => useWorkoutPrefs.getState());
  const localeOf = deps.localeOf ?? (() => (useLocaleStore.getState().locale === 'zh-TW' ? 'zh-TW' : 'en'));
  const prefs = () => cuePrefs(prefsOf(), localeOf());

  let sessionId: string | null = recorder.active()?.sessionId ?? null;
  if (sessionId) cues.reset(recorder.snapshot(), prefs());

  const offEvent = recorder.onEvent((e) => {
    if (e.kind === 'session_start') {
      sessionId = e.sessionId;
      cues.reset(recorder.snapshot(), prefs());
    } else if (e.kind === 'session_end') {
      if (e.sessionId === sessionId) sessionId = null;
    } else if (e.kind === 'auto_pause' || e.kind === 'auto_resume') {
      cues.announce(e.kind, prefs());
    }
  });
  const offSnap = recorder.subscribe(() => {
    const s = recorder.snapshot();
    if (!sessionId || s.sessionId !== sessionId || (s.state !== 'recording' && s.state !== 'paused')) return;
    cues.onSnapshot(s, prefs());
  });
  installed = () => {
    offEvent();
    offSnap();
    installed = null;
  };
  return installed;
}
