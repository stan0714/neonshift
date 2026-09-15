import { useNftRevealStore } from '@/state/nftRevealStore';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, Chip, InlineState, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import { apiClient, type AchievementView, type EventBadgeItem } from '@/services/api/ApiClient';
import { achievementService } from '@/services/chain/AchievementService';
import { ClaimError } from '@/services/chain/StarterShoeService';
import { useWalletStore } from '@/state/walletStore';
import { color, space, Text } from '@/theme';

/**
 * 活動留念章（PG-M-04；commemorative-nfts 2、3）：主辦方發行的報到章／完賽章分開，每玩家／活動／章別一次。
 * 權限依報名時鞋階（Lv2）承諾，之後降級不沒收；未報名者只看到「需報名」。與基礎 First Finish 不同章。
 * 領取流程與 PB／里程碑一致：同意 → 領取預覽（會公開的內容＋rent）→ MWA。
 */
type Props = { eventId: string; badges: { check_in: boolean; finish: boolean } | undefined; registration: 'none' | 'registered' | 'checked_in'; reloadKey?: number };

export function EventBadges({ eventId, badges, registration, reloadKey = 0 }: Props) {
  const { t } = useT();
  const session = useWalletStore((st) => st.session);
  const [items, setItems] = useState<EventBadgeItem[] | null>(null);
  const [achievements, setAchievements] = useState<AchievementView[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'info' | 'warning' | 'error'; title: string; body?: string } | null>(null);
  const offered = !!badges && (badges.check_in || badges.finish);
  const load = useCallback(async () => {
    if (!session || registration === 'none') { setItems([]); return; }
    try {
      setItems((await apiClient.eventBadges()).items.filter((b) => b.event_id === eventId));
      setAchievements((await apiClient.myAchievements().catch(() => ({ items: [] }))).items.filter((a) => a.kind === 'event'));
    } catch {
      setItems((x) => x ?? []);
    }
  }, [session, registration, eventId]);
  useEffect(() => { void load(); }, [load, reloadKey]);

  const mint = (b: EventBadgeItem) => {
    if (!session) return;
    Alert.alert(t('eb.consentTitle'), t('eb.consentBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('pb.consentPrivate'), onPress: () => void run(b, false) },
      { text: t('pb.consentShare'), onPress: () => void run(b, true) },
    ]);
  };
  const run = async (b: EventBadgeItem, consent: boolean) => {
    if (!session) return;
    setBusy(b.key);
    setNotice(null);
    try {
      const intent = await achievementService.eventBadgeIntent(b.event_id, b.kind, consent);
      if (intent.status === 'minted') { setNotice({ kind: 'success', title: t('pb.minted'), body: t('pb.mintedBody') }); return; }
      if (intent.status !== 'approved' || !intent.proof) {
        setNotice(intent.status === 'pending_registry' ? { kind: 'info', title: t('pb.mintPending'), body: t('pb.pendingBody') } : { kind: 'warning', title: t('pb.revoked'), body: t('eb.revokedBody') });
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
      const msg = e instanceof Error ? e.message : String(e);
      setNotice({ kind: 'error', title: /EVENT_BADGE_NOT_ELIGIBLE/.test(msg) ? t('eb.notEligible') : t('pb.err.generic', { message: msg }) });
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (!offered) return null;
  const kinds: ('check_in' | 'finish')[] = [...(badges!.check_in ? ['check_in' as const] : []), ...(badges!.finish ? ['finish' as const] : [])];
  return (
    <Surface style={styles.card} testID="event-badges">
      <Text variant="title">{t('eb.title')}</Text>
      <Text variant="caption" tone="muted">
        {t('eb.note')}
      </Text>
      {kinds.map((kind) => {
        const b = items?.find((x) => x.kind === kind) ?? null;
        const a = achievements.find((x) => x.milestone_key === `event|${eventId}|${kind}`);
        const state: string = !session || registration === 'none' ? 'register' : !b ? 'loading' : a?.minted || a?.status === 'minted' ? 'minted' : a?.status === 'revoked' || a?.status === 'revoke_pending' ? 'revoked' : a?.status === 'pending_registry' ? 'pending_registry' : b.status === 'eligible' ? 'claimable' : b.status;
        const canMint = state === 'claimable' || (a?.status === 'approved' && b?.status === 'eligible');
        return (
          <View key={kind} style={styles.row} testID={`event-badge-${kind}`} accessible accessibilityLabel={`${t(`eb.kind.${kind}` as TKey)} · ${t(`eb.state.${state}` as TKey)}`}>
            <View style={styles.flex}>
              <Text variant="body">{t(`eb.kind.${kind}` as TKey)}</Text>
              <Text variant="caption" tone="muted">
                {state === 'level_locked' && b ? t('eb.levelLockedHint', { need: b.min_level, had: b.level_at_registration }) : t(`eb.hint.${kind}` as TKey)}
              </Text>
            </View>
            <View style={styles.right}>
              <Chip label={t(`eb.state.${state}` as TKey)} kind={state === 'minted' ? 'level' : canMint ? 'synced' : state === 'revoked' ? 'offline' : state === 'pending_registry' ? 'devnet' : 'neutral'} />
              {canMint && b ? <Button label={t('pb.mint')} variant="secondary" onPress={() => mint(b)} loading={busy === b.key} disabled={busy !== null} testID={`event-badge-mint-${kind}`} /> : null}
            </View>
          </View>
        );
      })}
      {notice ? <InlineState kind={notice.kind} title={notice.title} body={notice.body} testID={`eb-${notice.kind}`} /> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  flex: { flex: 1 },
  right: { alignItems: 'flex-end', gap: space.xs },
});
