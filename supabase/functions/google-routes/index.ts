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
import { computeRoutes, type GoogleRoutesFailureReason } from "./google-routes-provider.ts";
import { validateGoogleRoutesRequest } from "./route-types.ts";

/**
 * google-routes: Google Routes API v2(computeRoutes)への実接続だけを担う、
 * ai-route-planningとは責務を分離した独立のEdge Function。
 * Gateway(このファイル) → google-routes-provider.ts(Google固有の実装)という
 * 構成にしている。
 *
 * 設計方針:
 * - 緯度経度以外の個人情報(住所・保存済み場所名・GPS履歴・DriveConditions/
 *   Context丸ごと等)は構造上そもそも受け取れない(route-types.tsを参照)。
 * - Google側がサポートしないpreferScenicRoads/preferCoastalRoads等は受け取らない。
 *   現時点で正式対応するのはavoidHighwaysのみ。
 * - ログにはAPIキー・完全な緯度経度・request/response本文・installId/IPの生値を
 *   一切出力しない(固定ラベルのみ)。
 * - ai-route-planningと同じくpublishable key認証(createSupabaseContext)・
 *   x-install-id・Upstashレート制限を用いるが、既存ファイルは変更せず、
 *   共有できる低レベルのプリミティブ(rate-limit-infra.ts)だけを再利用する。
 *   install/IP/global単位の一般レート制限は、ai-route-planningとRedisキーの
 *   prefixを完全に分離した別実装として、このファイル内に持つ
 *   (rate-limit-infra.tsの設計方針どおり、prefixは軸・時間窓ごとに分離すること)。
 * - Google Routes APIの呼び出し直前ごと(初回・リトライとも)にcheckExternalApiBudget
 *   ("google-routes")を呼び、1日あたりの予算(GOOGLE_ROUTES_DAILY_LIMIT)を
 *   超えたらGoogleを呼ばずに終わる(fail-closed)。
 */

// ===== 定数 ============================================================

/** リクエスト本文の上限バイト数。緯度経度の配列のみのため、ai-route-planningより小さくてよい。 */
const MAX_BODY_BYTES = 4 * 1024;

// OpenAI呼び出しと同様、Google呼び出しのタイムアウト・リトライ回数は
// google-routes-provider.ts側で管理する(GOOGLE_TIMEOUT_MS・GOOGLE_MAX_RETRIES)。

// ===== レート制限の設定値(すべて環境変数で上書き可能) ================================
// ai-route-planningとはRedisキーのprefixを分離するため、専用の環境変数名にしている
// (同名の値を共有させたい場合も、意図的に別の環境変数として明示的に設定する)。

const RATE_LIMIT_GROUTES_INSTALL_MINUTE = readPositiveIntEnv("RATE_LIMIT_GROUTES_INSTALL_MINUTE", 6);
const RATE_LIMIT_GROUTES_INSTALL_HOUR = readPositiveIntEnv("RATE_LIMIT_GROUTES_INSTALL_HOUR", 60);
const RATE_LIMIT_GROUTES_INSTALL_DAY = readPositiveIntEnv("RATE_LIMIT_GROUTES_INSTALL_DAY", 300);
const RATE_LIMIT_GROUTES_IP_MINUTE = readPositiveIntEnv("RATE_LIMIT_GROUTES_IP_MINUTE", 20);
const RATE_LIMIT_GROUTES_IP_HOUR = readPositiveIntEnv("RATE_LIMIT_GROUTES_IP_HOUR", 150);
const RATE_LIMIT_GROUTES_GLOBAL_DAY = readPositiveIntEnv("RATE_LIMIT_GROUTES_GLOBAL_DAY", 5_000);

/**
 * 一般トラフィック制限は、Upstash側の障害時は既定でfail-open。
 * 外部API予算チェック(checkExternalApiBudget、rate-limit-infra.ts)は
 * これとは独立して常にfail-closed。ai-route-planningと同じ環境変数名を
 * 共有する(プロジェクト全体で1つの運用方針として扱ってよいフラグのため)。
 */
const RATE_LIMIT_FAIL_OPEN = (Deno.env.get("RATE_LIMIT_FAIL_OPEN") ?? "true").toLowerCase() !== "false";

/** x-install-id(Expoアプリ側でSecureStoreに保存するランダムUUID)の形式検証。 */
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CORSを許可するOrigin。ai-route-planningと同じ環境変数(ALLOWED_ORIGINS)を
 * 共有する(プロジェクト全体で1つのフロントエンド構成を想定しているため)。
 */
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

/** ログには固定ラベルだけを出す。生のリクエスト内容・緯度経度・Googleレスポンス本文・APIキーは一切含めない。 */
function logOutcome(label: string): void {
  console.log(`[google-routes] ${label}`);
}

function mapFailureReasonToLogLabel(reason: GoogleRoutesFailureReason): string {
  switch (reason) {
    case "timeout":
      return "google_routes_timeout";
    case "rate_limited":
      return "google_routes_rate_limited";
    case "server_error":
    case "client_error":
      return "google_routes_server_error";
    case "invalid_response":
      return "google_routes_invalid_response";
    case "budget_exceeded":
      return "google_routes_budget_exceeded";
  }
}

// ===== 認証(publishable key) ===============================================

/** apikeyヘッダーのpublishable keyを、Supabase公式の@supabase/serverで検証する(ai-route-planningと同じ方式)。 */
async function authenticateRequest(req: Request): Promise<boolean> {
  const { error } = await createSupabaseContext(req, { auth: "publishable" });
  return !error;
}

/** x-install-idヘッダーの形式検証。本人認証ではなく、あくまで端末単位の識別子として扱う。 */
function isValidInstallId(value: string | null): value is string {
  return value !== null && INSTALL_ID_PATTERN.test(value);
}

/**
 * Supabaseのx-forwarded-forは常に信頼できるとは限らないため、取得できた場合の
 * 「先頭の1つ」だけを補助的なIPとして扱う(ai-route-planningと同じ方針)。
 */
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
 * prefix("rl:groutes:...")はai-route-planning("rl:install:...")と完全に分離しており、
 * 互いのカウントに影響しない。Upstash未設定/障害時はRATE_LIMIT_FAIL_OPENに従う。
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
        promise: getLimiter(redis, "rl:groutes:install:minute", RATE_LIMIT_GROUTES_INSTALL_MINUTE, "1 m").limit(
          installHash
        ),
      },
      {
        kind: "install_hour",
        retryAfterSeconds: 3600,
        promise: getLimiter(redis, "rl:groutes:install:hour", RATE_LIMIT_GROUTES_INSTALL_HOUR, "1 h").limit(
          installHash
        ),
      },
      {
        kind: "install_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:groutes:install:day", RATE_LIMIT_GROUTES_INSTALL_DAY, "1 d").limit(
          installHash
        ),
      },
      {
        kind: "global_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:groutes:global:day", RATE_LIMIT_GROUTES_GLOBAL_DAY, "1 d").limit("all"),
      },
    ];

    if (clientIp) {
      const ipHash = await hmacSha256Hex(clientIp, config.hashSecret);
      checks.push(
        {
          kind: "ip_minute",
          retryAfterSeconds: 60,
          promise: getLimiter(redis, "rl:groutes:ip:minute", RATE_LIMIT_GROUTES_IP_MINUTE, "1 m").limit(ipHash),
        },
        {
          kind: "ip_hour",
          retryAfterSeconds: 3600,
          promise: getLimiter(redis, "rl:groutes:ip:hour", RATE_LIMIT_GROUTES_IP_HOUR, "1 h").limit(ipHash),
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

  const validation = validateGoogleRoutesRequest(parsed);
  if (!validation.ok) {
    // reasonはサーバーログにも出さない(バリデーション対象はユーザー入力由来のため)。
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
  }

  try {
    const outcome = await computeRoutes(validation.data);
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
        "ROUTE_SEARCH_FAILED",
        "ルートを取得できませんでした。しばらくしてからもう一度お試しください。",
        corsHeaders
      );
    }

    logOutcome("google_routes_success");
    return jsonResponse(200, { ok: true, data: { routes: outcome.routes } }, corsHeaders);
  } catch (error) {
    logSafeError("computeRoutes failed", error);
    return errorResponse(500, "INTERNAL_ERROR", "しばらくしてからもう一度お試しください。", corsHeaders);
  }
});
