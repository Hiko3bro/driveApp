import { haversineDistanceKm } from '@/services/location/coordinates';
import type { Coordinates } from '@/types/location';

/** 経路全体を一往復するのにかける目安時間。実際の走行速度ではなく、体験確認用の目安値。 */
const DEMO_LOOP_DURATION_MS = 90_000;

/** 実在しない、丸めたデモ地域(DEMO_MAP_REGIONの中心と同じ)。経路が使えない場合のみのフォールバック。 */
const FALLBACK_DEMO_POINT: Coordinates = { latitude: 35, longitude: 135 };

function buildCumulativeDistances(path: Coordinates[]): number[] {
  const cumulative = [0];
  for (let i = 1; i < path.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineDistanceKm(path[i - 1], path[i]));
  }
  return cumulative;
}

function interpolateAlongPath(
  path: Coordinates[],
  cumulative: number[],
  fraction: number
): Coordinates {
  const total = cumulative[cumulative.length - 1];
  if (path.length === 1 || total <= 0) {
    return path[0];
  }

  const target = Math.min(Math.max(fraction, 0), 1) * total;
  let segmentIndex = cumulative.findIndex((value) => value >= target);
  if (segmentIndex <= 0) {
    segmentIndex = 1;
  }

  const segmentStart = cumulative[segmentIndex - 1];
  const segmentEnd = cumulative[segmentIndex];
  const segmentFraction =
    segmentEnd > segmentStart ? (target - segmentStart) / (segmentEnd - segmentStart) : 0;

  const from = path[segmentIndex - 1];
  const to = path[segmentIndex];
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * segmentFraction,
    longitude: from.longitude + (to.longitude - from.longitude) * segmentFraction,
  };
}

/**
 * Expo Go・権限拒否・シミュレーター等で実GPSが使えない場合のフォールバック用に、
 * 選択中ルートの経路(route.path)に沿って前後へ往復するデモ走行位置を生成する。
 * 表示・共有用のデータへは加工せず、生の緯度経度のみを返す。
 */
export function createDemoPositionSampler(path: Coordinates[]): (elapsedMs: number) => Coordinates {
  const safePath = path.length > 0 ? path : [FALLBACK_DEMO_POINT];
  const cumulative = buildCumulativeDistances(safePath);

  return (elapsedMs: number) => {
    const period = DEMO_LOOP_DURATION_MS;
    const t = (Math.max(0, elapsedMs) % (period * 2)) / period;
    const fraction = t <= 1 ? t : 2 - t;
    return interpolateAlongPath(safePath, cumulative, fraction);
  };
}
