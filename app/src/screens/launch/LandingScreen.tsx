import { Feather } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Button, Chip, Screen, Wordmark } from '@/components';
import { ShoeHero } from '@/components/ShoeHero';
import { APP_CONFIG } from '@/config/app';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { color, motion, space, Text } from '@/theme';
import { useT } from '@/i18n';

// 9.2 Hero 文案（首選）；文案走 i18n
const PROOF_ICONS = ['heart', 'layers', 'shield'] as const;

/**
 * Landing（Style 9）：產品價值頁，不請求任何權限、不播放無法跳過的影片。
 * TalkBack 順序：品牌 → hero 說明 → headline → proof points → CTA → disclaimer。
 */
export function LandingScreen() {
  const { t } = useT();
  const COPY = {
    eyebrow: t('landing.eyebrow'),
    headline: t('landing.headline'),
    body: t('landing.body'),
    proofs: PROOF_ICONS.map((icon, i) => ({ icon, text: t(`landing.proof${i + 1}` as 'landing.proof1') })),
    primary: t('common.connectWallet'),
    secondary: t('landing.preview'),
  };
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const reduceMotion = useReduceMotion();
  // 9.4：headline、body、CTA 以 60ms stagger 出現，總進場 ≤ 600ms；Reduce Motion 只保留 opacity
  const anims = useRef([0, 1, 2, 3].map(() => new Animated.Value(reduceMotion ? 1 : 0))).current;

  useEffect(() => {
    if (reduceMotion) {
      anims.forEach((a) => a.setValue(1));
      return;
    }
    const entrance = Animated.stagger(
      60,
      anims.map((a) => Animated.timing(a, { toValue: 1, duration: motion.slow, easing: Easing.bezier(...motion.easing), useNativeDriver: true })),
    );
    entrance.start();
    return () => entrance.stop();
  }, [anims, reduceMotion]);

  const enter = (i: number) => ({
    opacity: anims[i],
    transform: reduceMotion ? [] : [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  return (
    <Screen scroll testID="landing-screen">
      <View style={styles.header}>
        <Wordmark withMark />
        <Chip label={t('common.devnet')} kind="devnet" />
      </View>

      <Animated.View style={[styles.hero, enter(0)]}>
        <ShoeHero level={1} active={isFocused} />
      </Animated.View>

      <Animated.View style={enter(1)}>
        <Text variant="label" tone="mint" uppercase>
          {COPY.eyebrow}
        </Text>
        <Text variant="displayL" style={styles.headline} accessibilityRole="header">
          {COPY.headline}
        </Text>
        <Text variant="body" tone="secondary" style={styles.body}>
          {COPY.body}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.proofs, enter(2)]} accessibilityRole="list">
        {COPY.proofs.map((p) => (
          <View key={p.text} style={styles.proof} accessible accessibilityLabel={p.text}>
            <Feather name={p.icon} size={20} color={color.mint} />
            <Text variant="body" style={styles.proofText}>
              {p.text}
            </Text>
          </View>
        ))}
      </Animated.View>

      <Animated.View style={[styles.actions, enter(3)]}>
        <Button label={COPY.primary} onPress={() => navigation.navigate('Onboarding', { screen: 'WalletConnect' })} />
        <Button
          label={COPY.secondary}
          variant="secondary"
          style={styles.secondary}
          onPress={() => navigation.navigate('DemoPreview')}
        />
        <Text variant="caption" tone="muted" style={styles.disclaimer}>
          {t('common.disclaimer')}
        </Text>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  hero: { alignItems: 'center', marginTop: space.xl },
  headline: { marginTop: space.xs },
  body: { marginTop: space.s },
  proofs: { marginTop: space.xl },
  proof: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.xs },
  proofText: { marginLeft: space.s },
  actions: { marginTop: space.xxl },
  secondary: { marginTop: space.s },
  disclaimer: { marginTop: space.m, textAlign: 'center' },
});
