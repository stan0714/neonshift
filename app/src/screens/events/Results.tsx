import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, TextInput, View } from 'react-native';

import { Button, Chip, InlineState, Surface } from '@/components';
import { ShareImageBlock } from '@/components/ShareImageBlock';
import { APP_CONFIG } from '@/config/app';
import { finishShareLayout, FINISH_SHARE_DEFAULT, type FinishShareFields } from '@/domain/shareImage';
import { useT, type TKey } from '@/i18n';
import { apiClient, type EventRegistration, type EventResultRow, type EventResults, type MyResult } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

/** `event` 只用來組完賽卡（標題與時間）；沒有傳就不提供完賽卡，不從 slug 猜活動名 */
type Props = { eventId: string; slug: string; registration: EventRegistration | null; event?: { title: string; whenLabel: string }; onPrivacyChanged?: (r: EventRegistration) => void };

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
export function Results({ eventId, slug, registration, event, onPrivacyChanged }: Props) {
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

      {/* PG-SHARE-06 時機 S5：完賽卡。只有真的完賽才有這張卡；DNF／DNS／DQ 不產生「完賽」圖 */}
      {latestMine && latestMine.finish_status === 'finished' && event ? (
        <FinishShare result={latestMine} event={event} slug={slug} />
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

/**
 * 完賽卡（PG-SHARE-06 時機 S5）。成績只由主辦方發布，所以第一行先說這筆「主辦方公布了沒有」，
 * 而不是先把時間放大——把未公布的成績當成成績分享出去，是這張卡唯一會造成的實質傷害。
 *
 * **完賽時間與名次預設關閉**：這是本次社群分享的獨立同意，與公開成績榜的 `public_consent`
 * 是兩件事（social-share §5.4）；成績榜已經公開也不預先勾選。名次還要求主辦方已公布，
 * 否則沒有可引用的來源。完賽章 NFT 是另一枚收藏，由成就卡呈現，這張卡不宣稱任何鏈上資產。
 */
function FinishShare({ result, event, slug }: { result: MyResult; event: { title: string; whenLabel: string }; slug: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<FinishShareFields>(FINISH_SHARE_DEFAULT);
  const official = !!result.published_at;
  const url = `${APP_CONFIG.siteUrl}/e/${slug}?source=finish`;
  const layout = finishShareLayout(
    {
      eventTitle: event.title,
      whenLabel: event.whenLabel,
      disciplineLabel: `${result.discipline}${result.division ? ` · ${result.division}` : ''} · ${(result.distance_m / 1000).toFixed(1)} km`,
      finishTime: formatElapsed(result.elapsed_ms),
      rank: result.rank,
      official,
      // 更正過就要寫在圖上：舊圖與新成績對不起來時，看圖的人才知道成績被改過
      corrected: result.previous_revision_id !== null || result.reason !== null,
    },
    fields,
    { t: (k, pr) => t(k as TKey, pr), labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc' }, qr: url },
  );
  return (
    <View style={styles.finish} testID="results-finish-share">
      <Button label={t('share.card.image')} variant="secondary" onPress={() => setOpen((o) => !o)} accessibilityState={{ expanded: open }} testID="results-finish-open" />
      {open ? (
        <ShareImageBlock layout={layout} caption={t('share.invite.finish', { title: event.title, url })} prefix="results-finish">
          <View style={styles.rowBetween}>
            <Text variant="bodySmall" style={styles.flex}>{t('share.card.time')}</Text>
            <Switch value={fields.time} onValueChange={(v) => setFields((f) => ({ ...f, time: v }))} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('share.card.time')} testID="results-finish-time" />
          </View>
          <Text variant="caption" tone="muted">{t('share.card.timeNote')}</Text>
          {official && result.rank !== null ? (
            <View style={styles.rowBetween}>
              <Text variant="bodySmall" style={styles.flex}>{t('share.card.rank')}</Text>
              <Switch value={fields.rank} onValueChange={(v) => setFields((f) => ({ ...f, rank: v }))} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('share.card.rank')} testID="results-finish-rank" />
            </View>
          ) : (
            <Text variant="caption" tone="muted" testID="results-finish-rank-na">{t('share.card.rankNote')}</Text>
          )}
        </ShareImageBlock>
      ) : null}
    </View>
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
  finish: { marginTop: space.s },
  privacy: { marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: color.borderSubtle },
  board: { marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: color.borderSubtle },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 40, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  rank: { width: 40 },
  division: { width: 48, textAlign: 'right' },
  flex: { flex: 1 },
  input: { marginTop: space.xs, minHeight: 44, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, color: color.textPrimary, backgroundColor: color.elevated },
});
