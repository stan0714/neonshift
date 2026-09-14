import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Button, Chip, InlineState, Screen, Surface } from "@/components";
import { ShoeHero } from "@/components/ShoeHero";
import { APP_CONFIG } from "@/config/app";
import { SHOE_PROGRESSION, type ShoeLevel } from "@/config/shoeProgression";
import {
  COLLECTIBLES,
  collectibleStatus,
  type Collectible,
  type CollectibleStatus,
} from "@/domain/collectibles";
import { useCollectibleStore } from "@/state/collectibleStore";
import { useDashboardStore } from "@/state/dashboardStore";
import { useWalletStore } from "@/state/walletStore";
import { color, radius, space, Text } from "@/theme";

const RING = 132;
const STROKE = 6;

/**
 * Gear（PG-A-14，Style 12）：上半部跑鞋＋Level＋XP ring；中段 multiplier 與距下一階 XP；
 * 下段 My collection（Claimed／Claimable／Locked）。升級免費、自動發生在打卡交易內（2026-09-14 定案），
 * 這裡沒有升級 CTA；領取成就 NFT 免費，只付 devnet rent。
 */
export function GearScreen() {
  const session = useWalletStore((s) => s.session);
  const d = useDashboardStore();
  const c = useCollectibleStore();

  const refresh = useCallback(async () => {
    if (!session) return;
    await Promise.all([
      d.syncChain(session.publicKey),
      c.refresh(session.publicKey),
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (c.outcome?.kind === "success" && !c.outcome.result.alreadyClaimed)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [c.outcome]);

  const level = (d.profile?.shoeLevel ?? 1) as ShoeLevel;
  const xp = d.profile ? Number(d.profile.xp) : 0;
  const thresholds = d.config
    ? d.config.shoeXpThresholds.map(Number)
    : SHOE_PROGRESSION.stages.map((s) => s.xp);
  const stage = SHOE_PROGRESSION.stages[level - 1];
  const nextXp = thresholds[level] ?? null;
  const curXp = thresholds[level - 1] ?? 0;
  const ratio =
    nextXp === null
      ? 1
      : Math.min(1, Math.max(0, (xp - curXp) / (nextXp - curXp)));
  const multipliers = d.config?.coreMultiplierBps ?? [
    10_000, 11_000, 12_500, 14_000, 16_000,
  ];
  const fmtX = (bps: number | undefined) =>
    `${((bps ?? 10_000) / 10_000).toFixed(2).replace(/0$/, "")}×`;

  const claimDisabledReason = useMemo(() => {
    if (!session) return "Connect your wallet";
    if (!APP_CONFIG.chainConfigured)
      return "Onchain program not configured in this build";
    if (!d.profile) return "Claim your starter shoe first";
    if (d.config?.paused) return "Claims are paused right now";
    return undefined;
  }, [session, d.profile, d.config]);

  const items = COLLECTIBLES.map((item) => ({
    item,
    status: collectibleStatus(d.profile, c.claimed, item.kind),
  }));
  const claimedCount = items.filter((i) => i.status === "claimed").length;
  const shoes = items.filter((i) => i.item.group === "shoe");
  const badges = items.filter((i) => i.item.group === "badge");

  return (
    <Screen
      scroll
      insideTabs
      testID="gear-screen"
      refreshControl={
        <RefreshControl
          refreshing={c.loading}
          onRefresh={() => void refresh()}
          tintColor={color.mint}
        />
      }
    >
      <View style={styles.header}>
        <Text variant="heading1">Gear</Text>
        <Chip label="DEVNET" kind="devnet" />
      </View>

      <Surface hero style={styles.heroCard} testID="gear-hero">
        <ShoeHero level={level} size={220} />
        <View style={styles.heroRow}>
          <XpRing ratio={ratio} tint={stage.tint}>
            <Text variant="heading2" numeric>
              {level}
            </Text>
            <Text variant="label" tone="muted" uppercase>
              Level
            </Text>
          </XpRing>
          <View style={styles.heroMeta}>
            <Text variant="title">{stage.name}</Text>
            <Text variant="bodySmall" tone="secondary">
              {stage.detail}
            </Text>
            <Text
              variant="bodySmall"
              tone="secondary"
              numeric
              style={styles.xpLine}
            >
              {d.profile ? `${xp.toLocaleString()} XP` : "No profile yet"}
              {nextXp !== null && d.profile
                ? ` · ${Math.max(0, nextXp - xp).toLocaleString()} XP to Lv.${level + 1}`
                : nextXp === null
                  ? " · Max level"
                  : ""}
            </Text>
          </View>
        </View>
      </Surface>

      <View style={styles.stats}>
        <Stat
          label="Current multiplier"
          value={fmtX(multipliers[(d.profile?.coreLevel ?? 1) - 1])}
          tint={color.mint}
        />
        <View style={styles.gap} />
        <Stat
          label="Next multiplier"
          value={
            nextXp === null ? "—" : fmtX(multipliers[d.profile?.coreLevel ?? 1])
          }
          tint={color.violet}
        />
        <View style={styles.gap} />
        <Stat
          label="Next level"
          value={nextXp === null ? "Max" : `${nextXp.toLocaleString()} XP`}
          tint={color.cyan}
        />
      </View>
      <Text variant="caption" tone="muted" style={styles.note}>
        Levels rise automatically with XP when you clock in. No fees, nothing to
        burn.
      </Text>

      <View style={styles.sectionHead}>
        <Text variant="label" tone="muted" uppercase>
          My collection
        </Text>
        <Text variant="label" tone="secondary" numeric>
          {claimedCount}/{COLLECTIBLES.length}
        </Text>
      </View>
      <Text variant="caption" tone="muted" style={styles.sectionNote}>
        Achievement NFTs are free to claim — you only pay devnet rent. One of
        each, forever in your wallet.
      </Text>

      {c.outcome?.kind === "success" ? (
        <Outcome
          kind="success"
          title={
            c.outcome.result.alreadyClaimed
              ? "Already in your wallet"
              : "Collectible claimed"
          }
          body={`${nameOf(c.outcome.result.kind)} · ${c.outcome.result.asset.slice(0, 8)}…${c.outcome.result.signature ? ` · Tx ${c.outcome.result.signature.slice(0, 8)}…` : ""}`}
          onDismiss={c.dismissOutcome}
          testID="collectible-success"
        />
      ) : null}
      {c.outcome?.kind === "error" ? (
        <Outcome
          kind={c.outcome.code === "REJECTED" ? "warning" : "error"}
          title={
            c.outcome.code === "REJECTED"
              ? "Wallet approval cancelled"
              : c.outcome.code === "NETWORK_ERROR"
                ? "Network unavailable"
                : "Claim did not go through"
          }
          body={
            c.outcome.code === "REJECTED"
              ? "Nothing was sent. You can claim it any time."
              : `${c.outcome.message} Nothing was charged beyond network fees; try again.`
          }
          onDismiss={c.dismissOutcome}
          testID="collectible-error"
        />
      ) : null}
      {c.error ? (
        <InlineState
          kind="warning"
          title="Collection may be outdated"
          body={`Could not read your receipts from the network. ${c.error}`}
          testID="collectible-outdated"
        />
      ) : null}

      <Text
        variant="label"
        tone="secondary"
        uppercase
        style={styles.groupTitle}
      >
        Shoes
      </Text>
      <View style={styles.grid}>
        {shoes.map(({ item, status }) => (
          <Tile
            key={item.kind}
            item={item}
            status={status}
            claiming={c.claiming === item.kind}
            busy={c.claiming !== null}
            disabledReason={claimDisabledReason}
            onClaim={() =>
              session && void c.claim(session.publicKey, item.kind)
            }
          />
        ))}
      </View>
      <Text
        variant="label"
        tone="secondary"
        uppercase
        style={styles.groupTitle}
      >
        Badges
      </Text>
      <View style={styles.grid}>
        {badges.map(({ item, status }) => (
          <Tile
            key={item.kind}
            item={item}
            status={status}
            claiming={c.claiming === item.kind}
            busy={c.claiming !== null}
            disabledReason={claimDisabledReason}
            onClaim={() =>
              session && void c.claim(session.publicKey, item.kind)
            }
          />
        ))}
      </View>

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        Test Token · No monetary value
      </Text>
    </Screen>
  );
}

const nameOf = (kind: number) =>
  COLLECTIBLES.find((x) => x.kind === kind)?.name ?? "NFT";

function XpRing({
  ratio,
  tint,
  children,
}: {
  ratio: number;
  tint: string;
  children: React.ReactNode;
}) {
  const r = (RING - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      accessibilityLabel={`XP progress ${Math.round(ratio * 100)} percent`}
    >
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={color.borderSubtle}
          strokeWidth={STROKE}
          fill="none"
        />
        <Circle
          cx={RING / 2}
          cy={RING / 2}
          r={r}
          stroke={tint}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - ratio)}
          transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

function Stat({
  label,
  value,
  tint,
}: {
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <Surface style={styles.stat}>
      <Text variant="label" tone="muted" uppercase>
        {label}
      </Text>
      <Text variant="heading2" numeric style={{ color: tint }}>
        {value}
      </Text>
    </Surface>
  );
}

function Outcome({
  kind,
  title,
  body,
  onDismiss,
  testID,
}: {
  kind: "success" | "warning" | "error";
  title: string;
  body: string;
  onDismiss: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Dismiss`}
    >
      <InlineState kind={kind} title={title} body={body} testID={testID} />
    </Pressable>
  );
}

type TileProps = {
  item: Collectible;
  status: CollectibleStatus;
  claiming: boolean;
  busy: boolean;
  disabledReason?: string;
  onClaim: () => void;
};

/** Style 12：Claimed 實圖、Claimable mint border＋Claim、Locked 灰階＋解鎖條件 */
function Tile({
  item,
  status,
  claiming,
  busy,
  disabledReason,
  onClaim,
}: TileProps) {
  const locked = status === "locked";
  const tint = item.shoeLevel
    ? SHOE_PROGRESSION.stages[item.shoeLevel - 1].tint
    : item.icon === "award"
      ? color.warning
      : color.cyan;
  return (
    <View style={styles.cell}>
      <Surface
        active={status === "claimable"}
        level={status === "claimed" ? "elevated" : "surface"}
        style={[styles.tile, locked && styles.tileLocked]}
        testID={`collectible-${item.kind}`}
        accessibilityLabel={`${item.name}, ${status}`}
      >
        <View style={styles.tileArt}>
          {item.shoeLevel ? (
            <ShoeHero
              level={item.shoeLevel}
              size={120}
              active={status !== "locked"}
              badge={false}
            />
          ) : (
            <Feather
              name={item.icon}
              size={40}
              color={locked ? color.textMuted : tint}
            />
          )}
          {locked ? (
            <Feather
              name="lock"
              size={14}
              color={color.textMuted}
              style={styles.lock}
            />
          ) : null}
          {status === "claimed" ? (
            <Feather
              name="check-circle"
              size={16}
              color={color.success}
              style={styles.lock}
            />
          ) : null}
        </View>
        <Text variant="title" numberOfLines={1}>
          {item.name}
        </Text>
        {status === "claimed" ? (
          <Text variant="label" tone="success" uppercase>
            Claimed
          </Text>
        ) : null}
        {status === "locked" ? (
          <Text variant="caption" tone="muted">
            {item.unlock}
          </Text>
        ) : null}
        {status === "claimable" ? (
          <Button
            label="Claim"
            loading={claiming}
            loadingLabel="Claiming…"
            onPress={onClaim}
            disabled={busy || Boolean(disabledReason)}
            disabledReason={disabledReason}
            style={styles.claimBtn}
            testID={`claim-${item.kind}`}
          />
        ) : null}
      </Surface>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.m,
  },
  heroCard: { alignItems: "center" },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    marginTop: space.m,
  },
  heroMeta: { flex: 1, marginLeft: space.m },
  xpLine: { marginTop: space.xs },
  ring: {
    width: RING,
    height: RING,
    alignItems: "center",
    justifyContent: "center",
  },
  stats: { flexDirection: "row", marginTop: space.m },
  stat: { flex: 1, padding: space.s },
  gap: { width: space.xs },
  note: { marginTop: space.xs },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: space.xl,
  },
  sectionNote: { marginTop: space.xxs },
  groupTitle: { marginTop: space.m, marginBottom: space.xs },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -space.xxs,
  },
  cell: { width: "50%", padding: space.xxs },
  tile: { flex: 1, padding: space.s, borderRadius: radius.l },
  tileLocked: { opacity: 0.55 },
  tileArt: {
    alignItems: "center",
    justifyContent: "center",
    height: 100,
    marginBottom: space.xs,
  },
  lock: { position: "absolute", right: 0, top: 0 },
  claimBtn: { marginTop: space.xs },
  disclaimer: { marginTop: space.l, textAlign: "center" },
});
