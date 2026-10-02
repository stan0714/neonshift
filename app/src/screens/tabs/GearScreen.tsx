import { ShoePreview } from '@/components/ShoePreview';
import { Feather } from "@expo/vector-icons";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { Button, Chip, InlineState, Screen, Sheet, Surface } from "@/components";
import { ShoeStory } from "@/components/ShoeStory";
import { RevealCeremony } from "@/components/EvolutionReveal";
import { formatEditionNo } from "@/components/CollectorPlate";
import { ShoeHero } from "@/components/ShoeHero";
import { Milestones } from "@/screens/workouts/Milestones";
import { SeasonalFootprints } from "@/components/SeasonalFootprints";
import { ShareImageBlock } from "@/components/ShareImageBlock";
import { gearShareLayout, shareUrl } from "@/domain/shareImage";
import { maintenanceView, nextSteps } from "@/domain/maintenance";
import { freezeActive } from "@/chain/accounts";
import { shoeSection, type ShoeSection } from "@/domain/collectibles";
import type { PlayerProfile } from "@/chain/accounts";
import { APP_CONFIG } from "@/config/app";
import type { GearCategory, TabParamList } from "@/navigation/types";
import { FEATURES } from "@/config/features";
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
import { shoeMileage } from "@/domain/appearance";
import { useAppearance } from "@/hooks/useAppearance";
import { workoutRecorder } from "@/services/workouts/WorkoutRecorder";
import { useAppearanceStore } from "@/state/appearanceStore";
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
/** `route` 由分頁 navigator 傳入；宣告成 optional 讓測試可以單獨渲染這個畫面
    （用 useRoute 的話，沒有 navigation context 就會丟「Couldn't find a route object」） */
export function GearScreen({ route }: { route?: RouteProp<TabParamList, "Gear"> }) {
  const { t, locale } = useT();
  const session = useWalletStore((s) => s.session);
  const d = useDashboardStore();
  const c = useCollectibleStore();
  /** 點鞋子開詳情面板（2026-09-16 專案負責人指示）；記 kind 而非物件，資料變動時面板跟著更新 */
  const [detailKind, setDetailKind] = useState<ShoeLevel | null>(null);
  const [previewLevel, setPreviewLevel] = useState<ShoeLevel | null>(null);
  const [gearShareOpen, setGearShareOpen] = useState(false);
  /**
   * PG-SEASON-03 收藏分類切換（設計 §5「不把每年卡片全部塞到首頁」）。
   * 預設 all——這一頁本來就同時顯示四塊，改成預設只顯示一塊會讓現有使用者找不到東西；
   * 分類是用來收斂那條很長的捲軸，不是用來藏內容。個人最佳仍在「運動」分頁，這裡不搬也不複製。
   */
  /**
   * 收藏分類。R4：核准通知可直接帶 `category` 進來（里程碑／節日的領取入口都在這一頁），
   * 使用者不必落地後再自己找一次分類。之後手動切換照舊。
   */
  const routeCategory = route?.params?.category;
  const [cat, setCat] = useState<GearCategory>(routeCategory ?? "all");
  useEffect(() => { if (routeCategory) setCat(routeCategory); }, [routeCategory]);
  /** PG-LINK-01：外觀（可切換的已取得跑鞋＋棲地背景）與有效等級分開 */
  const ap = useAppearance();
  // 每雙鞋的運動歷程（本機紀錄，依開始時鞋款快照歸組；recorder 變化時重算）
  const [mileTick, setMileTick] = useState(0);
  useEffect(() => workoutRecorder.subscribe(() => setMileTick((n) => n + 1)), []);
  const mileage = useMemo(() => { void mileTick; return shoeMileage(workoutRecorder.localStore().list(), ap.owner); }, [mileTick, ap.owner]);
  const selectShoe = useAppearanceStore((s) => s.selectShoe);
  const setBackground = useAppearanceStore((s) => s.setBackground);
  const dismissOffer = useAppearanceStore((s) => s.dismissOffer);

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
    if (FEATURES.demoLevel) return t("common.reasonDemo");
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, d.profile, d.config, locale]);

  const items = COLLECTIBLES.map((item) => ({
    item,
    status: collectibleStatus(d.profile, c.claimed, item.kind),
  }));
  const claimedCount = items.filter((i) => i.status === "claimed").length;
  // 下拉重新整理原本只重讀收藏；里程碑／成就狀態（含 registry 核准）也要跟著重抓
  const [refreshTick, setRefreshTick] = useState(0);
  const shoes = items.filter((i) => i.item.group === "shoe");
  const badges = items.filter((i) => i.item.group === "badge");

  return (
    <Screen
      scroll
      insideTabs
      scene={ap.scene}
      testID="gear-screen"
      refreshControl={
        <RefreshControl
          refreshing={c.loading || d.chainSyncing}
          onRefresh={() => { setRefreshTick((n) => n + 1); void refresh(); }}
          tintColor={color.mint}
        />
      }
    >
      <View style={styles.header}>
        <Text variant="heading1">{t("gear.title")}</Text>
        <Chip label={t("common.devnet")} kind="devnet" />
        {FEATURES.demoLevel ? <Chip label={t("common.demoData")} kind="devnet" /> : null}
      </View>

      <Surface hero style={styles.heroCard} testID="gear-hero">
        <View style={styles.levelRow}>
          <Chip label={t("gear.activeLv", { n: level })} kind="level" />
          <Chip label={t("gear.highestLv", { n: highest })} kind={highest > level ? "synced" : "neutral"} />
          {ap.differs ? <View testID="gear-appearance-chip"><Chip label={t("gear.lookLv", { n: ap.level })} kind="neutral" /></View> : null}
        </View>
        <ShoeHero level={ap.level} size={220} />
        {ap.differs ? (
          <Text variant="caption" tone="muted" style={styles.center} testID="gear-appearance-note">
            {t("gear.lookNote", { look: ap.level, active: level })}
          </Text>
        ) : null}
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
          {freezeActive(d.freeze, Date.now() / 1000) ? (
            <Text variant="bodySmall" tone="warning" style={styles.mtXs} testID="gear-maint-frozen">
              {t("gear.maint.frozen", { until: new Date(d.freeze!.end * 1000).toLocaleString() })}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.mtXs}>
            {t("gear.maint.footnote")}
          </Text>
        </Surface>
      ) : null}

      {ap.offer ? (
        <Surface active style={styles.maint} testID="gear-offer">
          <Text variant="title">{t("gear.offer.title", { name: stageName(t, ap.offer) })}</Text>
          <Text variant="bodySmall" tone="secondary" style={styles.mtXs}>{t("gear.offer.body")}</Text>
          <View style={styles.rowBtns}>
            <Button label={t("gear.offer.useNow")} style={styles.flex} onPress={() => void selectShoe(ap.offer)} testID="gear-offer-use" />
            <Button label={t("gear.offer.later")} variant="secondary" style={styles.flex} onPress={dismissOffer} testID="gear-offer-later" />
          </View>
        </Surface>
      ) : null}

      <View style={styles.sectionHead}>
        <Text variant="label" tone="muted" uppercase>
          {t("gear.myShoes")}
        </Text>
        <Text variant="label" tone="secondary" numeric>
          {ap.owned.length}
        </Text>
      </View>
      <Text variant="caption" tone="muted" style={styles.sectionNote}>
        {t(ap.owned.length > 1 ? "gear.myShoes.note" : "gear.myShoes.single")}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shoeRow} testID="gear-my-shoes">
        {ap.owned.map((shoe) => {
          const inUse = shoe.level === ap.level;
          const when = ap.acquiredAt[shoe.level];
          return (
            <Pressable key={shoe.id} onPress={() => setDetailKind(shoe.level)} accessibilityRole="button" accessibilityLabel={`${stageName(t, shoe.level)}${inUse ? ` · ${t("gear.inUse")}` : ""}`} testID={`gear-shoe-${shoe.level}`}>
              <Surface active={inUse} style={styles.shoeCard}>
                <ShoeHero level={shoe.level} size={96} badge={false} active={false} />
                <Text variant="title" numberOfLines={1}>{stageName(t, shoe.level)}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {shoe.variant ? t(`wild.variant.${shoe.variant}` as TKey) : t("wild.series")}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {when ? t("gear.acquiredOn", { date: new Date(when).toLocaleDateString() }) : t("gear.acquiredUnknown")}
                </Text>
                <Text variant="caption" tone={mileage[shoe.id]?.count ? "secondary" : "muted"} numberOfLines={1} testID={`gear-shoe-${shoe.level}-mileage`}>
                  {mileage[shoe.id]?.count
                    ? `${t("gear.mileage", { n: mileage[shoe.id]!.count, km: (mileage[shoe.id]!.distanceMm / 1_000_000).toFixed(1) })}${mileage[shoe.id]!.review ? ` · ${t("gear.mileageReview", { n: mileage[shoe.id]!.review })}` : ""}`
                    : t("gear.mileageNone")}
                </Text>
                {inUse ? <View style={styles.mtXs}><Chip label={t("gear.inUse")} kind="level" /></View> : null}
              </Surface>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* PG-SHARE-06 卡型 D：目前這雙鞋的累積里程；已領取紀念 NFT 才算鏈上資產並標示網路 */}
      {(() => {
        const inUseShoe = ap.owned.find((s) => s.level === ap.level);
        const miles = inUseShoe ? mileage[inUseShoe.id] : undefined;
        if (!inUseShoe || !miles?.count) return null;
        const claimed = collectibleStatus(d.profile, c.claimed, ap.level) === "claimed";
        return (
          <Surface style={styles.mtXs} testID="gear-share-card">
            <Button label={t("share.card.image")} variant="secondary" onPress={() => setGearShareOpen((o) => !o)} accessibilityState={{ expanded: gearShareOpen }} testID="gear-share-open" />
            {gearShareOpen ? (
              <ShareImageBlock
                layout={gearShareLayout(
                  {
                    levelName: stageName(t, ap.level),
                    level: ap.level,
                    kmTotal: (miles.distanceMm / 1_000_000).toFixed(1),
                    nextLabel: null,
                    claimedOnChain: claimed,
                  },
                  {
                    t: (k, p) => t(k as TKey, p),
                    labels: { tagline: t("share.card.tagline"), site: "neonshift.cc", notice: APP_CONFIG.cluster === "mainnet-beta" ? t("share.card.net.mainnet") : t("share.card.net.devnet") },
                    qr: shareUrl(APP_CONFIG.siteUrl, "gear", "levelup"),
                  },
                )}
                caption={t("share.invite.gear", { level: stageName(t, ap.level), km: (miles.distanceMm / 1_000_000).toFixed(1), url: shareUrl(APP_CONFIG.siteUrl, "gear", "levelup") })}
                prefix="gear-share"
              />
            ) : null}
          </Surface>
        );
      })()}
      <Surface style={styles.mtXs} testID="gear-bg-card">
        <View style={styles.rowBetween}>
          <Text variant="bodySmall" tone="secondary" style={styles.flex}>{t("gear.bg.follow")}</Text>
          <Switch value={ap.backgroundEnabled} onValueChange={(v) => void setBackground(v)} disabled={!session} trackColor={{ true: color.mint, false: color.borderSubtle }} thumbColor={color.textPrimary} accessibilityLabel={t("gear.bg.follow")} testID="gear-bg-switch" />
        </View>
        <Text variant="caption" tone="muted" style={styles.mtXs}>{t(session ? "gear.bg.note" : "gear.bg.guest")}</Text>
      </Surface>

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
                : c.outcome.code === "INSUFFICIENT_SOL"
                  ? t("common.insufficientSol.title")
                  : t("gear.claimFailed")
          }
          body={
            c.outcome.code === "REJECTED"
              ? t("gear.nothingSent")
              : c.outcome.code === "INSUFFICIENT_SOL"
                ? t("common.insufficientSol.body")
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

      <View style={styles.cats} accessibilityRole="tablist" testID="gear-cats">
        {(["all", "shoes", "milestones", "seasonal"] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setCat(k)}
            accessibilityRole="tab"
            accessibilityState={{ selected: cat === k }}
            style={[styles.cat, cat === k && styles.catOn]}
            testID={`gear-cat-${k}`}
          >
            <Text variant="caption" tone={cat === k ? undefined : "secondary"} style={cat === k && styles.catOnText}>
              {t(`gear.cat.${k}` as TKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      {/* 個人最佳沒有搬過來，所以要說它在哪一頁，而不是讓人以為收藏頁少了一類 */}
      <Text variant="caption" tone="muted" style={styles.subhead} testID="gear-cat-note">{t("gear.cat.note")}</Text>

      {cat === "all" || cat === "shoes" ? (
        <>
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
                  onPress={() => setDetailKind(item.kind as ShoeLevel)}
                />
              ))}
            </View>
          </View>
        );
      })}
      <ShoeDetailSheet
        kind={detailKind}
        onClose={() => setDetailKind(null)}
        profile={d.profile}
        status={detailKind ? collectibleStatus(d.profile, c.claimed, detailKind) : "locked"}
        section={detailKind ? shoeSection(d.profile, detailKind) : "locked"}
        xp={xp}
        thresholds={thresholds}
        multiplier={detailKind ? fmtX(multipliers[detailKind - 1]) : ""}
        claiming={detailKind !== null && c.claiming === detailKind}
        busy={c.claiming !== null}
        disabledReason={claimDisabledReason}
        onClaim={() => session && detailKind && void c.claim(session.publicKey, detailKind)}
        onPreviewReveal={setPreviewLevel}
        look={detailKind ? { owned: ap.owned.some((o) => o.level === detailKind), inUse: detailKind === ap.level, active: level, onUse: () => { void selectShoe(detailKind); setDetailKind(null); } } : null}
      />
      {previewLevel ? <RevealCeremony from={(previewLevel - 1) as ShoeLevel} to={previewLevel} preview onClose={() => setPreviewLevel(null)} /> : null}
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

        </>
      ) : null}

      {cat === "all" || cat === "milestones" ? <Milestones reloadKey={`${claimedCount}:${refreshTick}`} /> : null}
      {/* PG-SEASON-03：收藏分三線（里程碑／個人最佳／節日）；節日只呈現資格，尚未開放領取 */}
      {cat === "all" || cat === "seasonal" ? <SeasonalFootprints reloadKey={refreshTick} /> : null}

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

type ShoeDetailProps = {
  kind: ShoeLevel | null;
  onClose: () => void;
  profile: PlayerProfile | null;
  status: CollectibleStatus;
  section: ShoeSection;
  xp: number;
  thresholds: number[];
  multiplier: string;
  claiming: boolean;
  busy: boolean;
  disabledReason?: string;
  onClaim: () => void;
  /** 未解鎖的 Lv.2+：試拆盲盒（示意揭曉，Style 25.2） */
  onPreviewReveal: (level: ShoeLevel) => void;
  /** PG-LINK-01：外觀切換（已取得 → 可「使用這雙」；使用中／未取得分別標示） */
  look: { owned: boolean; inUse: boolean; active: ShoeLevel; onUse: () => void } | null;
};

/**
 * 跑鞋詳情面板：鞋階、所需 XP、倍率、解鎖條件，以及「裝備 vs 紀念 NFT」說明（實機回饋：領過初階跑鞋後
 * 又看到「原點」可領，誤以為同一雙鞋要領兩次）。NFT 可領時 footer 直接領取。
 */
function ShoeDetailSheet({ kind, onClose, profile, status, section, xp, thresholds, multiplier, claiming, busy, disabledReason, onClaim, onPreviewReveal, look }: ShoeDetailProps) {
  const { t } = useT();
  const wallet = useWalletStore((s) => s.session?.publicKey ?? null);
  const editionRow = useCollectibleStore((s) => (kind ? s.editions[kind] : undefined));
  const editionLoading = useCollectibleStore((s) => (kind ? s.editionLoading[kind] : false));
  useEffect(() => {
    if (kind && status === "claimed" && wallet) void useCollectibleStore.getState().loadEdition(wallet, kind);
  }, [status, wallet, kind]);
  if (!kind) return null;
  const item = COLLECTIBLES.find((x) => x.kind === kind)!;
  const need = thresholds[kind - 1] ?? 0;
  const editionValue = status !== "claimed" ? null : editionRow ? t("nft.editionShort", { no: formatEditionNo(editionRow.edition), total: editionRow.total }) : editionLoading || editionRow === undefined ? t("nft.editionLoading") : t("nft.editionUnavailable");
  const remaining = Math.max(0, need - xp);
  const rows: { label: string; value: string; testID?: string }[] = [
    { label: t("gear.detail.stage"), value: `Lv.${kind} · ${stageName(t, kind)}` },
    { label: t("gear.detail.xp"), value: kind === 1 ? "0 XP" : `${need.toLocaleString()} XP` },
    { label: t("gear.detail.multiplier"), value: multiplier },
    { label: t("gear.detail.unlock"), value: collectibleUnlock(t, item) },
    { label: t("gear.detail.nft"), value: t(`gear.detail.nft.${status}` as TKey), testID: "shoe-detail-nft" },
    ...(editionValue ? [{ label: t("gear.detail.edition"), value: editionValue, testID: "shoe-detail-edition" }] : []),
    { label: t("gear.detail.look"), value: look?.inUse ? t("gear.inUse") : look?.owned ? t("gear.detail.look.available") : t("gear.detail.look.locked", { n: kind }), testID: "shoe-detail-look" },
  ];
  return (
    <Sheet visible onClose={onClose} title={collectibleName(t, item)} testID="shoe-detail" footer={
      status === "claimable" ? (
        <>
          <Button label={t("gear.claim")} loading={claiming} loadingLabel={t("gear.claiming")} onPress={onClaim} disabled={busy || Boolean(disabledReason)} disabledReason={disabledReason} style={styles.flex} testID="shoe-detail-claim" />
          {look?.owned && !look.inUse ? <Button label={t("gear.useThis")} variant="secondary" onPress={look.onUse} style={styles.flex} testID="shoe-detail-use" /> : null}
        </>
      ) : look?.owned && !look.inUse ? (
        <Button label={t("gear.useThis")} onPress={look.onUse} style={styles.flex} testID="shoe-detail-use" />
      ) : (
        <Button label={t("common.close")} variant="secondary" onPress={onClose} style={styles.flex} testID="shoe-detail-done" />
      )
    }>
      <View style={styles.detailHero}>
        {kind > 1 && section === "locked" ? <View style={{ padding: space.xl, alignItems: "center", gap: space.s }} testID="shoe-growth-box"><Feather name="package" size={80} color={color.violet} /><Text variant="title">{t("wild.sealed")}</Text><Button label={t("wild.previewReveal")} variant="secondary" onPress={() => onPreviewReveal(kind)} testID="shoe-detail-preview-reveal" /></View> : <ShoePreview level={kind} size={260} />}
        <View style={styles.levelRow}>
          <View testID={`shoe-detail-section-${section}`}><Chip label={t(`gear.section.${section}` as TKey)} kind={section === "equipped" ? "level" : section === "achieved" ? "synced" : "neutral"} /></View>
          {status === "claimed" ? <Chip label={t("gear.claimed")} kind="synced" /> : null}
        </View>
        <Text variant="body" tone="secondary" style={styles.center}>
          {stageDetail(t, kind)}
        </Text>
      </View>
      <ShoeStory level={kind} locked={section === "locked"} />
      {rows.map((r) => (
        <View key={r.label} style={styles.detailRow}>
          <Text variant="label" tone="muted" uppercase>
            {r.label}
          </Text>
          <Text variant="body" numeric style={styles.detailValue} testID={r.testID}>
            {r.value}
          </Text>
        </View>
      ))}
      {section === "locked" && profile ? (
        <Text variant="caption" tone="secondary" style={styles.sectionNote} testID="shoe-detail-remaining">
          {t("gear.detail.yourXp", { xp: xp.toLocaleString(), remaining: remaining.toLocaleString() })}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted" style={styles.sectionNote}>
        {t(kind === 1 ? "gear.detail.starterNote" : "gear.detail.gearNote")}
      </Text>
      {look?.owned && kind !== look.active ? (
        <Text variant="caption" tone="muted" style={styles.sectionNote} testID="shoe-detail-look-note">
          {t("gear.lookNote", { look: kind, active: look.active })}
        </Text>
      ) : null}
    </Sheet>
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
  /** 有給就整張可點（跑鞋 → 詳情面板） */
  onPress?: () => void;
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
  onPress,
}: TileProps) {
  const { t } = useT();
  const locked = status === "locked";
  const Wrap = onPress ? Pressable : View;
  const wrapProps = onPress ? { onPress, accessibilityRole: "button" as const, accessibilityLabel: t("gear.detail.a11y", { name: collectibleName(t, item) }), android_ripple: { color: color.borderSubtle }, testID: `collectible-open-${item.kind}` } : {};
  const tint = item.shoeLevel
    ? SHOE_PROGRESSION.stages[item.shoeLevel - 1].tint
    : item.icon === "award"
      ? color.warning
      : color.cyan;
  return (
    <Wrap style={styles.cell} {...wrapProps}>
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
              owner={locked ? null : undefined}
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
        <Text variant="title" numberOfLines={2}>
          {collectibleName(t, item)}
        </Text>
        {item.shoeLevel ? (
          <Text variant="caption" tone="muted">
            {t("gear.nftTag")}
          </Text>
        ) : null}
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
    </Wrap>
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
  flex: { flex: 1 },
  center: { textAlign: "center" },
  rowBtns: { flexDirection: "row", gap: space.s, marginTop: space.s },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.m },
  shoeRow: { gap: space.s, paddingVertical: space.xs },
  shoeCard: { width: 148, alignItems: "center", padding: space.s },
  detailHero: { alignItems: "center", gap: space.xs, marginBottom: space.m },
  detailRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.m, minHeight: 44, borderBottomWidth: 1, borderBottomColor: color.borderSubtle },
  detailValue: { flexShrink: 1, textAlign: "right" },
  groupTitle: { marginTop: space.m, marginBottom: space.xs },
  cats: { flexDirection: "row", flexWrap: "wrap", gap: space.xs, marginTop: space.m },
  cat: { minHeight: 36, paddingHorizontal: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: color.borderSubtle, alignItems: "center", justifyContent: "center" },
  catOn: { backgroundColor: color.mint, borderColor: color.mint },
  catOnText: { color: color.onMint },
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
