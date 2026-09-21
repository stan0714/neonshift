/**
 * 連線狀態（Style 14 offline）：expo-network；未知時視為在線，避免誤擋。
 *
 * 2026-09-21 實機：Wi-Fi 回來後 `useNetworkState` 的監聽沒有更新（App 在背景時斷網→回前景仍顯示 offline，
 * 冷啟才恢復）。因此另外在回前景時，以及顯示 offline 期間每 10 秒，主動 `getNetworkStateAsync()` 校正一次。
 */
import { getNetworkStateAsync, useNetworkState } from 'expo-network';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

const RECHECK_MS = 10_000;

type Probe = { isConnected?: boolean | null; isInternetReachable?: boolean | null };

function online(s: Probe): boolean {
  if (s.isConnected === undefined || s.isConnected === null) return true;
  return s.isConnected && s.isInternetReachable !== false;
}

export function useOnline(): boolean {
  const listened = online(useNetworkState());
  const [probed, setProbed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    setProbed(null);
    const probe = () => getNetworkStateAsync().then((s) => { if (alive) setProbed(online(s)); }).catch(() => {});
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void probe(); });
    // 監聽說離線時定期複查；監聽說在線就以監聽為準（不再輪詢）
    const timer = listened ? null : setInterval(() => void probe(), RECHECK_MS);
    if (!listened) void probe();
    return () => { alive = false; sub.remove(); if (timer) clearInterval(timer); };
  }, [listened]);

  // 監聽在線 → 在線；監聽離線 → 以最近一次主動探測為準（探測尚未回來時沿用監聽）
  if (listened) return true;
  return probed ?? false;
}
