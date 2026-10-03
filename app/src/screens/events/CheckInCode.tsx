import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, InlineState, Surface } from '@/components';
import { useT } from '@/i18n';
import { ApiError, apiClient, type CheckinChallenge } from '@/services/api/ApiClient';
import { color, radius, space, Text } from '@/theme';
import { apiErrorText } from '@/services/api/errorText';

/** 顯示代碼期間有限度輪詢報名狀態（review：staff 報到後參加者畫面要自動更新，不用反覆問工作人員） */
export const CHECKIN_POLL_MS = 5000;

/**
 * 參加者報到代碼（PG-E-05，SD 11.4）：向後端取 120 秒 challenge，顯示 QR＋8 碼給 staff 掃描／輸入。
 * 離線時不顯示「已報到」；到場確認只由 staff 端完成（本元件只輪詢後端狀態）。
 * review 修正：切換站點立即清空舊碼並顯示載入中、忽略舊站點的延遲回應；輪詢到 checked_in → 通知父層收起代碼。
 */
export function CheckInCode({ eventId, checkpointId, checkpointName, onCheckedIn }: { eventId: string; checkpointId: string; checkpointName: string; onCheckedIn?: () => void }) {
  const { t } = useT();
  const [ch, setCh] = useState<CheckinChallenge | null>(null);
  const [err, setErr] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  const seq = useRef(0);

  const fetchCode = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true);
    setErr(null);
    setCh(null); // 新站點／重新取得：舊碼不可再出示
    try {
      const c = await apiClient.checkinChallenge(eventId, checkpointId);
      if (my !== seq.current) return; // 已切到別的站點：丟棄這個延遲回應
      setCh(c);
      setLeft(Math.max(0, Math.round((Date.parse(c.expires_at) - Date.now()) / 1000)));
    } catch (e) {
      if (my !== seq.current) return;
      setErr(e instanceof ApiError ? { code: e.code, message: e.message } : { code: 'UNKNOWN', message: String(e) });
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [eventId, checkpointId]);

  useEffect(() => {
    void fetchCode();
    return () => { seq.current += 1; };
  }, [fetchCode]);

  useEffect(() => {
    if (!ch) return;
    const timer = setInterval(() => setLeft(Math.max(0, Math.round((Date.parse(ch.expires_at) - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [ch]);

  // 輪詢：代碼顯示中每 5 s 查一次報名狀態；staff 確認出席 → 父層收起代碼並顯示「已報到／下一步」
  useEffect(() => {
    if (!ch || !onCheckedIn) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await apiClient.eventRegistration(eventId);
        if (!stopped && r.registration?.status === 'checked_in') onCheckedIn();
      } catch {
        /* 離線／暫時失敗：下一輪再查 */
      }
    };
    const timer = setInterval(() => void tick(), CHECKIN_POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [ch, eventId, onCheckedIn]);

  if (err) return <InlineState kind={err.code === 'NOT_ELIGIBLE' ? 'info' : 'error'} title={t('ci.title')} body={err.code === 'NOT_ELIGIBLE' ? t('ci.err.NOT_ELIGIBLE') : t('ci.err.generic', { message: apiErrorText(t, err.message) })} action={{ label: t('ci.renew'), onPress: () => void fetchCode(), loading: busy }} testID="checkin-error" />;
  if (!ch) return <InlineState kind="info" title={t('ci.title')} body={t('ci.loading', { name: checkpointName })} testID="checkin-loading" />;
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
      {onCheckedIn ? <Text variant="caption" tone="muted" style={styles.body} testID="checkin-watching">{t('ci.watching')}</Text> : null}
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
