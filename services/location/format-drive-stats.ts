/** 経過秒数を "mm:ss"(1時間以上は "hh:mm:ss")形式にする。 */
export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 走行距離(km)を小数第2位までの文字列にする。記録詳細画面(drive-recording/drive-summary/diary-detail等)の精度表示専用。 */
export function formatDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return '0.00';
  }
  return distanceKm.toFixed(2);
}

/**
 * 距離(km)を、単位とユーザーの読みやすさを考慮した表示ラベルへ変換する
 * (1km未満はメートル表記、100km未満は小数第1位、100km以上は桁区切りの整数)。
 * Diary一覧・Home・Route比較・Route Proposal等、カード上の要約表示用。
 * GPS計測由来の浮動小数点の生値(例: 0.00004822988791711062)をそのままUIへ
 * 出さないための共通フォーマッタ。
 */
export function formatDistanceLabel(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return '0 m';
  }
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  if (distanceKm < 100) {
    return `${distanceKm.toFixed(1)} km`;
  }
  return `${Math.round(distanceKm).toLocaleString('ja-JP')} km`;
}
