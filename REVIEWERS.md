# NeonShift — reviewer guide

A 5-minute map for judges: who it is for, what is built today, how to try it, and where the evidence is. Network: **Solana devnet only**. tSKR is a test token with no monetary value and is not the official SKR.

| | |
|---|---|
| APK (Android 14+, arm64) | [NeonShift-v0.1.0-build24-devnet-arm64.apk](https://github.com/stan0714/neonshift/releases/download/v0.1.0-build24/NeonShift-v0.1.0-build24-devnet-arm64.apk) · [release notes and SHA-256](https://github.com/stan0714/neonshift/releases/tag/v0.1.0-build24) |
| Demo video (2:02) | [youtu.be/hFUhFfC1sb0](https://youtu.be/hFUhFfC1sb0) · transcript: [`docs/store/demo-voiceover-en.txt`](docs/store/demo-voiceover-en.txt) |
| Pitch deck | [NeonShift-Pitch-EN.pdf](https://github.com/stan0714/neonshift/releases/download/v0.1.0-build24/NeonShift-Pitch-EN.pdf) |
| Release candidate record | [`docs/evidence/2026-10-09-rc-v24.md`](docs/evidence/2026-10-09-rc-v24.md) (device results and transactions) |

## Who it is for

**Seeker owners who already carry the phone on walks and runs, but drop new fitness habits after the first week.** Most fitness apps reward a streak with badges that mean nothing outside the app. NeonShift gives each day a small, verifiable result: a claim the user approves in their own wallet, tSKR and XP that level up a running shoe, and free achievement collectibles they own. The loop is daily (steps or one workout), short (one wallet approval) and visible on-chain, which is what we want to test for retention. Health data stays on the phone; only a daily summary is checked.

## What is built, and how sure we are

| Feature | Status |
|---|---|
| Wallet connect + Sign-In With Solana (MWA), account switching, readable claim message | **Built, verified on a Seeker** |
| GPS run/walk recorder (splits, auto-pause, smoothed top speed, share card), Activity history | **Built, verified on a Seeker** |
| Daily missions: 8,000 steps or a 1 km / 10-minute workout → backend attestation → on-chain claim (tSKR + XP) | **Built, verified on a Seeker** (transactions below) |
| One claim per wallet per mission per UTC day (receipt PDA) | **Built, verified** by program tests; the app shows *Claimed* after a claim |
| Free achievement NFT (First 5K, Metaplex Core) | **Built, verified on a Seeker** |
| Genesis Mint frame bought with SKR (devnet **test** SKR mint) | **Built, verified on a Seeker**; mainnet purchase **not made** |
| Weekly step tournaments (Arena), partner events with staff check-in, public player gallery | **Built with automated tests; partially device-tested** |
| Species story cards (wildlife shoe series) | **Built, verified on a Seeker** |
| Community conservation pilots | **Planned** (no partnership or donation is claimed) |
| SKR staking boost + conservation share | **Planned, not built** ([design](docs/design/skr-staking-boost.md)); rates not final, no returns promised |
| Personal running coach (Health Connect HR/HRV trends, train/easy/rest) | **Planned, not built** ([design](docs/design/ai-running-coach.md)) |

## Try it (about 10 minutes)

1. Install the APK on a Seeker or another ARM64 Android 14+ phone. Install an MWA wallet (Seed Vault Wallet, Phantom or Solflare) set to **devnet** and get a little devnet SOL from [faucet.solana.com](https://faucet.solana.com).
2. Open NeonShift → connect the wallet → sign in. Grant Health Connect step access.
3. **Workout mission:** Start a workout → Run or Walk → move at least **1 km and 10 minutes** outdoors → Finish → Sync now.
4. Home → scroll to the mission cards → **Clock In** → hold the phone while walking for the 20-second motion check → approve in the wallet → the card shows *Claimed* and the transaction ID (open it in the Explorer).
5. **Duplicate claim:** the same mission cannot be claimed again until the next UTC day (resets 00:00 UTC). The program rejects a second claim with error 6009.
6. **Steps mission** works the same way after 8,000 device-recorded steps.

## On-chain evidence (devnet, wallet `AcBU…vbV2`)

| Action | Transaction |
|---|---|
| Steps mission +10 tSKR (2026-10-06) | [`5QawZy…ZAJcp`](https://explorer.solana.com/tx/5QawZy2B9rPBPnLiH9cAAw2e3XkeDLrpngsHioNzVAmFtjPbwWjuhik74uCgBy73CNA7gNhzEuQvLrmM8zgZAJcp?cluster=devnet) |
| Workout mission +5 tSKR, 6.41 km (2026-10-06) | [`3aPL5G…JTPHNM`](https://explorer.solana.com/tx/3aPL5GD9GHZ2q969U68WBoqrK8o66vQRgipwmzi5iLKJ5tieqzJEm5DWt5FD9qK7YDYe21Di21kp5bdU16JTPHNM?cluster=devnet) |
| Steps mission, build 22 readable claim message (2026-10-07) | [`3PpfNb…j24dA`](https://explorer.solana.com/tx/3PpfNbBr5iBmScoDztCkirchw2yyjfauGyTdmkWTTW1WcEcVsJ26cF3vwouq8cKg3qSgi3JhGgWPS1wCU2Lj24dA?cluster=devnet) |
| Workout mission, build 24 (2026-10-09, 2026-10-10) | [`3eTpvg…nLziB`](https://explorer.solana.com/tx/3eTpvgLDfCLhu3exvZQDH6UfW1zNJm53Ddc583A1BPaannvGMcpTvt8DEmkd4QpsqsJVTkUy7ueAkey1PRknLziB?cluster=devnet) · [`43AszE…6Tp94`](https://explorer.solana.com/tx/43AszEB5uBhF8Fy1JbQtMau4wb4hdfM7XTD7LuRC7gVo2sUUEmxZP2xSzyY7KRCPqyivSxke3k8RxQKvwK76Tp94?cluster=devnet) |
| Achievement NFT (ClaimAchievement) | [`5oNhcr…uDEg`](https://explorer.solana.com/tx/5oNhcrVgLJUmv8N597gB9TUC9nkoGXKJ5baRSMXdvE2skwAcsepKNThm5y7CnRopkB92NkLb6dbaCnFhv3vHuDEg?cluster=devnet) |
| Genesis Mint frame, 2.5 TEST SKR | [`5wqCxq…cEnF`](https://explorer.solana.com/tx/5wqCxqKXBmQzbWu4ZVtwoJ6rbtB5gCgLdpP6bCtLoPc8ymScvKZ6mszqqq4JaScsrvQ482haVLYFFToamoS7cEnF?cluster=devnet) ([evidence](docs/evidence/2026-10-01-skr-devnet-payment.md)) |

## Sensor and anti-cheat: where it is tested

| Rule | Code | Tests |
|---|---|---|
| Only device-recorded steps count; manual and third-party sources rejected; 250 steps/min clamp | `backend/src/risk/` | `backend/src/risk/risk.test.ts` (`SRC_MANUAL`, `SRC_UNATTRIBUTED`, clamp boundary) |
| 20-second live motion check before a steps claim | `app/src/services/claim/` | `app/src/__tests__/claimFlow.test.ts` |
| GPS: accuracy filter, speed-spike rejection, mock-location flag, gap teleport (≥ 300 m), sustained speed, clock drift, stride mismatch | `app/src/domain/gps/engine.ts` | `app/src/__tests__/gpsEngine.test.ts` (26 tests, incl. GPS_RULES_VERSION 4 regressions) |
| Auto-pause / resume; GPS gaps lower quality but do not void the workout | `app/src/services/workouts/WorkoutRecorder.ts` | `app/src/__tests__/workoutRecorder.test.ts` |
| Attestation bytes pinned across Rust / TypeScript / Python | `programs/attestation-core`, `backend/src/lib/attestation.ts` | `programs/attestation-core/tests/canonical.rs`, `backend/src/lib/attestation.test.ts` |
| On-chain: Ed25519 attestation check, wrong signer / program / cluster / wallet, one claim per day (receipt PDA) | `programs/neonshift-core` | `programs/neonshift-core/tests/test_clock_in.rs` (e.g. `replay_same_attestation_is_rejected_6009…`, `wallet_mismatch_6005`) |
| Readable, single-use claim challenge signed in the wallet | `backend/src/auth/challenge.ts` | `backend/src/auth/challenge.test.ts` |
| SKR payment: wrong mint, someone else's payment, replay, under-payment | `backend/src/skr/` | `backend/src/skr/skr.test.ts` |

Run them:

```bash
source scripts/env.sh
(cd app && npx jest)                      # 93 suites / 762 tests
(cd backend && npx vitest run)            # 279 tests (PostgreSQL integration tests need Docker)
(cd programs && cargo test -p neonshift-core)   # LiteSVM program tests
```

## Security review

The submission portal's automated security review (2026-10-11) confirmed no defect in this repository's code. Every finding was checked against the source; the dev-only critical (vitest) and the CI action pins are fixed, and the rest are explained in [`docs/security/2026-10-11-audit-triage.md`](docs/security/2026-10-11-audit-triage.md).

## Known limitations

- Devnet only. The SKR payment uses a devnet test mint; a mainnet purchase with official SKR has not been made.
- APK is arm64-v8a only and signed with a development certificate.
- Missions must be claimed on the same UTC day as the activity.
- The wallet may show "We don't recognize this domain" until NeonShift is listed on the Solana dApp Store.
- Most design and progress documents in `docs/` are in Traditional Chinese; this page and the README are the English entry points.
