import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button, Chip, InlineState, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import { apiClient, type EventRegistration, type EventResultRow, type EventResults, type MyResult } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

type Props = { eventId: string; slug: string; registration: EventRegistration | null; onPrivacyChanged?: (r: EventRegistration) => void };

export const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * 活動成績（PG-E-08，FR-12.3／BR-31／BR-32）：公開榜只含同意者的顯示名稱；主辦方成績標示來源、不冒充 Health Connect 驗證。
 * 本人成績來自 event-history（含更正版本與原因）；公開同意與顯示名稱可在此調整，撤回即移出公開榜。
 */
export function Results({ eventId, slug, registration, onPrivacyChanged }: Props) {
  const { t } = useT();
  const [board, setBoard] = useState<EventResults | null>(null);
  const [mine, setMine] = useState<MyResult[] | null>(null);
  const [consent, setConsent] = useState(registration?.public_consent ?? false);
  const [name, setName] = useState(registration?.display_name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ kind: 'success' | 'error'; title: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await apiClient.eventResults(slug));
    } catch {
      setBoard((b) => b ?? { event_id: eventId, slug, total_finished: 0, results: [], non_finishers: [], source: 'organizer' });
    }
    if (registration && registration.status !== 'cancelled') {
      try {
        const h = await apiClient.myEventHistory();
        setMine(h.items.find((i) => i.event?.event_id === eventId)?.results ?? []);
      } catch {
        setMine([]);
      }
    }
  }, [eventId, slug, registration]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setConsent(registration?.public_consent ?? false);
    setName(registration?.display_name ?? '');
  }, [registration?.public_consent, registration?.display_name]);

  const savePrivacy = async () => {
    setSaving(true);
    setSaved(null);
    try {
      const r = await apiClient.updateEventPrivacy(eventId, { public_consent: consent, display_name: name.trim() === '' ? null : name.trim() });
      onPrivacyChanged?.(r.registration);
      setSaved({ kind: 'success', title: t('res.saved') });
      await load();
    } catch (e) {
      setSaved({ kind: 'error', title: t('res.err.generic', { message: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setSaving(false);
    }
  };

  const latestMine = mine && mine.length > 0 ? mine[0]! : null;
  const hasBoard = !!board && (board.results.length > 0 || board.non_finishers.length > 0);
  if (!hasBoard && !latestMine && !(registration && registration.status !== 'cancelled')) return null;
  const dirty = consent !== (registration?.public_consent ?? false) || (name.trim() || null) !== (registration?.display_name ?? null);

  return (
    <Surface style={styles.card} testID="results">
      <Text variant="title">{t('res.title')}</Text>
      <Text variant="caption" tone="muted" style={styles.mt}>
        {t('res.source')}
      </Text>

      {latestMine ? (
        <View style={styles.mine} testID="results-mine">
          <Text variant="label" tone="mint" uppercase>
            {t('res.mine')}
          </Text>
          <View style={styles.rowBetween}>
            <Text variant="displayL" numeric>
              {latestMine.finish_status === 'finished' ? formatElapsed(latestMine.elapsed_ms) : t(`res.status.${latestMine.finish_status}` as TKey)}
            </Text>
            {latestMine.rank !== null ? <Chip label={`#${latestMine.rank}`} kind="level" /> : null}
          </View>
          <Text variant="caption" tone="secondary">
            {latestMine.discipline}
            {latestMine.division ? ` · ${latestMine.division}` : ''} · {(latestMine.distance_m / 1000).toFixed(1)} km
          </Text>
          {latestMine.reason ? (
            <Text variant="caption" tone="warning" style={styles.mt}>
              {t('res.corrected', { reason: latestMine.reason })}
            </Text>
          ) : null}
          {mine && mine.length > 1 ? (
            <Text variant="caption" tone="muted" style={styles.mt}>
              {t('res.history', { n: mine.length - 1, count: mine.length - 1 })}
            </Text>
          ) : null}
          {!(registration?.public_consent ?? false) ? (
            <Text variant="caption" tone="muted" style={styles.mt}>
              {t('res.notPublic')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {registration && registration.status !== 'cancelled' ? (
        <View style={styles.privacy} testID="results-privacy">
          <Text variant="label" tone="muted" uppercase>
            {t('res.privacyTitle')}
          </Text>
          <View style={styles.rowBetween}>
            <Text variant="bodySmall" tone="secondary" style={styles.flex}>
              {t('res.consent')}
            </Text>
            <Switch value={consent} onValueChange={setConsent} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('res.consent')} testID="results-consent" />
          </View>
          <TextInput value={name} onChangeText={setName} maxLength={40} placeholder={t('res.displayName')} placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel={t('res.displayName')} testID="results-name" />
          <Text variant="caption" tone="muted">
            {t('res.displayNameHint')}
          </Text>
          {dirty ? <Button label={t('res.savePrivacy')} variant="secondary" style={styles.mt} onPress={() => void savePrivacy()} loading={saving} disabled={saving} testID="results-save" /> : null}
          {saved ? <InlineState kind={saved.kind} title={saved.title} testID={`results-${saved.kind}`} /> : null}
        </View>
      ) : null}

      {hasBoard && board ? (
        <View style={styles.board} testID="results-board">
          <Text variant="label" tone="muted" uppercase>
            {t('res.finished', { n: board.total_finished, count: board.total_finished })}
          </Text>
          {board.results.map((r, i) => (
            <Row key={`${r.display_name}-${i}`} r={r} index={i} />
          ))}
          {board.non_finishers.length > 0 ? (
            <>
              <Text variant="label" tone="muted" uppercase style={styles.mt}>
                {t('res.nonFinishers')}
              </Text>
              {board.non_finishers.map((r, i) => (
                <Row key={`nf-${r.display_name}-${i}`} r={r} index={i} status={t(`res.status.${r.finish_status}` as TKey)} />
              ))}
            </>
          ) : null}
        </View>
      ) : (
        <Text variant="bodySmall" tone="secondary" style={styles.mt}>
          {t('res.empty')}
        </Text>
      )}
    </Surface>
  );
}

function Row({ r, index, status }: { r: EventResultRow; index: number; status?: string }) {
  return (
    <View style={styles.row} testID={`results-row-${index}`}>
      <Text variant="bodySmall" tone="muted" numeric style={styles.rank}>
        {r.rank !== null ? `#${r.rank}` : '—'}
      </Text>
      <Text variant="body" style={styles.flex} numberOfLines={1}>
        {r.display_name}
      </Text>
      <Text variant="caption" tone="muted" style={styles.division}>
        {r.division ?? ''}
      </Text>
      <Text variant="body" numeric>
        {status ?? formatElapsed(r.elapsed_ms)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  mt: { marginTop: space.s },
  mine: { marginTop: space.m, padding: space.m, borderRadius: radius.m, backgroundColor: color.elevated },
  privacy: { marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: color.borderSubtle },
  board: { marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: color.borderSubtle },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 40, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  rank: { width: 40 },
  division: { width: 48, textAlign: 'right' },
  flex: { flex: 1 },
  input: { marginTop: space.xs, minHeight: 44, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, color: color.textPrimary, backgroundColor: color.elevated },
});
