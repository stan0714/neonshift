import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Surface } from '@/components';
import { ShareImageBlock } from '@/components/ShareImageBlock';
import { eventShareLayout } from '@/domain/shareImage';
import { useT, type TKey } from '@/i18n';
import { ApiError, apiClient, type EventRegistration, type PartnerEventView } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

type T = ReturnType<typeof useT>['t'];
const fmtWhen = (iso: string | null, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '');

/**
 * 規則卡（review P1-4）：把主辦方 rules JSON 轉成跑者看得懂的欄位——集合時間／地點、距離、報到方式、領取條件、取消規則；
 * 未知鍵以「其他」列出（key 轉成可讀），巢狀物件攤平成「鍵：值」而不是印 JSON；規則版本放次要位置。
 */
const KNOWN: Record<string, { key: TKey; icon: React.ComponentProps<typeof Feather>['name']; format?: (v: unknown, t: T) => string }> = {
  meeting_time: { key: 'ev.rule.meetingTime', icon: 'clock' },
  meeting_point: { key: 'ev.rule.meetingPoint', icon: 'map-pin' },
  course: { key: 'ev.rule.course', icon: 'map' },
  distance_m: { key: 'ev.rule.distance', icon: 'navigation', format: (v, t) => (typeof v === 'number' ? (v >= 1000 ? t('ev.rule.km', { km: (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) }) : t('ev.rule.m', { m: v })) : String(v)) },
  check_in_window: { key: 'ev.rule.checkInWindow', icon: 'log-in' },
  check_in_method: { key: 'ev.rule.checkInMethod', icon: 'smartphone' },
  claim_conditions: { key: 'ev.rule.claim', icon: 'gift' },
  results: { key: 'ev.rule.results', icon: 'award' },
  cancel_policy: { key: 'ev.rule.cancel', icon: 'x-circle' },
  conservation_note: { key: 'ev.rule.note', icon: 'info' },
};
const humanKey = (k: string) => k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const flatten = (v: unknown, t: T, fmt?: (v: unknown, t: T) => string): string => {
  if (fmt) return fmt(v, t);
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.map((x) => flatten(x, t)).join('、');
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${humanKey(k)}：${flatten(x, t)}`).join('；');
  return String(v);
};

export function RulesCard({ event }: { event: PartnerEventView }) {
  const { t } = useT();
  const rules = event.rules;
  if (!rules) return null;
  const entries = Object.entries(rules.rules);
  const known = entries.filter(([k]) => KNOWN[k]);
  const other = entries.filter(([k]) => !KNOWN[k]);
  return (
    <Surface style={styles.card} testID="event-rules">
      <View style={styles.rowBetween}>
        <Text variant="title">{t('ev.rule.title')}</Text>
        <Chip label={t('ev.rulesV', { n: rules.version })} kind="neutral" />
      </View>
      {known.map(([k, v]) => {
        const def = KNOWN[k]!;
        return (
          <View key={k} style={styles.row} testID={`event-rule-${k}`}>
            <Feather name={def.icon} size={16} color={color.textMuted} style={styles.rowIcon} />
            <View style={styles.flex}>
              <Text variant="label" tone="muted" uppercase>{t(def.key)}</Text>
              <Text variant="bodySmall">{flatten(v, t, def.format)}</Text>
            </View>
          </View>
        );
      })}
      {other.length ? (
        <View style={styles.row} testID="event-rule-other">
          <Feather name="list" size={16} color={color.textMuted} style={styles.rowIcon} />
          <View style={styles.flex}>
            <Text variant="label" tone="muted" uppercase>{t('ev.rule.other')}</Text>
            {other.map(([k, v]) => (
              <Text key={k} variant="bodySmall" tone="secondary">{humanKey(k)}：{flatten(v, t)}</Text>
            ))}
          </View>
        </View>
      ) : null}
      <Text variant="caption" tone="muted" style={styles.mt}>{t('ev.rule.versionNote', { n: rules.version })}</Text>
    </Surface>
  );
}

/**
 * 活動進度列（review P2-6）：報名 → 報到 → 權益 → 成績 → 留念章。只依已知事實標記（報名／報到狀態、活動是否結束）；
 * 權益／成績／留念章的實際資格由各自區塊依後端顯示，這裡只指出「現在在哪一步、下一步是什麼」。
 */
export function EventProgress({ event, reg }: { event: PartnerEventView; reg: EventRegistration }) {
  const { t } = useT();
  const ended = !!event.ends_at && Date.now() >= Date.parse(event.ends_at);
  const steps: { key: TKey; done: boolean }[] = [
    { key: 'ev.step.registered', done: true },
    { key: 'ev.step.checkedIn', done: reg.status === 'checked_in' },
    { key: 'ev.step.perks', done: false },
    { key: 'ev.step.results', done: false },
    { key: 'ev.step.badge', done: false },
  ];
  const current = reg.status !== 'checked_in' ? 1 : ended ? 3 : 2;
  const hint = reg.status !== 'checked_in' ? t('ev.step.hint.checkIn') : ended ? t('ev.step.hint.after') : t('ev.step.hint.perks');
  return (
    <Surface style={styles.card} testID="event-progress">
      <View style={styles.steps}>
        {steps.map((s, i) => {
          const state = s.done ? 'done' : i === current ? 'current' : 'todo';
          return (
            <View key={s.key} style={styles.step} accessibilityLabel={`${t(s.key)} · ${t(`ev.step.state.${state}` as TKey)}`} testID={`event-step-${i}-${state}`}>
              <View style={[styles.dot, state === 'done' && styles.dotDone, state === 'current' && styles.dotCurrent]}>
                {state === 'done' ? <Feather name="check" size={12} color={color.onMint} /> : <Text variant="caption" tone={state === 'current' ? 'mint' : 'muted'}>{i + 1}</Text>}
              </View>
              <Text variant="caption" tone={state === 'todo' ? 'muted' : state === 'current' ? 'mint' : undefined} style={styles.stepLabel} numberOfLines={2}>{t(s.key)}</Text>
            </View>
          );
        })}
      </View>
      <Text variant="bodySmall" tone="secondary" style={styles.mt}>{hint}</Text>
    </Surface>
  );
}

const inviteUrl = (event: PartnerEventView) => `https://neonshift.cc/e/${event.slug}?source=invite`;

/** 邀請一起參加（review P2-8：與「分享我的完賽」分開）：只含活動名、時間與報名連結，不含任何個人資料 */
export async function shareInvite(t: T, event: PartnerEventView) {
  const message = t('ev.inviteText', { title: event.title, when: fmtWhen(event.starts_at, event.timezone), url: inviteUrl(event) });
  try {
    await Share.share({ message, title: event.title });
  } catch {
    /* 使用者取消 */
  }
}

/**
 * 邀請卡（PG-SHARE-06 卡型 C）。圖片預覽只在按下邀請後才產生（QR 要算，不必每次重繪活動頁）。
 * 圖上只有主辦方公開資訊：活動名、時間與「名額請看活動頁」——名額會變動，寫死在圖裡會過期。
 * 不含報名資料、報到碼與 NFC tag；連結沿用 `/e/<slug>?source=invite`，不夾帶其他 query。
 */
export function EventInvite({ event }: { event: PartnerEventView }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const url = inviteUrl(event);
  const layout = eventShareLayout(
    {
      title: event.title,
      whenLabel: `${fmtWhen(event.starts_at, event.timezone)} (${event.timezone})`,
      // 主辦方名稱與地點目前不在公開活動資料裡：不猜、不從時區推地名
      cityLabel: null,
      organizer: null,
    },
    { t: (k, p) => t(k as TKey, p), labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc' }, qr: url },
  );
  return (
    <Surface style={styles.mt} testID="event-invite-card">
      <Button label={t('ev.invite')} variant="secondary" onPress={() => setOpen((o) => !o)} accessibilityState={{ expanded: open }} testID="event-invite" />
      {open ? (
        <>
          <ShareImageBlock layout={layout} caption={t('ev.inviteText', { title: event.title, when: fmtWhen(event.starts_at, event.timezone), url })} prefix="event-invite-share" />
          <Button label={t('share.card.shareTextInstead')} variant="secondary" onPress={() => void shareInvite(t, event)} testID="event-invite-text" />
        </>
      ) : null}
    </Surface>
  );
}

/**
 * 我的活動（review P1-5）：依「即將參加／待報到／待領取／已完成」分類；活動當天給「查看集合資訊、出示報到碼」快捷。
 * 未登入時不顯示（各頁已有登入卡）；查詢失敗顯示警示不影響公開列表。
 */
type HistoryItem = Awaited<ReturnType<typeof apiClient.myEventHistory>>['items'][number];
type Bucket = 'today' | 'upcoming' | 'toClaim' | 'done';
export function MyEvents() {
  const { t } = useT();
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [noSession, setNoSession] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!session) { setItems(null); return; }
    apiClient.myEventHistory().then((r) => { if (alive) { setItems(r.items); setErr(null); setNoSession(false); } }).catch((e) => {
      if (!alive) return;
      if (e instanceof ApiError && e.code === 'NO_SESSION') { setNoSession(true); setItems(null); return; }
      setErr(e instanceof Error ? e.message : String(e));
    });
    return () => { alive = false; };
  }, [session]);
  if (!session || noSession) return null;
  if (err) return <InlineState kind="warning" title={t('ev.mine.failed')} body={err} testID="my-events-error" />;
  if (!items || items.length === 0) return null;
  const now = Date.now();
  const sameDay = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
  const bucketOf = (it: HistoryItem): Bucket | null => {
    if (!it.event || it.registration.status === 'cancelled') return null;
    const ended = !!it.event.ends_at && now >= Date.parse(it.event.ends_at);
    const pendingClaim = it.redemptions.some((r) => r.status === 'reserved');
    if (!ended && sameDay(it.event.starts_at)) return 'today';
    if (!ended) return 'upcoming';
    if (pendingClaim) return 'toClaim';
    return 'done';
  };
  const groups: Record<Bucket, HistoryItem[]> = { today: [], upcoming: [], toClaim: [], done: [] };
  for (const it of items) { const b = bucketOf(it); if (b) groups[b].push(it); }
  const order: Bucket[] = ['today', 'upcoming', 'toClaim', 'done'];
  if (order.every((b) => groups[b].length === 0)) return null;
  return (
    <Surface style={styles.card} testID="my-events">
      <Text variant="title">{t('ev.mine.title')}</Text>
      {order.filter((b) => groups[b].length).map((b) => (
        <View key={b} style={styles.mtS} testID={`my-events-${b}`}>
          <Text variant="label" tone={b === 'today' ? 'mint' : 'muted'} uppercase>{t(`ev.mine.${b}` as TKey)}</Text>
          {groups[b].map((it) => {
            const e = it.event!;
            const checkedIn = it.registration.status === 'checked_in';
            return (
              <Pressable key={e.event_id} onPress={() => navigation.navigate('EventDetail', { idOrSlug: e.slug, showCode: b === 'today' && !checkedIn })} accessibilityRole="button" style={styles.item} testID={`my-event-${e.slug}`}>
                <View style={styles.flex}>
                  <Text variant="bodySmall">{e.title}</Text>
                  <Text variant="caption" tone="muted">
                    {fmtWhen(e.starts_at)}{b === 'today' || b === 'upcoming' ? ` · ${checkedIn ? t('ev.mine.checkedIn') : t('ev.mine.toCheckIn')}` : b === 'toClaim' ? ` · ${t('ev.mine.claimHint')}` : it.results.length ? ` · ${t('ev.mine.hasResults')}` : ''}
                  </Text>
                </View>
                {b === 'today' ? <Chip label={checkedIn ? t('ev.mine.meetingInfo') : t('ci.show')} kind="synced" /> : <Feather name="chevron-right" size={18} color={color.textMuted} />}
              </Pressable>
            );
          })}
        </View>
      ))}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m, borderRadius: radius.l },
  mt: { marginTop: space.s },
  mtS: { marginTop: space.m },
  flex: { flex: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.s },
  rowIcon: { marginTop: 2, marginRight: space.s },
  steps: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xxs },
  step: { flex: 1, alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: color.mint, borderColor: color.mint },
  dotCurrent: { borderColor: color.mint, borderWidth: 2 },
  stepLabel: { marginTop: space.xxs, textAlign: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 48, marginTop: space.xs },
});
