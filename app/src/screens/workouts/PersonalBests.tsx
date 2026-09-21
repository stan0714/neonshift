import { useNftRevealStore } from '@/state/nftRevealStore';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Surface } from '@/components';
import { formatDuration, formatKm } from '@/domain/workouts';
import { useT, type TKey } from '@/i18n';
import { apiClient, type AchievementView, type PersonalBests as Pbs } from '@/services/api/ApiClient';
import { achievementService } from '@/services/chain/AchievementService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { useWalletStore } from '@/state/walletStore';
import { color, space, Text } from '@/theme';

/**
 * 個人最佳（PG-R-07，FR-15.1／BR-38）：固定類別、官方與裝置分開、戶外與室內分開；Baseline／刷新次數；
 * 來源更正或刪除後重算並提示。只比較本平台已匯入的有效紀錄（顯示「自 YYYY-MM-DD」）。
 */
export function PersonalBests({ reloadKey = 0 }: { reloadKey?: number }) {
  const { t } = useT();
  const session = useWalletStore((st) => st.session);
  const [data, setData] = useState<Pbs | null>(null);
  const [achievements, setAchievements] = useState<AchievementView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning' | 'error'; title: string; body?: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await apiClient.personalBests());
      setAchievements((await apiClient.myAchievements().catch(() => ({ items: [] }))).items);
    } catch {
      setData((d) => d ?? { rules_major: 1, imported_since: null, groups: [] });
    }
  }, []);

  /** 鑄造流程：逐次公開同意 → intent（registry 狀態）→ 費用確認 → 錢包簽送 */
  const mint = (pbId: string) => {
    if (!session) return;
    Alert.alert(t('pb.consentTitle'), t('pb.consentBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pb.consentPrivate'), onPress: () => void run(pbId, false) },
      { text: t('pb.consentShare'), onPress: () => void run(pbId, true) },
    ]);
  };
  const run = async (pbId: string, consent: boolean) => {
    if (!session) return;
    setBusy(pbId);
    setNotice(null);
    try {
      const intent = await achievementService.intent(pbId, consent);
      if (intent.status === 'minted') { setNotice({ kind: 'success', title: t('pb.minted'), body: t('pb.mintedBody') }); return; }
      if (intent.status !== 'approved' || !intent.proof) {
        setNotice(intent.status === 'pending_registry' ? { kind: 'info', title: t('pb.mintPending'), body: t('pb.pendingBody') } : { kind: 'warning', title: t('pb.revoked'), body: t('pb.revokedBody') });
        return;
      }
      const sol = (intent.fee_estimate_lamports / 1e9).toFixed(4);
      await new Promise<void>((resolve) => {
        Alert.alert(t('pb.feeTitle'), t('pb.feeBody', { sol }), [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve() },
          {
            text: t('pb.mintNow'),
            onPress: () => {
              void (async () => {
                try {
                  const r = await achievementService.mint(session.publicKey, intent);
                  if (r.kind === 'minted' && !r.alreadyMinted) useNftRevealStore.getState().enqueue({ id: r.asset, title: typeof intent.metadata_preview.name === 'string' ? intent.metadata_preview.name : undefined });
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
      setNotice({ kind: 'error', title: t('pb.err.generic', { message: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(null);
      await load();
    }
  };
  useEffect(() => {
    void load();
  }, [load, reloadKey]);
  if (!data) return null;
  const groups = data.groups.filter((g) => g.current || g.history.length);
  return (
    <Surface style={styles.card} testID="pbs">
      <Text variant="title">{t('pb.title')}</Text>
      {data.imported_since ? (
        <Text variant="caption" tone="muted">
          {t('pb.since', { date: data.imported_since.slice(0, 10) })}
        </Text>
      ) : null}
      {groups.length === 0 ? (
        <Text variant="bodySmall" tone="secondary" style={styles.mt} testID="pbs-empty">
          {t('pb.empty')}
        </Text>
      ) : null}
      {groups.map((g) => {
        const improvements = g.history.filter((h) => h.status === 'historical').length;
        const hadInvalid = g.history.some((h) => h.status === 'invalidated');
        return (
          <View key={g.key} style={styles.group} testID={`pb-${g.category}-${g.verification_class}`}>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Text variant="body">{t(`pb.cat.${g.category}` as TKey)}</Text>
                <Text variant="caption" tone="muted">
                  {t(`pb.class.${g.verification_class}` as TKey)}
                  {g.environment === 'indoor' ? ` · ${t('wo.env.indoor')}` : ''}
                  {g.current ? ` · ${new Date(g.current.achieved_at).toLocaleDateString()}` : ''}
                </Text>
                {hadInvalid ? (
                  <Text variant="caption" tone="warning">
                    {t('pb.invalidated')}
                  </Text>
                ) : null}
              </View>
              <View style={styles.right}>
                <Text variant="heading2" numeric>
                  {g.current ? (g.current.unit === 'ms' ? formatDuration(g.current.value) : formatKm(g.current.value)) : '—'}
                </Text>
                {g.current ? <Chip label={g.current.is_baseline ? t('pb.baseline') : t('pb.improved', { n: improvements, count: improvements })} kind={g.current.is_baseline ? 'neutral' : 'synced'} /> : null}
              </View>
            </View>
            {/* NFT 狀態／原因／鑄造鈕獨立成一列（實機 2026-09-21：放在右欄時長文案把左欄擠成 0 寬、整列變成一大塊空白） */}
            {g.current && session ? (() => {
              const a = achievements.find((x) => x.pb_id === g.current!.pb_id);
              if (a?.minted || a?.status === 'minted') return <View style={styles.nftRow}><Chip label={t('pb.minted')} kind="level" /></View>;
              if (a?.status === 'revoked' || a?.status === 'revoke_pending') return <View style={styles.nftRow}><Chip label={t('pb.revoked')} kind="offline" /></View>;
              if (a?.status === 'pending_registry') return <View style={styles.nftRow}><Chip label={t('pb.mintPending')} kind="devnet" /></View>;
              // PG-V-03：達成日 Active level < 3 或無等級歷史 → 只保留私人 PB，說明原因
              const el = g.nft_eligibility;
              if (el && el.status !== 'eligible') return <Text variant="caption" tone="muted" style={styles.nftRow} testID={`pb-nft-${el.status}-${g.category}-${g.verification_class}`}>{el.status === 'level_required' ? t('pb.nftLevelRequired', { need: el.required, had: el.level ?? 1 }) : t('pb.nftHistoryUnknown')}</Text>;
              return <Button label={t('pb.mint')} variant="secondary" style={styles.nftRow} onPress={() => mint(g.current!.pb_id)} loading={busy === g.current!.pb_id} disabled={busy !== null} testID={`pb-mint-${g.category}-${g.verification_class}`} />;
            })() : null}
          </View>
        );
      })}
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`pb-${notice.kind}`} /> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  mt: { marginTop: space.s },
  group: { paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  flex: { flex: 1 },
  right: { alignItems: 'flex-end', gap: space.xs, flexShrink: 0 },
  nftRow: { marginTop: space.xs },
});
