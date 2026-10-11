# Security review triage — 2026-10-11

Source: the CLOCK IN submission portal's automated security review of `main` @ `20f9382` (211 findings: 1 critical, 23 high, 106 medium, 80 low, 1 info). The report itself states: **"Nothing was confirmed as a defect in the code that was reviewed."** Most items are pattern matches marked *low confidence*, and many sit in test files. Each was checked against the source; the result is below.

## Fixed in this change (no app or on-chain redeploy needed)

| Finding | Action |
|---|---|
| **Critical** — vitest 2.1.9 / @vitest/mocker advisories (GHSA-5xrq-8626-4rwp, GHSA-82fw-gwwq-j7x9); also vite 5.4.21 and esbuild 0.21.5 via vitest | `backend` dev dependency upgraded to **vitest 4.1.11**. Backend: 279 tests pass, `tsc` clean. Dev-only; never shipped to users. |
| 6× GitHub Actions referenced by moving tags | `.github/workflows/ci.yml` pins every action to a full commit SHA (tag kept as a comment); `rust-toolchain` now takes `toolchain: stable` as an input. |

## Checked and not a defect

| Finding | Why it does not apply |
|---|---|
| 4× "leaked secret: generic-api-key" (`ClaimSubmitter.ts:16`, `bodyStore.ts:8`, `seasonalReminderStore.ts:13`, `skrStore.ts:14`) | Each is a local storage key name such as `'neonshift.skr.v1'`, not a credential. No keys are in the repo (`*-keypair.json`, `*.keystore`, `*.env` are gitignored; signer keys live off-repo). |
| `clock_in`: writable `UncheckedAccount` `receipt` | Step 10 derives `["claim", wallet, task_date, task_type]` with `find_program_address`, requires the passed key to match, and creates the account only if empty; an existing receipt returns 6009. Tested by `receipt_pda_must_match_args` and `replay_same_attestation_is_rejected_6009…`. |
| "Type cosplay" in `clock_in.rs:181`, `maintenance.rs:121` | `clock_in` writes the receipt discriminator itself; `migrate_player` checks owner = program, the 8-byte `PlayerProfile` discriminator and the exact v1 length before touching data. |
| Arbitrary CPI to `mpl_core_program` | Both `claim_collectible` and `claim_achievement` constrain `address = MPL_CORE_ID`, and the CPI helper repeats `require_keys_eq!(…, MPL_CORE_ID)`. |
| CPI target `token_program` "unresolved" (clock_in, tournament, settlement) | Every one is `Program<'info, Token>`, which Anchor checks against the SPL Token program ID. |
| `init_if_needed` on `eligibility` and `freeze` | Admin-only instructions (`has_one = admin` on `Config`); the upsert is intended so the admin can update an existing record. |
| Token accounts "not constrained to be distinct" | Reward/prize vaults are fixed by `Config` (`address =` / `has_one`) or by PDA seeds and owned by program PDAs; player accounts must be owned by the player. They cannot be the same account. |
| Account read before CPI and written after (`profile`, `tournament`) | The CPIs are SPL token transfers, which cannot modify program-owned `PlayerProfile` / `Tournament` data. |
| 75× unchecked arithmetic | `programs/Cargo.toml` sets `overflow-checks = true` for release builds, so an overflow aborts the transaction instead of wrapping. |
| "Random authority generation", "PDA sharing", "account data matching" in `programs/neonshift-core/tests/**` | Test fixtures that deliberately create random keys to prove the program rejects them. |
| `MainActivity` exported without a permission | Required for the launcher and for the verified `neonshift.cc` App Link. Wallet actions go through MWA, not through intents to this activity. |
| `output/shoe-design-review/render.cjs` "deserialization" | A local design-preview script that evaluates this repo's own component files; not shipped and never reads untrusted input. |

## Known, accepted for this submission (tracked for after the hackathon)

| Finding | Assessment |
|---|---|
| `android:allowBackup="true"` | Backup rules (`secure_store_backup_rules`, `secure_store_data_extraction_rules`) exclude SecureStore. Workout points on disk are encrypted with a key held in SecureStore (Android Keystore), so a backup copy is not readable. Will set `allowBackup="false"` in the next build. |
| `deploy/l1/bootstrap.sh` pipes the NodeSource setup script to `bash` | Server bootstrap run manually by the operator over SSH, not part of the app or CI. Will switch to the signed NodeSource apt repository with a pinned key. |
| toml 3.0.0 (via @coral-xyz/anchor), decode-uri-component 0.2.2 (via React Navigation), uuid, stream-json in `app` | Transitive. The app never parses TOML; decode-uri-component is reached only through deep-link parsing, where the worst case is a slow parse in the user's own app. Upgrading requires a new APK, so it is deferred to the next build to keep the submitted build 24 unchanged. |
| bigint-buffer 1.1.5 (via @solana/spl-token) in `tools/chain-admin` | Operator CLI only; no fixed version has been published. |
| Rust advisories in `programs/Cargo.lock` (curve25519-dalek 3.2.0, ed25519-dalek 1.0.1, rand 0.7.3, unmaintained crates) | Pulled in by the Solana/Anchor toolchain crates used for the build and LiteSVM tests. The on-chain program verifies Ed25519 signatures with the native precompile, not with these crates. Will follow the next Anchor/Solana SDK upgrade. |
| @solana/web3.js v1 (27 imports) | Informational; migration to @solana/kit is a post-hackathon task. |
