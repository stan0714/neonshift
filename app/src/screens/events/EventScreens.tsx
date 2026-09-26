import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, RefreshControl, Share, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { SignInState } from '@/components/SignInState';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type EventRegistration, type PartnerEventView, type TagState } from '@/services/api/ApiClient';
import { EventInvite, EventProgress, MyEvents, RulesCard } from './EventExtras';

import { CheckInCode } from './CheckInCode';
import { EventBadges } from './EventBadges';
import { Perks } from './Perks';
import { Results } from './Results';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';
import { t, useT, type TKey } from '@/i18n';
import { apiErrorText } from '@/services/api/errorText';

type Err = { code: string; message: string; ref?: string };
const toErr = (e: unknown): Err => (e instanceof ApiError ? { code: e.code, message: e.code === 'NETWORK_ERROR' ? apiErrorText(t, e) : e.message, ...(e.requestId ? { ref: e.requestId } : {}) } : { code: 'UNKNOWN', message: String(e) });
type T = ReturnType<typeof useT>['t'];
const fmt = (t: T, iso: string | null, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : t('ev.tba'));
const stateLabel = (t: T, s: PartnerEventView['state']) => t(`ev.state.${s}` as TKey);

function registrationWindow(e: PartnerEventView, nowMs: number): 'open' | 'not_yet' | 'closed' {
  if (e.state !== 'published') return 'closed';
  if (e.registration_opens_at && nowMs < Date.parse(e.registration_opens_at)) return 'not_yet';
  if (e.registration_closes_at && nowMs >= Date.parse(e.registration_closes_at)) return 'closed';
  if (e.ends_at && nowMs >= Date.parse(e.ends_at)) return 'closed';
  return 'open';
}

/** 合作活動列表（PG-E-03，SD 11.1）：已發布活動；公開讀取不需登入。 */
export function EventsScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const [events, setEvents] = useState<PartnerEventView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (next: string | null = null) => {
    setLoading(true);
    try {
      const page = await apiClient.events(next);
      setEvents((prev) => (next && prev ? [...prev, ...page.events] : page.events));
      setCursor(page.next_cursor);
      setErr(null);
    } catch (e) {
      setErr(toErr(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen scroll testID="events-screen" refreshControl={<RefreshControl refreshing={loading && !events} onRefresh={() => void load()} tintColor={color.mint} />}>
      <Text variant="bodySmall" tone="secondary">
        {t('ev.intro')}
      </Text>
      <MyEvents />
      {err ? <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? t('common.devnetBreak') : t('common.somethingInterrupted')} body={t('ev.errBody', { message: err.message })} referenceId={err.ref} action={{ label: t('common.tryAgain'), onPress: () => void load(), loading }} testID="events-error" /> : null}
      {events && events.length === 0 ? (
        <Surface style={styles.card} testID="events-empty">
          <Text variant="title">{t('ev.empty.title')}</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            {t('ev.empty.body')}
          </Text>
        </Surface>
      ) : null}
      {events?.map((e) => (
        <Pressable key={e.event_id} onPress={() => navigation.navigate('EventDetail', { idOrSlug: e.slug })} accessibilityRole="button" accessibilityLabel={`${e.title}, ${stateLabel(t, e.state)}`} testID={`event-${e.slug}`}>
          <Surface style={styles.card}>
            <View style={styles.rowBetween}>
              <Text variant="title" style={styles.flex}>
                {e.title}
              </Text>
              <Chip label={stateLabel(t, e.state)} kind={e.state === 'published' ? 'synced' : 'offline'} />
            </View>
            <Text variant="bodySmall" tone="secondary" style={styles.mt} numeric>
              {fmt(t, e.starts_at, e.timezone)} · {e.timezone}
            </Text>
            <Text variant="caption" tone="muted" style={styles.mt}>
              {e.capacity === 0 ? t('ev.registered_n', { n: e.registration_count }) : t('ev.spotsLeft', { left: e.spots_left ?? 0, cap: e.capacity })}
            </Text>
          </Surface>
        </Pressable>
      ))}
      {cursor ? <Button label={t('common.loadMore')} variant="secondary" style={styles.mt} onPress={() => void load(cursor)} loading={loading} loadingLabel={t('common.loading')} /> : null}
    </Screen>
  );
}

/** 活動詳情：規則版本同意、報名／取消、容量、宣傳來源（deep link `neonshift.cc/e/<slug>?source=`）。 */
export function EventDetailScreen() {
  const { t } = useT();
  const { params } = useRoute<RouteProp<RootParamList, 'EventDetail'>>();
  const navigation = useNavigation();
  const session = useWalletStore((s) => s.session);
  const [event, setEvent] = useState<PartnerEventView | null>(null);
  const [reg, setReg] = useState<EventRegistration | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  /** 報名狀態查詢失敗（非未登入）：明確顯示「目前無法確認」，不讓已報名者以為沒報名（review P1-3） */
  const [regErr, setRegErr] = useState<Err | null>(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: 'success' | 'error'; title: string; body: string; ref?: string } | null>(null);
  const [tag, setTag] = useState<TagState | 'checking' | 'unknown' | 'signin' | null>(params.tag ? 'checking' : null);
  const [staff, setStaff] = useState(false);
  const [showCode, setShowCode] = useState(!!params.showCode);

  const load = useCallback(async () => {
    try {
      const e = await apiClient.event(params.idOrSlug, params.source);
      setEvent(e);
      setErr(null);
      try {
        setReg((await apiClient.eventRegistration(e.event_id)).registration);
        setNeedsSignIn(false);
        setRegErr(null);
      } catch (x) {
        if (x instanceof ApiError && x.code === 'NO_SESSION') { setNeedsSignIn(true); setReg(null); setRegErr(null); }
        else { setReg(null); setRegErr(toErr(x)); }
      }
      apiClient.partnerMe().then((me) => setStaff(me.event_roles.some((r) => r.event_id === e.event_id && r.role === 'staff') || me.organizations.some((o) => o.role === 'owner'))).catch(() => setStaff(false));
      // PG-E-04：標籤只提供 opaque reference，資格與狀態一律向後端查（SD 11.4）
      if (params.tag) {
        try {
          setTag(await apiClient.eventTag(e.event_id, params.tag));
        } catch (x) {
          setTag(x instanceof ApiError && x.code === 'NO_SESSION' ? 'signin' : 'unknown');
        }
      }
    } catch (e) {
      setErr(toErr(e));
    }
    // 換錢包（身分切換）重查：session.address 在依賴內
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.idOrSlug, params.source, params.tag, session?.address]);
  useEffect(() => {
    void load();
  }, [load]);
  // 返回此頁（例如從 Staff 工具或錢包回來）重查報名狀態
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    void load();
  }, [load]));
  const onCheckedIn = useCallback(() => {
    setReg((r) => (r ? { ...r, status: 'checked_in' } : r));
    setShowCode(false);
    void load();
  }, [load]);

  const nowMs = Date.now();
  const window = event ? registrationWindow(event, nowMs) : 'closed';
  const registered = reg?.status === 'registered' || reg?.status === 'checked_in';

  const register = async () => {
    if (!event?.rules) return;
    setBusy(true);
    setOutcome(null);
    try {
      const r = await apiClient.registerEvent(event.event_id, { accepted_rule_revision: event.rules.revision_id, public_consent: consent }, params.source);
      setReg(r.registration);
      setOutcome({ kind: 'success', title: r.already ? t('ev.ok.already') : t('ev.ok.registered'), body: t('ev.ok.body') });
      await load();
    } catch (e) {
      const x = toErr(e);
      const known = ['EVENT_FULL', 'EVENT_NOT_OPEN', 'REVISION_CONFLICT', 'NO_SESSION'].includes(x.code);
      const title = known ? t(`ev.err.${x.code}.title` as TKey) : t('common.somethingInterrupted');
      const body = known ? t(`ev.err.${x.code}.body` as TKey) : t('ev.err.generic.body', { message: x.message });
      setOutcome({ kind: 'error', title, body, ...(x.ref ? { ref: x.ref } : {}) });
      if (x.code === 'REVISION_CONFLICT') await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!event) return;
    Alert.alert(t('ev.cancel.title'), t('ev.cancel.body'), [
      { text: t('ev.cancel.keep'), style: 'cancel' },
      {
        text: t('ev.cancel.ok'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await apiClient.cancelEventRegistration(event.event_id);
            setReg(null);
            setOutcome({ kind: 'success', title: t('ev.cancelled.title'), body: t('ev.cancelled.body') });
            await load();
          } catch (e) {
            const x = toErr(e);
            setOutcome({ kind: 'error', title: t('ev.cancelFail'), body: x.message, ...(x.ref ? { ref: x.ref } : {}) });
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen scroll testID="event-detail-screen">
      {err ? <InlineState kind={err.code === 'NOT_FOUND' ? 'info' : 'error'} title={err.code === 'NOT_FOUND' ? t('ev.notFound.title') : t('common.somethingInterrupted')} body={err.code === 'NOT_FOUND' ? t('ev.notFound.body') : t('ev.errBody', { message: err.message })} referenceId={err.ref} action={err.code === 'NOT_FOUND' ? undefined : { label: t('common.tryAgain'), onPress: () => void load() }} testID="event-error" /> : null}
      {event && tag ? <TagBanner tag={tag} /> : null}
      {event && staff ? <Button label={t('ev.staffLink')} variant="secondary" style={styles.card} onPress={() => navigation.navigate('StaffCheckIn', { eventId: event.event_id, slug: event.slug })} testID="event-staff-link" /> : null}
      {event ? (
        <>
          <Surface hero>
            <View style={styles.rowBetween}>
              <Chip label={stateLabel(t, event.state)} kind={event.state === 'published' ? 'synced' : 'offline'} />
            </View>
            <Text variant="heading2" style={styles.mt}>
              {event.title}
            </Text>
            {event.description ? (
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                {event.description}
              </Text>
            ) : null}
            <Row icon="calendar" label={t('ev.event')} value={`${fmt(t, event.starts_at, event.timezone)} → ${fmt(t, event.ends_at, event.timezone)} (${event.timezone})`} />
            <Row icon="map-pin" label={t('ev.localTime')} value={`${fmt(t, event.starts_at)} → ${fmt(t, event.ends_at)}`} />
            <Row icon="edit-3" label={t('ev.registration')} value={event.registration_closes_at ? t('ev.until', { when: fmt(t, event.registration_closes_at) }) : t('ev.untilStart')} />
            <Row icon="users" label={t('ev.capacity')} value={event.capacity === 0 ? t('ev.unlimited', { n: event.registration_count }) : t('ev.spotsLeft', { left: event.spots_left ?? 0, cap: event.capacity })} />
            {event.state === 'cancelled' ? <Row icon="x-octagon" label={t('ev.cancelledLabel')} value={event.cancel_reason ?? t('ev.byOrganizer')} /> : null}
          </Surface>

          {event.rules ? <RulesCard event={event} /> : null}
          {registered && reg ? <EventProgress event={event} reg={reg} /> : null}
          <EventInvite event={event} />
          {regErr ? <InlineState kind="warning" title={t('ev.regUnknown.title')} body={t('ev.regUnknown.body', { message: regErr.message })} action={{ label: t('common.tryAgain'), onPress: () => void load() }} testID="event-reg-unknown" /> : null}

          {outcome ? (
            <Pressable onPress={() => setOutcome(null)} accessibilityRole="button" accessibilityLabel={t('common.dismiss')}>
              <InlineState kind={outcome.kind} title={outcome.title} body={outcome.body} referenceId={outcome.ref} testID={`event-${outcome.kind}`} />
            </Pressable>
          ) : null}

          {registered ? (
            <Surface style={styles.card} active testID="event-registered">
              <Text variant="title">{t('ev.registeredTitle')}</Text>
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                {t('ev.acceptedRules', { v: event.rules?.revision_id === reg?.accepted_rule_revision ? (event.rules?.version ?? '') : t('ev.earlier') })}{reg?.status === 'checked_in' ? t('ev.checkedIn') : t('ev.checkInHint')}
              </Text>
              {reg?.status === 'checked_in' ? (
                <Text variant="bodySmall" tone="mint" style={styles.mt} testID="event-checked-in-next">{t('ev.checkedInNext')}</Text>
              ) : tag && typeof tag === 'object' && tag.status === 'active' && tag.checkpoint?.purpose === 'check_in' ? (
                <CheckInCode eventId={event.event_id} checkpointId={tag.checkpoint.checkpoint_id} checkpointName={tag.checkpoint.name} onCheckedIn={onCheckedIn} />
              ) : showCode ? (
                <CheckInPicker eventId={event.event_id} onCheckedIn={onCheckedIn} />
              ) : (
                <Button label={t('ci.show')} variant="secondary" style={styles.mt} onPress={() => setShowCode(true)} testID="event-show-code" />
              )}
              {window !== 'closed' && reg?.status !== 'checked_in' ? <Button label={t('ev.cancel.ok')} variant="danger" style={styles.mt} onPress={cancel} loading={busy} disabled={busy} /> : null}
            </Surface>
          ) : needsSignIn ? (
            <SignInState title={t('ev.signin.title')} body={t('ev.signin.body')} onSignedIn={load} testID="event-signin" />
          ) : regErr ? null : window === 'open' && event.rules ? (
            <Surface style={styles.card} testID="event-register">
              <View style={styles.rowBetween}>
                <Text variant="bodySmall" tone="secondary" style={styles.flex}>
                  {t('ev.consent')}
                </Text>
                <Switch value={consent} onValueChange={setConsent} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('ev.consentA11y')} testID="event-consent" />
              </View>
              <Text variant="caption" tone="muted" style={styles.mt}>
                {t('ev.accept', { v: event.rules.version })}
              </Text>
              <Button label={event.spots_left === 0 ? t('ev.full') : t('ev.register')} style={styles.mt} onPress={() => void register()} loading={busy} loadingLabel={t('ev.registering')} disabled={busy || event.spots_left === 0 || !session} disabledReason={!session ? t('common.reasonConnectWallet') : event.spots_left === 0 ? t('ev.fullReason') : undefined} testID="event-register-btn" />
            </Surface>
          ) : (
            <InlineState kind="info" title={window === 'not_yet' ? t('ev.opensSoon.title') : event.state === 'cancelled' ? t('ev.cancelledEvent.title') : t('ev.closed.title')} body={window === 'not_yet' ? t('ev.opensSoon.body', { when: fmt(t, event.registration_opens_at) }) : event.state === 'cancelled' ? (event.cancel_reason ?? t('ev.cancelledEvent.body')) : t('ev.closed.body')} testID="event-closed" />
          )}
          {event.state !== 'cancelled' ? <Perks eventId={event.event_id} slug={event.slug} registration={registered ? (reg?.status === 'checked_in' ? 'checked_in' : 'registered') : 'none'} signedIn={!!session} /> : null}
          {event.state !== 'cancelled' ? <EventBadges eventId={event.event_id} badges={event.badges} registration={registered ? (reg?.status === 'checked_in' ? 'checked_in' : 'registered') : 'none'} reloadKey={reg?.status === 'checked_in' ? 1 : 0} /> : null}
          <Results eventId={event.event_id} slug={event.slug} registration={registered ? reg : null} onPrivacyChanged={setReg} />
        </>
      ) : null}
    </Screen>
  );
}

/** 無標籤時：讓參加者選報到站點後顯示代碼 */
function CheckInPicker({ eventId, onCheckedIn }: { eventId: string; onCheckedIn?: () => void }) {
  const { t } = useT();
  const [cps, setCps] = useState<{ checkpoint_id: string; name: string }[] | null>(null);
  const [cp, setCp] = useState<{ checkpoint_id: string; name: string } | null>(null);
  useEffect(() => {
    apiClient
      .partnerCheckpoints(eventId)
      .then((r) => {
        const list = r.checkpoints.filter((c) => c.purpose === 'check_in');
        setCps(list);
        setCp(list[0] ?? null);
      })
      .catch(() => setCps([]));
  }, [eventId]);
  if (cps === null) return null;
  if (cps.length === 0) return <InlineState kind="info" title={t('ci.title')} body={t('ev.checkInHint')} testID="checkin-no-checkpoint" />;
  return (
    <>
      {cps.length > 1 ? (
        <View style={[styles.rowBetween, styles.mt]}>
          {cps.map((c) => (
            <Pressable key={c.checkpoint_id} onPress={() => setCp(c)} accessibilityRole="radio" accessibilityState={{ selected: cp?.checkpoint_id === c.checkpoint_id }}>
              <Chip label={c.name} kind={cp?.checkpoint_id === c.checkpoint_id ? 'synced' : 'neutral'} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {cp ? <CheckInCode key={cp.checkpoint_id} eventId={eventId} checkpointId={cp.checkpoint_id} checkpointName={cp.name} onCheckedIn={onCheckedIn} /> : null}
    </>
  );
}

/** NFC／QR 標籤狀態（E-04）；報到／核銷動作在 E-05／E-06 接上 */
function TagBanner({ tag }: { tag: TagState | 'checking' | 'unknown' | 'signin' }) {
  const { t } = useT();
  if (tag === 'checking') return <InlineState kind="info" title={t('tag.checking')} testID="tag-checking" />;
  if (tag === 'signin') return <InlineState kind="info" title={t('common.signInRequired')} body={t('tag.signin')} testID="tag-signin" />;
  if (tag === 'unknown') return <InlineState kind="warning" title={t('tag.unknown.title')} body={t('tag.unknown.body')} testID="tag-unknown" />;
  if (tag.status === 'revoked') return <InlineState kind="warning" title={t('tag.revoked.title')} body={t('tag.revoked.body')} testID="tag-revoked" />;
  if (tag.status === 'not_yours') return <InlineState kind="warning" title={t('tag.notYours.title')} body={t('tag.notYours.body')} testID="tag-not-yours" />;
  const body = tag.purpose === 'participant' ? t('tag.active.participant') : tag.checkpoint?.purpose === 'check_in' ? t('tag.active.checkIn') : tag.checkpoint?.purpose === 'redemption' ? t('tag.active.redemption') : t('tag.active.info');
  return <InlineState kind="success" title={t('tag.active.title', { name: tag.checkpoint?.name ?? t('ev.event') })} body={body} testID="tag-active" />;
}

function Row({ icon, label, value }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Feather name={icon} size={16} color={color.textMuted} style={styles.rowIcon} />
      <View style={styles.flex}>
        <Text variant="label" tone="muted" uppercase>
          {label}
        </Text>
        <Text variant="bodySmall" numeric>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m, borderRadius: radius.l },
  mt: { marginTop: space.s },
  flex: { flex: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.s },
  row: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.s },
  rowIcon: { marginTop: 2, marginRight: space.s },
});
