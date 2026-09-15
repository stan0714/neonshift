import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, InlineState, Surface } from '@/components';
import { useT } from '@/i18n';
import { ApiError, apiClient, type CheckinChallenge } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';

/**
 * 參加者報到代碼（PG-E-05，SD 11.4）：向後端取 120 秒 challenge，顯示 QR＋8 碼給 staff 掃描／輸入。
 * 離線時不顯示「已報到」；到場確認只由 staff 端完成。
 */
export function CheckInCode({ eventId, checkpointId, checkpointName }: { eventId: string; checkpointId: string; checkpointName: string }) {
  const { t } = useT();
  const [ch, setCh] = useState<CheckinChallenge | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);

  const fetchCode = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = await apiClient.checkinChallenge(eventId, checkpointId);
      setCh(c);
      setLeft(Math.max(0, Math.round((Date.parse(c.expires_at) - Date.now()) / 1000)));
    } catch (e) {
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: String(e) });
    } finally {
      setBusy(false);
    }
  }, [eventId, checkpointId]);

  useEffect(() => {
    void fetchCode();
  }, [fetchCode]);

  useEffect(() => {
    if (!ch) return;
    const timer = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(ch.expires_at) - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [ch]);

  if (err) return <InlineState kind={err.code === 'NOT_ELIGIBLE' ? 'info' : 'error'} title={t('ci.title')} body={err.code === 'NOT_ELIGIBLE' ? t('ci.err.NOT_ELIGIBLE') : t('ci.err.generic', { message: err.message })} action={{ label: t('ci.renew'), onPress: () => void fetchCode(), loading: busy }} testID="checkin-error" />;
  if (!ch) return null;
  const expired = left <= 0;
  return (
    <Surface style={styles.card} active={!expired} testID="checkin-code">
      <Text variant="label" tone="muted" uppercase>
        {t('ci.title')}
      </Text>
      <Pressable onPress={() => expired && void fetchCode()} style={styles.qrWrap} accessibilityRole="image" accessibilityLabel={`${t('ci.title')} ${ch.code}`}>
        <View style={[styles.qr, expired && styles.qrExpired]}>
          <QRCode value={ch.qr_payload} size={180} backgroundColor="#FFFFFF" color={color.canvas} />
        </View>
      </Pressable>
      <Text variant="displayL" numeric style={styles.code} selectable testID="checkin-code-text">
        {ch.code.slice(0, 4)} {ch.code.slice(4)}
      </Text>
      <Text variant="bodySmall" tone={expired ? 'warning' : 'secondary'} style={styles.body}>
        {expired ? t('ci.expired') : t('ci.body', { name: checkpointName, s: left })}
      </Text>
      <Button label={t('ci.renew')} variant="secondary" style={styles.btn} onPress={() => void fetchCode()} loading={busy} />
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space.m, alignItems: 'center' },
  qrWrap: { marginTop: space.s },
  qr: { padding: space.s, backgroundColor: '#FFFFFF', borderRadius: radius.m },
  qrExpired: { opacity: 0.25 },
  code: { marginTop: space.s, letterSpacing: 4 },
  body: { marginTop: space.xs, textAlign: 'center' },
  btn: { alignSelf: 'stretch', marginTop: space.s },
});
