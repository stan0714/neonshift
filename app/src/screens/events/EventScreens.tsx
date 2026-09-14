import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type EventRegistration, type PartnerEventView } from '@/services/api/ApiClient';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

type Err = { code: string; message: string; ref?: string };
const toErr = (e: unknown): Err => (e instanceof ApiError ? { code: e.code, message: e.message, ...(e.requestId ? { ref: e.requestId } : {}) } : { code: 'UNKNOWN', message: String(e) });
const fmt = (iso: string | null, tz?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : 'TBA');
const stateLabel = (s: PartnerEventView['state']) => ({ draft: 'Draft', published: 'Open', cancelled: 'Cancelled', completed: 'Completed' })[s];

function registrationWindow(e: PartnerEventView, nowMs: number): 'open' | 'not_yet' | 'closed' {
  if (e.state !== 'published') return 'closed';
  if (e.registration_opens_at && nowMs < Date.parse(e.registration_opens_at)) return 'not_yet';
  if (e.registration_closes_at && nowMs >= Date.parse(e.registration_closes_at)) return 'closed';
  if (e.ends_at && nowMs >= Date.parse(e.ends_at)) return 'closed';
  return 'open';
}

/** 合作活動列表（PG-E-03，SD 11.1）：已發布活動；公開讀取不需登入。 */
export function EventsScreen() {
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
        Partner runs and walks. Register in the app, check in on site with NFC or QR, and collect your results and perks here.
      </Text>
      {err ? <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? 'Devnet is taking a break' : 'Something interrupted your shift'} body={`${err.message} Nothing changed.`} referenceId={err.ref} action={{ label: 'Try again', onPress: () => void load(), loading }} testID="events-error" /> : null}
      {events && events.length === 0 ? (
        <Surface style={styles.card} testID="events-empty">
          <Text variant="title">No events yet</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            Partner events appear here once organizers publish them.
          </Text>
        </Surface>
      ) : null}
      {events?.map((e) => (
        <Pressable key={e.event_id} onPress={() => navigation.navigate('EventDetail', { idOrSlug: e.slug })} accessibilityRole="button" accessibilityLabel={`${e.title}, ${stateLabel(e.state)}`} testID={`event-${e.slug}`}>
          <Surface style={styles.card}>
            <View style={styles.rowBetween}>
              <Text variant="title" style={styles.flex}>
                {e.title}
              </Text>
              <Chip label={stateLabel(e.state)} kind={e.state === 'published' ? 'synced' : 'offline'} />
            </View>
            <Text variant="bodySmall" tone="secondary" style={styles.mt} numeric>
              {fmt(e.starts_at, e.timezone)} · {e.timezone}
            </Text>
            <Text variant="caption" tone="muted" style={styles.mt}>
              {e.capacity === 0 ? `${e.registration_count} registered` : `${e.spots_left} of ${e.capacity} spots left`}
            </Text>
          </Surface>
        </Pressable>
      ))}
      {cursor ? <Button label="Load more" variant="secondary" style={styles.mt} onPress={() => void load(cursor)} loading={loading} loadingLabel="Loading…" /> : null}
    </Screen>
  );
}

/** 活動詳情：規則版本同意、報名／取消、容量、宣傳來源（deep link `neonshift.cc/e/<slug>?source=`）。 */
export function EventDetailScreen() {
  const { params } = useRoute<RouteProp<RootParamList, 'EventDetail'>>();
  const session = useWalletStore((s) => s.session);
  const [event, setEvent] = useState<PartnerEventView | null>(null);
  const [reg, setReg] = useState<EventRegistration | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [outcome, setOutcome] = useState<{ kind: 'success' | 'error'; title: string; body: string; ref?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const e = await apiClient.event(params.idOrSlug, params.source);
      setEvent(e);
      setErr(null);
      try {
        setReg((await apiClient.eventRegistration(e.event_id)).registration);
        setNeedsSignIn(false);
      } catch (x) {
        if (x instanceof ApiError && x.code === 'NO_SESSION') setNeedsSignIn(true);
      }
    } catch (e) {
      setErr(toErr(e));
    }
  }, [params.idOrSlug, params.source]);
  useEffect(() => {
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
      setOutcome({ kind: 'success', title: r.already ? 'Already registered' : 'You are registered', body: 'Bring your phone on event day. Check-in and perks show up here.' });
      await load();
    } catch (e) {
      const x = toErr(e);
      const copy: Record<string, [string, string]> = { EVENT_FULL: ['Event is full', 'All spots are taken. Nothing was charged.'], EVENT_NOT_OPEN: ['Registration closed', 'The registration window is not open.'], REVISION_CONFLICT: ['Rules were updated', 'The organizer changed the rules. Review and accept the current version.'], NO_SESSION: ['Sign in required', 'Sign in from the Arena tab, then register.'] };
      const [title, body] = copy[x.code] ?? ['Something interrupted your shift', `${x.message} Nothing changed.`];
      setOutcome({ kind: 'error', title, body, ...(x.ref ? { ref: x.ref } : {}) });
      if (x.code === 'REVISION_CONFLICT') await load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!event) return;
    Alert.alert('Cancel registration?', 'Your spot goes back to the pool. You can register again while registration is open.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel registration',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await apiClient.cancelEventRegistration(event.event_id);
            setReg(null);
            setOutcome({ kind: 'success', title: 'Registration cancelled', body: 'Your spot was released.' });
            await load();
          } catch (e) {
            const x = toErr(e);
            setOutcome({ kind: 'error', title: 'Could not cancel', body: x.message, ...(x.ref ? { ref: x.ref } : {}) });
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen scroll testID="event-detail-screen">
      {err ? <InlineState kind={err.code === 'NOT_FOUND' ? 'info' : 'error'} title={err.code === 'NOT_FOUND' ? 'Event not found' : 'Something interrupted your shift'} body={err.code === 'NOT_FOUND' ? 'This event is not published or the link is wrong.' : `${err.message} Nothing changed.`} referenceId={err.ref} action={err.code === 'NOT_FOUND' ? undefined : { label: 'Try again', onPress: () => void load() }} testID="event-error" /> : null}
      {event ? (
        <>
          <Surface hero>
            <View style={styles.rowBetween}>
              <Chip label={stateLabel(event.state)} kind={event.state === 'published' ? 'synced' : 'offline'} />
              {event.rules ? <Chip label={`Rules v${event.rules.version}`} kind="level" /> : null}
            </View>
            <Text variant="heading2" style={styles.mt}>
              {event.title}
            </Text>
            {event.description ? (
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                {event.description}
              </Text>
            ) : null}
            <Row icon="calendar" label="Event" value={`${fmt(event.starts_at, event.timezone)} → ${fmt(event.ends_at, event.timezone)} (${event.timezone})`} />
            <Row icon="map-pin" label="Your local time" value={`${fmt(event.starts_at)} → ${fmt(event.ends_at)}`} />
            <Row icon="edit-3" label="Registration" value={event.registration_closes_at ? `until ${fmt(event.registration_closes_at)}` : 'until the event starts'} />
            <Row icon="users" label="Capacity" value={event.capacity === 0 ? `${event.registration_count} registered · unlimited` : `${event.spots_left} of ${event.capacity} spots left`} />
            {event.state === 'cancelled' ? <Row icon="x-octagon" label="Cancelled" value={event.cancel_reason ?? 'by the organizer'} /> : null}
          </Surface>

          {event.rules ? (
            <Surface style={styles.card} testID="event-rules">
              <Text variant="label" tone="muted" uppercase>
                Rules · version {event.rules.version}
              </Text>
              {Object.entries(event.rules.rules).map(([k, v]) => (
                <Text key={k} variant="bodySmall" tone="secondary" style={styles.mt} numeric>
                  {k.replace(/_/g, ' ')}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </Text>
              ))}
            </Surface>
          ) : null}

          {outcome ? (
            <Pressable onPress={() => setOutcome(null)} accessibilityRole="button" accessibilityLabel="Dismiss">
              <InlineState kind={outcome.kind} title={outcome.title} body={outcome.body} referenceId={outcome.ref} testID={`event-${outcome.kind}`} />
            </Pressable>
          ) : null}

          {registered ? (
            <Surface style={styles.card} active testID="event-registered">
              <Text variant="title">You are registered</Text>
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                Accepted rules version {event.rules?.revision_id === reg?.accepted_rule_revision ? event.rules?.version : 'earlier'}. {reg?.status === 'checked_in' ? 'Checked in on site.' : 'Check in on site with NFC or QR on event day.'}
              </Text>
              {window !== 'closed' && reg?.status !== 'checked_in' ? <Button label="Cancel registration" variant="danger" style={styles.mt} onPress={cancel} loading={busy} disabled={busy} /> : null}
            </Surface>
          ) : needsSignIn ? (
            <InlineState kind="info" title="Sign in to register" body="Registration needs a backend session. Sign in from the Arena tab, then come back." testID="event-signin" />
          ) : window === 'open' && event.rules ? (
            <Surface style={styles.card} testID="event-register">
              <View style={styles.rowBetween}>
                <Text variant="bodySmall" tone="secondary" style={styles.flex}>
                  Show my name and result on the public board (you can change this later)
                </Text>
                <Switch value={consent} onValueChange={setConsent} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel="Public result consent" testID="event-consent" />
              </View>
              <Text variant="caption" tone="muted" style={styles.mt}>
                By registering you accept rules version {event.rules.version}. No payment, no health data is shared with the organizer.
              </Text>
              <Button label={event.spots_left === 0 ? 'Event is full' : 'Register'} style={styles.mt} onPress={() => void register()} loading={busy} loadingLabel="Registering…" disabled={busy || event.spots_left === 0 || !session} disabledReason={!session ? 'Connect your wallet' : event.spots_left === 0 ? 'All spots are taken' : undefined} testID="event-register-btn" />
            </Surface>
          ) : (
            <InlineState kind="info" title={window === 'not_yet' ? 'Registration opens soon' : event.state === 'cancelled' ? 'Event cancelled' : 'Registration closed'} body={window === 'not_yet' ? `Opens ${fmt(event.registration_opens_at)}.` : event.state === 'cancelled' ? (event.cancel_reason ?? 'Cancelled by the organizer.') : 'Registration is closed for this event.'} testID="event-closed" />
          )}
        </>
      ) : null}
    </Screen>
  );
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
