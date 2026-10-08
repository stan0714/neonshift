import { useEffect, useState } from 'react';

import { workoutOutbox } from '@/services/workouts/WorkoutOutbox';
import { useSyncPrefs } from '@/state/syncPrefsStore';
import { useWalletStore } from '@/state/walletStore';

/** 上傳佇列狀態（PG-LINK-02）：目前玩家的待傳清單／摘要與自動同步開關；佇列有變動就重讀 */
export function useOutbox() {
  const owner = useWalletStore((s) => s.session?.address ?? null);
  const autoSync = useSyncPrefs((s) => (s.loaded && s.owner === owner ? s.autoSyncWorkouts : false));
  const lastSuccessAt = useSyncPrefs((s) => (s.loaded && s.owner === owner ? s.lastSuccessAt : null));
  const prefsOwner = useSyncPrefs((s) => (s.loaded ? s.owner : undefined));
  const [tick, setTick] = useState(0);
  useEffect(() => workoutOutbox.subscribe(() => setTick((n) => n + 1)), []);
  useEffect(() => { if (prefsOwner !== owner) void useSyncPrefs.getState().load(owner); }, [owner, prefsOwner]);
  // tick 只用來觸發重讀
  void tick;
  return { owner, autoSync, lastSuccessAt, list: workoutOutbox.list(owner), summary: workoutOutbox.summary(owner), unassigned: workoutOutbox.unassigned() };
}
