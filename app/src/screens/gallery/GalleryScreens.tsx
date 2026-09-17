import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { COLLECTIBLES, collectibleName, stageName } from '@/domain/collectibles';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type GalleryBoard, type GalleryListResponse, type GalleryPlayerResponse, type GalleryPlayerView } from '@/services/api/ApiClient';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { PbCard } from './PbCard';
import { color, radius, space, Text } from '@/theme';
import { useT, type TKey } from '@/i18n';

type Err = { code: string; message: string; ref?: string };
const toErr = (e: unknown): Err => (e instanceof ApiError ? { code: e.code, message: e.message, ...(e.requestId ? { ref: e.requestId } : {}) } : { code: 'UNKNOWN', message: String(e) });
const dateOf = (taskDate: number) => new Date(taskDate * 86_400_000).toISOString().slice(0, 10);
const lvl = (n: number) => Math.min(5, Math.max(1, n)) as ShoeLevel;

function ErrorState({ err, retry, loading }: { err: Err; retry: () => void; loading: boolean }) {
  const { t } = useT();
  if (err.code === 'NO_SESSION') return <InlineState kind="info" title={t('gal.signin.title')} body={t('gal.signin.body')} testID="gallery-signin" />;
  return <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? t('common.devnetBreak') : t('common.somethingInterrupted')} body={t('gal.errBody', { message: err.message })} referenceId={err.ref} action={{ label: t('common.tryAgain'), onPress: retry, loading }} testID="gallery-error" />;
}

/** 12.1 列表：排名、短地址（本人標 You）、Lv、XP、收藏數；搜尋地址前綴；Updated 時間。 */
export function GalleryScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const me = useWalletStore((s) => s.session?.address ?? null);
  const [data, setData] = useState<GalleryListResponse | null>(null);
  const [results, setResults] = useState<GalleryPlayerView[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState<GalleryBoard>('active'); // PG-V-04：現役榜／歷史成就榜分開

  const load = useCallback(async (cursor: string | null = null) => {
    setLoading(true);
    try {
      const page = await apiClient.galleryPlayers(cursor, 50, board);
      setData((prev) => (cursor && prev ? { ...page, players: [...prev.players, ...page.players] } : page));
      setErr(null);
    } catch (e) {
      setErr(toErr(e));
    } finally {
      setLoading(false);
    }
  }, [board]);

  useEffect(() => {
    void load();
  }, [load]);

  const search = async (text: string) => {
    setQ(text);
    if (text.trim().length < 2) {
      setResults(null);
      return;
    }
    try {
      setResults((await apiClient.gallerySearch(text.trim())).players);
    } catch {
      setResults([]);
    }
  };

  const rows = results ?? data?.players ?? [];

  return (
    <Screen scroll testID="gallery-screen" refreshControl={<RefreshControl refreshing={loading && !data} onRefresh={() => void load()} tintColor={color.mint} />}>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={color.textMuted} />
        <TextInput value={q} onChangeText={(t) => void search(t)} placeholder={t('gal.search')} placeholderTextColor={color.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.search} accessibilityLabel={t('gal.search')} testID="gallery-search" />
      </View>
      <View style={styles.filters} accessibilityRole="tablist">
        {(['active', 'lifetime'] as const).map((b) => (
          <Pressable key={b} onPress={() => setBoard(b)} accessibilityRole="tab" accessibilityState={{ selected: board === b }} style={[styles.filter, board === b && styles.filterOn]} testID={`gallery-board-${b}`}>
            <Text variant="caption" tone={board === b ? undefined : 'secondary'} style={board === b && styles.filterOnText}>
              {t(`gal.board.${b}` as TKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      {data ? (
        <View style={styles.meta}>
          <Text variant="caption" tone="muted">
            {results ? t('gal.matches', { n: results.length, count: results.length }) : t('gal.players', { n: data.total, time: new Date(data.generated_at).toLocaleTimeString() })}
          </Text>
          {data.you && !results ? (
            <Text variant="caption" tone="mint">
              {t('gal.youAre', { rank: data.you.rank })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {err ? <ErrorState err={err} retry={() => void load()} loading={loading} /> : null}
      {data && rows.length === 0 && !err ? (
        <Surface style={styles.card} testID="gallery-empty">
          <Text variant="title">{results ? t('gal.noMatch.title') : t('gal.empty.title')}</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            {results ? t('gal.noMatch.body') : t('gal.empty.body')}
          </Text>
        </Surface>
      ) : null}
      {rows.map((p) => {
        const you = p.wallet === me;
        return (
          <Pressable key={p.wallet} onPress={() => navigation.navigate('GalleryPlayer', { wallet: p.wallet })} accessibilityRole="button" accessibilityLabel={t('gal.row', { name: you ? t('common.you') : shortAddress(p.wallet), rank: p.rank ?? '—', level: p.shoe_level })} testID={`gallery-row-${p.wallet}`}>
            <Surface style={[styles.row, you && styles.rowYou]} level={you ? 'elevated' : 'surface'}>
              <Text variant="title" numeric style={styles.rank}>
                #{p.rank ?? '—'}
              </Text>
              <View style={[styles.dot, { backgroundColor: SHOE_PROGRESSION.stages[lvl(p.shoe_level) - 1].tint }]} />
              <View style={styles.rowText}>
                <Text variant="title" numeric>
                  {you ? t('common.you') : shortAddress(p.wallet)}
                </Text>
                <Text variant="caption" tone="muted" numeric>
                  {t('gal.rowMeta', { xp: Number(p.xp), n: p.collectible_count, count: p.collectible_count })}
                </Text>
              </View>
              <Chip label={t('common.lv', { n: board === 'lifetime' ? (p.highest_level ?? p.shoe_level) : p.shoe_level })} kind={board === 'lifetime' ? 'synced' : 'level'} />
            </Surface>
          </Pressable>
        );
      })}
      {data?.next_cursor && !results ? <Button label={t('common.loadMore')} variant="secondary" style={styles.more} onPress={() => void load(data.next_cursor)} loading={loading} loadingLabel={t('common.loading')} testID="gallery-more" /> : null}
    </Screen>
  );
}

/** 12.1 玩家頁：大跑鞋（對方等級）、Lv／XP／streak／最近打卡日、已領取 NFT 網格；不顯示任何健康數值。 */
export function GalleryPlayerScreen() {
  const { t } = useT();
  const { params } = useRoute<RouteProp<RootParamList, 'GalleryPlayer'>>();
  const [data, setData] = useState<GalleryPlayerResponse | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'shoes' | 'events' | 'pb' | 'first'>('all');
  const navigation = useNavigation();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiClient.galleryPlayer(params.wallet));
      setErr(null);
    } catch (e) {
      setErr(toErr(e));
    } finally {
      setLoading(false);
    }
  }, [params.wallet]);

  useEffect(() => {
    void load();
  }, [load]);

  const p = data?.player;
  const stage = p ? SHOE_PROGRESSION.stages[lvl(p.shoe_level) - 1] : null;
  const nextXp = p ? (SHOE_PROGRESSION.stages as readonly { xp: number }[])[lvl(p.shoe_level)]?.xp ?? null : null;

  return (
    <Screen scroll testID="gallery-player-screen" refreshControl={<RefreshControl refreshing={loading && !data} onRefresh={() => void load()} tintColor={color.mint} />}>
      {err ? (
        err.code === 'NOT_FOUND' ? (
          <InlineState kind="info" title={t('gal.missing.title')} body={t('gal.missing.body')} testID="gallery-player-missing" />
        ) : (
          <ErrorState err={err} retry={() => void load()} loading={loading} />
        )
      ) : null}
      {p && stage ? (
        <>
          <Surface hero style={styles.hero} testID="gallery-player-hero">
            <View style={styles.heroHead}>
              <View>
                <Text variant="heading2" numeric>
                  {data?.is_you ? t('common.you') : shortAddress(p.wallet, 6)}
                </Text>
                <Text variant="caption" tone="muted" numeric selectable>
                  {p.wallet}
                </Text>
              </View>
              <Chip label={p.rank ? `#${p.rank}` : t('gal.unranked')} kind="level" />
            </View>
            <ShoeHero owner={p.wallet} level={lvl(p.shoe_level)} size={220} />
            <Text variant="title">
              {t('common.lvDot', { n: p.shoe_level })} · {stageName(t, lvl(p.shoe_level))}
            </Text>
          </Surface>
          <View style={styles.stats}>
            <Stat label="XP" value={Number(p.xp).toLocaleString()} tint={color.mint} />
            <Stat label={t('gal.streak')} value={t('gal.days', { n: p.streak_days })} tint={color.cyan} />
            <Stat label={t('gal.bestStreak')} value={t('gal.days', { n: p.max_streak_days })} tint={color.violet} />
          </View>
          <Text variant="caption" tone="muted" style={styles.mt}>
            {t('gal.lastClockIn', { date: p.last_task_date === null ? t('gal.never') : dateOf(p.last_task_date), core: p.core_level })}
          </Text>

          {data?.is_you && data.hidden ? <InlineState kind="info" title={t('gal.hiddenNote')} testID="gallery-hidden-note" /> : null}
          <View style={styles.filters} accessibilityRole="tablist">
            {(['all', 'shoes', 'events', 'pb', 'first'] as const).map((f) => (
              <Pressable key={f} onPress={() => setFilter(f)} accessibilityRole="tab" accessibilityState={{ selected: filter === f }} style={[styles.filter, filter === f && styles.filterOn]} testID={`gallery-filter-${f}`}>
                <Text variant="caption" tone={filter === f ? undefined : 'secondary'} style={filter === f && styles.filterOnText}>
                  {t(`gal.filter.${f}` as TKey)}
                </Text>
              </Pressable>
            ))}
          </View>
          {filter === 'all' || filter === 'first' ? (() => {
            // PG-M-03：首次里程碑（Genesis Distance／First Finish）與 PB 分開列，不混稱
            const firsts = (data?.achievements ?? []).filter((a) => a.series === 'genesis_distance' || a.series === 'first_finish');
            return filter === 'first' || firsts.length ? (
              <>
                <View style={styles.sectionHead}>
                  <Text variant="label" tone="muted" uppercase>
                    {t('gal.firstSection')}
                  </Text>
                </View>
                {firsts.length === 0 ? (
                  <Text variant="bodySmall" tone="secondary" testID="gallery-no-first">
                    {t('gal.noFirst')}
                  </Text>
                ) : (
                  <View style={styles.grid}>
                    {firsts.map((a) => (
                      <View key={a.achievement_id} style={styles.cell}>
                        <PbCard a={a} onPress={a.asset ? () => navigation.navigate('AchievementDetail', { asset: a.asset! }) : undefined} testID={`gallery-first-${a.achievement_id}`} />
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null;
          })() : null}
          {filter === 'all' || filter === 'pb' ? (
            <>
              <View style={styles.sectionHead}>
                <Text variant="label" tone="muted" uppercase>
                  {t('gal.pbSection')}
                </Text>
                {data?.is_you ? (
                  <Pressable onPress={() => navigation.navigate('Workouts')} accessibilityRole="link" hitSlop={8} testID="gallery-pb-cabinet">
                    <Text variant="label" tone="cyan" uppercase>
                      {t('gal.pbCabinet')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {(data?.achievements ?? []).filter((a) => a.series === 'pb_speed' || a.series === 'pb_distance').length === 0 ? (
                <Text variant="bodySmall" tone="secondary" testID="gallery-no-pb">
                  {t('gal.noPb')}
                </Text>
              ) : (
                <View style={styles.grid}>
                  {(data?.achievements ?? []).filter((a) => a.series === 'pb_speed' || a.series === 'pb_distance').map((a) => (
                    <View key={a.achievement_id} style={styles.cell}>
                      <PbCard a={a} onPress={a.asset ? () => navigation.navigate('AchievementDetail', { asset: a.asset! }) : undefined} testID={`gallery-pb-${a.achievement_id}`} />
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : null}
          {filter === 'all' || filter === 'events' ? (() => {
            // PG-M-04：活動留念章（報到／完賽）獨立區塊
            const evs = (data?.achievements ?? []).filter((a) => a.series === 'event_check_in' || a.series === 'event_finish');
            return filter === 'events' || evs.length ? (
              <>
                <View style={styles.sectionHead}>
                  <Text variant="label" tone="muted" uppercase>
                    {t('gal.eventSection')}
                  </Text>
                </View>
                {evs.length === 0 ? (
                  <Text variant="bodySmall" tone="secondary" testID="gallery-events-empty">
                    {t('gal.noEvents')}
                  </Text>
                ) : (
                  <View style={styles.grid}>
                    {evs.map((a) => (
                      <View key={a.achievement_id} style={styles.cell}>
                        <PbCard a={a} onPress={a.asset ? () => navigation.navigate('AchievementDetail', { asset: a.asset! }) : undefined} testID={`gallery-event-${a.achievement_id}`} />
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : null;
          })() : null}
          {filter === 'all' || filter === 'shoes' ? (
          <>
          <View style={styles.sectionHead}>
            <Text variant="label" tone="muted" uppercase>
              {t('gal.collection')}
            </Text>
            <Text variant="label" tone="secondary" numeric>
              {data?.collectibles.length}/{COLLECTIBLES.length}
            </Text>
          </View>
          {data && data.collectibles.length === 0 ? (
            <Surface style={styles.card} testID="gallery-no-collectibles">
              <Text variant="title">{t('gal.noCollectibles.title')}</Text>
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                {t('gal.noCollectibles.body', { progress: nextXp !== null ? t('gal.xpToNext', { n: Math.max(0, nextXp - Number(p.xp)), level: p.shoe_level + 1 }) : t('gal.maxLevel') })}
              </Text>
            </Surface>
          ) : null}
          <View style={styles.grid}>
            {data?.collectibles.map((c) => {
              const item = COLLECTIBLES.find((x) => x.kind === c.kind);
              return (
                <View key={c.kind} style={styles.cell}>
                  <Surface level="elevated" style={styles.tile} testID={`gallery-collectible-${c.kind}`}>
                    <View style={styles.tileArt}>{item?.shoeLevel ? <ShoeHero owner={p.wallet} level={item.shoeLevel} size={110} badge={false} /> : <Feather name={item?.icon ?? 'award'} size={36} color={color.warning} />}</View>
                    <Text variant="title" numberOfLines={1}>
                      {item ? collectibleName(t, item) : t('gal.collectibleN', { n: c.kind })}
                    </Text>
                    <Text variant="caption" tone="muted" numeric>
                      {new Date(c.claimed_at).toISOString().slice(0, 10)}
                    </Text>
                  </Surface>
                </View>
              );
            })}
          </View>
          </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <Surface style={styles.stat}>
      <Text variant="label" tone="muted" uppercase>
        {label}
      </Text>
      <Text variant="heading2" numeric style={{ color: tint }}>
        {value}
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, backgroundColor: color.surface, minHeight: 48 },
  search: { flex: 1, marginLeft: space.xs, color: color.textPrimary, fontSize: 16, paddingVertical: space.xs },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s },
  card: { marginTop: space.m },
  mt: { marginTop: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: space.s, padding: space.s, borderRadius: radius.m },
  rowYou: { borderColor: color.borderActive },
  rank: { width: 52 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: space.s },
  rowText: { flex: 1 },
  more: { marginTop: space.m },
  hero: { alignItems: 'center' },
  heroHead: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  stats: { flexDirection: 'row', gap: space.xs, marginTop: space.m },
  stat: { flex: 1, padding: space.s },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xl, marginBottom: space.xs },
  filters: { flexDirection: 'row', gap: space.xs, marginTop: space.m },
  filter: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  filterOn: { backgroundColor: color.mint, borderColor: color.mint },
  filterOnText: { color: color.onMint },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xxs },
  cell: { width: '50%', padding: space.xxs },
  tile: { flex: 1, padding: space.s, borderRadius: radius.l },
  tileArt: { alignItems: 'center', justifyContent: 'center', height: 92, marginBottom: space.xs },
});
