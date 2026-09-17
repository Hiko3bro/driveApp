/**
 * google-places Edge Functionが受け取る最小の入力の型と実行時検証、および
 * アプリのカテゴリからGoogle公式のPlace Types (New)への変換テーブル。
 * Googleの生のincludedTypesをクライアントに自由入力させず、この5カテゴリの
 * enumだけを受け取る。
 */

/**
 * 'history'(歴史・城・神社寺・歴史的建築)・'market'(市場)は、ドライブ計画
 * (気になる場所探し・区間探索)のために追加したカテゴリ。今すぐドライブ側の
 * Spot Discoveryのカテゴリチップは既存の5種のまま変更していない
 * (types/spot.tsのSPOT_BROWSE_FILTERS参照)。
 */
/**
 * 'coastal'は、drive-route-planner内部の海沿いcorridor探索専用に追加したカテゴリ
 * (plan-builder.tsが直接importして使うのみで、Expoクライアントやgoogle-places
 * Edge Functionへ公開しているカテゴリ一覧(services/spot/google-places-client.ts)
 * には含めていない)。
 */
export const PLACE_CATEGORY_OPTIONS = [
  'restaurant',
  'cafe',
  'scenic',
  'onsen',
  'activity',
  'history',
  'market',
  'coastal',
] as const;
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
  // 観光地・景勝地を優先する(WebFetchでGoogle公式Table Aを確認済みの実在type値のみ)。
  // 「おまかせ」等の主ゴール候補が小規模飲食店に偏らないよう、ランドマーク系を厚めにした。
  scenic: [
    'scenic_spot',
    'tourist_attraction',
    'observation_deck',
    'park',
    'beach',
    'national_park',
    'historical_landmark',
    'castle',
    'monument',
    'cultural_landmark',
    'shinto_shrine',
    'buddhist_temple',
    'museum',
    'aquarium',
    'zoo',
  ],
  onsen: ['spa', 'public_bath', 'sauna'],
  activity: ['tourist_attraction', 'hiking_area', 'amusement_park', 'aquarium', 'zoo'],
  // 歴史・城・神社寺・歴史的建築。Google Places API (New) Table Aの実在type値のみを使う。
  history: [
    'historical_landmark',
    'historical_place',
    'castle',
    'shinto_shrine',
    'buddhist_temple',
    'museum',
    'cultural_landmark',
    'monument',
  ],
  // 市場(伝統的な市場・朝市等)。
  market: ['market', 'farmers_market', 'flea_market'],
  // 海沿いcorridor探索専用(WebFetchでGoogle公式Table Aを確認した、海・港に直接関連する実在type値のみ)。
  coastal: ['beach', 'marina', 'fishing_pier'],
};

/**
 * 飲食店寄りのprimaryType(WebFetchでGoogle公式Table Aを確認済み)。「おまかせ」の主ゴール・
 * 一般的な景色/観光カテゴリ探索(scenic/history/market/activity/onsen/coastal)の結果に
 * 小規模飲食店が紛れ込んだ場合に除外するためだけに使う判定。ユーザーが明示的に
 * restaurant/cafeカテゴリを選んだ場合はこの判定を適用しない(除外しない)。
 */
const FOOD_PRIMARY_TYPES = new Set([
  'restaurant',
  'cafe',
  'coffee_shop',
  'bar',
  'bakery',
  'fast_food_restaurant',
  'meal_takeaway',
  'diner',
  'buffet_restaurant',
  'food_court',
  'ice_cream_shop',
]);

/** primaryTypeが飲食店寄りかどうか(cuisine別の"xxx_restaurant"も含む)。 */
export function isLikelyFoodPlace(primaryType: string | null): boolean {
  if (!primaryType) {
    return false;
  }
  return FOOD_PRIMARY_TYPES.has(primaryType) || primaryType.endsWith('_restaurant');
}

/** Place写真1件への参照。実画像バイナリやAPIキーはこの型に含めない。 */
export interface PlacePhotoRef {
  /** Photo Media取得に使うGoogle側リソース名(例: "places/PLACE_ID/photos/PHOTO_ID")。 */
  name: string;
  /** authorAttributions[].displayNameのみを抽出したもの(Google公式の表示義務対応)。 */
  attributions: string[];
}

/** アプリへ返す正規化済みの1スポット。Google固有のネストした構造には依存させない。 */
export interface PlaceCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
  /** addressComponentsから取り出した都道府県名(例:「高知県」)。取得できない場合はnull。 */
  prefecture: string | null;
  /** addressComponentsから取り出した市区町村名(例:「白浜町」)。取得できない場合はnull。 */
  locality: string | null;
  /** 先頭1枚分の写真参照のみ(1Place1枚方針)。写真が無いPlaceはnull。 */
  photoRef: PlacePhotoRef | null;
}

// ===== Text Search(地域名等の自由文から、実在する代表地点を1件解決する) ===============
//
// ドライブ計画のチャットで、AIが「高知駅」のような検索意図(defaultOriginQuery等)を
// 返した時に、実在確認して実座標を得るために使う。AIが座標や地点を直接作ることはない。

export const MAX_TEXT_QUERY_LENGTH = 100;
export const MIN_TEXT_MAX_RESULTS = 1;
export const MAX_TEXT_MAX_RESULTS = 5;
export const DEFAULT_TEXT_MAX_RESULTS = 1;

/**
 * locationBiasの半径のデフォルト・上限(m)。Google Places API (New) Text Searchの
 * 公式ドキュメント(locationBias.circle.radius)で「0.0〜50000.0(m)」と明記されている
 * ため、それを超える値は上限でクランプする(WebFetchで確認済み。以前200,000を設定して
 * いたのはGoogle側の実際の制約を確認しないまま設定した誤りで、高知県のような広域
 * planning areaでText Search Pool検索が全滅する不具合の原因になっていた)。
 */
export const DEFAULT_TEXT_BIAS_RADIUS_METERS = 30_000;
export const MIN_TEXT_BIAS_RADIUS_METERS = 1_000;
export const MAX_TEXT_BIAS_RADIUS_METERS = 50_000;

export interface TextSearchLocationBias {
  center: LatLng;
  radiusMeters: number;
}

export interface TextPlaceSearchRequest {
  textQuery: string;
  maxResults: number;
  /**
   * 「夜景スポット」のような一般的な検索語句が、ユーザーの出発地点等から遠く離れた
   * 無関係な場所にマッチしないよう、検索の重み付け中心を指定する(結果を厳密に
   * 制限はしない、Google側のlocationBiasと同じ「優先」的な扱い)。
   */
  locationBias?: TextSearchLocationBias;
}

export type TextValidationResult =
  | { ok: true; data: TextPlaceSearchRequest }
  | { ok: false; reason: string };

const ALLOWED_TEXT_REQUEST_KEYS = new Set(['mode', 'textQuery', 'maxResults', 'locationBias']);
const ALLOWED_LOCATION_BIAS_KEYS = new Set(['center', 'radiusMeters']);

function validateLocationBias(value: unknown): TextSearchLocationBias | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_LOCATION_BIAS_KEYS.has(key))) {
    return null;
  }
  const center = validateLatLng(record.center);
  if (!center) {
    return null;
  }
  let radiusMeters = DEFAULT_TEXT_BIAS_RADIUS_METERS;
  if (record.radiusMeters !== undefined) {
    if (
      typeof record.radiusMeters !== 'number' ||
      !Number.isFinite(record.radiusMeters) ||
      record.radiusMeters < MIN_TEXT_BIAS_RADIUS_METERS ||
      record.radiusMeters > MAX_TEXT_BIAS_RADIUS_METERS
    ) {
      return null;
    }
    radiusMeters = record.radiusMeters;
  }
  return { center, radiusMeters };
}

/** 想定外フィールド・空文字・長すぎる文字列のいずれも、例外を投げず拒否する。 */
export function validateTextPlaceSearchRequest(value: unknown): TextValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'body must be a JSON object' };
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_TEXT_REQUEST_KEYS.has(key))) {
    return { ok: false, reason: 'unexpected field present' };
  }

  if (
    typeof record.textQuery !== 'string' ||
    record.textQuery.trim().length === 0 ||
    record.textQuery.length > MAX_TEXT_QUERY_LENGTH
  ) {
    return { ok: false, reason: 'invalid textQuery' };
  }

  let maxResults = DEFAULT_TEXT_MAX_RESULTS;
  if (record.maxResults !== undefined) {
    if (
      typeof record.maxResults !== 'number' ||
      !Number.isInteger(record.maxResults) ||
      record.maxResults < MIN_TEXT_MAX_RESULTS ||
      record.maxResults > MAX_TEXT_MAX_RESULTS
    ) {
      return { ok: false, reason: 'invalid maxResults' };
    }
    maxResults = record.maxResults;
  }

  let locationBias: TextSearchLocationBias | undefined;
  if (record.locationBias !== undefined) {
    const validated = validateLocationBias(record.locationBias);
    if (!validated) {
      return { ok: false, reason: 'invalid locationBias' };
    }
    locationBias = validated;
  }

  return { ok: true, data: { textQuery: record.textQuery.trim(), maxResults, locationBias } };
}

// ===== Photo Media(候補カード表示用に、既に検索結果として得た写真参照から実画像を1枚取得する) =====
//
// photoNameはGoogleのレスポンスに由来する値だが、クライアントから受け取った時点では
// 「信頼できない入力」として扱い、Google側URLの一部に埋め込む前に厳格な形式検証を行う。

/** "places/PLACE_ID/photos/PHOTO_ID" 形式のみ許可する(URLへ埋め込む前提のため、任意の文字列は許可しない)。 */
const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_=-]+$/;
/**
 * Googleの実際のphotoリソース名はテスト実測で400〜500文字程度あるため、実在するIDを
 * 弾かないよう余裕を持たせた上限にする(それでも任意長の文字列を許可するわけではない、
 * URLへ埋め込む前提のためPHOTO_NAME_PATTERN自体の文字種制限が主な防御)。
 */
export const MAX_PHOTO_NAME_LENGTH = 2000;
export const MIN_PHOTO_MAX_WIDTH_PX = 200;
export const MAX_PHOTO_MAX_WIDTH_PX = 960;
export const DEFAULT_PHOTO_MAX_WIDTH_PX = 480;

export interface PhotoMediaRequest {
  photoName: string;
  maxWidthPx: number;
}

export type PhotoValidationResult =
  | { ok: true; data: PhotoMediaRequest }
  | { ok: false; reason: string };

const ALLOWED_PHOTO_REQUEST_KEYS = new Set(['mode', 'photoName', 'maxWidthPx']);

/** 想定外フィールド・不正な形式のphotoName・範囲外のmaxWidthPxのいずれも、例外を投げず拒否する。 */
export function validatePhotoMediaRequest(value: unknown): PhotoValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'body must be a JSON object' };
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_PHOTO_REQUEST_KEYS.has(key))) {
    return { ok: false, reason: 'unexpected field present' };
  }

  if (
    typeof record.photoName !== 'string' ||
    record.photoName.length === 0 ||
    record.photoName.length > MAX_PHOTO_NAME_LENGTH ||
    !PHOTO_NAME_PATTERN.test(record.photoName)
  ) {
    return { ok: false, reason: 'invalid photoName' };
  }

  let maxWidthPx = DEFAULT_PHOTO_MAX_WIDTH_PX;
  if (record.maxWidthPx !== undefined) {
    if (
      typeof record.maxWidthPx !== 'number' ||
      !Number.isInteger(record.maxWidthPx) ||
      record.maxWidthPx < MIN_PHOTO_MAX_WIDTH_PX ||
      record.maxWidthPx > MAX_PHOTO_MAX_WIDTH_PX
    ) {
      return { ok: false, reason: 'invalid maxWidthPx' };
    }
    maxWidthPx = record.maxWidthPx;
  }

  return { ok: true, data: { photoName: record.photoName, maxWidthPx } };
}
