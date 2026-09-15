/**
 * Attestor 簽章介面（PG-B-10，SD 4.6）。
 * 私鑰不進入 API process：正式環境用 KMS／HSM 或隔離 signer service（HttpSignerClient）；
 * `LocalKeypairSigner` 只供本機 dev／測試，啟動時會明確記錄警告。
 */
export interface AttestorSigner {
  /** 32-byte ed25519 公鑰；後端啟動時須與鏈上 Config.attestor_pubkey 比對（SD 8） */
  publicKey(): Promise<Uint8Array>;
  /** 對 164-byte canonical bytes 簽章，回 64-byte 簽章 */
  sign(message: Uint8Array): Promise<Uint8Array>;
  readonly kind: "local" | "http" | "kms";
}
