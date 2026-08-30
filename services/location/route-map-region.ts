import {
  DEMO_MAP_REGION,
  isValidCoordinates,
  isValidMapRegion,
  normalizeLongitude,
} from '@/services/location/coordinates';
import type { Coordinates, MapRegion } from '@/types/location';

const CAMERA_PADDING_RATIO = 1.6;
const MIN_CAMERA_DELTA = 0.015;
const MAX_LATITUDE_DELTA = 180;
const MAX_LONGITUDE_DELTA = 360;

function paddedDelta(span: number, maximum: number): number {
  if (!Number.isFinite(span) || span < 0) {
    return MIN_CAMERA_DELTA;
  }

  return Math.min(Math.max(span * CAMERA_PADDING_RATIO, MIN_CAMERA_DELTA), maximum);
}

/**
 * 経度を円周上で扱い、全地点を含む最小の弧を返す。
 * 例: [135.0, 135.2] -> 中心135.1・幅0.2、
 *     [179.9, -179.9] -> 中心-180・幅0.2。
 */
function computeMinimalLongitudeArc(longitudes: number[]): { center: number; span: number } | null {
  if (longitudes.length === 0) {
    return null;
  }

  const sorted = [...longitudes].sort((a, b) => a - b);
  let largestGap = -1;
  let arcStart = sorted[0];
  let arcEnd = sorted[0];

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next = index === sorted.length - 1 ? sorted[0] + 360 : sorted[index + 1];
    const gap = next - current;

    if (gap > largestGap) {
      largestGap = gap;
      // 最大の空白区間を除いた反対側の弧が、全地点を含む最小範囲になる。
      arcStart = next;
      arcEnd = current + 360;
    }
  }

  const span = arcEnd - arcStart;
  const center = normalizeLongitude((arcStart + arcEnd) / 2);
  if (center === null || !Number.isFinite(span) || span < 0 || span > 360) {
    return null;
  }

  return { center, span };
}

/**
 * ルート全体を安全に収めるカメラ範囲を計算する純粋関数。
 * 空配列・無効座標のみならデモ地域、単一点なら最小deltaを返す。
 */
export function computeRegionForPath(path: readonly Coordinates[]): MapRegion {
  const validPath = path.filter(isValidCoordinates);
  if (validPath.length === 0) {
    return { ...DEMO_MAP_REGION };
  }

  let minLatitude = validPath[0].latitude;
  let maxLatitude = validPath[0].latitude;
  const longitudes: number[] = [];

  for (const point of validPath) {
    minLatitude = Math.min(minLatitude, point.latitude);
    maxLatitude = Math.max(maxLatitude, point.latitude);
    longitudes.push(point.longitude);
  }

  const longitudeArc = computeMinimalLongitudeArc(longitudes);
  if (!longitudeArc) {
    return { ...DEMO_MAP_REGION };
  }

  const region: MapRegion = {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: longitudeArc.center,
    latitudeDelta: paddedDelta(maxLatitude - minLatitude, MAX_LATITUDE_DELTA),
    longitudeDelta: paddedDelta(longitudeArc.span, MAX_LONGITUDE_DELTA),
  };

  return isValidMapRegion(region) ? region : { ...DEMO_MAP_REGION };
}
