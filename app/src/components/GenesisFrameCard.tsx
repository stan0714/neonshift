import { useEffect } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';

import { Button, Chip, InlineState } from '@/components';
import { useT, type TKey } from '@/i18n';
import type { SkrSkuView } from '@/services/api/ApiClient';
import { skrService } from '@/services/skr/SkrService';
import { genesisFrameActive, ownsGenesisFrame, pendingOrderFor, useSkrStore } from '@/state/skrStore';
import { shortAddress, useWalletStore } from '@/state/walletStore';
import { color, radius, space, Text } from '@/theme';

/**
 * SKR 獨立獎首款 SKU：已驗證首次 5 km 成就 → 可用官方 SKR 購買「Genesis Mint」收藏卡邊框（純外觀）。
 * 狀態：未開放（隱藏）／未達成／待登錄／可購買（價格、網路、收款人預覽）／訂單進行中（查看狀態、取消）／需人工處理／已擁有（選用開關）。
 * 規則（計畫 §1／§5）：成就不能買；SKR 不加 XP／排名；devnet 試跑一律標 TEST；付款送出後不重送、遺失回覆走 recover。
 */
export function GenesisFrameCard({ reloadKey = 0 }: { reloadKey?: number | string }) {
  const { t } = useT();
  const session = useWalletStore((s) => s.session);
  const st = useSkrStore();
  const wallet = session?.address ?? null;
  useEffect(() => { if (wallet) void st.refreshCatalog(wallet); }, [wallet, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!session || !wallet || !st.catalog || !st.catalog.enabled) return null;
  const cat = st.catalog;
  const sku: SkrSkuView | undefined = cat.skus.find((s) => s.sku === 'genesis_mint_frame');
  if (!sku) return null;
  const owned = ownsGenesisFrame(st, wallet);
  const active = genesisFrameActive(st, wallet);
  const pending = pendingOrderFor(st, wallet);
  const open = sku.open_order;
  const isTest = cat.network !== 'mainnet-beta';
  const busy = st.phase !== null;

  const buy = () => {
    Alert.alert(
      t('skr.confirmTitle'),
      t('skr.confirmBody', { amount: sku.price_display, network: isTest ? t('skr.networkTest') : t('skr.networkMainnet'), recipient: shortAddress(cat.recipient, 6) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('skr.pay', { amount: sku.price_display }), onPress: () => void st.purchase(session.publicKey, sku.sku) },
      ],
    );
  };

  const errorBody = st.error ? t(`skr.err.${st.error.code}` as TKey) : null;
  const outcome = st.outcome;
  return (
    <View style={[styles.card, active && styles.cardFramed]} testID="genesis-frame-card" accessible accessibilityLabel={t('skr.title')}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text variant="title">{t('skr.title')}</Text>
          <Text variant="caption" tone="muted">{t('skr.subtitle')}</Text>
        </View>
        <Chip label={isTest ? t('skr.chipTest') : t('skr.chipMainnet')} kind={isTest ? 'devnet' : 'level'} />
      </View>
      <Text variant="bodySmall" tone="secondary" style={styles.mt}>{t('skr.rules')}</Text>

      {owned ? (
        <View style={styles.row} testID="genesis-frame-owned">
          <View style={styles.flex}>
            <Chip label={t('skr.owned')} kind="synced" />
            <Text variant="caption" tone="muted" style={styles.mtXs}>{t('skr.ownedHint')}</Text>
          </View>
          <Switch value={active} onValueChange={(v) => void st.setUseGenesisFrame(wallet, v)} accessibilityLabel={t('skr.useFrame')} testID="genesis-frame-toggle" />
        </View>
      ) : open && (open.status === 'awaiting_payment' || open.status === 'confirming' || open.status === 'needs_review') ? (
        <View style={styles.mt} testID={`genesis-frame-order-${open.status}`}>
          <Chip label={t(`skr.order.${open.status}` as TKey)} kind={open.status === 'needs_review' ? 'devnet' : 'neutral'} />
          <Text variant="caption" tone="secondary" style={styles.mtXs}>{t(`skr.orderHint.${open.status}` as TKey, { amount: open.amount_display })}</Text>
          <View style={styles.actions}>
            {open.status !== 'needs_review' ? <Button label={t('skr.checkStatus')} variant="secondary" onPress={() => void st.recover(wallet, open.order_id)} loading={busy} disabled={busy} testID="genesis-frame-recover" /> : null}
            {open.status === 'awaiting_payment' ? <Button label={t('skr.payNow')} onPress={buy} disabled={busy} testID="genesis-frame-pay" /> : null}
            {open.status === 'awaiting_payment' ? <Button label={t('common.cancel')} variant="secondary" onPress={() => void st.cancel(wallet, open.order_id)} disabled={busy} testID="genesis-frame-cancel" /> : null}
          </View>
        </View>
      ) : sku.eligibility === 'eligible' ? (
        <View style={styles.mt} testID="genesis-frame-buy">
          <Text variant="heading2" numeric>{t('skr.price', { amount: sku.price_display })}</Text>
          <Text variant="caption" tone="muted">{t('skr.priceHint', { recipient: shortAddress(cat.recipient, 6) })}</Text>
          <Button label={busy && st.phase ? t(`skr.phase.${st.phase}` as TKey) : t('skr.buy')} onPress={buy} loading={busy} disabled={busy} style={styles.mt} testID="genesis-frame-buy-btn" />
        </View>
      ) : (
        <View style={styles.mt} testID={`genesis-frame-${sku.eligibility}`}>
          <Chip label={t(`skr.eligibility.${sku.eligibility}` as TKey)} kind="neutral" />
          <Text variant="caption" tone="muted" style={styles.mtXs}>{t(`skr.eligibilityHint.${sku.eligibility}` as TKey)}</Text>
        </View>
      )}

      {pending && !owned && !open ? (
        <View style={styles.mt} testID="genesis-frame-pending-local">
          <Text variant="caption" tone="secondary">{t('skr.pendingLocal')}</Text>
          <Button label={t('skr.checkStatus')} variant="secondary" onPress={() => void st.recover(wallet, pending.orderId)} loading={busy} disabled={busy} style={styles.mtXs} testID="genesis-frame-recover-local" />
        </View>
      ) : null}

      {outcome?.kind === 'fulfilled' ? <InlineState kind="success" title={t('skr.done')} body={t('skr.doneBody')} testID="genesis-frame-success" /> : null}
      {outcome?.kind === 'confirming' ? <InlineState kind="info" title={t('skr.order.confirming')} body={t('skr.orderHint.confirming', { amount: outcome.order.amount_display })} testID="genesis-frame-confirming" /> : null}
      {outcome?.kind === 'needs_review' ? <InlineState kind="warning" title={t('skr.order.needs_review')} body={t('skr.orderHint.needs_review', { amount: outcome.order.amount_display })} testID="genesis-frame-review" /> : null}
      {errorBody ? <InlineState kind={st.error?.code === 'REJECTED' ? 'warning' : 'error'} title={t('skr.failed')} body={errorBody} testID="genesis-frame-error" /> : null}
      {st.catalogError ? <Text variant="caption" tone="muted" style={styles.mt}>{t('skr.catalogError')}</Text> : null}
      <Text variant="caption" tone="muted" style={styles.mt}>{t('skr.footer')}</Text>
    </View>
  );
}

/** 供收藏卡套用的邊框樣式（擁有且選用時） */
export const genesisFrameStyle = { borderColor: color.warning, borderWidth: 2 } as const;
export { skrService };

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, padding: space.m, backgroundColor: color.surface, marginTop: space.s },
  cardFramed: genesisFrameStyle,
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space.s },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
  mt: { marginTop: space.s },
  mtXs: { marginTop: space.xs },
});
