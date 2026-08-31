/** 経過秒数を "mm:ss"(1時間以上は "hh:mm:ss")形式にする。 */
export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** 走行距離(km)を小数第2位までの文字列にする。 */
export function formatDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return '0.00';
  }
  return distanceKm.toFixed(2);
}
