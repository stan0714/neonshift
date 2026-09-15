import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Button, Chip, InlineState, Screen, Surface } from "@/components";
import { ShoeHero } from "@/components/ShoeHero";
import { Milestones } from "@/screens/workouts/Milestones";
import { maintenanceView, nextSteps } from "@/domain/maintenance";
import { shoeSection } from "@/domain/collectibles";
import { APP_CONFIG } from "@/config/app";
import { SHOE_PROGRESSION, type ShoeLevel } from "@/config/shoeProgression";
import {
  COLLECTIBLES,
  collectibleName,
  collectibleUnlock,
  stageDetail,
  stageName,
  collectibleStatus,
  type Collectible,
  type CollectibleStatus,
} from "@/domain/collectibles";
import { useCollectibleStore } from "@/state/collectibleStore";
import { useDashboardStore } from "@/state/dashboardStore";
import { useWalletStore } from "@/state/walletStore";
import { color, radius, space, Text } from "@/theme";
import { useT, type TKey } from "@/i18n";

const RING = 132;
const STROKE = 6;

/**
 * Gear（PG-A-14，Style 12）：上半部跑鞋＋Level＋XP ring；中段 multiplier 與距下一階 XP；
 * 下段 My collection（Claimed／Claimable／Locked）。升級免費、自動發生在打卡交易內（2026-09-14 定案），
 * 這裡沒有升級 CTA；領取成就 NFT 免費，只付 devnet rent。
 */
export function GearScreen() {
  const { t, locale } = useT();
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

  const level = (d.profile?.coreLevel ?? d.profile?.shoeLevel ?? 1) as ShoeLevel; // PG-V-04：Hero 只展示 Active level
  const highest = Math.max(d.profile?.highestLevel ?? 1, level);
  const mv = maintenanceView(d.profile, d.config?.shoeXpThresholds ?? SHOE_PROGRESSION.stages.map((s) => BigInt(s.xp)), Date.now());
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
    if (!session) return t("common.reasonConnectWallet");
    if (!APP_CONFIG.chainConfigured) return t("common.reasonChain");
    if (!d.profile) return t("gear.reasonStarter");
    if (d.config?.paused) return t("common.reasonPaused");
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, d.profile, d.config, locale]);

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
        <Text variant="heading1">{t("gear.title")}</Text>
        <Chip label={t("common.devnet")} kind="devnet" />
      </View>

      <Surface hero style={styles.heroCard} testID="gear-hero">
        <View style={styles.levelRow}>
          <Chip label={t("gear.activeLv", { n: level })} kind="level" />
          <Chip label={t("gear.highestLv", { n: highest })} kind={highest > level ? "synced" : "neutral"} />
        </View>
        <ShoeHero level={level} size={220} />
        <View style={styles.heroRow}>
          <XpRing ratio={ratio} tint={stage.tint}>
            <Text variant="heading2" numeric>
              {level}
            </Text>
            <Text variant="label" tone="muted" uppercase>
              {t("common.level")}
            </Text>
          </XpRing>
          <View style={styles.heroMeta}>
            <Text variant="title">{stageName(t, level)}</Text>
            <Text variant="bodySmall" tone="secondary">
              {stageDetail(t, level)}
            </Text>
            <Text
              variant="bodySmall"
              tone="secondary"
              numeric
              style={styles.xpLine}
            >
              {d.profile ? t("common.xp", { n: xp }) : t("home.noProfile")}
              {nextXp !== null && d.profile
                ? t("gear.xpToNext", { n: Math.max(0, nextXp - xp), level: level + 1 })
                : nextXp === null
                  ? t("gear.maxLevel")
                  : ""}
            </Text>
          </View>
        </View>
      </Surface>

      <View style={styles.stats}>
        <Stat
          label={t("gear.currentMultiplier")}
          value={fmtX(multipliers[(d.profile?.coreLevel ?? 1) - 1])}
          tint={color.mint}
        />
        <View style={styles.gap} />
        <Stat
          label={t("gear.nextMultiplier")}
          value={
            nextXp === null ? "—" : fmtX(multipliers[d.profile?.coreLevel ?? 1])
          }
          tint={color.violet}
        />
        <View style={styles.gap} />
        <Stat
          label={t("gear.nextLevel")}
          value={nextXp === null ? t("gear.max") : t("common.xp", { n: nextXp })}
          tint={color.cyan}
        />
      </View>
      <Text variant="caption" tone="muted" style={styles.note}>
        {t("gear.note")}
      </Text>

      {mv ? (
        <Surface style={styles.maint} testID={`gear-maintenance-${mv.state}`}>
          <View style={styles.sectionHead}>
            <Text variant="label" tone="muted" uppercase>
              {t("gear.maint.title")}
            </Text>
            {mv.state === "active" ? (
              <Text variant="label" tone="secondary" numeric>
                {t("gear.maint.daysLeft", { n: mv.daysLeft })}
              </Text>
            ) : null}
          </View>
          {mv.state === "migration_required" ? (
            <Text variant="bodySmall" tone="secondary">{t("gear.maint.migrate")}</Text>
          ) : mv.state === "settlement_pending" ? (
            <Text variant="bodySmall" tone="secondary">{t("gear.maint.pending", { n: mv.pendingEpochs })}</Text>
          ) : (
            <>
              <View style={styles.stats}>
                <Stat label={t("gear.maint.points")} value={`${mv.points} / ${mv.restore?.points ?? mv.next?.points ?? mv.keep.points}`} tint={color.mint} />
                <View style={styles.gap} />
                <Stat label={t("gear.maint.activeDays")} value={`${mv.activeDays} / ${mv.restore?.activeDays ?? mv.next?.activeDays ?? mv.keep.activeDays}`} tint={color.cyan} />
              </View>
              <Text variant="caption" tone="muted" style={styles.mtXs}>
                {t("gear.maint.endsAt", { local: new Date(mv.epochEndsAtMs).toLocaleString(), utc: new Date(mv.epochEndsAtMs).toISOString().slice(0, 16).replace("T", " ") })}
              </Text>
              {mv.activeLevel >= 2 ? (
                <Text variant="bodySmall" tone={mv.keep.met ? "mint" : "secondary"} style={styles.mtXs} testID="gear-maint-keep">
                  {mv.keep.met ? t("gear.maint.keepMet", { n: mv.activeLevel }) : t("gear.maint.keep", { n: mv.activeLevel, ...nextSteps(mv.keep, mv.points, mv.activeDays) })}
                </Text>
              ) : null}
              {mv.restore ? (
                <Text variant="bodySmall" tone="secondary" style={styles.mtXs} testID="gear-maint-restore">
                  {t("gear.maint.restore", { n: mv.restore.level, ...nextSteps(mv.restore, mv.points, mv.activeDays) })}
                </Text>
              ) : mv.next ? (
                <Text variant="bodySmall" tone="secondary" style={styles.mtXs} testID="gear-maint-next">
                  {mv.next.xpAllowed ? (mv.next.met ? t("gear.maint.nextMet", { n: mv.next.level }) : t("gear.maint.next", { n: mv.next.level, ...nextSteps(mv.next, mv.points, mv.activeDays) })) : t("gear.maint.nextXp", { n: mv.next.level })}
                </Text>
              ) : null}
            </>
          )}
          <Text variant="caption" tone="muted" style={styles.mtXs}>
            {t("gear.maint.footnote")}
          </Text>
        </Surface>
      ) : null}

      <View style={styles.sectionHead}>
        <Text variant="label" tone="muted" uppercase>
          {t("gear.myCollection")}
        </Text>
        <Text variant="label" tone="secondary" numeric>
          {claimedCount}/{COLLECTIBLES.length}
        </Text>
      </View>
      <Text variant="caption" tone="muted" style={styles.sectionNote}>
        {t("gear.collectionNote")}
      </Text>

      {c.outcome?.kind === "success" ? (
        <Outcome
          kind="success"
          title={
            c.outcome.result.alreadyClaimed
              ? t("gear.alreadyInWallet")
              : t("gear.collectibleClaimed")
          }
          body={`${t("gear.claimedBody", { name: nameOf(t, c.outcome.result.kind), asset: c.outcome.result.asset.slice(0, 8) })}${c.outcome.result.signature ? t("gear.claimedTx", { tx: c.outcome.result.signature.slice(0, 8) }) : ""}`}
          onDismiss={c.dismissOutcome}
          testID="collectible-success"
        />
      ) : null}
      {c.outcome?.kind === "error" ? (
        <Outcome
          kind={c.outcome.code === "REJECTED" ? "warning" : "error"}
          title={
            c.outcome.code === "REJECTED"
              ? t("gear.walletCancelled")
              : c.outcome.code === "NETWORK_ERROR"
                ? t("gear.networkUnavailable")
                : t("gear.claimFailed")
          }
          body={
            c.outcome.code === "REJECTED"
              ? t("gear.nothingSent")
              : t("gear.failedBody", { message: c.outcome.message })
          }
          onDismiss={c.dismissOutcome}
          testID="collectible-error"
        />
      ) : null}
      {c.error ? (
        <InlineState
          kind="warning"
          title={t("gear.outdated.title")}
          body={t("gear.outdated.body", { error: c.error })}
          testID="collectible-outdated"
        />
      ) : null}

      <Text
        variant="label"
        tone="secondary"
        uppercase
        style={styles.groupTitle}
      >
        {t("gear.shoes")}
      </Text>
      {(["equipped", "achieved", "locked"] as const).map((section) => {
        const list = shoes.filter(({ item }) => shoeSection(d.profile, item.kind) === section);
        if (!list.length) return null;
        return (
          <View key={section} testID={`gear-shoes-${section}`}>
            <Text variant="caption" tone={section === "equipped" ? "mint" : "muted"} style={styles.subhead}>
              {t(`gear.section.${section}` as TKey)}
            </Text>
            <View style={styles.grid}>
              {list.map(({ item, status }) => (
                <Tile
                  key={item.kind}
                  item={item}
                  status={status}
                  history={section === "achieved"}
                  claiming={c.claiming === item.kind}
                  busy={c.claiming !== null}
                  disabledReason={claimDisabledReason}
                  onClaim={() =>
                    session && void c.claim(session.publicKey, item.kind)
                  }
                />
              ))}
            </View>
          </View>
        );
      })}
      <Text
        variant="label"
        tone="secondary"
        uppercase
        style={styles.groupTitle}
      >
        {t("gear.badges")}
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

      <Milestones reloadKey={claimedCount} />

      <Text variant="caption" tone="muted" style={styles.disclaimer}>
        {t("common.testToken")}
      </Text>
    </Screen>
  );
}

type T = ReturnType<typeof useT>["t"];
const nameOf = (t: T, kind: number) => {
  const c = COLLECTIBLES.find((x) => x.kind === kind);
  return c ? collectibleName(t, c) : "NFT";
};

function XpRing({
  ratio,
  tint,
  children,
}: {
  ratio: number;
  tint: string;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const r = (RING - STROKE) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <View
      style={styles.ring}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(ratio * 100) }}
      accessibilityLabel={t("gear.xpProgress", { n: Math.round(ratio * 100) })}
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
  /** PG-V-04：曾經達成（History 標籤；保留完整作品與 Claim 入口） */
  history?: boolean;
};

/** Style 12：Claimed 實圖、Claimable mint border＋Claim、Locked 灰階＋解鎖條件 */
function Tile({
  item,
  status,
  history = false,
  claiming,
  busy,
  disabledReason,
  onClaim,
}: TileProps) {
  const { t } = useT();
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
        accessibilityLabel={t("gear.a11yTile", { name: collectibleName(t, item), status: t(`gear.status.${status}` as TKey) })}
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
          {collectibleName(t, item)}
        </Text>
        {history ? (
          <Text variant="label" tone="secondary" uppercase testID={`collectible-history-${item.kind}`}>
            {t("gear.history")}
          </Text>
        ) : null}
        {status === "claimed" ? (
          <Text variant="label" tone="success" uppercase>
            {t("gear.claimed")}
          </Text>
        ) : null}
        {status === "locked" ? (
          <Text variant="caption" tone="muted">
            {collectibleUnlock(t, item)}
          </Text>
        ) : null}
        {status === "claimable" ? (
          <Button
            label={t("gear.claim")}
            loading={claiming}
            loadingLabel={t("gear.claiming")}
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
  levelRow: { flexDirection: "row", gap: space.xs, marginBottom: space.s },
  maint: { marginTop: space.m },
  mtXs: { marginTop: space.xs },
  subhead: { marginTop: space.s, marginBottom: space.xs },
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
