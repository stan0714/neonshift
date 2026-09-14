import { ctaFor, progress, reduce, secondsUntilUtcMidnight, taskDateOf, type TaskStatus } from '@/domain/taskEngine';

describe('PG-A-08 UTC 日界線（BR-05）', () => {
  test('任務日 = floor(unix / 86400)；裝置時區無關', () => {
    expect(taskDateOf(1_789_000_000)).toBe(20_706);
    expect(taskDateOf(20_710 * 86_400)).toBe(20_710);
    expect(taskDateOf(20_711 * 86_400 - 1)).toBe(20_710);
    expect(taskDateOf(20_711 * 86_400)).toBe(20_711);
  });
  test('UTC 換日倒數', () => {
    expect(secondsUntilUtcMidnight(20_710 * 86_400)).toBe(86_400);
    expect(secondsUntilUtcMidnight(20_711 * 86_400 - 1)).toBe(1);
  });
});

describe('達標判定（BR-01）', () => {
  test('步數 7,999／8,000；睡眠 419／420', () => {
    expect(progress('steps', 7_999).met).toBe(false);
    expect(progress('steps', 8_000)).toMatchObject({ met: true, remaining: 0, ratio: 1 });
    expect(progress('sleep', 419).met).toBe(false);
    expect(progress('sleep', 420).met).toBe(true);
    expect(progress('steps', 4_000)).toMatchObject({ remaining: 4_000, ratio: 0.5 });
    expect(progress('steps', -5).value).toBe(0);
  });
});

describe('每日任務狀態機（SA 6.3）', () => {
  const run = (start: TaskStatus, events: Parameters<typeof reduce>[1][]) => events.reduce((s, e) => reduce(s, e, 'steps'), start);

  test('正常路徑：未達標 → 可打卡 → 驗證中 → 待簽章 → 確認中 → 已領取', () => {
    expect(run('not_met', [{ kind: 'data', value: 8_000 }, { kind: 'submit' }, { kind: 'attested' }, { kind: 'sent' }, { kind: 'confirmed' }])).toBe('claimed');
  });
  test('拒絕後同日新資料達標可重試；換日重置', () => {
    expect(run('verifying', [{ kind: 'rejected' }])).toBe('rejected');
    expect(run('rejected', [{ kind: 'data', value: 9_000 }])).toBe('ready');
    expect(run('rejected', [{ kind: 'data', value: 100 }])).toBe('rejected');
    expect(run('rejected', [{ kind: 'new_day' }])).toBe('not_met');
    expect(run('claimed', [{ kind: 'new_day' }])).toBe('not_met');
  });
  test('取消或 attestation 過期回可打卡；交易失敗回待簽章；已領取不再變動', () => {
    expect(run('awaiting_signature', [{ kind: 'cancel' }])).toBe('ready');
    expect(run('confirming', [{ kind: 'failed' }])).toBe('awaiting_signature');
    expect(run('claimed', [{ kind: 'data', value: 0 }])).toBe('claimed');
    expect(run('claimed', [{ kind: 'submit' }])).toBe('claimed');
  });
  test('冪等：任何狀態發現 receipt 即已領取', () => {
    for (const s of ['not_met', 'ready', 'verifying', 'awaiting_signature', 'confirming', 'rejected'] as TaskStatus[]) {
      expect(reduce(s, { kind: 'receipt_exists' }, 'steps')).toBe('claimed');
    }
  });
  test('未達標不可 submit', () => {
    expect(run('not_met', [{ kind: 'submit' }])).toBe('not_met');
  });
  test('CTA 文案（Style 7.3）', () => {
    expect(ctaFor('not_met', progress('steps', 0))).toEqual({ label: 'mission.cta.keepMoving', enabled: false });
    expect(ctaFor('ready', progress('steps', 9_000))).toEqual({ label: 'mission.cta.clockIn', enabled: true });
    expect(ctaFor('verifying', progress('steps', 9_000)).enabled).toBe(false);
    expect(ctaFor('rejected', progress('steps', 9_000))).toEqual({ label: 'mission.cta.tryAgain', enabled: true });
    expect(ctaFor('claimed', progress('steps', 9_000))).toEqual({ label: 'mission.cta.claimed', enabled: false });
  });
});
