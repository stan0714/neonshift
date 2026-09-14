/**
 * AuthService（PG-B-03／B-04，SD 4.2）：SIWS nonce／verify、JWT 與 refresh session。
 */
import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { ApiError } from "../errors.js";
import type { Store } from "../store/types.js";
import { buildSiwsMessage, parseSiwsMessage, type SiwsFields } from "./siws.js";
import { ACCESS_TTL_SECONDS, newRefreshToken, REFRESH_TTL_SECONDS, refreshHashOf, sha256, signAccessToken, type TokenConfig, verifyAccessToken } from "./tokens.js";

export const NONCE_TTL_SECONDS = 5 * 60;
export const SIWS_STATEMENT = "Sign in to NeonShift. This request will not trigger a blockchain transaction or cost any gas fees.";

export type AuthConfig = {
  domain: string;
  uri: string;
  /** CAIP-2，例如 solana:devnet */
  chainId: string;
  tokens: TokenConfig;
};

export type NonceResponse = {
  nonce: string;
  request_id: string;
  issued_at: string;
  expires_at: string;
  /** 完整訊息，App 直接簽這串（後端仍以自己的解析結果為準） */
  message: string;
};

export type TokenPair = {
  wallet: string;
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
};

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly cfg: AuthConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** POST /auth/nonce：32-byte CSPRNG nonce，只存雜湊；5 分鐘到期；一次性 */
  async issueNonce(wallet: string): Promise<NonceResponse> {
    if (!base58.test(wallet)) throw new ApiError(400, "VALIDATION", "wallet must be a base58 public key");
    const now = this.now();
    const nonce = randomBytes(32).toString("base64url");
    const requestId = randomUUID();
    const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
    await this.store.insertChallenge({
      nonceHash: sha256(nonce),
      wallet,
      purpose: "login",
      requestHash: null,
      taskDate: null,
      taskType: null,
      expiresAt,
      usedAt: null,
    });
    const fields: SiwsFields = {
      domain: this.cfg.domain,
      address: wallet,
      statement: SIWS_STATEMENT,
      uri: this.cfg.uri,
      version: "1",
      chainId: this.cfg.chainId,
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: expiresAt.toISOString(),
      requestId,
    };
    return { nonce, request_id: requestId, issued_at: fields.issuedAt, expires_at: fields.expirationTime, message: buildSiwsMessage(fields) };
  }

  /**
   * POST /auth/verify：解析訊息、綁定 domain／URI／chain／nonce／時效、驗簽、
   * 簽章地址必須等於訊息內 address；nonce 原子消耗且只能用一次。
   */
  async verify(message: string, signatureB64: string): Promise<TokenPair> {
    const now = this.now();
    const fields = parseSiwsMessage(message);
    if (!fields) throw new ApiError(400, "SIWS_MALFORMED", "sign-in message is not in the expected format");
    if (fields.domain !== this.cfg.domain) throw new ApiError(401, "SIWS_DOMAIN_MISMATCH", "domain mismatch");
    if (fields.uri !== this.cfg.uri) throw new ApiError(401, "SIWS_URI_MISMATCH", "uri mismatch");
    if (fields.chainId !== this.cfg.chainId) throw new ApiError(401, "SIWS_CHAIN_MISMATCH", "chain mismatch");
    if (fields.statement !== SIWS_STATEMENT) throw new ApiError(401, "SIWS_STATEMENT_MISMATCH", "statement mismatch");
    const exp = Date.parse(fields.expirationTime);
    const iat = Date.parse(fields.issuedAt);
    if (!Number.isFinite(exp) || !Number.isFinite(iat) || iat > now.getTime() + 60_000 || exp <= now.getTime()) {
      throw new ApiError(401, "SIWS_EXPIRED", "sign-in message expired or has invalid timestamps");
    }

    // 驗簽在消耗 nonce 之前，避免壞簽章燒掉合法 nonce
    let sig: Buffer;
    try {
      sig = Buffer.from(signatureB64, "base64");
    } catch {
      throw new ApiError(400, "VALIDATION", "signature must be base64");
    }
    if (sig.length !== 64) throw new ApiError(400, "VALIDATION", "signature must be 64 bytes");
    const pubkey = bs58.decode(fields.address);
    if (pubkey.length !== 32 || !nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pubkey)) {
      throw new ApiError(401, "SIWS_BAD_SIGNATURE", "signature does not match the address in the message");
    }

    const challenge = await this.store.consumeChallenge(sha256(fields.nonce), now);
    if (!challenge || challenge.purpose !== "login") throw new ApiError(401, "SIWS_NONCE_INVALID", "nonce unknown, expired or already used");
    if (challenge.wallet !== fields.address) throw new ApiError(401, "SIWS_WALLET_MISMATCH", "nonce was issued to a different wallet");

    const player = await this.store.upsertPlayer(fields.address, now);
    if (player.deletedAt) throw new ApiError(403, "PLAYER_DELETED", "this wallet's data was deleted");
    return this.issueSession(fields.address, randomUUID(), now);
  }

  /** POST /auth/refresh：輪替；舊 token 再現即撤銷整個 family（重用偵測） */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const now = this.now();
    const hash = refreshHashOf(refreshToken);
    if (!hash) throw new ApiError(401, "REFRESH_INVALID", "invalid refresh token");
    const session = await this.store.getSessionByRefreshHash(hash);
    if (!session) throw new ApiError(401, "REFRESH_INVALID", "invalid refresh token");
    if (session.revokedAt) throw new ApiError(401, "REFRESH_REVOKED", "session revoked");
    if (session.usedAt || session.rotatedTo) {
      // 重用：整個 family 作廢
      await this.store.revokeFamily(session.familyId, now);
      throw new ApiError(401, "REFRESH_REUSED", "refresh token reuse detected; session family revoked");
    }
    if (session.expiresAt <= now) throw new ApiError(401, "REFRESH_EXPIRED", "refresh token expired");
    const player = await this.store.getPlayer(session.wallet);
    if (!player || player.deletedAt) throw new ApiError(403, "PLAYER_DELETED", "this wallet's data was deleted");
    const pair = await this.issueSession(session.wallet, session.familyId, now);
    await this.store.rotateSession(session.jti, pair.sessionJti, now);
    return pair.pair;
  }

  /** POST /auth/logout：撤銷目前 session family；重複登出仍成功 */
  async logout(sessionJti: string): Promise<void> {
    const s = await this.store.getSession(sessionJti);
    if (s) await this.store.revokeFamily(s.familyId, this.now());
  }

  /** Bearer 驗證：JWT 有效且其 session 未撤銷、玩家未刪除 */
  async authenticate(bearer: string): Promise<{ wallet: string; sessionJti: string }> {
    const now = this.now();
    let claims;
    try {
      claims = await verifyAccessToken(this.cfg.tokens, bearer, now);
    } catch {
      throw new ApiError(401, "UNAUTHORIZED", "invalid or expired access token");
    }
    const session = await this.store.getSession(claims.sid);
    if (!session || session.revokedAt || session.wallet !== claims.sub) throw new ApiError(401, "SESSION_REVOKED", "session revoked");
    const player = await this.store.getPlayer(claims.sub);
    if (!player || player.deletedAt) throw new ApiError(403, "PLAYER_DELETED", "this wallet's data was deleted");
    return { wallet: claims.sub, sessionJti: claims.sid };
  }

  private async issueSession(wallet: string, familyId: string, now: Date): Promise<TokenPair & { sessionJti: string; pair: TokenPair }> {
    const refresh = newRefreshToken();
    const jti = randomUUID();
    await this.store.insertSession({
      jti,
      familyId,
      wallet,
      refreshHash: refresh.hash,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_SECONDS * 1000),
      usedAt: null,
      rotatedTo: null,
      revokedAt: null,
    });
    const access = await signAccessToken(this.cfg.tokens, wallet, jti, now);
    const pair: TokenPair = {
      wallet,
      access_token: access.token,
      token_type: "Bearer",
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh.token,
      refresh_expires_in: REFRESH_TTL_SECONDS,
    };
    return { ...pair, sessionJti: jti, pair };
  }
}
