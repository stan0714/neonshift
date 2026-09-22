import { ShoePreview } from '@/components/ShoePreview';
import { genesisFrameActive, useSkrStore } from '@/state/skrStore';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, InlineState, Screen, Sheet, Surface } from '@/components';
import { CollectorPlate, type EditionState } from '@/components/CollectorPlate';
import { ShoeHero } from '@/components/ShoeHero';
import { ShoeStory } from '@/components/ShoeStory';
import { SignInState } from '@/components/SignInState';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { COLLECTIBLES, collectibleName, stageName } from '@/domain/collectibles';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type GalleryBoard, type GalleryListResponse, type GalleryPlayerResponse, type GalleryPlayerView } from '@/services/api/ApiClient';
import { collectibleService } from '@/services/chain/CollectibleService';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { PbCard } from './PbCard';
import { color, layout, radius, space, Text } from '@/theme';
import { useT, type TKey } from '@/i18n';

type Err = { code: string; message: string; ref?: string };
const toErr = (e: unknown): Err => (e instanceof ApiError ? { code: e.code, message: e.message, ...(e.requestId ? { ref: e.requestId } : {}) } : { code: 'UNKNOWN', message: String(e) });
const dateOf = (taskDate: number) => new Date(taskDate * 86_400_000).toISOString().slice(0, 10);
const lvl = (n: number) => Math.min(5, Math.max(1, n)) as ShoeLevel;
/** 搜尋去抖（review：每輸入一字就發請求，舊回應可能蓋掉新結果） */
const SEARCH_DEBOUNCE_MS = 300;

function ErrorState({ err, retry, loading }: { err: Err; retry: () => void; loading: boolean }) {
  const { t } = useT();
  if (err.code === 'NO_SESSION') return <SignInState title={t('gal.signin.title')} body={t('gal.signin.body')} onSignedIn={retry} testID="gallery-signin" />;
  return <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? t('common.devnetBreak') : t('common.somethingInterrupted')} body={t('gal.errBody', { message: err.message })} referenceId={err.ref} action={{ label: t('common.tryAgain'), onPress: retry, loading }} testID="gallery-error" />;
}

/**
 * 12.1 列表：排名、短地址（本人標 You）、Lv、XP、收藏數；搜尋地址前綴；Updated 時間。
 * review 修正：搜尋去抖＋請求序號（切榜同樣）、搜尋失敗顯示錯誤而非「找不到」、頂部「我的收藏」入口、FlatList 虛擬化、歷史榜等級一致。
 */
export function GalleryScreen() {
  const { t } = useT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const me = useWalletStore((s) => s.session?.address ?? null);
  const [data, setData] = useState<GalleryListResponse | null>(null);
  const [results, setResults] = useState<GalleryPlayerView[] | null>(null);
  const [searchErr, setSearchErr] = useState<Err | null>(null);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);
  const [board, setBoard] = useState<GalleryBoard>('active'); // PG-V-04：現役榜／歷史成就榜分開
  // 請求序號：只採用最後一次發出的回應（切榜、分頁、搜尋各自一組）
  const listSeq = useRef(0);
  const searchSeq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (cursor: string | null = null) => {
    const seq = ++listSeq.current;
    setLoading(true);
    try {
      const page = await apiClient.galleryPlayers(cursor, 50, board);
      if (seq !== listSeq.current) return; // 已被更新的請求取代（例如快速切榜）
      setData((prev) => (cursor && prev ? { ...page, players: [...prev.players, ...page.players] } : page));
      setErr(null);
    } catch (e) {
      if (seq !== listSeq.current) return;
      setErr(toErr(e));
    } finally {
      if (seq === listSeq.current) setLoading(false);
    }
  }, [board]);

  useEffect(() => {
    setData(null); // 切榜先清舊榜，避免舊榜資料配新榜標籤
    void load();
  }, [load]);

  const runSearch = useCallback(async (text: string) => {
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const r = await apiClient.gallerySearch(text);
      if (seq !== searchSeq.current) return;
      setResults(r.players);
      setSearchErr(null);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      setResults(null);
      setSearchErr(toErr(e)); // 失敗是失敗，不當成「找不到玩家」
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, []);

  const search = (text: string) => {
    setQ(text);
    if (debounce.current) clearTimeout(debounce.current);
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      searchSeq.current += 1; // 讓仍在飛的搜尋作廢
      setResults(null);
      setSearchErr(null);
      setSearching(false);
      return;
    }
    debounce.current = setTimeout(() => void runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const rows = results ?? data?.players ?? [];
  const searchingMode = q.trim().length >= 2;

  const header = (
    <>
      {me ? (
        <Pressable onPress={() => navigation.navigate('GalleryPlayer', { wallet: me })} accessibilityRole="button" accessibilityLabel={t('gal.mine.a11y')} testID="gallery-mine">
          <Surface hero style={styles.mine}>
            <View style={styles.flex}>
              <Text variant="title">{t('gal.mine.title')}</Text>
              <Text variant="caption" tone="secondary">{data?.you ? t('gal.mine.rank', { rank: data.you.rank }) : t('gal.mine.body')}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={color.mint} />
          </Surface>
        </Pressable>
      ) : null}
      <Text variant="label" tone="muted" uppercase style={styles.explore}>{t('gal.explore')}</Text>
      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={color.textMuted} />
        <TextInput value={q} onChangeText={search} placeholder={t('gal.search')} placeholderTextColor={color.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.search} accessibilityLabel={t('gal.search')} testID="gallery-search" />
        {searching ? <Text variant="caption" tone="muted" testID="gallery-searching">{t('common.loading')}</Text> : null}
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
      {data || results ? (
        <View style={styles.meta}>
          <Text variant="caption" tone="muted">
            {results ? t('gal.matches', { n: results.length, count: results.length }) : data ? t('gal.players', { n: data.total, time: new Date(data.generated_at).toLocaleTimeString() }) : ''}
          </Text>
          {data?.you && !results ? (
            <Text variant="caption" tone="mint">
              {t('gal.youAre', { rank: data.you.rank })}
            </Text>
          ) : null}
        </View>
      ) : null}
      {searchErr ? <InlineState kind={searchErr.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={t('gal.searchFailed')} body={t('gal.errBody', { message: searchErr.message })} action={{ label: t('common.tryAgain'), onPress: () => void runSearch(q.trim()), loading: searching }} testID="gallery-search-error" /> : null}
      {err && !searchingMode ? <ErrorState err={err} retry={() => void load()} loading={loading} /> : null}
      {(results ? results.length === 0 : data && rows.length === 0 && !err) ? (
        <Surface style={styles.card} testID="gallery-empty">
          <Text variant="title">{results ? t('gal.noMatch.title') : t('gal.empty.title')}</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            {results ? t('gal.noMatch.body') : t('gal.empty.body')}
          </Text>
        </Surface>
      ) : null}
    </>
  );

  return (
    <Screen testID="gallery-screen" style={styles.listScreen}>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.wallet}
        ListHeaderComponent={header}
        ListFooterComponent={data?.next_cursor && !results ? <Button label={t('common.loadMore')} variant="secondary" style={styles.more} onPress={() => void load(data.next_cursor)} loading={loading} loadingLabel={t('common.loading')} testID="gallery-more" /> : null}
        refreshControl={<RefreshControl refreshing={loading && !data} onRefresh={() => void load()} tintColor={color.mint} />}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: layout.screenPaddingX, paddingTop: insets.top + space.m, paddingBottom: insets.bottom + space.xl }}
        initialNumToRender={12}
        windowSize={7}
        testID="gallery-list"
        renderItem={({ item: p }) => {
          const you = p.wallet === me;
          // 歷史榜：名次、顏色、等級與讀屏文字一律用歷史最高等級
          const level = board === 'lifetime' ? (p.highest_level ?? p.shoe_level) : p.shoe_level;
          return (
            <Pressable onPress={() => navigation.navigate('GalleryPlayer', { wallet: p.wallet })} accessibilityRole="button" accessibilityLabel={t('gal.row', { name: you ? t('common.you') : shortAddress(p.wallet), rank: p.rank ?? '—', level })} testID={`gallery-row-${p.wallet}`}>
              <Surface style={[styles.row, you && styles.rowYou]} level={you ? 'elevated' : 'surface'}>
                <Text variant="title" numeric style={styles.rank}>
                  #{p.rank ?? '—'}
                </Text>
                <View style={[styles.dot, { backgroundColor: SHOE_PROGRESSION.stages[lvl(level) - 1].tint }]} />
                <View style={styles.rowText}>
                  <Text variant="title" numeric>
                    {you ? t('common.you') : shortAddress(p.wallet)}
                  </Text>
                  <Text variant="caption" tone="muted" numeric>
                    {t('gal.rowMeta', { xp: Number(p.xp), n: p.collectible_count, count: p.collectible_count })}
                  </Text>
                </View>
                <Chip label={t('common.lv', { n: level })} kind={board === 'lifetime' ? 'synced' : 'level'} />
              </Surface>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

/**
 * 12.1 玩家頁：大跑鞋（對方等級）、Lv／XP／streak／最近打卡日、已領取 NFT 網格；不顯示任何健康數值。
 * review 修正：載入失敗／404／換錢包時清除舊資料；空收藏給下一步；跑鞋收藏可點開詳情（取得日期、故事、鏈上 vs 外觀）。
 */
export function GalleryPlayerScreen() {
  const { t } = useT();
  const { params } = useRoute<RouteProp<RootParamList, 'GalleryPlayer'>>();
  const me = useWalletStore((s) => s.session?.address ?? null);
  const skr = useSkrStore();
  const framed = genesisFrameActive(skr, me); // SKR-06：只在本人頁面套 Genesis 邊框（他人頁面不顯示付費外觀）
  const [data, setData] = useState<GalleryPlayerResponse | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'shoes' | 'events' | 'pb' | 'first'>('all');
  const [shoeDetail, setShoeDetail] = useState<{ kind: number; claimedAt: string; asset: string } | null>(null);
  const navigation = useNavigation();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await apiClient.galleryPlayer(params.wallet);
      if (my !== seq.current) return;
      setData(r);
      setErr(null);
    } catch (e) {
      if (my !== seq.current) return;
      setData(null); // 對方退出藝廊／查無資料／失敗：不留舊收藏在畫面上
      setErr(toErr(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [params.wallet]);

  // 換錢包（身分切換）或換目標玩家 → 清畫面重查
  useEffect(() => {
    setData(null);
    setErr(null);
    setShoeDetail(null);
    void load();
  }, [load, me]);

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
                        <PbCard a={a} framed={!!data?.is_you && framed} onPress={a.asset ? () => navigation.navigate('AchievementDetail', { asset: a.asset! }) : undefined} testID={`gallery-first-${a.achievement_id}`} />
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
                {data.is_you ? t('gal.noCollectibles.you') : t('gal.noCollectibles.other')}
              </Text>
              <Text variant="caption" tone="muted" style={styles.mt}>
                {/* 升階由維持制度決定（每期活躍日／點數），XP 差額只是其一，不暗示立即升階 */}
                {nextXp !== null ? t('gal.levelNote', { n: Math.max(0, nextXp - Number(p.xp)), level: p.shoe_level + 1 }) : t('gal.maxLevel')}
              </Text>
              {data.is_you ? (
                <View style={styles.actions}>
                  <Button label={t('gal.next.claimable')} variant="secondary" onPress={() => navigation.navigate('Main', { screen: 'Gear' })} testID="gallery-next-gear" />
                  <Button label={t('gal.next.milestones')} variant="secondary" style={styles.mtS} onPress={() => navigation.navigate('Workouts')} testID="gallery-next-milestones" />
                  <Button label={t('gal.next.workout')} style={styles.mtS} onPress={() => navigation.navigate('WorkoutStart')} testID="gallery-next-workout" />
                </View>
              ) : null}
            </Surface>
          ) : null}
          <View style={styles.grid}>
            {data?.collectibles.map((c) => {
              const item = COLLECTIBLES.find((x) => x.kind === c.kind);
              return (
                <View key={c.kind} style={styles.cell}>
                  <Pressable onPress={() => setShoeDetail({ kind: c.kind, claimedAt: c.claimed_at, asset: c.asset })} accessibilityRole="button" accessibilityLabel={item ? collectibleName(t, item) : t('gal.collectibleN', { n: c.kind })} testID={`gallery-collectible-${c.kind}`}>
                    <Surface level="elevated" style={styles.tile}>
                      <View style={styles.tileArt}>{item?.shoeLevel ? <ShoeHero owner={p.wallet} level={item.shoeLevel} size={110} badge={false} /> : <Feather name={item?.icon ?? 'award'} size={36} color={color.warning} />}</View>
                      <Text variant="title" numberOfLines={1}>
                        {item ? collectibleName(t, item) : t('gal.collectibleN', { n: c.kind })}
                      </Text>
                      <Text variant="caption" tone="muted" numeric>
                        {new Date(c.claimed_at).toISOString().slice(0, 10)}
                      </Text>
                    </Surface>
                  </Pressable>
                </View>
              );
            })}
          </View>
          </>
          ) : null}
          {shoeDetail ? <CollectibleDetailSheet owner={p.wallet} isYou={!!data?.is_you} kind={shoeDetail.kind} claimedAt={shoeDetail.claimedAt} asset={shoeDetail.asset} onClose={() => setShoeDetail(null)} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

/** 收藏詳情（review P2-5）：取得日期、來源、NFT 編號、物種故事；明確區分 App 鞋面外觀與鏈上收藏 */
function CollectibleDetailSheet({ owner, isYou, kind, claimedAt, asset, onClose }: { owner: string; isYou: boolean; kind: number; claimedAt: string; asset: string; onClose: () => void }) {
  const { t } = useT();
  const item = COLLECTIBLES.find((x) => x.kind === kind);
  const level = item?.shoeLevel ?? null;
  const [edition, setEdition] = useState<EditionState>('loading');
  useEffect(() => {
    if (!level) return;
    let alive = true;
    collectibleService.fetchEdition(new PublicKey(owner), kind as 1).then((e) => alive && setEdition(e ?? 'unavailable')).catch(() => alive && setEdition('unavailable'));
    return () => { alive = false; };
  }, [owner, kind, level]);
  const explorer = `https://explorer.solana.com/address/${asset}?cluster=devnet`;
  return (
    <Sheet visible onClose={onClose} title={item ? collectibleName(t, item) : t('gal.collectibleN', { n: kind })} testID="gallery-collectible-detail" footer={<Button label={t('common.close')} variant="secondary" onPress={onClose} style={styles.flex} testID="gallery-collectible-detail-done" />}>
      <View style={styles.detailHero}>{level ? <ShoePreview owner={owner} level={level} size={260} /> : <Feather name={item?.icon ?? 'award'} size={64} color={color.warning} />}</View>
      <DetailRow label={t('gal.detail.claimed')} value={new Date(claimedAt).toLocaleString()} />
      <DetailRow label={t('gal.detail.reason')} value={item ? (level ? t('gal.detail.reasonStage', { n: level }) : t(item.unlockKey)) : '—'} />
      <DetailRow label={t('gal.detail.owner')} value={isYou ? t('common.you') : shortAddress(owner, 6)} />
      {level ? <View style={styles.mt}><CollectorPlate level={level} edition={edition} compact /></View> : null}
      <Text variant="caption" tone="muted" style={styles.mt}>{t('gal.detail.appearanceNote')}</Text>
      {level ? <ShoeStory level={level} preview={!isYou} /> : null}
      <Pressable onPress={() => void Linking.openURL(explorer)} accessibilityRole="link" style={styles.link} testID="gallery-collectible-detail-explorer">
        <Text variant="bodySmall" tone="cyan">{t('gal.detail.explorer')}</Text>
      </Pressable>
    </Sheet>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text variant="label" tone="muted" uppercase>{label}</Text>
      <Text variant="body" numeric style={styles.detailValue}>{value}</Text>
    </View>
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
  listScreen: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  explore: { marginTop: space.l, marginBottom: space.xs },
  searchRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, backgroundColor: color.surface, minHeight: 48 },
  search: { flex: 1, marginLeft: space.xs, color: color.textPrimary, fontSize: 16, paddingVertical: space.xs },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.s },
  card: { marginTop: space.m },
  mt: { marginTop: space.xs },
  mtS: { marginTop: space.s },
  flex: { flex: 1 },
  actions: { marginTop: space.m },
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
  detailHero: { alignItems: 'center', marginBottom: space.s },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: color.borderSubtle, gap: space.s },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  link: { marginTop: space.m, minHeight: 44, justifyContent: 'center' },
});
