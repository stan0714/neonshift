import { useNftRevealStore } from '@/state/nftRevealStore';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState } from '@/components';
import { useT, type TKey } from '@/i18n';
import { apiClient, type AchievementView, type MilestoneItem, type Milestones as Ms } from '@/services/api/ApiClient';
import { achievementService } from '@/services/chain/AchievementService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

/**
 * Milestones 收藏（PG-M-03；commemorative-nfts 5、Style 22、FR-17.4）：Genesis Distance 四枚＋First Finish。
 * 每張卡：章名、門檻、Organizer／Device、環境、狀態（未解鎖／裝置版待開放／待審／可領取／等待核准／已領取／已撤銷）。
 * 已達成用完整作品、不因鞋階變灰；同一筆長距離解鎖多章逐枚領取；領取前預覽逐項列出會公開的內容。顯示資料涵蓋起點。
 */
const ORDER: MilestoneItem['category'][] = ['first_5k', 'first_10k', 'first_half', 'first_marathon', 'first_finish'];
const IMAGE_BASE = 'https://neonshift.cc/nft/achievements/milestones/';

export function Milestones({ reloadKey = 0 }: { reloadKey?: number }) {
  const { t } = useT();
  const session = useWalletStore((st) => st.session);
  const [data, setData] = useState<Ms | null>(null);
  const [achievements, setAchievements] = useState<AchievementView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning' | 'error'; title: string; body?: string } | null>(null);
  const load = useCallback(async () => {
    if (!session) { setData(null); return; }
    try {
      setData(await apiClient.milestones());
      setAchievements((await apiClient.myAchievements().catch(() => ({ items: [] }))).items.filter((a) => a.kind === 'milestone'));
    } catch {
      setData((d) => d ?? { rules_major: 1, imported_since: null, items: [], unlocked_by_source: [] });
    }
  }, [session]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  /** 逐次公開同意 → intent → 預覽會公開的內容＋費用 → 錢包簽送（與 PB 流程一致） */
  const mint = (key: string) => {
    if (!session) return;
    Alert.alert(t('ms.consentTitle'), t('ms.consentBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pb.consentPrivate'), onPress: () => void run(key, false) },
      { text: t('pb.consentShare'), onPress: () => void run(key, true) },
    ]);
  };
  const run = async (key: string, consent: boolean) => {
    if (!session) return;
    setBusy(key);
    setNotice(null);
    try {
      const intent = await achievementService.milestoneIntent(key, consent);
      if (intent.status === 'minted') { setNotice({ kind: 'success', title: t('pb.minted'), body: t('pb.mintedBody') }); return; }
      if (intent.status !== 'approved' || !intent.proof) {
        setNotice(intent.status === 'pending_registry' ? { kind: 'info', title: t('pb.mintPending'), body: t('pb.pendingBody') } : { kind: 'warning', title: t('pb.revoked'), body: t('ms.revokedBody') });
        return;
      }
      const attrs = ((intent.metadata_preview.attributes as { trait_type: string; value: string }[] | undefined) ?? []).map((a) => `• ${a.trait_type}: ${a.value}`).join('\n');
      const sol = (intent.fee_estimate_lamports / 1e9).toFixed(4);
      await new Promise<void>((resolve) => {
        Alert.alert(t('ms.previewTitle'), t('ms.previewBody', { attrs, sol }), [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve() },
          {
            text: t('pb.mintNow'),
            onPress: () => {
              void (async () => {
                try {
                  const r = await achievementService.mint(session.publicKey, intent);
                  if (r.kind === 'minted' && !r.alreadyMinted) useNftRevealStore.getState().enqueue({ id: r.asset, milestone: data?.items.find(item => item.key === key)?.category, title: typeof intent.metadata_preview.name === 'string' ? intent.metadata_preview.name : undefined });
                  if (r.kind === 'minted') setNotice({ kind: 'success', title: t('pb.minted'), body: t('pb.mintedBody') });
                } catch (e) {
                  const code = e instanceof ClaimError ? e.code : 'FAILED';
                  setNotice({ kind: 'error', title: code === 'REJECTED' || code === 'NETWORK_ERROR' || code === 'NOT_AVAILABLE' ? t(`pb.err.${code}` as TKey) : t('pb.err.generic', { message: e instanceof Error ? e.message : String(e) }) });
                } finally {
                  resolve();
                }
              })();
            },
          },
        ]);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setNotice({ kind: 'error', title: /MILESTONE_NOT_ELIGIBLE/.test(msg) ? t('ms.notEligible') : t('pb.err.generic', { message: msg }) });
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!session || !data) return null;
  const items = [...data.items].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.verification_class.localeCompare(b.verification_class));
  const multi = data.unlocked_by_source.filter((s) => s.categories.length > 1);
  return (
    <View testID="milestones">
      <Text variant="label" tone="secondary" uppercase style={styles.groupTitle}>
        {t('ms.title')}
      </Text>
      <Text variant="caption" tone="muted" style={styles.note}>
        {data.imported_since ? t('ms.since', { date: data.imported_since.slice(0, 10) }) : t('ms.noData')}
      </Text>
      {multi.map((s) => (
        <Text key={`${s.kind}-${s.id}`} variant="caption" tone="cyan" style={styles.note} testID="ms-multi">
          {t('ms.multiUnlock', { n: s.categories.length })}
        </Text>
      ))}
      <View style={styles.grid}>
        {items.map((m) => {
          const a = achievements.find((x) => x.milestone_key === m.key);
          const state: 'minted' | 'revoked' | 'pending_registry' | 'claimable' | MilestoneItem['status'] =
            a?.minted || a?.status === 'minted' ? 'minted' : a?.status === 'revoked' || a?.status === 'revoke_pending' ? 'revoked' : a?.status === 'pending_registry' ? 'pending_registry' : m.status === 'eligible' ? 'claimable' : m.status;
          const unlocked = state === 'minted' || state === 'claimable' || state === 'pending_registry' || (a?.status === 'approved');
          const chipKind = state === 'minted' ? 'level' : state === 'claimable' || a?.status === 'approved' ? 'synced' : state === 'revoked' ? 'offline' : state === 'pending_registry' || state === 'pending_review' ? 'devnet' : 'neutral';
          return (
            <View key={m.key} style={[styles.card, !unlocked && styles.cardLocked]} testID={`ms-${m.category}-${m.verification_class}`} accessible accessibilityLabel={`${t(`ms.cat.${m.category}` as TKey)} · ${t(`pb.class.${m.verification_class}` as TKey)} · ${t(`ms.state.${state}` as TKey)}`}>
              <Text variant="title">{t(`ms.cat.${m.category}` as TKey)}</Text>
              <Text variant="caption" tone="muted">
                {t(`ms.name.${m.category}` as TKey)}
              </Text>
              <Text variant="caption" tone="secondary" style={styles.mtXs}>
                {t(`pb.class.${m.verification_class}` as TKey)}
                {m.environment === 'indoor' ? ` · ${t('wo.env.indoor')}` : ''}
                {m.threshold_mm ? ` · ${t('ms.threshold', { km: (Number(m.threshold_mm) / 1_000_000).toFixed(m.category === 'first_half' ? 4 : 3) })}` : ''}
              </Text>
              {m.first?.achieved_at && unlocked ? (
                <Text variant="caption" tone="muted">
                  {t('ms.achievedOn', { date: m.first.achieved_at.slice(0, 10) })}
                </Text>
              ) : null}
              <View style={styles.row}>
                <Chip label={t(`ms.state.${state}` as TKey)} kind={chipKind} />
                {state === 'claimable' || a?.status === 'approved' ? (
                  <Button label={t('pb.mint')} variant="secondary" onPress={() => mint(m.key)} loading={busy === m.key} disabled={busy !== null} testID={`ms-mint-${m.category}-${m.verification_class}`} />
                ) : null}
              </View>
              {state === 'device_pending' ? (
                <Text variant="caption" tone="muted" style={styles.mtXs}>
                  {t('ms.devicePendingHint')}
                </Text>
              ) : null}
              {state === 'minted' ? (
                <Text variant="caption" tone="muted" style={styles.mtXs} numberOfLines={1}>
                  {`${IMAGE_BASE}${m.category}-${m.verification_class}.svg`}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`ms-${notice.kind}`} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  groupTitle: { marginTop: space.l, marginBottom: space.xs },
  note: { marginBottom: space.xs },
  grid: { gap: space.s },
  card: { borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, padding: space.m, backgroundColor: color.surface },
  cardLocked: { opacity: 0.7 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.s, gap: space.s },
  mtXs: { marginTop: space.xs },
});
