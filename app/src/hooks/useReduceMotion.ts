import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** 系統 Reduce Motion（Style 15）：停用縮放／循環動畫，只保留 opacity 與靜態狀態。 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduce(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
