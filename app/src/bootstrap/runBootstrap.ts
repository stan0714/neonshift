import type { BootstrapContext, BootstrapRoute, BootstrapTask, StepOutcome, StepState } from './types';

export type BootstrapRunResult =
  | { kind: 'ok'; route: BootstrapRoute; ctx: BootstrapContext }
  | { kind: 'blocked'; reason: 'forceUpdate' | 'maintenance'; detail?: string; retryAfter?: string; ctx: BootstrapContext };

export type BootstrapObserver = (steps: StepState[], ctx: BootstrapContext, current?: BootstrapTask) => void;

/**
 * 依序執行 bootstrap 步驟。單一步驟失敗不中止流程（8.4：無網路、錢包失效、Health Connect 不可用皆可離開 loading），
 * 只有版本或維護等 `blocked` 結果才停在對應狀態。
 */
export async function runBootstrap(
  tasks: readonly BootstrapTask[],
  observe: BootstrapObserver,
  signal?: { aborted: boolean },
): Promise<BootstrapRunResult> {
  const ctx: BootstrapContext = {
    onboardingComplete: false,
    walletConnected: false,
    hasCache: false,
    minVersionOk: true,
  };
  const steps: StepState[] = tasks.map((t) => ({ id: t.id, label: t.label, status: 'pending' }));
  const emit = (current?: BootstrapTask) => observe(steps.map((s) => ({ ...s })), { ...ctx }, current);

  for (const [i, task] of tasks.entries()) {
    if (signal?.aborted) break;
    steps[i] = { ...steps[i], status: 'running' };
    emit(task);
    let outcome: StepOutcome;
    try {
      outcome = await task.run(ctx);
    } catch (e) {
      outcome = { status: 'failed', detail: e instanceof Error ? e.message : String(e) };
    }
    if (outcome.status === 'blocked') {
      steps[i] = { ...steps[i], status: 'failed', detail: outcome.detail };
      emit();
      return { kind: 'blocked', reason: outcome.reason, detail: outcome.detail, retryAfter: outcome.retryAfter, ctx };
    }
    steps[i] = { ...steps[i], status: outcome.status, detail: outcome.detail };
    emit();
  }

  return { kind: 'ok', route: routeFor(ctx), ctx };
}

/** 9.3：已完成 onboarding 且 session 可恢復時跳過 Landing，直接進 Dashboard。 */
export function routeFor(ctx: BootstrapContext): BootstrapRoute {
  return ctx.onboardingComplete && ctx.walletConnected ? 'Main' : 'Landing';
}
