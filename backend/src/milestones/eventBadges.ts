/**
 * 活動留念章（PG-M-04；commemorative-nfts 2、3；shoe-gameplay 活動 NFT 承諾權限）。
 * - 主辦方在活動設定 `badges.check_in`／`badges.finish` 才發行；報到章與完賽章分開，每玩家／活動／章別一次。
 * - 條件：報到章＝參加者已報到；完賽章＝該活動最新發布結果 FINISHED（任一 discipline）。取消報名 → 失效。
 * - 權限：報名時鞋階快照 ≥ Lv2（`level_at_registration`）；舊列無快照 → 以目前鞋階判定。之後降級不沒收。
 * - 穩定 key `event|<event_id>|<check_in|finish>`（M-02 沿用 achievements.milestone_key），與基礎 First Finish（first_finish）不同。
 * - 不含主辦方商標；活動名稱是公開資訊，精確時間／名次只在公開同意時寫入 metadata。
 */
import type { EventParticipant, EventRow, ResultRevision, Store } from "../store/types.js";

export const EVENT_BADGE_RULES_MAJOR = 1;
/** 活動 NFT 所需報名時鞋階（shoe-gameplay Lv2 Pulse） */
export const EVENT_BADGE_MIN_LEVEL = 2;
export type EventBadgeKind = "check_in" | "finish";
export type EventBadgeStatus = "eligible" | "locked" | "level_locked" | "cancelled";
export type EventBadgeResolution = {
  key: string;
  eventId: string;
  kind: EventBadgeKind;
  category: "event_check_in" | "event_finish";
  event: { title: string; slug: string; startsAt: Date | null; endsAt: Date | null; state: EventRow["state"] };
  status: EventBadgeStatus;
  levelAtRegistration: number;
  /** eligible 時的來源：報到＝參加者列（revision 1）；完賽＝結果 revision */
  source: { kind: "participant" | "result"; id: string; revision: number; achievedAt: Date | null; result: ResultRevision | null } | null;
};

export const eventBadgeKeyOf = (eventId: string, kind: EventBadgeKind) => `event|${eventId}|${kind}`;
export const parseEventBadgeKey = (key: string): { eventId: string; kind: EventBadgeKind } | null => {
  const m = /^event\|([0-9a-f-]{36})\|(check_in|finish)$/.exec(key);
  return m ? { eventId: m[1]!, kind: m[2] as EventBadgeKind } : null;
};

export class EventBadgeService {
  constructor(private readonly store: Store) {}

  async resolve(wallet: string): Promise<EventBadgeResolution[]> {
    const parts = await this.store.listParticipations(wallet);
    if (!parts.length) return [];
    const results = await this.store.listCurrentResultsForWallet(wallet);
    const currentLevel = (await this.store.getGalleryPlayer(wallet))?.shoeLevel ?? 1;
    const out: EventBadgeResolution[] = [];
    for (const p of parts) {
      const e = await this.store.getEvent(p.eventId);
      if (!e || (!e.badges.checkIn && !e.badges.finish)) continue;
      const level = p.levelAtRegistration ?? currentLevel;
      if (e.badges.checkIn) out.push(this.one(e, p, "check_in", level, results));
      if (e.badges.finish) out.push(this.one(e, p, "finish", level, results));
    }
    return out;
  }

  private one(e: EventRow, p: EventParticipant, kind: EventBadgeKind, level: number, results: ResultRevision[]): EventBadgeResolution {
    const base = { key: eventBadgeKeyOf(e.eventId, kind), eventId: e.eventId, kind, category: (kind === "check_in" ? "event_check_in" : "event_finish") as EventBadgeResolution["category"], event: { title: e.title, slug: e.slug, startsAt: e.startsAt, endsAt: e.endsAt, state: e.state }, levelAtRegistration: level };
    if (p.status === "cancelled" || e.state === "cancelled") return { ...base, status: "cancelled", source: null };
    if (level < EVENT_BADGE_MIN_LEVEL) return { ...base, status: "level_locked", source: null };
    if (kind === "check_in") {
      if (p.status !== "checked_in") return { ...base, status: "locked", source: null };
      return { ...base, status: "eligible", source: { kind: "participant", id: `${e.eventId}:${p.wallet}`, revision: 1, achievedAt: e.startsAt ?? p.registeredAt, result: null } };
    }
    const finished = results.filter((r) => r.eventId === e.eventId && r.finishStatus === "finished").sort((a, b) => a.discipline.localeCompare(b.discipline))[0];
    if (!finished) return { ...base, status: "locked", source: null };
    return { ...base, status: "eligible", source: { kind: "result", id: finished.revisionId, revision: 1, achievedAt: e.startsAt ?? e.endsAt ?? finished.publishedAt, result: finished } };
  }
}

export const eventBadgeView = (b: EventBadgeResolution) => ({
  key: b.key, event_id: b.eventId, kind: b.kind, category: b.category, rules_major: EVENT_BADGE_RULES_MAJOR, status: b.status, level_at_registration: b.levelAtRegistration, min_level: EVENT_BADGE_MIN_LEVEL,
  event: { title: b.event.title, slug: b.event.slug, starts_at: b.event.startsAt?.toISOString() ?? null, ends_at: b.event.endsAt?.toISOString() ?? null, state: b.event.state },
  source: b.source ? { kind: b.source.kind, id: b.source.id, revision: b.source.revision, achieved_at: b.source.achievedAt?.toISOString() ?? null } : null,
});
