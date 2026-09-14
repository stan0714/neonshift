/** 連線狀態（Style 14 offline）：expo-network；未知時視為在線，避免誤擋。 */
import { useNetworkState } from 'expo-network';

export function useOnline(): boolean {
  const state = useNetworkState();
  if (state.isConnected === undefined || state.isConnected === null) return true;
  return state.isConnected && state.isInternetReachable !== false;
}
