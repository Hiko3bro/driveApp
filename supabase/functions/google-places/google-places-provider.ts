/**
 * Google Places API (New) の Nearby Search(POST /v1/places:searchNearby)・
 * Text Search(POST /v1/places:searchText)への実接続。生のfetch()だけを使い、
 * 公式クライアントライブラリは追加していない。このファイルだけがGoogle固有の詳細
 * (URL・ヘッダー形式・リトライ方針・レスポンス正規化)を知っている。index.ts
 * (Gateway)はこのモジュールが返す正規化済みのPlaceCandidate[]だけを見て応答を組み立てる。
 */
import { checkExternalApiBudget } from "../ai-route-planning/rate-limit-infra.ts";
import {
  CATEGORY_PLACE_TYPES,
  type PlaceCandidate,
  type PlacePhotoRef,
  type PlaceSearchRequest,
  type TextPlaceSearchRequest,
} from "./place-types.ts";

const SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PHOTO_MEDIA_BASE_URL = "https://places.googleapis.com/v1";

/**
 * 必要最小限のフィールドだけを要求する。rating/reviews/currentOpeningHours/
 * websiteUri/priceLevel等のEnterprise+Atmosphere系フィールドは今回も
 * 一切要求しない(コスト抑制のため、Enterprise+Atmosphere tierへの追加課金が発生する)。
 * addressComponentsは、Text Search・Nearby Searchいずれも既存の課金tier
 * (Text SearchはEssentials/Proが同額、Nearby SearchはそもそもProのみでEssentials
 * 自体が存在しない)の範囲内で追加できることを確認済みのため、planning area
 * (都道府県)の実在確認用に追加した(candidateがplanning area内かどうかの
 * ハードな判定に使う、plan-builder.ts参照)。
 * photosは、候補カードの写真表示(1Place1枚、表示された候補分だけ)のために追加した。
 * 公式ドキュメントでは`displayName`/`primaryType`と同じ基本属性系フィールドとして
 * 案内されており、口コミ・営業状態系(rating/reviews/openingHours)のような
 * Enterprise+Atmosphere tierとは別系統という理解だが、正確なSKU区分はGoogleの
 * Pricing & Billingページでのみ確認できるため断定はしていない。この行を消すだけで
 * 写真機能全体を即座に無効化でき、既存の検索結果自体には影響しない。
 */
const FIELD_MASK =
  "places.id,places.displayName,places.location,places.primaryType,places.addressComponents,places.photos";

/** 1回のGoogle呼び出しにかけるタイムアウト(ミリ秒)。 */
const PLACES_TIMEOUT_MS = 8_000;
/** サーバー側リトライは最大1回まで(無限リトライ禁止)。429/5xx/timeout/network errorのみ対象。 */
const PLACES_MAX_RETRIES = 1;
/** リトライ前の短いbackoff(ミリ秒)。 */
const PLACES_RETRY_BACKOFF_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PlacesAttemptResult =
  | { kind: "success"; body: unknown }
  | { kind: "timeout" }
  | { kind: "rate_limited" }
  | { kind: "server_error" }
  | { kind: "client_error" }
  /** HTTP的には成功(200)だが、期待した形のJSONを取り出せなかったケース。Google側の障害(5xx)とは別カテゴリ。 */
  | { kind: "malformed_response" }
  | { kind: "network_error" };

/** timeout/429/5xx/ネットワークエラーだけがリトライ対象。malformed_response・4xxはリトライしない。 */
function isRetryable(kind: PlacesAttemptResult["kind"]): boolean {
  return kind === "timeout" || kind === "rate_limited" || kind === "server_error" || kind === "network_error";
}

function buildGoogleRequestBody(request: PlaceSearchRequest): Record<string, unknown> {
  return {
    includedTypes: CATEGORY_PLACE_TYPES[request.category],
    maxResultCount: request.maxResults,
    rankPreference: request.rankPreference,
    languageCode: "ja",
    regionCode: "JP",
    locationRestriction: {
      circle: {
        center: { latitude: request.center.latitude, longitude: request.center.longitude },
        radius: request.radiusMeters,
      },
    },
  };
}

/**
 * locationRestriction(厳密な範囲制限)は指定しない(地域名等の自由文そのもので検索する
 * ため、範囲外の実在地点を弾いてしまうと逆に不自然)。locationBiasが指定された場合のみ、
 * その中心付近を優先する「重み付け」を追加する(「夜景スポット」等の一般的な語句が、
 * 出発地点から無関係に離れた場所にマッチしないようにするため)。
 */
function buildTextRequestBody(request: TextPlaceSearchRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    textQuery: request.textQuery,
    maxResultCount: request.maxResults,
    languageCode: "ja",
    regionCode: "JP",
  };
  if (request.locationBias) {
    body.locationBias = {
      circle: {
        center: {
          latitude: request.locationBias.center.latitude,
          longitude: request.locationBias.center.longitude,
        },
        radius: request.locationBias.radiusMeters,
      },
    };
  }
  return body;
}

async function requestPlacesOnce(apiKey: string, url: string, requestBody: string): Promise<PlacesAttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        // APIキーはヘッダーへ使うだけで、ログにもレスポンスにも出さない。
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
        "Content-Type": "application/json",
      },
      body: requestBody,
      signal: controller.signal,
    });

    if (response.status === 429) {
      return { kind: "rate_limited" };
    }
    if (response.status >= 500) {
      return { kind: "server_error" };
    }
    if (!response.ok) {
      return { kind: "client_error" };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { kind: "malformed_response" };
    }
    return { kind: "success", body: json };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { kind: "timeout" };
    }
    return { kind: "network_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * addressComponents(Google Places API (New)の生レスポンス)から、
 * types: ["administrative_area_level_1", ...] を持つ要素のlongText(例:「高知県」)を
 * 取り出す。日本の都道府県はadministrative_area_level_1に対応する
 * (Google Places公式ドキュメントのAddress Component Typesで確認済み)。
 * 見つからない/形式が想定外の場合はnull(=planning area判定は距離ベースへ安全にフォールバック)。
 */
function extractPrefecture(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const types = record.types;
    if (!Array.isArray(types) || !types.includes("administrative_area_level_1")) {
      continue;
    }
    const longText = record.longText;
    if (typeof longText === "string" && longText.length > 0) {
      return longText;
    }
  }
  return null;
}

/**
 * addressComponentsから、types: ["locality", ...] を持つ要素のlongText
 * (例:「白浜町」「高知市」)を取り出す。市区町村が取れない地点(離島・自然地形等)
 * もあるため、見つからない場合はnull(=説明文生成側は都道府県名だけにフォールバックする)。
 */
function extractLocality(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const types = record.types;
    if (!Array.isArray(types) || !types.includes("locality")) {
      continue;
    }
    const longText = record.longText;
    if (typeof longText === "string" && longText.length > 0) {
      return longText;
    }
  }
  return null;
}

/**
 * 検索結果に含まれるphotos配列から、先頭1枚分の参照だけを抽出する(1Place1枚方針、
 * 実画像は別途Photo Media APIで取得する。ここでは参照名とattributionのみ)。
 */
function extractPhotoRef(value: unknown): PlacePhotoRef | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const first = value[0];
  if (typeof first !== "object" || first === null) {
    return null;
  }
  const record = first as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  const attributions: string[] = [];
  const rawAttributions = record.authorAttributions;
  if (Array.isArray(rawAttributions)) {
    for (const attribution of rawAttributions) {
      if (typeof attribution !== "object" || attribution === null) {
        continue;
      }
      const displayName = (attribution as Record<string, unknown>).displayName;
      if (typeof displayName === "string" && displayName.length > 0) {
        attributions.push(displayName);
      }
    }
  }

  return { name, attributions };
}

/** 1件のPlaceを検証・正規化する。想定外の形はnull(呼び出し側でその候補だけ除外する)。 */
function normalizePlace(value: unknown): PlaceCandidate | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  const id = record.id;
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }

  const displayName = record.displayName;
  if (typeof displayName !== "object" || displayName === null) {
    return null;
  }
  const name = (displayName as Record<string, unknown>).text;
  if (typeof name !== "string" || name.length === 0) {
    return null;
  }

  const location = record.location;
  if (typeof location !== "object" || location === null) {
    return null;
  }
  const latitude = (location as Record<string, unknown>).latitude;
  const longitude = (location as Record<string, unknown>).longitude;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    return null;
  }

  const primaryType = record.primaryType;

  return {
    id,
    name,
    latitude,
    longitude,
    primaryType: typeof primaryType === "string" ? primaryType : null,
    prefecture: extractPrefecture(record.addressComponents),
    locality: extractLocality(record.addressComponents),
    photoRef: extractPhotoRef(record.photos),
  };
}

/**
 * Googleの生レスポンスを無条件に信頼せず、1件ごとに検証してから正規化する。
 * 不正な形の候補はその候補だけを除外する(応答全体は落とさない)。placesフィールド
 * 自体が無い/空配列は「該当スポットなし」という正常な検索結果として扱い、
 * 空配列を返す。1件以上あったのに全件が不正な形だった場合のみ、応答全体を
 * 不正として扱う(null、呼び出し側でinvalid_response)。
 */
function normalizePlaces(body: unknown): PlaceCandidate[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.places === undefined) {
    return [];
  }
  if (!Array.isArray(record.places)) {
    return null;
  }
  if (record.places.length === 0) {
    return [];
  }

  const candidates: PlaceCandidate[] = [];
  for (const item of record.places) {
    const normalized = normalizePlace(item);
    if (normalized) {
      candidates.push(normalized);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates;
}

export type GooglePlacesFailureReason =
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "invalid_response"
  | "budget_exceeded";

export type GooglePlacesOutcome =
  | { ok: true; places: PlaceCandidate[] }
  | { ok: false; reason: GooglePlacesFailureReason };

/**
 * Google Placesへ実際にfetchを送る回数(初回+最大PLACES_MAX_RETRIES回)ぶんだけ、
 * その都度checkExternalApiBudget("google-places")を呼ぶ。予算チェックが通らなければ、
 * その回のfetchは送らずに終了する(budget_exceeded)。
 */
export async function searchNearbyPlaces(request: PlaceSearchRequest): Promise<GooglePlacesOutcome> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    return { ok: false, reason: "server_error" };
  }

  const requestBody = JSON.stringify(buildGoogleRequestBody(request));

  let lastAttempt: PlacesAttemptResult | null = null;

  for (let attempt = 0; attempt <= PLACES_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(PLACES_RETRY_BACKOFF_MS);
    }

    const budgetOk = await checkExternalApiBudget("google-places");
    if (!budgetOk) {
      return { ok: false, reason: "budget_exceeded" };
    }

    const result = await requestPlacesOnce(apiKey, SEARCH_NEARBY_URL, requestBody);
    lastAttempt = result;

    if (result.kind === "success") {
      const places = normalizePlaces(result.body);
      if (!places) {
        return { ok: false, reason: "invalid_response" };
      }
      return { ok: true, places };
    }

    if (!isRetryable(result.kind)) {
      break;
    }
    // ループを継続 = 1回だけリトライする(PLACES_MAX_RETRIES=1のため最大2試行)。
  }

  switch (lastAttempt?.kind) {
    case "timeout":
      return { ok: false, reason: "timeout" };
    case "rate_limited":
      return { ok: false, reason: "rate_limited" };
    case "server_error":
    case "network_error":
      return { ok: false, reason: "server_error" };
    case "malformed_response":
      return { ok: false, reason: "invalid_response" };
    default:
      return { ok: false, reason: "client_error" };
  }
}

/**
 * Text Search(POST /v1/places:searchText)。地域名・施設名等の自由文から、
 * 実在する代表地点を解決する(ドライブ計画チャットの「defaultOriginQuery」解決用)。
 * FIELD_MASK・正規化・予算チェック・リトライ方針はNearby Searchと共通のものを再利用する。
 */
export async function searchTextPlaces(request: TextPlaceSearchRequest): Promise<GooglePlacesOutcome> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    return { ok: false, reason: "server_error" };
  }

  const requestBody = JSON.stringify(buildTextRequestBody(request));

  let lastAttempt: PlacesAttemptResult | null = null;

  for (let attempt = 0; attempt <= PLACES_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(PLACES_RETRY_BACKOFF_MS);
    }

    const budgetOk = await checkExternalApiBudget("google-places");
    if (!budgetOk) {
      return { ok: false, reason: "budget_exceeded" };
    }

    const result = await requestPlacesOnce(apiKey, SEARCH_TEXT_URL, requestBody);
    lastAttempt = result;

    if (result.kind === "success") {
      const places = normalizePlaces(result.body);
      if (!places) {
        return { ok: false, reason: "invalid_response" };
      }
      return { ok: true, places };
    }

    if (!isRetryable(result.kind)) {
      break;
    }
  }

  switch (lastAttempt?.kind) {
    case "timeout":
      return { ok: false, reason: "timeout" };
    case "rate_limited":
      return { ok: false, reason: "rate_limited" };
    case "server_error":
    case "network_error":
      return { ok: false, reason: "server_error" };
    case "malformed_response":
      return { ok: false, reason: "invalid_response" };
    default:
      return { ok: false, reason: "client_error" };
  }
}

// ===== Photo Media(検索結果として既に得ているphotoRefから、実画像のURIを1枚取得する) =====

export type PhotoOutcome =
  | { ok: true; photoUri: string }
  | { ok: false; reason: GooglePlacesFailureReason };

async function requestPhotoMediaOnce(apiKey: string, url: string): Promise<PlacesAttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        // APIキーはヘッダーへ使うだけで、ログにもレスポンスにも出さない。
        "X-Goog-Api-Key": apiKey,
      },
      signal: controller.signal,
    });

    if (response.status === 429) {
      return { kind: "rate_limited" };
    }
    if (response.status >= 500) {
      return { kind: "server_error" };
    }
    if (!response.ok) {
      return { kind: "client_error" };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { kind: "malformed_response" };
    }
    return { kind: "success", body: json };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { kind: "timeout" };
    }
    return { kind: "network_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** レスポンスのphotoUriが、そのままクライアントの<Image>へ渡しても安全なhttps URLかを検証する。 */
function extractPhotoUri(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const photoUri = record.photoUri;
  if (typeof photoUri !== "string" || !photoUri.startsWith("https://")) {
    return null;
  }
  return photoUri;
}

/**
 * Photo Media(GET /v1/{photoName}/media)をskipHttpRedirect=trueで叩き、
 * JSON中のphotoUriだけを取り出して返す。生の画像バイナリはサーバーを経由しない
 * (Googleがフロントエンド向けに発行するphotoUriをそのままクライアントへ渡すだけ)。
 * 予算チェックは検索(google-places)とは別カウンタ("google-places-photo")を使う。
 */
export async function fetchPlacePhoto(photoName: string, maxWidthPx: number): Promise<PhotoOutcome> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    return { ok: false, reason: "server_error" };
  }

  const url = `${PHOTO_MEDIA_BASE_URL}/${photoName}/media?maxWidthPx=${maxWidthPx}&skipHttpRedirect=true`;

  let lastAttempt: PlacesAttemptResult | null = null;

  for (let attempt = 0; attempt <= PLACES_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(PLACES_RETRY_BACKOFF_MS);
    }

    const budgetOk = await checkExternalApiBudget("google-places-photo");
    if (!budgetOk) {
      return { ok: false, reason: "budget_exceeded" };
    }

    const result = await requestPhotoMediaOnce(apiKey, url);
    lastAttempt = result;

    if (result.kind === "success") {
      const photoUri = extractPhotoUri(result.body);
      if (!photoUri) {
        return { ok: false, reason: "invalid_response" };
      }
      return { ok: true, photoUri };
    }

    if (!isRetryable(result.kind)) {
      break;
    }
  }

  switch (lastAttempt?.kind) {
    case "timeout":
      return { ok: false, reason: "timeout" };
    case "rate_limited":
      return { ok: false, reason: "rate_limited" };
    case "server_error":
    case "network_error":
      return { ok: false, reason: "server_error" };
    case "malformed_response":
      return { ok: false, reason: "invalid_response" };
    default:
      return { ok: false, reason: "client_error" };
  }
}
