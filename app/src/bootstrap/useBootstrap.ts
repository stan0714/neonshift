import { useCallback, useEffect, useRef, useState } from 'react';

import { defaultBootstrapTasks } from './defaultTasks';
import { routeFor, runBootstrap, type BootstrapRunResult } from './runBootstrap';
import { BOOTSTRAP_TIMING, type BootstrapContext, type BootstrapPhase, type BootstrapTask, type StepState } from './types';

export type BootstrapState = {
  phase: BootstrapPhase;
  steps: StepState[];
  /** 目前步驟的 loading copy；完成後為 undefined */
  currentLabel?: string;
  result?: BootstrapRunResult;
  /** 8.2 > 10s：診斷摘要 */
  diagnostics: string[];
  retry: () => void;
  /** 8.2：只有存在快取且已超過 3s 時才可用 */
  canUseOffline: boolean;
  continueOffline: () => void;
};

const initialSteps = (tasks: readonly BootstrapTask[]): StepState[] =>
  tasks.map((t) => ({ id: t.id, label: t.label, status: 'pending' }));

/**
 * Bootstrap 狀態機（Style 8.2 的 300ms／3s／10s 規則）。
 * 時間門檻只決定「顯示什麼」，不偽造進度；步驟狀態由真實任務驅動。
 */
export function useBootstrap(tasks: readonly BootstrapTask[] = defaultBootstrapTasks): BootstrapState {
  const [phase, setPhase] = useState<BootstrapPhase>('hidden');
  const [steps, setSteps] = useState<StepState[]>(() => initialSteps(tasks));
  const [currentLabel, setCurrentLabel] = useState<string | undefined>();
  const [ctx, setCtx] = useState<BootstrapContext>();
  const [result, setResult] = useState<BootstrapRunResult>();
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const signalRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    const signal = { aborted: false };
    signalRef.current = signal;
    const startedAt = Date.now();
    let finished = false;
    setPhase('hidden');
    setSteps(initialSteps(tasks));
    setResult(undefined);
    setCtx(undefined);
    setDiagnostics([]);

    // 300ms 內完成不顯示畫面；3s／10s 逐步升級提示
    const timers = [
      setTimeout(() => !finished && setPhase('loading'), BOOTSTRAP_TIMING.showAfterMs),
      setTimeout(() => !finished && setPhase('slow'), BOOTSTRAP_TIMING.slowAfterMs),
      setTimeout(() => !finished && setPhase('stalled'), BOOTSTRAP_TIMING.stalledAfterMs),
    ];

    runBootstrap(
      tasks,
      (nextSteps, nextCtx, current) => {
        if (signal.aborted) return;
        setSteps(nextSteps);
        setCtx(nextCtx);
        setCurrentLabel(current?.label);
      },
      signal,
    ).then((res) => {
      if (signal.aborted) return;
      finished = true;
      timers.forEach(clearTimeout);
      setCurrentLabel(undefined);
      setResult(res);
      setCtx(res.ctx);
      setDiagnostics([
        `Elapsed ${Date.now() - startedAt} ms`,
        ...res.ctx.cacheTimestamp ? [`Cached data from ${new Date(res.ctx.cacheTimestamp).toISOString()}`] : [],
        ...nextFailedDetails(res),
      ]);
      setPhase(res.kind === 'blocked' ? res.reason : 'done');
    });

    return () => {
      signal.aborted = true;
      timers.forEach(clearTimeout);
    };
  }, [tasks, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const canUseOffline = Boolean(ctx?.hasCache) && (phase === 'slow' || phase === 'stalled');

  const continueOffline = useCallback(() => {
    if (!ctx?.hasCache) return;
    signalRef.current.aborted = true;
    setCurrentLabel(undefined);
    setResult({ kind: 'ok', route: routeFor(ctx), ctx });
    setPhase('done');
  }, [ctx]);

  return { phase, steps, currentLabel, result, diagnostics, retry, canUseOffline, continueOffline };
}

function nextFailedDetails(res: BootstrapRunResult): string[] {
  return res.kind === 'blocked' && res.detail ? [res.detail] : [];
}
