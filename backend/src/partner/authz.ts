/**
 * 合作活動授權（PG-E-01，SD 11.1）。角色一律由 DB 的有效資料推導（組織成員未撤銷、組織未停權、活動角色未撤銷），
 * 不信任 client 傳來的 org_id／role。owner 擁有其組織活動的全部權限；staff 可限定 checkpoint；
 * result_editor 匯入成績；publisher 發布／更正。敏感操作另要求「近期登入」（family 起點在 RECENT_LOGIN_SECONDS 內）。
 * 越權統一回 403 ROLE_FORBIDDEN；不存在的活動對無權者也回 404，避免資源枚舉。
 */
import type { FastifyRequest } from "fastify";

import { ApiError } from "../errors.js";
import type { EventRole, EventRow, PartnerStore } from "../store/types.js";

export const RECENT_LOGIN_SECONDS = 30 * 60;

export type EventAccess = {
  event: EventRow;
  isOwner: boolean;
  roles: Set<EventRole>;
  /** staff 被限定的 checkpoint；null = 全部 */
  staffCheckpoints: Set<string> | null;
};

export class PartnerAuthz {
  constructor(
    private readonly store: PartnerStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async isOrgOwner(orgId: string, wallet: string): Promise<boolean> {
    const org = await this.store.getOrganization(orgId);
    if (!org || org.suspendedAt) return false;
    const m = await this.store.getMembership(orgId, wallet);
    return !!m && !m.revokedAt && m.role === "owner";
  }

  async requireOrgOwner(orgId: string, wallet: string): Promise<void> {
    if (!(await this.isOrgOwner(orgId, wallet))) throw new ApiError(403, "ROLE_FORBIDDEN", "organization owner required");
  }

  /** 解析錢包對某活動的權限；活動不存在回 null */
  async accessFor(eventId: string, wallet: string): Promise<EventAccess | null> {
    const event = await this.store.getEvent(eventId);
    if (!event) return null;
    const isOwner = await this.isOrgOwner(event.orgId, wallet);
    const grants = await this.store.listEventRoles(eventId, wallet);
    const roles = new Set<EventRole>(grants.map((g) => g.role));
    const staffGrants = grants.filter((g) => g.role === "staff");
    const staffCheckpoints = staffGrants.length === 0 || staffGrants.some((g) => g.checkpointId === null) ? null : new Set(staffGrants.map((g) => g.checkpointId!));
    return { event, isOwner, roles, staffCheckpoints };
  }

  /**
   * 要求 owner 或指定活動角色之一；`checkpointId` 給定時 staff 需被授權該站點。
   * 無權者：活動不存在或無任何角色 → 404（一致的 404，防枚舉）；有角色但不足 → 403。
   */
  async requireEventRole(eventId: string, wallet: string, allowed: EventRole[], opts: { checkpointId?: string } = {}): Promise<EventAccess> {
    const access = await this.accessFor(eventId, wallet);
    if (!access) throw new ApiError(404, "NOT_FOUND", "event not found");
    if (access.isOwner) return access;
    if (access.roles.size === 0) throw new ApiError(404, "NOT_FOUND", "event not found");
    const ok = allowed.some((r) => access.roles.has(r));
    if (!ok) throw new ApiError(403, "ROLE_FORBIDDEN", `requires one of ${allowed.join(", ")}`);
    if (opts.checkpointId && allowed.includes("staff") && access.roles.has("staff") && !allowed.some((r) => r !== "staff" && access.roles.has(r))) {
      if (access.staffCheckpoints && !access.staffCheckpoints.has(opts.checkpointId)) throw new ApiError(403, "ROLE_FORBIDDEN", "staff not authorized for this checkpoint");
    }
    return access;
  }

  /** 發布／更正／核銷／成員權限變更需近期登入（SD 11.1） */
  requireRecentLogin(req: FastifyRequest, maxAgeSeconds = RECENT_LOGIN_SECONDS): void {
    const loginAt = req.auth?.loginAt;
    if (!loginAt || this.now().getTime() - loginAt.getTime() > maxAgeSeconds * 1000) {
      throw new ApiError(403, "RECENT_LOGIN_REQUIRED", `sign in again to perform this action (within ${maxAgeSeconds / 60} minutes)`);
    }
  }

  /** 稽核：操作人、動作、目標、revision、request id（不含核銷 token／健康資料） */
  audit(req: FastifyRequest, entry: { eventId?: string | null; orgId?: string | null; action: string; target?: string | null; revisionId?: string | null; details?: unknown }): Promise<void> {
    return this.store.appendAudit(
      { eventId: entry.eventId ?? null, orgId: entry.orgId ?? null, actorWallet: req.auth!.wallet, action: entry.action, target: entry.target ?? null, revisionId: entry.revisionId ?? null, requestId: String(req.id), details: entry.details ?? {} },
      this.now(),
    );
  }
}
