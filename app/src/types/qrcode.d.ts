/**
 * `qrcode` 沒有附型別；這裡只宣告分享圖卡用到的那一支（create → modules 矩陣），
 * 不把整包吃成 any。react-native-qrcode-svg 內部也是這樣用它
 * （node_modules/react-native-qrcode-svg/src/genMatrix.js），能在 RN 跑已由活動報到 QR 實機驗證。
 */
declare module 'qrcode' {
  export type QRCodeErrorCorrectionLevel = 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H';
  export type QRCodeMatrix = { modules: { size: number; data: Uint8Array | number[] } };
  export function create(text: string, options?: { errorCorrectionLevel?: QRCodeErrorCorrectionLevel; version?: number }): QRCodeMatrix;
  const _default: { create: typeof create };
  export default _default;
}
