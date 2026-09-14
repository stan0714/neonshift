import { useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button, Chip, InlineState, Screen, Surface } from '@/components';
import { useT, type TKey } from '@/i18n';
import type { RootParamList } from '@/navigation/types';
import { ApiError, apiClient, type StaffCheckinResult } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

type Checkpoint = { checkpoint_id: string; name: string; purpose: string };

/**
 * 工作人員報到（PG-E-05，SD 11.4）：依名單核驗代碼並在授權站點確認到場；手動補登需理由（稽核）。
 * 掃描 QR 以輸入代碼取代（相機掃描為後續項目）；離線只保留待處理 UI，不先顯示已報到。
 */
export function StaffCheckInScreen() {
  const { t } = useT();
  const { params } = useRoute<RouteProp<RootParamList, 'StaffCheckIn'>>();
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [cp, setCp] = useState<Checkpoint | null>(null);
  const [code, setCode] = useState('');
  const [manual, setManual] = useState(false);
  const [wallet, setWallet] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<{ kind: 'success' | 'error' | 'warning'; title: string; body?: string } | null>(null);
  const [noRole, setNoRole] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cps, me, list] = await Promise.all([apiClient.partnerCheckpoints(params.eventId), apiClient.partnerMe(), apiClient.staffCheckins(params.eventId).catch(() => null)]);
      const mine = me.event_roles.filter((r) => r.event_id === params.eventId && r.role === 'staff');
      const allowed = cps.checkpoints.filter((c) => c.purpose === 'check_in' && (mine.some((r) => r.checkpoint_id === null) || mine.some((r) => r.checkpoint_id === c.checkpoint_id) || me.organizations.some((o) => o.role === 'owner')));
      setCheckpoints(allowed);
      setCp(allowed[0] ?? null);
      setCount(list?.check_ins.length ?? null);
      setNoRole(allowed.length === 0);
    } catch (e) {
      setNoRole(e instanceof ApiError && (e.status === 403 || e.status === 404));
      setCheckpoints([]);
    }
  }, [params.eventId]);
  useEffect(() => {
    void load();
  }, [load]);

  const confirm = async () => {
    if (!cp) return;
    setBusy(true);
    setOutcome(null);
    try {
      const r: StaffCheckinResult = manual
        ? await apiClient.staffCheckin(params.eventId, { wallet: wallet.trim(), checkpoint_id: cp.checkpoint_id, method: 'manual', reason: reason.trim() })
        : await apiClient.staffCheckin(params.eventId, { code: code.trim(), checkpoint_id: cp.checkpoint_id, method: 'qr' });
      const name = r.display_name ?? `${r.wallet.slice(0, 4)}…${r.wallet.slice(-4)}`;
      setOutcome({ kind: r.already ? 'warning' : 'success', title: r.already ? t('staff.okAlready', { name }) : t('staff.ok', { name }), body: r.confirmed_at });
      setCode('');
      setWallet('');
      setReason('');
      if (!r.already) setCount((c) => (c ?? 0) + 1);
    } catch (e) {
      const c = e instanceof ApiError ? e.code : 'UNKNOWN';
      const known = ['CHECKIN_CHALLENGE_EXPIRED', 'NOT_ELIGIBLE', 'ROLE_FORBIDDEN'].includes(c);
      setOutcome({ kind: 'error', title: known ? t(`staff.err.${c}` as TKey) : t('staff.err.generic', { message: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll testID="staff-checkin-screen">
      <Text variant="bodySmall" tone="secondary">
        {t('staff.intro')}
      </Text>
      {noRole ? <InlineState kind="warning" title={t('staff.noRole')} testID="staff-no-role" /> : null}
      {checkpoints && checkpoints.length > 0 ? (
        <>
          <Text variant="label" tone="muted" uppercase style={styles.mt}>
            {t('ci.pickCheckpoint')}
          </Text>
          <View style={styles.chips}>
            {checkpoints.map((c) => (
              <Pressable key={c.checkpoint_id} onPress={() => setCp(c)} accessibilityRole="radio" accessibilityState={{ selected: cp?.checkpoint_id === c.checkpoint_id }} testID={`cp-${c.checkpoint_id}`}>
                <Chip label={c.name} kind={cp?.checkpoint_id === c.checkpoint_id ? 'synced' : 'neutral'} />
              </Pressable>
            ))}
            {count !== null ? <Chip label={t('staff.count', { n: count, count })} kind="level" /> : null}
          </View>
          <Surface style={styles.card}>
            {!manual ? (
              <>
                <Text variant="label" tone="muted" uppercase>
                  {t('staff.code')}
                </Text>
                <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={64} placeholder="ABCD 2345" placeholderTextColor={color.textMuted} style={styles.input} accessibilityLabel={t('staff.code')} testID="staff-code" />
              </>
            ) : (
              <>
                <Text variant="label" tone="muted" uppercase>
                  {t('staff.wallet')}
                </Text>
                <TextInput value={wallet} onChangeText={setWallet} autoCapitalize="none" autoCorrect={false} style={styles.input} accessibilityLabel={t('staff.wallet')} testID="staff-wallet" />
                <Text variant="label" tone="muted" uppercase style={styles.mt}>
                  {t('staff.reason')}
                </Text>
                <TextInput value={reason} onChangeText={setReason} style={styles.input} accessibilityLabel={t('staff.reason')} testID="staff-reason" />
              </>
            )}
            <Button label={t('staff.confirm')} style={styles.mt} onPress={() => void confirm()} loading={busy} loadingLabel={t('staff.confirming')} disabled={busy || !cp || (manual ? wallet.trim().length < 32 || reason.trim().length < 3 : code.replace(/\s/g, '').length < 8)} testID="staff-confirm" />
            <Pressable onPress={() => setManual((m) => !m)} accessibilityRole="switch" accessibilityState={{ checked: manual }} style={styles.link} testID="staff-manual-toggle">
              <Text variant="bodySmall" tone="cyan">
                {t('staff.manual')}
              </Text>
            </Pressable>
          </Surface>
          {outcome ? <InlineState kind={outcome.kind} title={outcome.title} body={outcome.body} testID={`staff-${outcome.kind}`} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mt: { marginTop: space.m },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  card: { marginTop: space.m },
  input: { marginTop: space.xs, minHeight: 48, borderWidth: 1, borderColor: color.borderSubtle, borderRadius: radius.m, paddingHorizontal: space.s, color: color.textPrimary, fontSize: 18, backgroundColor: color.elevated },
  link: { marginTop: space.s, minHeight: 44, justifyContent: 'center' },
});
