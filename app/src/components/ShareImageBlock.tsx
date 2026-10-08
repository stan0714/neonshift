import { useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type Svg from 'react-native-svg';

import { Button } from './Button';
import { InlineState } from './InlineState';
import { ShareCard } from './ShareCard';
import { SHARE_FORMATS, type ShareFormat, type ShareImageLayout, type ShareRenderSpec } from '@/domain/shareImage';
import { copyCaption, shareLayout, shareTextInstead, type ShareFailReason } from '@/services/share/shareImage';
import { useT } from '@/i18n';
import { color, radius, space, Text } from '@/theme';

/**
 * 分享圖卡的共用區塊（PG-SHARE-06）：預覽 → 分享圖片／複製文案，以及失敗後的下一步。
 *
 * 抽出來的理由是這段規則不該每個入口各寫一份：一次只做一件事、送出前一定看得到整張圖、
 * 失敗只給選項不自動彈第二個面板、返回只說「已返回分享頁」不說已發布（social-share §6.1）。
 */
export function ShareImageBlock({
  layout,
  caption,
  prefix = 'share-card',
  spec,
  stillValid,
  children,
}: {
  layout: ShareImageLayout;
  /** 圖片被接收 App 丟掉文字時，使用者可複製的文案（含連結） */
  caption: string;
  /** testID 前綴：同一個畫面有多個入口時分開 */
  prefix?: string;
  spec?: ShareRenderSpec;
  stillValid?: (spec: ShareRenderSpec) => boolean;
  /** 預覽與按鈕之間的額外內容（例如欄位開關） */
  children?: ReactNode;
}) {
  const { t } = useT();
  const svgRef = useRef<Svg>(null);
  const [phase, setPhase] = useState<'preview' | 'rendering' | 'handing_off' | 'returned'>('preview');
  const [err, setErr] = useState<ShareFailReason | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** PG-SHARE-07：輸出尺寸。story 是同一塊內容置中在 9:16 畫布上，所以預覽不必換一張 */
  const [format, setFormat] = useState<ShareFormat>('post');
  const busy = phase === 'rendering' || phase === 'handing_off';

  const send = async () => {
    if (busy) return;
    setErr(null);
    setNote(null);
    setPhase('rendering');
    try {
      setPhase('handing_off');
      const r = await shareLayout({ svg: svgRef.current, layout, dialogTitle: t('share.card.title'), format, ...(spec ? { spec: { ...spec, format } } : {}), ...(stillValid ? { stillValid } : {}) });
      setPhase(r.ok ? 'returned' : 'preview');
      if (!r.ok) setErr(r.reason);
    } finally {
      setPhase((p) => (p === 'rendering' || p === 'handing_off' ? 'preview' : p));
    }
  };

  return (
    <View style={styles.box} testID={`${prefix}-block`}>
      <View style={styles.preview}>
        <ShareCard ref={svgRef} layout={layout} width={format === 'story' ? 240 : 300} format={format} a11yLabel={t('share.card.a11y', { label: layout.label, hero: `${layout.hero.value} ${layout.hero.unit}`.trim() })} testID={`${prefix}-preview`} />
      </View>
      {/* 尺寸切換：預覽就是實際輸出的那一張（同一個 SVG），不是另外畫一張示意圖 */}
      <View style={styles.formats} accessibilityRole="tablist">
        {SHARE_FORMATS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFormat(f)}
            accessibilityRole="tab"
            accessibilityState={{ selected: format === f }}
            style={[styles.format, format === f && styles.formatOn]}
            testID={`${prefix}-format-${f}`}
          >
            <Text variant="caption" tone={format === f ? undefined : 'secondary'} style={format === f && styles.formatOnText}>{t(`share.card.format.${f}`)}</Text>
          </Pressable>
        ))}
      </View>
      {format === 'story' ? <Text variant="caption" tone="muted" testID={`${prefix}-story-note`}>{t('share.card.storyNote')}</Text> : null}
      {children}
      <Button label={t('share.card.image')} onPress={() => void send()} loading={busy} loadingLabel={t('share.card.rendering')} disabled={busy} testID={`${prefix}-image`} />
      <Button label={t('share.card.copy')} variant="secondary" onPress={() => void copyCaption(caption).then((ok) => setNote(ok ? t('share.card.copied') : null))} testID={`${prefix}-copy`} />
      {/* 交付流程返回不代表對方社群已發布 */}
      {phase === 'returned' && !err ? (
        <Text variant="caption" tone="secondary" testID={`${prefix}-returned`}>{t('share.card.returned')}</Text>
      ) : null}
      {err ? (
        <View style={styles.err} testID={`${prefix}-error-${err}`}>
          <InlineState
            kind={err === 'unpublishable' ? 'warning' : 'error'}
            title={t(err === 'no_target' ? 'share.card.noTargetTitle' : err === 'unpublishable' ? 'share.card.blockedTitle' : err === 'cache_full' ? 'share.card.busyTitle' : 'share.card.failedTitle')}
            body={t(err === 'no_target' ? 'share.card.noTargetBody' : err === 'unpublishable' ? 'share.card.blockedBody' : err === 'cache_full' ? 'share.card.busyBody' : 'share.card.failedBody')}
          />
          {err !== 'unpublishable' ? (
            <>
              {err === 'render_failed' || err === 'cache_full' ? <Button label={t('share.card.retry')} variant="secondary" onPress={() => void send()} testID={`${prefix}-retry`} /> : null}
              <Button label={t('share.card.shareTextInstead')} variant="secondary" onPress={() => void shareTextInstead(caption)} testID={`${prefix}-text`} />
            </>
          ) : null}
        </View>
      ) : null}
      {note ? (
        <Text variant="caption" tone="secondary" testID={`${prefix}-note`}>{note}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.s, marginTop: space.s },
  preview: { alignItems: 'center' },
  formats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  format: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: 'center', justifyContent: 'center' },
  formatOn: { backgroundColor: color.mint, borderColor: color.mint },
  formatOnText: { color: color.onMint },
  err: { gap: space.s },
});
