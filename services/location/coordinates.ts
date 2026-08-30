import type { Coordinates, MapRegion } from '@/types/location';

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/** 実在の住所や目印を意図しない、地図初期表示専用の丸めたデモ地域。 */
export const DEMO_MAP_REGION: MapRegion = {
  latitude: 35,
  longitude: 135,
  latitudeDelta: 0.03,
  longitudeDelta: 0.03,
};

/** ネイティブ地図へ渡せる有限かつ有効範囲内の座標かを確認する。 */
export function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const { latitude, longitude } = value as Partial<Coordinates>;
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= MIN_LATITUDE &&
    latitude <= MAX_LATITUDE &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= MIN_LONGITUDE &&
    longitude <= MAX_LONGITUDE
  );
}

/** 座標に加えて、カメラ表示範囲も有限の正数であることを確認する。 */
export function isValidMapRegion(value: unknown): value is MapRegion {
  if (!isValidCoordinates(value)) {
    return false;
  }

  const { latitudeDelta, longitudeDelta } = value as Partial<MapRegion>;
  return (
    typeof latitudeDelta === 'number' &&
    Number.isFinite(latitudeDelta) &&
    latitudeDelta > 0 &&
    latitudeDelta <= 180 &&
    typeof longitudeDelta === 'number' &&
    Number.isFinite(longitudeDelta) &&
    longitudeDelta > 0 &&
    longitudeDelta <= 360
  );
}

/** 任意の有限な経度をネイティブ地図が扱える[-180, 180)へ正規化する。 */
export function normalizeLongitude(longitude: number): number | null {
  if (!Number.isFinite(longitude)) {
    return null;
  }

  const normalized = ((((longitude - MIN_LONGITUDE) % 360) + 360) % 360) + MIN_LONGITUDE;
  return Object.is(normalized, -0) ? 0 : normalized;
}

/** 計算で生成した座標をネイティブ地図が扱える範囲へ収める。 */
export function normalizeGeneratedCoordinates(coordinates: Coordinates): Coordinates | null {
  if (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude)) {
    return null;
  }

  const latitude = Math.min(MAX_LATITUDE, Math.max(MIN_LATITUDE, coordinates.latitude));
  const longitude = normalizeLongitude(coordinates.longitude);
  if (longitude === null) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}
