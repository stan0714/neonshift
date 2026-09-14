import { useEffect, useState } from 'react';

import { workoutRecorder, type RecorderSnapshot } from '@/services/workouts/WorkoutRecorder';

/** 訂閱 recorder；記錄中每秒刷新（時間／速度窗），其餘只在事件時刷新 */
export function useRecorder(recorder = workoutRecorder): RecorderSnapshot {
  const [snap, setSnap] = useState<RecorderSnapshot>(() => recorder.snapshot());
  useEffect(() => {
    const unsub = recorder.subscribe(() => setSnap(recorder.snapshot()));
    const timer = setInterval(() => {
      const s = recorder.snapshot();
      if (s.state === 'recording' || s.state === 'paused') setSnap(s);
    }, 1000);
    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [recorder]);
  return snap;
}
