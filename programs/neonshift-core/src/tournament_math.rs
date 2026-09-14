//! 結算純函式（SD 6.2、BRD 8.4、SD-Q2）：退款、獎金與 rolling hash。
//! 全部為整數運算、無狀態，供 `begin_settlement`（預算總額）與 `claim_prize`（單筆）共用，
//! 兩處必定得出相同結果，資金守恆由此保證。
//!
//! 實作定案（待專案負責人確認，對應 SA-Q7／BRD Q-09）：
//! - 名次權重：組內線性遞減，k 個實際排名者的第 i 名權重 = k - i + 1，總和 k(k+1)/2。
//! - 空位：得獎組大小於 lock 固定；若排名人數不足以填滿，只在「實際排名者」間分配，
//!   整組無人時該組份額歸 `treasury_remainder`。
//! - 整數除法餘數一律歸 `treasury_remainder`（UC-09）。
//! - 沒收者退款 0、無獎金；其質押留在池中（BRD 8.4）。

use solana_sha256_hasher::hashv;

use crate::constants::BPS_ONE;
use crate::state::Tournament;

/// 排名結果的 canonical encoding（85 bytes）：tournament(32) ‖ wallet(32) ‖ final_steps u64 LE ‖
/// first_reached_at i64 LE ‖ rank u32 LE ‖ forfeited u8
pub fn canonical_result(tournament: &[u8; 32], wallet: &[u8; 32], final_steps: u64, first_reached_at: i64, rank: u32, forfeited: bool) -> [u8; 85] {
    let mut out = [0u8; 85];
    out[0..32].copy_from_slice(tournament);
    out[32..64].copy_from_slice(wallet);
    out[64..72].copy_from_slice(&final_steps.to_le_bytes());
    out[72..80].copy_from_slice(&first_reached_at.to_le_bytes());
    out[80..84].copy_from_slice(&rank.to_le_bytes());
    out[84] = forfeited as u8;
    out
}

/// rolling = SHA-256(prev ‖ canonical)
pub fn roll(prev: &[u8; 32], canonical: &[u8]) -> [u8; 32] {
    hashv(&[prev, canonical]).to_bytes()
}

/// 依名次推導分組：1 = A、2 = B、0 = 未得獎（rank 0 視為未排名）
pub fn group_of(t: &Tournament, rank: u32) -> u8 {
    if rank == 0 {
        0
    } else if rank <= t.group_a_size {
        1
    } else if rank <= t.group_a_size + t.group_b_size {
        2
    } else {
        0
    }
}

/// 某排名者的退款：得獎者 100%、未得獎者 `loser_refund_bps`
pub fn refund_for(t: &Tournament, rank: u32) -> u64 {
    if group_of(t, rank) != 0 {
        t.stake_amount
    } else {
        mul_bps(t.stake_amount, t.loser_refund_bps)
    }
}

/// 實際排名人數為 `ranked` 時，A／B 組各有幾個實際得獎者
pub fn filled(t: &Tournament, ranked: u32) -> (u32, u32) {
    let a = ranked.min(t.group_a_size);
    let b = ranked.saturating_sub(t.group_a_size).min(t.group_b_size);
    (a, b)
}

/// 組內線性遞減：第 `pos`（1 起）名在 `k` 人中的獎金
fn linear_share(pool: u64, k: u32, pos: u32) -> u64 {
    if k == 0 || pos == 0 || pos > k {
        return 0;
    }
    let weight = (k - pos + 1) as u128;
    let total = (k as u128) * (k as u128 + 1) / 2;
    ((pool as u128) * weight / total) as u64
}

/// 可分配獎金池與 A／B 組份額
pub fn pools(t: &Tournament, total_refund: u64) -> Option<(u64, u64, u64)> {
    let pool = t.total_staked.checked_add(t.treasury_injection)?.checked_sub(total_refund)?;
    Some((pool, mul_bps(pool, t.prize_a_bps), mul_bps(pool, t.prize_b_bps)))
}

/// 某排名者的獎金（`ranked` = 實際排名總數，`pool_a`／`pool_b` 來自 `pools`）
pub fn prize_for(t: &Tournament, ranked: u32, pool_a: u64, pool_b: u64, rank: u32) -> u64 {
    let (fa, fb) = filled(t, ranked);
    match group_of(t, rank) {
        1 => linear_share(pool_a, fa, rank),
        2 => linear_share(pool_b, fb, rank - t.group_a_size),
        _ => 0,
    }
}

/// 結算預算：(total_refund, total_prize, treasury_remainder, distributable_pool)
pub fn budget(t: &Tournament, ranked: u32) -> Option<(u64, u64, u64, u64)> {
    let (fa, fb) = filled(t, ranked);
    let winners = fa + fb;
    let losers = ranked - winners;
    let total_refund = (winners as u64).checked_mul(t.stake_amount)?.checked_add((losers as u64).checked_mul(mul_bps(t.stake_amount, t.loser_refund_bps))?)?;
    let (pool, pool_a, pool_b) = pools(t, total_refund)?;
    let mut total_prize: u64 = 0;
    for rank in 1..=winners {
        total_prize = total_prize.checked_add(prize_for(t, ranked, pool_a, pool_b, rank))?;
    }
    let remainder = t.total_staked.checked_add(t.treasury_injection)?.checked_sub(total_refund)?.checked_sub(total_prize)?;
    Some((total_refund, total_prize, remainder, pool))
}

pub fn mul_bps(amount: u64, bps: u16) -> u64 {
    ((amount as u128) * (bps as u128) / (BPS_ONE as u128)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;

    fn t(n_staked: u64, injection: u64, a: u32, b: u32) -> Tournament {
        Tournament {
            stake_amount: 50 * TSKR_UNIT,
            total_staked: n_staked * 50 * TSKR_UNIT,
            treasury_injection: injection,
            group_a_size: a,
            group_b_size: b,
            prize_a_bps: PRIZE_A_BPS,
            prize_b_bps: PRIZE_B_BPS,
            loser_refund_bps: LOSER_REFUND_BPS,
            ..Default::default()
        }
    }

    #[test]
    fn conservation_holds_for_many_shapes() {
        for (n, inj, forfeited) in [(10u64, 0u64, 0u32), (10, 600 * TSKR_UNIT, 0), (10, 600 * TSKR_UNIT, 4), (10, 0, 10), (33, 1_000 * TSKR_UNIT, 1), (3, 7, 0), (100, 5_000 * TSKR_UNIT, 37), (11, 1, 9)] {
            let (a, b) = Tournament::group_sizes(n as u32);
            let tt = t(n, inj, a, b);
            let ranked = n as u32 - forfeited;
            let (refund, prize, rem, pool) = budget(&tt, ranked).unwrap();
            assert_eq!(refund + prize + rem, tt.total_staked + tt.treasury_injection, "n={n} inj={inj} f={forfeited}");
            // 逐筆加總必須等於預算
            let (_, pa, pb) = pools(&tt, refund).unwrap();
            let sum: u64 = (1..=ranked).map(|r| refund_for(&tt, r) + prize_for(&tt, ranked, pa, pb, r)).sum();
            assert_eq!(sum, refund + prize);
            assert!(pool >= prize);
        }
    }

    #[test]
    fn linear_weights_and_empty_group() {
        let (a, b) = Tournament::group_sizes(10); // A 1、B 2
        let tt = t(10, 0, a, b);
        let (refund, _, _, _) = budget(&tt, 10).unwrap();
        let (pool, pa, pb) = pools(&tt, refund).unwrap();
        // 10 人：3 得獎（退 50 全額）、7 未得獎（退 25）→ pool = 500 - 150 - 175 = 175 tSKR
        assert_eq!(pool, 175 * TSKR_UNIT);
        assert_eq!((pa, pb), (105 * TSKR_UNIT, 70 * TSKR_UNIT));
        assert_eq!(prize_for(&tt, 10, pa, pb, 1), 105 * TSKR_UNIT);
        // B 組 2 人線性 2:1
        assert_eq!(prize_for(&tt, 10, pa, pb, 2), 70 * TSKR_UNIT * 2 / 3);
        assert_eq!(prize_for(&tt, 10, pa, pb, 3), 70 * TSKR_UNIT / 3);
        assert_eq!(prize_for(&tt, 10, pa, pb, 4), 0);
        // 只剩 1 人排名（其餘沒收）：B 組無人，其份額歸餘數
        let (refund1, prize1, rem1, _) = budget(&tt, 1).unwrap();
        assert_eq!(refund1, 50 * TSKR_UNIT);
        let (_, pa1, _) = pools(&tt, refund1).unwrap();
        assert_eq!(prize1, pa1);
        assert_eq!(rem1, 450 * TSKR_UNIT - pa1);
        // 全數沒收：無退款無獎金，全歸餘數
        assert_eq!(budget(&tt, 0).unwrap(), (0, 0, 500 * TSKR_UNIT, 500 * TSKR_UNIT));
    }

    #[test]
    fn canonical_layout_and_roll() {
        let c = canonical_result(&[1; 32], &[2; 32], 12_345, 1_789_000_000, 7, true);
        assert_eq!(&c[64..72], &12_345u64.to_le_bytes());
        assert_eq!(&c[80..84], &7u32.to_le_bytes());
        assert_eq!(c[84], 1);
        let h1 = roll(&[0; 32], &c);
        assert_ne!(h1, [0; 32]);
        assert_eq!(h1, roll(&[0; 32], &c));
        assert_ne!(roll(&h1, &c), h1);
    }
}
