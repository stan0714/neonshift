//! 獎勵計算與等級推導（PG-C-06／C-08，SD 3.4、SA BR-02／04／06／23／34／35）。
//! 純函式、不碰帳戶，方便邊界測試。

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::ErrorCode;
use crate::state::{Config, PlayerProfile};

/// 依 BR-06 推導本次任務應套用的連續天數；必須在計算獎勵前推導、成功後才寫回。
/// 同日第二項任務沿用同一值，不可累加兩次。
pub fn effective_streak_days(profile: &PlayerProfile, task_date: u32) -> Result<u16> {
    if profile.last_task_date == task_date {
        Ok(profile.streak_days)
    } else if profile.last_task_date.checked_add(1) == Some(task_date) {
        profile.streak_days.checked_add(1).ok_or_else(|| error!(ErrorCode::MathOverflow))
    } else {
        Ok(1)
    }
}

/// 未受每日上限收斂前的原始獎勵：`floor(base × core_bps × streak_bps / 10^8)`，全程 u128。
pub fn raw_reward(config: &Config, core_level: u8, task_type: u8, streak_days: u16) -> Result<u64> {
    let base: u64 = match task_type {
        TASK_STEPS => config.base_steps_reward,
        TASK_SLEEP => config.base_sleep_reward,
        _ => return Err(error!(ErrorCode::InvalidTaskType)),
    };
    let idx = core_level.checked_sub(1).ok_or(ErrorCode::InvalidCoreLevel)? as usize;
    let multiplier_bps = *config.core_multiplier_bps.get(idx).ok_or(ErrorCode::InvalidCoreLevel)?;
    let streak_bps: u64 = if config.streak_enabled && streak_days >= STREAK_BONUS_DAYS {
        config.streak_bonus_bps as u64
    } else {
        BPS_ONE as u64
    };
    let raw = (base as u128)
        .checked_mul(multiplier_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_mul(streak_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / 100_000_000u128; // 10_000 × 10_000
    u64::try_from(raw).map_err(|_| error!(ErrorCode::MathOverflow))
}

/// BR-04：以剩餘日額收斂
pub fn capped_reward(raw: u64, daily_cap: u64, claimed_today: u64) -> u64 {
    raw.min(daily_cap.saturating_sub(claimed_today))
}

/// BR-34：每次成功打卡的 XP
pub fn xp_for(task_type: u8) -> Result<u64> {
    match task_type {
        TASK_STEPS => Ok(XP_STEPS),
        TASK_SLEEP => Ok(XP_SLEEP),
        _ => Err(error!(ErrorCode::InvalidTaskType)),
    }
}

/// BR-35：以最高已達門檻推導等級（1～5）；滿階維持 5。升級免費後 core_level 與 shoe_level 皆用此值
pub fn shoe_level_for(xp: u64, thresholds: &[u64; 5]) -> u8 {
    let mut level = PlayerProfile::MIN_LEVEL;
    for (i, t) in thresholds.iter().enumerate() {
        if xp >= *t {
            level = (i + 1) as u8;
        }
    }
    level
}

/// 升級分配（SD 3.4；升級改為免費後保留供未來付費功能）：`burn = floor(cost × burn_bps / 10_000)`、`treasury = cost - burn`
pub fn split_upgrade_cost(cost: u64, burn_bps: u16) -> Result<(u64, u64)> {
    let burn = (cost as u128)
        .checked_mul(burn_bps as u128)
        .ok_or(ErrorCode::MathOverflow)?
        / BPS_ONE as u128;
    let burn = u64::try_from(burn).map_err(|_| error!(ErrorCode::MathOverflow))?;
    Ok((burn, cost - burn))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Config {
        Config {
            admin: Pubkey::default(),
            cluster_id: CLUSTER_LOCALNET,
            attestor_pubkey: Pubkey::default(),
            attestor_valid_from: 0,
            prev_attestor_pubkey: Pubkey::default(),
            prev_attestor_valid_until: 0,
            mint: Pubkey::default(),
            mint_decimals: 6,
            reward_vault: Pubkey::default(),
            treasury_vault: Pubkey::default(),
            daily_cap: DEFAULT_DAILY_CAP,
            base_steps_reward: DEFAULT_BASE_STEPS_REWARD,
            base_sleep_reward: DEFAULT_BASE_SLEEP_REWARD,
            streak_enabled: false,
            streak_bonus_bps: DEFAULT_STREAK_BONUS_BPS,
            burn_bps: DEFAULT_BURN_BPS,
            core_multiplier_bps: DEFAULT_CORE_MULTIPLIER_BPS,
            core_upgrade_costs: [1, 2, 3, 4],
            shoe_xp_thresholds: DEFAULT_SHOE_XP_THRESHOLDS,
            paused: false,
            paused_at: 0,
            bump: 0,
        }
    }

    fn profile(last: u32, streak: u16) -> PlayerProfile {
        PlayerProfile {
            wallet: Pubkey::default(),
            core_level: 1,
            shoe_level: 1,
            xp: 0,
            last_task_date: last,
            streak_days: streak,
            max_streak_days: streak,
            claimed_today: 0,
            today_date: 0,
            bump: 0,
            highest_level: 1,
            epoch_anchor: 0,
            last_settled_epoch: 0,
            epoch_points: 0,
            epoch_bitmap: 0,
            maintenance_rules_version: 1,
        }
    }

    #[test]
    fn core_levels_match_brd_table() {
        // BRD 8.3：步數 10 tSKR × 倍率
        let c = cfg();
        let expected = [10_000_000u64, 12_000_000, 15_000_000, 18_000_000, 22_000_000];
        for (lvl, exp) in (1u8..=5).zip(expected) {
            assert_eq!(raw_reward(&c, lvl, TASK_STEPS, 1).unwrap(), exp, "core {lvl}");
        }
        assert_eq!(raw_reward(&c, 3, TASK_SLEEP, 1).unwrap(), 7_500_000);
    }

    #[test]
    fn invalid_core_level_and_task_type() {
        let c = cfg();
        assert!(raw_reward(&c, 0, TASK_STEPS, 1).is_err());
        assert!(raw_reward(&c, 6, TASK_STEPS, 1).is_err());
        assert!(raw_reward(&c, 1, 3, 1).is_err());
    }

    #[test]
    fn streak_bonus_only_when_enabled_and_seven_days() {
        let mut c = cfg();
        assert_eq!(raw_reward(&c, 1, TASK_STEPS, 7).unwrap(), 10_000_000, "停用時一律 1.0x");
        c.streak_enabled = true;
        assert_eq!(raw_reward(&c, 1, TASK_STEPS, 6).unwrap(), 10_000_000);
        assert_eq!(raw_reward(&c, 1, TASK_STEPS, 7).unwrap(), 11_000_000);
        assert_eq!(raw_reward(&c, 5, TASK_STEPS, 30).unwrap(), 24_200_000);
    }

    #[test]
    fn effective_streak_rules() {
        // 連續：+1；同日：沿用；斷日：1；首次（last=0, task=1）：連續視同 +1
        assert_eq!(effective_streak_days(&profile(100, 3), 101).unwrap(), 4);
        assert_eq!(effective_streak_days(&profile(101, 4), 101).unwrap(), 4);
        assert_eq!(effective_streak_days(&profile(100, 3), 105).unwrap(), 1);
        assert_eq!(effective_streak_days(&profile(0, 0), 20_710).unwrap(), 1);
        assert!(effective_streak_days(&profile(100, u16::MAX), 101).is_err());
    }

    #[test]
    fn daily_cap_and_boundaries() {
        assert_eq!(capped_reward(10, 40, 0), 10);
        assert_eq!(capped_reward(10, 40, 35), 5, "額度部分剩餘只發剩餘量");
        assert_eq!(capped_reward(10, 40, 40), 0);
        assert_eq!(capped_reward(10, 40, 41), 0, "claimed 超過 cap 不得下溢");
        assert_eq!(capped_reward(10, 40, 39), 1, "額度剩 1");
        let mut c = cfg();
        c.base_steps_reward = 0;
        assert_eq!(raw_reward(&c, 5, TASK_STEPS, 1).unwrap(), 0, "base 為 0");
        c.base_steps_reward = u64::MAX;
        c.core_multiplier_bps = [10_000, 10_000, 10_000, 10_000, MAX_CORE_MULTIPLIER_BPS];
        assert!(raw_reward(&c, 5, TASK_STEPS, 1).is_err(), "倍率最大值 × u64::MAX 溢位 → 6011");
        assert_eq!(raw_reward(&c, 1, TASK_STEPS, 1).unwrap(), u64::MAX, "1.0x 不溢位");
    }

    #[test]
    fn shoe_level_thresholds_br35() {
        let t = DEFAULT_SHOE_XP_THRESHOLDS;
        assert_eq!(shoe_level_for(0, &t), 1);
        assert_eq!(shoe_level_for(449, &t), 1);
        assert_eq!(shoe_level_for(450, &t), 2);
        assert_eq!(shoe_level_for(1_499, &t), 2);
        assert_eq!(shoe_level_for(1_500, &t), 3);
        assert_eq!(shoe_level_for(7_500, &t), 5);
        assert_eq!(shoe_level_for(u64::MAX, &t), 5, "滿階維持 Lv5");
    }

    #[test]
    fn upgrade_split_is_exact() {
        assert_eq!(split_upgrade_cost(100, 7_000).unwrap(), (70, 30));
        assert_eq!(split_upgrade_cost(101, 7_000).unwrap(), (70, 31), "整數餘數歸國庫");
        assert_eq!(split_upgrade_cost(1, 7_000).unwrap(), (0, 1));
        assert_eq!(split_upgrade_cost(u64::MAX, 10_000).unwrap(), (u64::MAX, 0));
    }
}
