/**
 * Google Places API (New) の Nearby Search(POST /v1/places:searchNearby)への
 * 実接続。生のfetch()だけを使い、公式クライアントライブラリは追加していない。
 * このファイルだけがGoogle固有の詳細(URL・ヘッダー形式・リトライ方針・
 * レスポンス正規化)を知っている。index.ts(Gateway)はこのモジュールが返す
 * 正規化済みのPlaceCandidate[]だけを見て応答を組み立てる。
 */
import { checkExternalApiBudget } from "../ai-route-planning/rate-limit-infra.ts";
import { CATEGORY_PLACE_TYPES, type PlaceCandidate, type PlaceSearchRequest } from "./place-types.ts";

const SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";

/**
 * 必要最小限のフィールドだけを要求する。rating/reviews/currentOpeningHours/
 * photos/websiteUri/priceLevel等のEnterprise系フィールドは今回一切要求しない
 * (コスト抑制のため)。
 */
const FIELD_MASK = "places.id,places.displayName,places.location,places.primaryType";

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

async function requestPlacesOnce(apiKey: string, requestBody: string): Promise<PlacesAttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PLACES_TIMEOUT_MS);

  try {
    const response = await fetch(SEARCH_NEARBY_URL, {
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

    const result = await requestPlacesOnce(apiKey, requestBody);
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
