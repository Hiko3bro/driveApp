/**
 * google-routes Edge Functionが受け取る最小の入力の型と実行時検証。
 * 緯度経度以外の個人情報(住所・保存済み場所名・GPS履歴等)はそもそも
 * この型に存在しない。
 */

export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/**
 * 経由地点数の安全な上限。Google Routes API自体の上限はこれより大きいが、
 * 乱用防止と応答時間の観点から保守的に制限する。
 */
export const MAX_INTERMEDIATES = 10;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * このEdge Functionが受け取る最小のリクエスト形状。avoidHighwaysのみ、
 * Google Routes APIのRouteModifiersへ正式にマッピングする(Google公式上、
 * 「絶対に使わない」保証ではなく可能な範囲で避けるbiasであることが前提)。
 * preferScenicRoads/preferCoastalRoads等はここでは受け取らない
 * (Google Routes APIが直接サポートする概念ではないため、Places/waypoint選定側の責務)。
 */
export interface GoogleRoutesRequest {
  origin: LatLng;
  destination: LatLng;
  intermediates?: LatLng[];
  avoidHighways?: boolean;
}

export type ValidationResult =
  | { ok: true; data: GoogleRoutesRequest }
  | { ok: false; reason: string };

const ALLOWED_REQUEST_KEYS = new Set(["origin", "destination", "intermediates", "avoidHighways"]);
const ALLOWED_LATLNG_KEYS = new Set(["latitude", "longitude"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateLatLng(value: unknown): LatLng | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_LATLNG_KEYS.has(key))) {
    return null;
  }
  const { latitude, longitude } = record;
  if (!isFiniteNumber(latitude) || latitude < MIN_LATITUDE || latitude > MAX_LATITUDE) {
    return null;
  }
  if (!isFiniteNumber(longitude) || longitude < MIN_LONGITUDE || longitude > MAX_LONGITUDE) {
    return null;
  }
  return { latitude, longitude };
}

/** 想定外フィールド・不正な緯度経度・上限を超える経由地点数のいずれも、例外を投げず拒否する。 */
export function validateGoogleRoutesRequest(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_REQUEST_KEYS.has(key))) {
    return { ok: false, reason: "unexpected field present" };
  }

  const origin = validateLatLng(record.origin);
  if (!origin) {
    return { ok: false, reason: "invalid origin" };
  }
  const destination = validateLatLng(record.destination);
  if (!destination) {
    return { ok: false, reason: "invalid destination" };
  }

  let intermediates: LatLng[] | undefined;
  if (record.intermediates !== undefined) {
    if (!Array.isArray(record.intermediates) || record.intermediates.length > MAX_INTERMEDIATES) {
      return { ok: false, reason: "invalid intermediates" };
    }
    const parsed: LatLng[] = [];
    for (const item of record.intermediates) {
      const point = validateLatLng(item);
      if (!point) {
        return { ok: false, reason: "invalid intermediate point" };
      }
      parsed.push(point);
    }
    intermediates = parsed;
  }

  let avoidHighways: boolean | undefined;
  if (record.avoidHighways !== undefined) {
    if (typeof record.avoidHighways !== "boolean") {
      return { ok: false, reason: "avoidHighways must be boolean" };
    }
    avoidHighways = record.avoidHighways;
  }

  return { ok: true, data: { origin, destination, intermediates, avoidHighways } };
}

/**
 * アプリへ返す正規化済みのルート候補。Googleの生レスポンス形状(nested location等)
 * への依存をアプリ側へ広げないための共有shape。1〜3件を想定するが、この型自体は
 * 件数を限定しない(呼び出し側が配列の長さで扱う)。
 */
export interface RouteCandidate {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  routeLabels: string[];
}
