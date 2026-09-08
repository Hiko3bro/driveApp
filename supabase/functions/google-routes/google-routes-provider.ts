/**
 * Google Routes API v2(computeRoutes)への実接続。生のfetch()だけを使い、
 * 公式クライアントライブラリは追加していない(依存を増やさないため)。
 * このファイルだけがGoogle固有の詳細(URL・ヘッダー形式・リトライ方針・
 * レスポンス正規化)を知っている。index.ts(Gateway)はこのモジュールが返す
 * 正規化済みのRouteCandidate[]だけを見て応答を組み立てる。
 */
import { checkExternalApiBudget } from "../ai-route-planning/rate-limit-infra.ts";
import type { GoogleRoutesRequest, RouteCandidate } from "./route-types.ts";

const COMPUTE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** 必要なフィールドだけを要求する(Google側で計算される巨大なレスポンスを避ける)。 */
const FIELD_MASK = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeLabels";

/** 1回のGoogle呼び出しにかけるタイムアウト(ミリ秒)。 */
const GOOGLE_TIMEOUT_MS = 8_000;
/** サーバー側リトライは最大1回まで(無限リトライ禁止)。429/5xx/timeout/network errorのみ対象。 */
const GOOGLE_MAX_RETRIES = 1;
/** リトライ前の短いbackoff(ミリ秒)。 */
const GOOGLE_RETRY_BACKOFF_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type GoogleAttemptResult =
  | { kind: "success"; body: unknown }
  | { kind: "timeout" }
  | { kind: "rate_limited" }
  | { kind: "server_error" }
  | { kind: "client_error" }
  /** HTTP的には成功(200)だが、期待した形のJSONを取り出せなかったケース。Google側の障害(5xx)とは別カテゴリ。 */
  | { kind: "malformed_response" }
  | { kind: "network_error" };

/** timeout/429/5xx/ネットワークエラーだけがリトライ対象。malformed_response・4xxはリトライしない。 */
function isRetryable(kind: GoogleAttemptResult["kind"]): boolean {
  return kind === "timeout" || kind === "rate_limited" || kind === "server_error" || kind === "network_error";
}

/**
 * intermediatesが1件以上ある場合、Google Routes APIの仕様上alternative routes機能は
 * 使用できないため、常に単一ルートを要求する(架空の複数ルートを作らない)。
 * intermediatesが0件の場合のみcomputeAlternativeRoutesを有効にする。
 */
function buildGoogleRequestBody(request: GoogleRoutesRequest): Record<string, unknown> {
  const hasIntermediates = Boolean(request.intermediates && request.intermediates.length > 0);
  const body: Record<string, unknown> = {
    origin: { location: { latLng: request.origin } },
    destination: { location: { latLng: request.destination } },
    travelMode: "DRIVE",
    regionCode: "JP",
    languageCode: "ja",
    computeAlternativeRoutes: !hasIntermediates,
  };
  if (hasIntermediates) {
    body.intermediates = request.intermediates!.map((point) => ({ location: { latLng: point } }));
  }
  if (request.avoidHighways) {
    // Google公式上、avoidHighwaysは「絶対に使わない」保証ではなく、可能な範囲で避ける方向のbias。
    body.routeModifiers = { avoidHighways: true };
  }
  return body;
}

async function requestGoogleRoutesOnce(apiKey: string, requestBody: string): Promise<GoogleAttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GOOGLE_TIMEOUT_MS);

  try {
    const response = await fetch(COMPUTE_ROUTES_URL, {
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

/** Googleの`"1234s"`形式のduration文字列を、安全に整数秒へ変換する。不正な形式はnull。 */
function parseDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null;
}

/**
 * Googleの生レスポンスを無条件に信頼せず、実行時に厳密に検証してから
 * RouteCandidate[]へ正規化する。想定外の形は例外を投げずnullを返す
 * (呼び出し側でinvalid_responseとして扱う)。routesフィールド自体が
 * 無い応答(ルートが見つからなかった場合を含む)は、空配列(該当ルートなし)
 * として扱い、malformedとは区別する。
 */
function normalizeRoutes(body: unknown): RouteCandidate[] | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.routes === undefined) {
    return [];
  }
  if (!Array.isArray(record.routes)) {
    return null;
  }

  const candidates: RouteCandidate[] = [];
  for (const route of record.routes) {
    if (typeof route !== "object" || route === null) {
      return null;
    }
    const r = route as Record<string, unknown>;
    const durationSeconds = parseDurationSeconds(r.duration);
    const distanceMeters = r.distanceMeters;
    const polyline = r.polyline;

    if (
      durationSeconds === null ||
      typeof distanceMeters !== "number" ||
      !Number.isFinite(distanceMeters) ||
      distanceMeters < 0 ||
      typeof polyline !== "object" ||
      polyline === null
    ) {
      return null;
    }

    const encodedPolyline = (polyline as Record<string, unknown>).encodedPolyline;
    if (typeof encodedPolyline !== "string" || encodedPolyline.length === 0) {
      return null;
    }

    const routeLabelsRaw = r.routeLabels;
    const routeLabels = Array.isArray(routeLabelsRaw)
      ? routeLabelsRaw.filter((label): label is string => typeof label === "string")
      : [];

    candidates.push({ distanceMeters, durationSeconds, encodedPolyline, routeLabels });
  }
  return candidates;
}

export type GoogleRoutesFailureReason =
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "invalid_response"
  | "budget_exceeded";

export type GoogleRoutesOutcome =
  | { ok: true; routes: RouteCandidate[] }
  | { ok: false; reason: GoogleRoutesFailureReason };

/**
 * Google Routesへ実際にfetchを送る回数(初回+最大GOOGLE_MAX_RETRIES回)ぶんだけ、
 * その都度checkExternalApiBudget("google-routes")を呼ぶ。予算チェックが通らなければ、
 * その回のfetchは送らずに終了する(budget_exceeded)。
 */
export async function computeRoutes(request: GoogleRoutesRequest): Promise<GoogleRoutesOutcome> {
  const apiKey = Deno.env.get("GOOGLE_ROUTES_API_KEY");
  if (!apiKey) {
    return { ok: false, reason: "server_error" };
  }

  const requestBody = JSON.stringify(buildGoogleRequestBody(request));

  let lastAttempt: GoogleAttemptResult | null = null;

  for (let attempt = 0; attempt <= GOOGLE_MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(GOOGLE_RETRY_BACKOFF_MS);
    }

    const budgetOk = await checkExternalApiBudget("google-routes");
    if (!budgetOk) {
      return { ok: false, reason: "budget_exceeded" };
    }

    const result = await requestGoogleRoutesOnce(apiKey, requestBody);
    lastAttempt = result;

    if (result.kind === "success") {
      const routes = normalizeRoutes(result.body);
      if (!routes) {
        return { ok: false, reason: "invalid_response" };
      }
      return { ok: true, routes };
    }

    if (!isRetryable(result.kind)) {
      break;
    }
    // ループを継続 = 1回だけリトライする(GOOGLE_MAX_RETRIES=1のため最大2試行)。
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
