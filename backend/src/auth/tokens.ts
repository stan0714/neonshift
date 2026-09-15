/**
 * JWT 與 refresh token（SD 4.2）。
 * - access JWT：HS256（單一後端）、最長 15 分鐘；固定 iss／aud／sub=wallet／jti／iat／nbf／exp
 * - refresh：32-byte 隨機值，DB 只存 SHA-256；每次使用輪替並偵測重用
 * 演算法固定，驗證時嚴格限制 `algorithms: ["HS256"]`。
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 24 * 60 * 60;

export type TokenConfig = { secret: Uint8Array; issuer: string; audience: string };

export type AccessClaims = { sub: string; jti: string; sid: string; iat: number; exp: number };

export async function signAccessToken(cfg: TokenConfig, wallet: string, sessionJti: string, now: Date): Promise<{ token: string; jti: string; exp: number }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ACCESS_TTL_SECONDS;
  const jti = randomUUID();
  const token = await new SignJWT({ sid: sessionJti })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(cfg.issuer)
    .setAudience(cfg.audience)
    .setSubject(wallet)
    .setJti(jti)
    .setIssuedAt(iat)
    .setNotBefore(iat)
    .setExpirationTime(exp)
    .sign(cfg.secret);
  return { token, jti, exp };
}

export async function verifyAccessToken(cfg: TokenConfig, token: string, now: Date): Promise<AccessClaims> {
  const { payload } = await jwtVerify(token, cfg.secret, {
    algorithms: ["HS256"],
    issuer: cfg.issuer,
    audience: cfg.audience,
    currentDate: now,
  });
  if (!payload.sub || !payload.jti || typeof payload.sid !== "string" || !payload.iat || !payload.exp) {
    throw new Error("missing claims");
  }
  return { sub: payload.sub, jti: payload.jti, sid: payload.sid, iat: payload.iat, exp: payload.exp };
}

export function newRefreshToken(): { token: string; hash: Buffer } {
  const raw = randomBytes(32);
  return { token: raw.toString("base64url"), hash: sha256(raw) };
}

export function refreshHashOf(token: string): Buffer | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length !== 32) return null;
    return sha256(raw);
  } catch {
    return null;
  }
}

export function sha256(data: Buffer | string): Buffer {
  return createHash("sha256").update(data).digest();
}
