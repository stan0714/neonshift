import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { SHOE_PROGRESSION, type ShoeLevel } from '@/config/shoeProgression';
import { COLLECTIBLES } from '@/domain/collectibles';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type GalleryListResponse, type GalleryPlayerResponse, type GalleryPlayerView } from '@/services/api/ApiClient';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

type Err = { code: string; message: string; ref?: string };
const toErr = (e: unknown): Err => (e instanceof ApiError ? { code: e.code, message: e.message, ...(e.requestId ? { ref: e.requestId } : {}) } : { code: 'UNKNOWN', message: String(e) });
const dateOf = (taskDate: number | null) => (taskDate === null ? 'never' : new Date(taskDate * 86_400_000).toISOString().slice(0, 10));
const lvl = (n: number) => Math.min(5, Math.max(1, n)) as ShoeLevel;

function ErrorState({ err, retry, loading }: { err: Err; retry: () => void; loading: boolean }) {
  if (err.code === 'NO_SESSION') return <InlineState kind="info" title="Sign in to browse the gallery" body="The gallery needs a backend session. Sign in from the Arena tab." testID="gallery-signin" />;
  return <InlineState kind={err.code === 'NETWORK_ERROR' ? 'warning' : 'error'} title={err.code === 'NETWORK_ERROR' ? 'Devnet is taking a break' : 'Something interrupted your shift'} body={`${err.message} Nothing changed.`} referenceId={err.ref} action={{ label: 'Try again', onPress: retry, loading }} testID="gallery-error" />;
}

/** 12.1 列表：排名、短地址（本人標 You）、Lv、XP、收藏數；搜尋地址前綴；Updated 時間。 */
export function GalleryScreen() {
  const navigation = useNavigation();
  const me = useWalletStore((s) => s.session?.address ?? null);
  const [data, setData] = useState<GalleryListResponse | null>(null);
  const [results, setResults] = useState<GalleryPlayerView[] | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (cursor: string | null = null) => {
    setLoading(true);
    try {
      const page = await apiClient.galleryPlayers(cursor);
      setData((prev) => (cursor && prev ? { ...page, players: [...prev.players, ...page.players] } : page));
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
        <TextInput value={q} onChangeText={(t) => void search(t)} placeholder="Search wallet address" placeholderTextColor={color.textMuted} autoCapitalize="none" autoCorrect={false} style={styles.search} accessibilityLabel="Search wallet address" testID="gallery-search" />
      </View>
      {data ? (
        <View style={styles.meta}>
          <Text variant="caption" tone="muted">
            {results ? `${results.length} match${results.length === 1 ? '' : 'es'}` : `${data.total} players · Updated ${new Date(data.generated_at).toLocaleTimeString()}`}
          </Text>
          {data.you && !results ? (
            <Text variant="caption" tone="mint">
              You are #{data.you.rank}
            </Text>
          ) : null}
        </View>
      ) : null}
      {err ? <ErrorState err={err} retry={() => void load()} loading={loading} /> : null}
      {data && rows.length === 0 && !err ? (
        <Surface style={styles.card} testID="gallery-empty">
          <Text variant="title">{results ? 'No player with that address' : 'No players yet'}</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mt}>
            {results ? 'Check the prefix — at least two characters of a base58 address.' : 'Be the first: claim your starter shoe and clock in.'}
          </Text>
        </Surface>
      ) : null}
      {rows.map((p) => {
        const you = p.wallet === me;
        return (
          <Pressable key={p.wallet} onPress={() => navigation.navigate('GalleryPlayer', { wallet: p.wallet })} accessibilityRole="button" accessibilityLabel={`${you ? 'You' : shortAddress(p.wallet)}, rank ${p.rank ?? '—'}, level ${p.shoe_level}`} testID={`gallery-row-${p.wallet}`}>
            <Surface style={[styles.row, you && styles.rowYou]} level={you ? 'elevated' : 'surface'}>
              <Text variant="title" numeric style={styles.rank}>
                #{p.rank ?? '—'}
              </Text>
              <View style={[styles.dot, { backgroundColor: SHOE_PROGRESSION.stages[lvl(p.shoe_level) - 1].tint }]} />
              <View style={styles.rowText}>
                <Text variant="title" numeric>
                  {you ? 'You' : shortAddress(p.wallet)}
                </Text>
                <Text variant="caption" tone="muted" numeric>
                  {Number(p.xp).toLocaleString()} XP · {p.collectible_count} collectible{p.collectible_count === 1 ? '' : 's'}
                </Text>
              </View>
              <Chip label={`LV. ${p.shoe_level}`} kind="level" />
            </Surface>
          </Pressable>
        );
      })}
      {data?.next_cursor && !results ? <Button label="Load more" variant="secondary" style={styles.more} onPress={() => void load(data.next_cursor)} loading={loading} loadingLabel="Loading…" testID="gallery-more" /> : null}
    </Screen>
  );
}

/** 12.1 玩家頁：大跑鞋（對方等級）、Lv／XP／streak／最近打卡日、已領取 NFT 網格；不顯示任何健康數值。 */
export function GalleryPlayerScreen() {
  const { params } = useRoute<RouteProp<RootParamList, 'GalleryPlayer'>>();
  const [data, setData] = useState<GalleryPlayerResponse | null>(null);
  const [err, setErr] = useState<Err | null>(null);
  const [loading, setLoading] = useState(false);

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
          <InlineState kind="info" title="No profile yet" body="This wallet has not claimed a starter shoe or clocked in." testID="gallery-player-missing" />
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
                  {data?.is_you ? 'You' : shortAddress(p.wallet, 6)}
                </Text>
                <Text variant="caption" tone="muted" numeric selectable>
                  {p.wallet}
                </Text>
              </View>
              <Chip label={p.rank ? `#${p.rank}` : 'Unranked'} kind="level" />
            </View>
            <ShoeHero level={lvl(p.shoe_level)} size={220} />
            <Text variant="title">
              Lv.{p.shoe_level} · {stage.name}
            </Text>
          </Surface>
          <View style={styles.stats}>
            <Stat label="XP" value={Number(p.xp).toLocaleString()} tint={color.mint} />
            <Stat label="Streak" value={`${p.streak_days}d`} tint={color.cyan} />
            <Stat label="Best streak" value={`${p.max_streak_days}d`} tint={color.violet} />
          </View>
          <Text variant="caption" tone="muted" style={styles.mt}>
            Last clock-in {dateOf(p.last_task_date)} UTC · Core Lv.{p.core_level}
          </Text>

          <View style={styles.sectionHead}>
            <Text variant="label" tone="muted" uppercase>
              Collection
            </Text>
            <Text variant="label" tone="secondary" numeric>
              {data?.collectibles.length}/{COLLECTIBLES.length}
            </Text>
          </View>
          {data && data.collectibles.length === 0 ? (
            <Surface style={styles.card} testID="gallery-no-collectibles">
              <Text variant="title">No collectibles yet</Text>
              <Text variant="bodySmall" tone="secondary" style={styles.mt}>
                {nextXp !== null ? `${Math.max(0, nextXp - Number(p.xp)).toLocaleString()} XP to Lv.${p.shoe_level + 1}.` : 'Max level reached.'} Collectibles are claimed in Gear.
              </Text>
            </Surface>
          ) : null}
          <View style={styles.grid}>
            {data?.collectibles.map((c) => {
              const item = COLLECTIBLES.find((x) => x.kind === c.kind);
              return (
                <View key={c.kind} style={styles.cell}>
                  <Surface level="elevated" style={styles.tile} testID={`gallery-collectible-${c.kind}`}>
                    <View style={styles.tileArt}>{item?.shoeLevel ? <ShoeHero level={item.shoeLevel} size={110} badge={false} /> : <Feather name={item?.icon ?? 'award'} size={36} color={color.warning} />}</View>
                    <Text variant="title" numberOfLines={1}>
                      {item?.name ?? `Collectible #${c.kind}`}
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.xxs },
  cell: { width: '50%', padding: space.xxs },
  tile: { flex: 1, padding: space.s, borderRadius: radius.l },
  tileArt: { alignItems: 'center', justifyContent: 'center', height: 92, marginBottom: space.xs },
});
