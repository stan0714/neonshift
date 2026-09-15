import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Chip, InlineState, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import { ApiError, apiClient, type EventBenefit, type Redemption } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

type Props = { eventId: string; slug: string; registration: 'none' | 'registered' | 'checked_in'; signedIn: boolean };

const KNOWN = ['BENEFIT_OUT_OF_STOCK', 'BENEFIT_LIMIT_REACHED', 'CHECKIN_REQUIRED', 'CLAIM_DEADLINE_PASSED', 'NOT_ELIGIBLE', 'EVENT_CANCELLED'];

/**
 * 活動權益（PG-E-06，FR-11.2／11.4）：品項與剩餘量對所有人可見；預留／領徽章需報名（實體品項預設需報到）。
 * 預留成功只代表「保留」，交付由 staff 確認；逾期／取消分開呈現，不把鏈下領取顯示成鏈上入帳。
 */
export function Perks({ eventId, slug, registration, signedIn }: Props) {
  const { t } = useT();
  const [benefits, setBenefits] = useState<EventBenefit[] | null>(null);
  const [mine, setMine] = useState<Redemption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ title: string; body?: string } | null>(null);
  const [keys] = useState(() => new Map<string, string>());
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try {
      const b = await apiClient.eventBenefits(eventId);
      setBenefits(b.benefits);
      if (signedIn && registration !== 'none') setMine((await apiClient.myRedemptions(eventId)).redemptions);
    } catch {
      setBenefits((cur) => cur ?? []);
    }
  }, [eventId, signedIn, registration]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!mine.some((r) => r.status === 'reserved')) return;
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, [mine]);

  const reserve = async (b: EventBenefit) => {
    // 同一品項重試沿用同一 idempotency key（回同一筆預留）
    const key = keys.get(b.benefit_id) ?? randomUUID();
    keys.set(b.benefit_id, key);
    setBusy(b.benefit_id);
    setErr(null);
    try {
      await apiClient.reserveRedemption(eventId, { benefit_id: b.benefit_id, idempotency_key: key });
      keys.delete(b.benefit_id);
      await load();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'UNKNOWN';
      setErr({ title: KNOWN.includes(code) ? t(`perk.err.${code}` as TKey) : t('perk.err.generic', { message: e instanceof Error ? e.message : String(e) }) });
      if (code !== 'UNKNOWN') await load();
    } finally {
      setBusy(null);
    }
  };

  if (!benefits || benefits.length === 0) return null;
  const now = Date.now();
  return (
    <Surface style={styles.card} testID="perks">
      <Text variant="title">{t('perk.title')}</Text>
      {registration === 'none' ? (
        <Text variant="bodySmall" tone="secondary" style={styles.mt}>
          {t('perk.needRegister')}
        </Text>
      ) : null}
      {benefits.map((b) => {
        const rs = mine.filter((r) => r.benefit_id === b.benefit_id);
        const reserved = rs.find((r) => r.status === 'reserved' && Date.parse(r.reserved_until) > now);
        const fulfilled = rs.find((r) => r.status === 'fulfilled');
        const expired = !reserved && !fulfilled && rs.some((r) => r.status === 'expired' || (r.status === 'reserved' && Date.parse(r.reserved_until) <= now));
        const claimedQty = rs.filter((r) => r.status === 'reserved' || r.status === 'fulfilled').reduce((n, r) => n + r.quantity, 0);
        const needCheckin = b.requires_checkin && registration !== 'checked_in';
        const canAct = registration !== 'none' && !reserved && !fulfilled && claimedQty < b.per_person_limit && b.remaining > 0 && !needCheckin;
        return (
          <View key={b.benefit_id} style={styles.item} testID={`perk-${b.benefit_id}`}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text variant="body">{b.name}</Text>
                <Text variant="caption" tone="muted">
                  {t(`perk.kind.${b.kind}` as TKey)}
                  {b.claim_deadline ? ` · ${t('perk.deadline', { when: new Date(b.claim_deadline).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}` : ''}
                </Text>
              </View>
              {fulfilled ? (
                <Chip label={b.kind === 'digital_badge' ? t('perk.badgeIssued') : t('perk.fulfilled')} kind="synced" />
              ) : (
                <Chip label={b.remaining > 0 ? t('perk.remaining', { n: b.remaining, count: b.remaining }) : t('perk.soldOut')} kind={b.remaining > 0 ? 'neutral' : 'offline'} />
              )}
            </View>
            {reserved ? (
              <View style={styles.reserved} testID={`perk-reserved-${b.benefit_id}`}>
                <Text variant="label" tone="success" uppercase>
                  {t('perk.reservedTitle')}
                </Text>
                <View style={styles.qr}>
                  <QRCode value={`neonshift-redeem:${slug}:${reserved.claim_code ?? ''}`} size={140} backgroundColor="#FFFFFF" color={color.canvas} />
                </View>
                <Text variant="displayL" numeric style={styles.code} selectable testID={`perk-code-${b.benefit_id}`}>
                  {(reserved.claim_code ?? '').slice(0, 4)} {(reserved.claim_code ?? '').slice(4)}
                </Text>
                <Text variant="caption" tone="secondary" style={styles.center}>
                  {t('perk.reservedBody', { m: Math.max(1, Math.ceil((Date.parse(reserved.reserved_until) - now) / 60_000)) })}
                </Text>
              </View>
            ) : null}
            {expired ? (
              <Text variant="caption" tone="warning" style={styles.mt}>
                {t('perk.expired')}
              </Text>
            ) : null}
            {fulfilled?.credential_id ? (
              <Text variant="caption" tone="muted" style={styles.mt} selectable>
                {fulfilled.credential_id}
              </Text>
            ) : null}
            {!fulfilled && !reserved && registration !== 'none' ? (
              <Button
                label={b.kind === 'digital_badge' ? t('perk.claimBadge') : t('perk.reserve')}
                variant="secondary"
                style={styles.mt}
                onPress={() => void reserve(b)}
                loading={busy === b.benefit_id}
                loadingLabel={t('perk.reserving')}
                disabled={!canAct || busy !== null}
                disabledReason={needCheckin ? t('perk.needCheckin') : b.remaining === 0 ? t('perk.soldOut') : undefined}
                testID={`perk-btn-${b.benefit_id}`}
              />
            ) : null}
          </View>
        );
      })}
      {err ? <InlineState kind="error" title={err.title} body={err.body} testID="perk-error" /> : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m },
  mt: { marginTop: space.s },
  item: { marginTop: space.m, paddingTop: space.m, borderTopWidth: 1, borderTopColor: color.borderSubtle },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  flex: { flex: 1 },
  reserved: { marginTop: space.s, alignItems: 'center' },
  qr: { marginTop: space.xs, padding: space.s, backgroundColor: '#FFFFFF', borderRadius: radius.m },
  code: { marginTop: space.xs, letterSpacing: 4 },
  center: { textAlign: 'center', marginTop: space.xs },
});
