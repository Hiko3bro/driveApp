/**
 * google-places Edge Functionが受け取る最小の入力の型と実行時検証、および
 * アプリのカテゴリからGoogle公式のPlace Types (New)への変換テーブル。
 * Googleの生のincludedTypesをクライアントに自由入力させず、この5カテゴリの
 * enumだけを受け取る。
 */

export const PLACE_CATEGORY_OPTIONS = ['restaurant', 'cafe', 'scenic', 'onsen', 'activity'] as const;
export type PlaceCategory = (typeof PLACE_CATEGORY_OPTIONS)[number];

export const RANK_PREFERENCE_OPTIONS = ['POPULARITY', 'DISTANCE'] as const;
export type RankPreference = (typeof RANK_PREFERENCE_OPTIONS)[number];

export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;
export const MIN_RADIUS_METERS = 100;
export const MAX_RADIUS_METERS = 50_000;
export const MIN_MAX_RESULTS = 1;
export const MAX_MAX_RESULTS = 20;
export const DEFAULT_MAX_RESULTS = 10;
export const DEFAULT_RANK_PREFERENCE: RankPreference = 'POPULARITY';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface PlaceSearchRequest {
  center: LatLng;
  radiusMeters: number;
  category: PlaceCategory;
  maxResults: number;
  rankPreference: RankPreference;
}

export type ValidationResult =
  | { ok: true; data: PlaceSearchRequest }
  | { ok: false; reason: string };

const ALLOWED_REQUEST_KEYS = new Set(['center', 'radiusMeters', 'category', 'maxResults', 'rankPreference']);
const ALLOWED_LATLNG_KEYS = new Set(['latitude', 'longitude']);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateLatLng(value: unknown): LatLng | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
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

/** 想定外フィールド・不正な緯度経度・範囲外の値のいずれも、例外を投げず拒否する。 */
export function validatePlaceSearchRequest(value: unknown): ValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'body must be a JSON object' };
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_REQUEST_KEYS.has(key))) {
    return { ok: false, reason: 'unexpected field present' };
  }

  const center = validateLatLng(record.center);
  if (!center) {
    return { ok: false, reason: 'invalid center' };
  }

  if (
    typeof record.radiusMeters !== 'number' ||
    !Number.isFinite(record.radiusMeters) ||
    record.radiusMeters < MIN_RADIUS_METERS ||
    record.radiusMeters > MAX_RADIUS_METERS
  ) {
    return { ok: false, reason: 'invalid radiusMeters' };
  }

  if (
    typeof record.category !== 'string' ||
    !(PLACE_CATEGORY_OPTIONS as readonly string[]).includes(record.category)
  ) {
    return { ok: false, reason: 'invalid category' };
  }

  let maxResults = DEFAULT_MAX_RESULTS;
  if (record.maxResults !== undefined) {
    if (
      typeof record.maxResults !== 'number' ||
      !Number.isInteger(record.maxResults) ||
      record.maxResults < MIN_MAX_RESULTS ||
      record.maxResults > MAX_MAX_RESULTS
    ) {
      return { ok: false, reason: 'invalid maxResults' };
    }
    maxResults = record.maxResults;
  }

  let rankPreference: RankPreference = DEFAULT_RANK_PREFERENCE;
  if (record.rankPreference !== undefined) {
    if (
      typeof record.rankPreference !== 'string' ||
      !(RANK_PREFERENCE_OPTIONS as readonly string[]).includes(record.rankPreference)
    ) {
      return { ok: false, reason: 'invalid rankPreference' };
    }
    rankPreference = record.rankPreference as RankPreference;
  }

  return {
    ok: true,
    data: {
      center,
      radiusMeters: record.radiusMeters,
      category: record.category as PlaceCategory,
      maxResults,
      rankPreference,
    },
  };
}

/**
 * アプリのカテゴリ→Google公式Place Types (New)のマッピング。存在しない独自type
 * (例: "onsen"というGoogle typeがある前提)は送らない。実在するGoogle公式typeの
 * 組み合わせだけで近似する。
 */
export const CATEGORY_PLACE_TYPES: Record<PlaceCategory, string[]> = {
  restaurant: ['restaurant'],
  cafe: ['cafe', 'coffee_shop'],
  scenic: ['scenic_spot', 'tourist_attraction', 'observation_deck', 'park', 'beach'],
  onsen: ['spa', 'public_bath', 'sauna'],
  activity: ['tourist_attraction', 'hiking_area', 'amusement_park', 'aquarium', 'zoo'],
};

/** アプリへ返す正規化済みの1スポット。Google固有のネストした構造には依存させない。 */
export interface PlaceCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
}
