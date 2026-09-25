import { MintProgress, type MintPhase } from '@/components/MintProgress';
import { applyLocalMints, recordLocalMint } from '@/services/chain/localMints';
import { useNftRevealStore } from '@/state/nftRevealStore';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState } from '@/components';
import { GenesisFrameCard, genesisFrameStyle } from '@/components/GenesisFrameCard';
import { genesisFrameActive, useSkrStore } from '@/state/skrStore';
import { useLocaleStore, useT, type TKey } from '@/i18n';
import { apiClient, type AchievementView, type MilestoneItem, type Milestones as Ms } from '@/services/api/ApiClient';
import { achievementService } from '@/services/chain/AchievementService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';
import { ShareCard } from '@/components/ShareCard';
import { achievementShareLayout, ACHIEVEMENT_SHARE_DEFAULT, SHARE_RENDERER_VERSION, shareUrl, type AchievementShareFields, type ShareImageLayout, type ShareRenderSpec } from '@/domain/shareImage';
import { copyCaption, shareLayout, shareTextInstead } from '@/services/share/shareImage';
import { APP_CONFIG } from '@/config/app';
import type Svg from 'react-native-svg';

/**
 * Milestones 收藏（PG-M-03；commemorative-nfts 5、Style 22、FR-17.4）：Genesis Distance 四枚＋First Finish。
 * 每張卡：章名、門檻、Organizer／Device、環境、狀態（未解鎖／裝置版待開放／待審／可領取／等待核准／已領取／已撤銷）。
 * 已達成用完整作品、不因鞋階變灰；同一筆長距離解鎖多章逐枚領取；領取前預覽逐項列出會公開的內容。顯示資料涵蓋起點。
 */
const ORDER: MilestoneItem['category'][] = ['first_5k', 'first_10k', 'first_half', 'first_marathon', 'first_finish'];
const IMAGE_BASE = 'https://neonshift.cc/nft/achievements/milestones/';

export function Milestones({ reloadKey = 0 }: { reloadKey?: number | string }) {
  const { t } = useT();
  const session = useWalletStore((st) => st.session);
  const skr = useSkrStore();
  const framed = genesisFrameActive(skr, session?.address ?? null); // SKR-06：擁有且選用 Genesis 邊框時套在里程碑卡片
  const [data, setData] = useState<Ms | null>(null);
  const [achievements, setAchievements] = useState<AchievementView[]>([]);
  const [mintPhase, setMintPhase] = useState<MintPhase | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning' | 'error'; title: string; body?: string } | null>(null);
  const load = useCallback(async () => {
    if (!session) { setData(null); return; }
    try {
      setData(await apiClient.milestones());
      setAchievements(applyLocalMints((await apiClient.myAchievements().catch(() => ({ items: [] }))).items).filter((a) => a.kind === 'milestone'));
    } catch {
      setData((d) => d ?? { rules_major: 1, imported_since: null, items: [], unlocked_by_source: [] });
    }
  }, [session]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  // registry 核准是伺服器端非同步發生的：回到這個分頁就重抓，否則「待核准」會一直停在畫面上直到重開 App
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // PG-SHARE-02／03：只有確認鑄造成功的成就能出收藏卡（§4.5）；送出前一定看得到整張圖（§4.4）
  const svgRef = useRef<Svg>(null);
  const locale = useLocaleStore((st) => st.locale);
  type ShareTarget = { key: string; item: MilestoneItem; detail: string | null; achievedAt: Date | null; title: string; spec: ShareRenderSpec };
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [shareFields, setShareFields] = useState<AchievementShareFields>(ACHIEVEMENT_SHARE_DEFAULT);
  // preview → rendering → handing_off → returned／error；一次只做一件事，連點不會產生兩張圖（§6.1）
  const [sharePhase, setSharePhase] = useState<'preview' | 'rendering' | 'handing_off' | 'returned'>('preview');
  const [shareErr, setShareErr] = useState<'render_failed' | 'no_target' | 'unpublishable' | 'stale' | null>(null);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const networkLabel = APP_CONFIG.cluster === 'mainnet-beta' ? t('share.card.net.mainnet') : t('share.card.net.devnet');
  const shareLink = shareUrl(APP_CONFIG.siteUrl, 'achievement', 'mint');
  const openShare = (m: MilestoneItem, a: AchievementView) => {
    setShareFields(ACHIEVEMENT_SHARE_DEFAULT); // NFT 已公開也不預先勾選（§5.4）
    setSharePhase('preview');
    setShareErr(null);
    setShareNote(null);
    setShare({
      key: m.key,
      item: m,
      title: t(`ms.cat.${m.category}` as TKey),
      detail: m.threshold_mm ? `${(Number(m.threshold_mm) / 1_000_000).toFixed(m.category === 'first_half' ? 4 : 3)} km` : null,
      achievedAt: m.first?.achieved_at ? new Date(m.first.achieved_at) : null,
      // 來源 ID／revision 只留在本機（§4.6）：不寫進圖檔、QR 或連結
      spec: { kind: 'achievement', source: a.source ? { id: a.source.id, revision: a.source.revision } : null, owner: session?.address ?? null, rendererVersion: SHARE_RENDERER_VERSION, locale, format: 'post' },
    });
  };
  const shareCardLayout = (target: ShareTarget, fields: AchievementShareFields): ShareImageLayout =>
    achievementShareLayout(
      { category: target.item.category, title: target.title, series: t('share.card.series'), detail: target.detail, achievedAt: target.achievedAt, verification: target.item.verification_class, edition: null },
      fields,
      { t: (k, pr) => t(k as TKey, pr), labels: { tagline: t('share.card.tagline'), site: 'neonshift.cc', notice: networkLabel }, qr: shareLink },
    );
  const captionOf = (target: ShareTarget) => t('share.invite.achievement', { name: target.title, network: networkLabel, url: shareLink });
  const sendShare = async () => {
    if (!share || sharePhase === 'rendering' || sharePhase === 'handing_off') return;
    setShareErr(null);
    setShareNote(null);
    setSharePhase('rendering');
    try {
      setSharePhase('handing_off');
      const r = await shareLayout({
        svg: svgRef.current,
        layout: shareCardLayout(share, shareFields),
        dialogTitle: t('share.card.title'),
        spec: share.spec,
        // 匯出期間換了帳號就作廢，不把圖寫到另一個帳號的分享（§4.6）
        stillValid: (spec) => spec.owner === (useWalletStore.getState().session?.address ?? null),
      });
      setSharePhase(r.ok ? 'returned' : 'preview');
      if (!r.ok) setShareErr(r.reason);
    } finally {
      setSharePhase((ph) => (ph === 'rendering' || ph === 'handing_off' ? 'preview' : ph));
    }
  };

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
    setMintPhase('server');
    try {
      const intent = await achievementService.milestoneIntent(key, consent);
      if (intent.status === 'minted') { setNotice({ kind: 'success', title: t('pb.minted'), body: t('pb.mintedBody') }); return; }
      if (intent.status !== 'approved' || !intent.proof) {
        setNotice((intent.status === 'pending_registry' || intent.status === 'approved' && !intent.proof) ? { kind: 'info', title: t('pb.mintPending'), body: t('pb.pendingBody') } : { kind: 'warning', title: t('pb.revoked'), body: t('ms.revokedBody') });
        return;
      }
      const attrs = ((intent.metadata_preview.attributes as { trait_type: string; value: string }[] | undefined) ?? []).map((a) => `• ${a.trait_type}: ${a.value}`).join('\n');
      setMintPhase('approved');
      const sol = (intent.fee_estimate_lamports / 1e9).toFixed(4);
      await new Promise<void>((resolve) => {
        Alert.alert(t('ms.previewTitle'), t('ms.previewBody', { attrs, sol }), [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve() },
          {
            text: t('pb.mintNow'),
            onPress: () => {
              void (async () => {
                try {
                  const r = await achievementService.mint(session.publicKey, intent, setMintPhase);
                  if (r.kind === 'minted') recordLocalMint(intent.achievement.achievement_id, { asset: r.asset, signature: r.signature ?? '' });
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
      setMintPhase(null);
      setBusy(null);
      await load();
    }
  };

  if (!session || !data) return null;
  const items = [...data.items].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || a.verification_class.localeCompare(b.verification_class));
  const multi = data.unlocked_by_source.filter((s) => s.categories.length > 1);
  return (
    <View testID="milestones">
      <MintProgress phase={mintPhase} />
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
            <View key={m.key} style={[styles.card, !unlocked && styles.cardLocked, framed && unlocked && genesisFrameStyle]} testID={`ms-${m.category}-${m.verification_class}`} accessible accessibilityLabel={`${t(`ms.cat.${m.category}` as TKey)} · ${t(`pb.class.${m.verification_class}` as TKey)} · ${t(`ms.state.${state}` as TKey)}`}>
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
                <>
                  <Text variant="caption" tone="muted" style={styles.mtXs} numberOfLines={1}>
                    {`${IMAGE_BASE}${m.category}-${m.verification_class}.svg`}
                  </Text>
                  {a ? <Button label={t('share.card.image')} variant="secondary" style={styles.mtXs} onPress={() => openShare(m, a)} testID={`ms-share-${m.category}-${m.verification_class}`} /> : null}
                </>
              ) : null}
            </View>
          );
        })}
      </View>
      {share ? (
        <View style={styles.shareBox} testID="ms-share-preview">
          <Text variant="title">{t('share.card.title')}</Text>
          <ShareCard ref={svgRef} layout={shareCardLayout(share, shareFields)} width={300} a11yLabel={t('share.card.a11y', { label: share.title, hero: share.title })} />
          {share.detail ? (
            <>
              <View style={styles.shareRow}>
                <Text variant="bodySmall" style={styles.shareLabel}>{t('share.card.detail')}</Text>
                <Switch value={shareFields.detail} onValueChange={(v) => setShareFields((f) => ({ ...f, detail: v }))} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('share.card.detail')} testID="ms-share-detail" />
              </View>
              <Text variant="caption" tone="muted">{t('share.card.detailNote')}</Text>
            </>
          ) : null}
          {share.achievedAt ? (
            <View style={styles.shareRow}>
              <Text variant="bodySmall" style={styles.shareLabel}>{t('share.card.date')}</Text>
              <Switch value={shareFields.date} onValueChange={(v) => setShareFields((f) => ({ ...f, date: v }))} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t('share.card.date')} testID="ms-share-date" />
            </View>
          ) : null}
          <Button label={t('share.card.image')} onPress={() => void sendShare()} loading={sharePhase === 'rendering' || sharePhase === 'handing_off'} loadingLabel={t('share.card.rendering')} disabled={sharePhase === 'rendering' || sharePhase === 'handing_off'} testID="ms-share-send" />
          <Button label={t('share.card.copy')} variant="secondary" onPress={() => void copyCaption(captionOf(share)).then((ok) => setShareNote(ok ? t('share.card.copied') : null))} testID="ms-share-copy" />
          <Button label={t('common.cancel')} variant="secondary" onPress={() => { setShare(null); setShareErr(null); setShareNote(null); }} testID="ms-share-cancel" />
          {/* 交付流程返回不等於對方已發布（§6.1） */}
          {sharePhase === 'returned' && !shareErr ? <Text variant="caption" tone="secondary" testID="ms-share-returned">{t('share.card.returned')}</Text> : null}
          {shareErr ? (
            <View style={styles.shareErr} testID={`ms-share-error-${shareErr}`}>
              <InlineState
                kind={shareErr === 'unpublishable' ? 'warning' : 'error'}
                title={t(shareErr === 'no_target' ? 'share.card.noTargetTitle' : shareErr === 'unpublishable' ? 'share.card.blockedTitle' : 'share.card.failedTitle')}
                body={t(shareErr === 'no_target' ? 'share.card.noTargetBody' : shareErr === 'unpublishable' ? 'share.card.blockedBody' : 'share.card.failedBody')}
              />
              {shareErr !== 'unpublishable' ? (
                <>
                  {shareErr === 'render_failed' ? <Button label={t('share.card.retry')} variant="secondary" onPress={() => void sendShare()} testID="ms-share-retry" /> : null}
                  <Button label={t('share.card.shareTextInstead')} variant="secondary" onPress={() => void shareTextInstead(captionOf(share))} testID="ms-share-text" />
                </>
              ) : null}
            </View>
          ) : null}
          {shareNote ? <Text variant="caption" tone="secondary" testID="ms-share-note">{shareNote}</Text> : null}
        </View>
      ) : null}
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`ms-${notice.kind}`} /> : null}
      <GenesisFrameCard reloadKey={reloadKey} />
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
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', gap: space.s, minHeight: 44 },
  shareLabel: { flex: 1 },
  shareErr: { alignSelf: 'stretch', gap: space.s },
  shareBox: { marginTop: space.m, padding: space.m, gap: space.s, alignItems: 'center', borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, backgroundColor: color.surface },
});
