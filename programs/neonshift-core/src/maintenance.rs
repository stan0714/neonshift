//! PG-V-02：跑鞋維持挑戰純計算（shoe-gameplay 3、4.1、4.2）。與 `tools/maintenance-sim/rules.mjs` 同版參數與順序；
//! 鏈上結算只用這裡的函式，不接受後端／client 指定點數。

use crate::constants::*;

/// 目前日序落在第幾期（anchor 之前視為第 0 期）
pub fn epoch_index(anchor: u32, task_date: u32) -> u32 {
    task_date.saturating_sub(anchor) / EPOCH_DAYS
}

/// 期內第幾日（0..EPOCH_DAYS）
pub fn day_offset(anchor: u32, task_date: u32) -> u8 {
    (task_date.saturating_sub(anchor) % EPOCH_DAYS) as u8
}

/// 累積 XP 上限等級（Config 門檻）
pub fn xp_cap_level(xp: u64, thresholds: &[u64; 5]) -> u8 {
    let mut level = 1u8;
    for (i, t) in thresholds.iter().enumerate() {
        if xp >= *t {
            level = (i + 1) as u8;
        }
    }
    level
}

/// 該階維持條件：點數與活躍日須同時符合；Lv1 永遠通過
pub fn meets(level: u8, points: u16, active_days: u8) -> bool {
    let i = (level.clamp(1, 5) - 1) as usize;
    points >= MAINTENANCE_POINTS[i] && active_days >= MAINTENANCE_ACTIVE_DAYS[i]
}

/// 期末結算一期：(active_after, highest_after)
/// 1. Lv≥2 且未達 → 降一階，本次不升；2. 通過 → XP 上限內升至成績能支撐的最高階（可跨階、亦用於回歸）；3. 更新歷史最高。
pub fn settle_one(active: u8, highest: u8, xp_cap: u8, points: u16, active_days: u8) -> (u8, u8) {
    let next = if active >= 2 && !meets(active, points, active_days) {
        active - 1
    } else {
        let mut best = 1u8;
        for l in 1..=xp_cap.clamp(1, 5) {
            if meets(l, points, active_days) {
                best = l;
            }
        }
        best.max(active)
    };
    (next, highest.max(next))
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: [u64; 5] = [0, 450, 1500, 3600, 7500];

    #[test]
    fn epoch_and_offset() {
        assert_eq!(epoch_index(100, 100), 0);
        assert_eq!(epoch_index(100, 106), 0);
        assert_eq!(epoch_index(100, 107), 1);
        assert_eq!(day_offset(100, 113), 6);
        assert_eq!(epoch_index(100, 50), 0);
    }

    #[test]
    fn meets_thresholds_match_sim() {
        assert!(meets(5, 900, 6));
        assert!(!meets(5, 750, 5));
        assert!(meets(4, 750, 5));
        assert!(meets(2, 200, 2));
        assert!(!meets(2, 150, 1));
        assert!(meets(4, 700, 7)); // 睡眠不可用
        assert!(!meets(5, 700, 7));
        assert!(meets(1, 0, 0));
    }

    #[test]
    fn settle_matches_rules_mjs() {
        // 全勤 1050／7：Lv1 → Lv2（XP 1050）；回歸不逐階
        assert_eq!(settle_one(1, 1, xp_cap_level(1050, &T), 1050, 7), (2, 2));
        assert_eq!(settle_one(1, 5, xp_cap_level(9000, &T), 1050, 7), (5, 5));
        assert_eq!(settle_one(3, 5, 5, 750, 5), (4, 5));
        assert_eq!(settle_one(5, 5, 5, 750, 5), (4, 5)); // 降一階
        assert_eq!(settle_one(4, 4, xp_cap_level(5000, &T), 1050, 7), (4, 4)); // XP 不足 Lv5
        assert_eq!(settle_one(1, 1, 1, 0, 0), (1, 1)); // Lv1 保底
        assert_eq!(settle_one(2, 2, 3, 200, 2), (2, 2)); // 剛好維持
        // 缺席四期 Lv5 → Lv1，highest 不變
        let mut s = (5u8, 5u8);
        for _ in 0..4 {
            s = settle_one(s.0, s.1, 5, 0, 0);
        }
        assert_eq!(s, (1, 5));
    }
}
