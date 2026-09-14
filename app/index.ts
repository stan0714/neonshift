// polyfill 必須在任何 @solana/web3.js import 之前載入（Runbook 2.2）
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

import { registerRootComponent } from 'expo';

import App from './App';
// PG-R-03：背景定位任務必須在啟動時定義（前景服務推送定位）
import './src/services/workouts/locationTask';

const g = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
if (typeof g.Buffer === 'undefined') {
  g.Buffer = Buffer;
}

registerRootComponent(App);
