// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "@supabase/server";
import {
  getLimiter,
  getRedisClient,
  getUpstashConfig,
  hmacSha256Hex,
  logSafeError,
  readPositiveIntEnv,
} from "../ai-route-planning/rate-limit-infra.ts";
import {
  fetchPlacePhoto,
  searchNearbyPlaces,
  searchTextPlaces,
  type GooglePlacesFailureReason,
} from "./google-places-provider.ts";
import {
  validatePhotoMediaRequest,
  validatePlaceSearchRequest,
  validateTextPlaceSearchRequest,
} from "./place-types.ts";

/**
 * google-places: Google Places API (New) の Nearby Search(searchNearby)への
 * 実接続だけを担う、ai-route-planning・google-routesとは責務を分離した
 * 独立のEdge Function。
 * Gateway(このファイル) → google-places-provider.ts(Google固有の実装)という構成。
 *
 * 設計方針:
 * - クライアントにGoogleの生のincludedTypesを自由入力させず、5つのアプリカテゴリ
 *   (restaurant/cafe/scenic/onsen/activity)だけを受け取り、place-types.tsの
 *   固定テーブルでGoogle公式のPlace Types (New)へ変換する。
 * - 緯度経度以外の個人情報(住所・保存済み場所名・GPS履歴等)は構造上そもそも
 *   受け取れない。
 * - Places APIには実座標(center)を送るが、この座標をOpenAI(ai-route-planning)へ
 *   送る処理は一切追加しない。OpenAI→抽象化された嗜好のみ、Google→実座標、
 *   という分離を維持する。
 * - ログにはAPIキー・完全な中心座標・Placeの緯度経度・検索結果全文・
 *   installId/IPの生値を一切出力しない(固定ラベルのみ)。
 * - ai-route-planning・google-routesと同じくpublishable key認証
 *   (createSupabaseContext)・x-install-id・Upstashレート制限を用いるが、
 *   既存ファイルは変更せず、共有できる低レベルのプリミティブ(rate-limit-infra.ts)
 *   だけを再利用する。install/IP/global単位の一般レート制限は、他の2関数と
 *   Redisキーのprefixを完全に分離した別実装として、このファイル内に持つ。
 * - Google Places APIの呼び出し直前ごと(初回・リトライとも)にcheckExternalApiBudget
 *   ("google-places")を呼び、1日あたりの予算(GOOGLE_PLACES_DAILY_LIMIT)を
 *   超えたらGoogleを呼ばずに終わる(fail-closed)。
 */

// ===== 定数 ============================================================

/** リクエスト本文の上限バイト数。緯度経度+数値+短いenumのみのため小さくてよい。 */
const MAX_BODY_BYTES = 2 * 1024;

// Google呼び出しのタイムアウト・リトライ回数はgoogle-places-provider.ts側で管理する
// (PLACES_TIMEOUT_MS・PLACES_MAX_RETRIES)。

// ===== レート制限の設定値(すべて環境変数で上書き可能) ================================
// ai-route-planning・google-routesとはRedisキーのprefixを分離するため、
// 専用の環境変数名にしている。

const RATE_LIMIT_GPLACES_INSTALL_MINUTE = readPositiveIntEnv("RATE_LIMIT_GPLACES_INSTALL_MINUTE", 10);
const RATE_LIMIT_GPLACES_INSTALL_HOUR = readPositiveIntEnv("RATE_LIMIT_GPLACES_INSTALL_HOUR", 100);
const RATE_LIMIT_GPLACES_INSTALL_DAY = readPositiveIntEnv("RATE_LIMIT_GPLACES_INSTALL_DAY", 300);
const RATE_LIMIT_GPLACES_IP_MINUTE = readPositiveIntEnv("RATE_LIMIT_GPLACES_IP_MINUTE", 30);
const RATE_LIMIT_GPLACES_IP_HOUR = readPositiveIntEnv("RATE_LIMIT_GPLACES_IP_HOUR", 200);
const RATE_LIMIT_GPLACES_GLOBAL_DAY = readPositiveIntEnv("RATE_LIMIT_GPLACES_GLOBAL_DAY", 5_000);

/**
 * 一般トラフィック制限は、Upstash側の障害時は既定でfail-open。
 * 外部API予算チェック(checkExternalApiBudget、rate-limit-infra.ts)は
 * これとは独立して常にfail-closed。他のEdge Functionと同じ環境変数名を
 * 共有する(プロジェクト全体で1つの運用方針として扱ってよいフラグのため)。
 */
const RATE_LIMIT_FAIL_OPEN = (Deno.env.get("RATE_LIMIT_FAIL_OPEN") ?? "true").toLowerCase() !== "false";

/** x-install-id(Expoアプリ側でSecureStoreに保存するランダムUUID)の形式検証。 */
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** CORSを許可するOrigin。他のEdge Functionと同じ環境変数(ALLOWED_ORIGINS)を共有する。 */
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://localhost:19006",
  "http://127.0.0.1:19006",
];

function getAllowedOrigins(): string[] {
  const configured = Deno.env.get("ALLOWED_ORIGINS");
  if (!configured) {
    return DEFAULT_DEV_ORIGINS;
  }
  return configured
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// ===== レスポンス型 ========================================================

type ApiSuccessResponse<T> = { ok: true; data: T };
type ApiErrorResponse = { ok: false; error: { code: string; message: string } };

// ===== 本文読み取り(サイズ上限つき) =========================================

/** Content-Lengthヘッダーに頼らず、実際に読み取ったバイト数で上限を強制する。 */
async function readBodyWithLimit(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false }> {
  if (!req.body) {
    return { ok: true, text: "" };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

// ===== レスポンス・ログ用ヘルパー ============================================

function buildCorsHeaders(originHeader: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-install-id",
    Vary: "Origin",
  };

  if (!originHeader) {
    return headers;
  }
  if (getAllowedOrigins().includes(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  return headers;
}

function jsonResponse(
  status: number,
  body: ApiSuccessResponse<unknown> | ApiErrorResponse,
  corsHeaders: HeadersInit
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}

function errorResponse(status: number, code: string, message: string, corsHeaders: HeadersInit): Response {
  return jsonResponse(status, { ok: false, error: { code, message } }, corsHeaders);
}

/** ログには固定ラベルだけを出す。APIキー・完全な座標・検索結果本文は一切含めない。 */
function logOutcome(label: string): void {
  console.log(`[google-places] ${label}`);
}

function mapFailureReasonToLogLabel(reason: GooglePlacesFailureReason): string {
  switch (reason) {
    case "timeout":
      return "google_places_timeout";
    case "rate_limited":
      return "google_places_rate_limited";
    case "server_error":
    case "client_error":
      return "google_places_server_error";
    case "invalid_response":
      return "google_places_invalid_response";
    case "budget_exceeded":
      return "google_places_budget_exceeded";
  }
}

// ===== 認証(publishable key) ===============================================

/** apikeyヘッダーのpublishable keyを、Supabase公式の@supabase/serverで検証する(他のEdge Functionと同じ方式)。 */
async function authenticateRequest(req: Request): Promise<boolean> {
  const { error } = await createSupabaseContext(req, { auth: "publishable" });
  return !error;
}

/** x-install-idヘッダーの形式検証。本人認証ではなく、あくまで端末単位の識別子として扱う。 */
function isValidInstallId(value: string | null): value is string {
  return value !== null && INSTALL_ID_PATTERN.test(value);
}

/** Supabaseのx-forwarded-forは常に信頼できるとは限らないため、取得できた場合の「先頭の1つ」だけを補助的なIPとして扱う。 */
function extractClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }
  const first = forwardedFor.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// ===== レート制限(Upstash Redis、install/IP/globalの一般トラフィック制限) ============

type RateLimitKind = "install_minute" | "install_hour" | "install_day" | "ip_minute" | "ip_hour" | "global_day";

interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/**
 * install-id単位(分/時/日)・IP単位(分/時、取得できた場合のみ)・
 * Edge Function全体(1日)のレート制限をまとめてチェックする。Redisキーの
 * prefix("rl:gplaces:...")は、ai-route-planning("rl:install:...")・
 * google-routes("rl:groutes:...")と完全に分離しており、互いのカウントに
 * 影響しない。Upstash未設定/障害時はRATE_LIMIT_FAIL_OPENに従う。
 */
async function checkGeneralRateLimit(installId: string, clientIp: string | null): Promise<RateLimitCheckResult> {
  const config = getUpstashConfig();
  if (!config) {
    return { allowed: RATE_LIMIT_FAIL_OPEN };
  }

  try {
    const redis = getRedisClient(config.url, config.token);
    const installHash = await hmacSha256Hex(installId, config.hashSecret);

    const checks: {
      kind: RateLimitKind;
      retryAfterSeconds: number;
      promise: Promise<{ success: boolean }>;
    }[] = [
      {
        kind: "install_minute",
        retryAfterSeconds: 60,
        promise: getLimiter(redis, "rl:gplaces:install:minute", RATE_LIMIT_GPLACES_INSTALL_MINUTE, "1 m").limit(
          installHash
        ),
      },
      {
        kind: "install_hour",
        retryAfterSeconds: 3600,
        promise: getLimiter(redis, "rl:gplaces:install:hour", RATE_LIMIT_GPLACES_INSTALL_HOUR, "1 h").limit(
          installHash
        ),
      },
      {
        kind: "install_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:gplaces:install:day", RATE_LIMIT_GPLACES_INSTALL_DAY, "1 d").limit(
          installHash
        ),
      },
      {
        kind: "global_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:gplaces:global:day", RATE_LIMIT_GPLACES_GLOBAL_DAY, "1 d").limit("all"),
      },
    ];

    if (clientIp) {
      const ipHash = await hmacSha256Hex(clientIp, config.hashSecret);
      checks.push(
        {
          kind: "ip_minute",
          retryAfterSeconds: 60,
          promise: getLimiter(redis, "rl:gplaces:ip:minute", RATE_LIMIT_GPLACES_IP_MINUTE, "1 m").limit(ipHash),
        },
        {
          kind: "ip_hour",
          retryAfterSeconds: 3600,
          promise: getLimiter(redis, "rl:gplaces:ip:hour", RATE_LIMIT_GPLACES_IP_HOUR, "1 h").limit(ipHash),
        }
      );
    }

    const results = await Promise.all(checks.map((check) => check.promise));
    const failedIndex = results.findIndex((result) => !result.success);
    if (failedIndex === -1) {
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: checks[failedIndex].retryAfterSeconds };
  } catch (error) {
    logSafeError("checkGeneralRateLimit failed", error);
    return { allowed: RATE_LIMIT_FAIL_OPEN };
  }
}

// ===== エントリーポイント ===================================================

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // apikey(publishable key)の検証は、他のどのチェックよりも先に行う。
  if (!(await authenticateRequest(req))) {
    return errorResponse(401, "UNAUTHENTICATED", "認証できませんでした。", corsHeaders);
  }

  const installId = req.headers.get("x-install-id");
  if (!isValidInstallId(installId)) {
    return errorResponse(400, "INVALID_INSTALL_ID", "リクエストを確認してください。", corsHeaders);
  }

  if (req.method !== "POST") {
    return errorResponse(405, "METHOD_NOT_ALLOWED", "対応していないHTTPメソッドです。", corsHeaders);
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Typeはapplication/jsonにしてください。", corsHeaders);
  }

  const rateLimitResult = await checkGeneralRateLimit(installId, extractClientIp(req));
  if (!rateLimitResult.allowed) {
    const rateLimitHeaders: Record<string, string> = { ...corsHeaders };
    if (rateLimitResult.retryAfterSeconds) {
      rateLimitHeaders["Retry-After"] = String(rateLimitResult.retryAfterSeconds);
    }
    return errorResponse(429, "RATE_LIMITED", "しばらく時間をおいてから再度お試しください。", rateLimitHeaders);
  }

  const bodyResult = await readBodyWithLimit(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "リクエスト本文が大きすぎます。", corsHeaders);
  }

  let parsed: unknown;
  try {
    parsed = bodyResult.text.length > 0 ? JSON.parse(bodyResult.text) : undefined;
  } catch {
    return errorResponse(400, "INVALID_JSON", "JSONの形式が正しくありません。", corsHeaders);
  }

  // modeが"text"/"photo"の場合のみそれぞれの分岐を通る(既存クライアントはmodeを送らないため、
  // 未指定/"nearby"は今までどおりNearby Searchの検証・処理をそのまま通る)。
  const requestedMode =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).mode
      : undefined;
  const isTextMode = requestedMode === "text";
  const isPhotoMode = requestedMode === "photo";

  if (isPhotoMode) {
    const validation = validatePhotoMediaRequest(parsed);
    if (!validation.ok) {
      return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
    }

    try {
      const outcome = await fetchPlacePhoto(validation.data.photoName, validation.data.maxWidthPx);
      if (!outcome.ok) {
        logOutcome(mapFailureReasonToLogLabel(outcome.reason).replace("google_places_", "google_places_photo_"));
        const status =
          outcome.reason === "budget_exceeded"
            ? 503
            : outcome.reason === "rate_limited"
              ? 429
              : outcome.reason === "timeout"
                ? 504
                : 502;
        return errorResponse(
          status,
          "PLACE_PHOTO_FAILED",
          "写真を取得できませんでした。しばらくしてからもう一度お試しください。",
          corsHeaders
        );
      }

      logOutcome("google_places_photo_success");
      return jsonResponse(200, { ok: true, data: { photoUri: outcome.photoUri } }, corsHeaders);
    } catch (error) {
      logSafeError("fetchPlacePhoto failed", error);
      return errorResponse(500, "INTERNAL_ERROR", "しばらくしてからもう一度お試しください。", corsHeaders);
    }
  }

  if (isTextMode) {
    const validation = validateTextPlaceSearchRequest(parsed);
    if (!validation.ok) {
      return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
    }

    try {
      const outcome = await searchTextPlaces(validation.data);
      if (!outcome.ok) {
        logOutcome(mapFailureReasonToLogLabel(outcome.reason));
        const status =
          outcome.reason === "budget_exceeded"
            ? 503
            : outcome.reason === "rate_limited"
              ? 429
              : outcome.reason === "timeout"
                ? 504
                : 502;
        return errorResponse(
          status,
          "PLACE_SEARCH_FAILED",
          "場所を検索できませんでした。しばらくしてからもう一度お試しください。",
          corsHeaders
        );
      }

      logOutcome("google_places_text_success");
      return jsonResponse(200, { ok: true, data: { places: outcome.places } }, corsHeaders);
    } catch (error) {
      logSafeError("searchTextPlaces failed", error);
      return errorResponse(500, "INTERNAL_ERROR", "しばらくしてからもう一度お試しください。", corsHeaders);
    }
  }

  const validation = validatePlaceSearchRequest(parsed);
  if (!validation.ok) {
    // reasonはサーバーログにも出さない(バリデーション対象はユーザー入力由来のため)。
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
  }

  try {
    const outcome = await searchNearbyPlaces(validation.data);
    if (!outcome.ok) {
      logOutcome(mapFailureReasonToLogLabel(outcome.reason));
      const status =
        outcome.reason === "budget_exceeded"
          ? 503
          : outcome.reason === "rate_limited"
            ? 429
            : outcome.reason === "timeout"
              ? 504
              : 502;
      return errorResponse(
        status,
        "PLACE_SEARCH_FAILED",
        "周辺のスポットを取得できませんでした。しばらくしてからもう一度お試しください。",
        corsHeaders
      );
    }

    logOutcome("google_places_success");
    return jsonResponse(200, { ok: true, data: { places: outcome.places } }, corsHeaders);
  } catch (error) {
    logSafeError("searchNearbyPlaces failed", error);
    return errorResponse(500, "INTERNAL_ERROR", "しばらくしてからもう一度お試しください。", corsHeaders);
  }
});
