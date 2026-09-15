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
import { buildDrivePlans } from "./plan-builder.ts";
import { validateDrivePlanRequest } from "./plan-types.ts";
import type { GoogleRoutesFailureReason } from "../google-routes/google-routes-provider.ts";

/**
 * drive-route-planner: 「時間予算を考慮した実ドライブルート提案」のオーケストレーター。
 * Expoは1回のリクエストでこのEdge Functionだけを呼び、その内部でGoogle Places
 * (google-places-provider.ts)とGoogle Routes(google-routes-provider.ts)を
 * 必要な回数だけ直接呼び出す(HTTP経由でgoogle-places/google-routes Edge Functionを
 * 呼び直すのではなく、providerロジックを直接importして再利用する。二重の認証・
 * 二重のレート制限・不要なネットワーク往復を避けるため)。
 *
 * google-places・google-routes・ai-route-planningの各Edge Functionは、単体テスト・
 * 将来の直接利用のために変更・削除していない。
 *
 * 設計方針:
 * - Expoから受け取るのは実座標(origin/destination/userViaPoints)と、AIが解釈した
 *   抽象的な嗜好(preferences)だけ。これらをOpenAIへ送る処理はこのファイル・
 *   plan-builder.tsのどちらにも存在しない(Google Places/Routesにのみ実座標を渡す)。
 * - ユーザーが指定したuserViaPointsは、削除・並べ替え・candidate placeとの置き換えを
 *   一切行わない(plan-builder.ts参照)。
 * - Google APIの呼び出しが失敗しても、mockデータへフォールバックすることはない。
 *   成功した範囲のデータ(基本ルートのみ等)を返すか、致命的な失敗のみエラーにする。
 * - publishable key認証・x-install-id・Upstashレート制限は、他のEdge Functionと
 *   同じ低レベルのプリミティブ(rate-limit-infra.ts)を再利用しつつ、Redisキーの
 *   prefix("rl:planner:...")は完全に分離した専用の一般トラフィック制限を持つ。
 * - Google Places/Routesの1日あたりの予算チェック(checkExternalApiBudget)は、
 *   plan-builder.tsが呼ぶ既存provider(computeRoutes/searchNearbyPlaces)の内部で
 *   既に行われており、ここで重ねてスキップすることはない。
 */

// ===== 定数 ============================================================

/** リクエスト本文の上限バイト数。緯度経度の配列+短い設定値のみのため小さくてよい。 */
const MAX_BODY_BYTES = 4 * 1024;

// ===== レート制限の設定値(すべて環境変数で上書き可能) ================================
// 他のEdge FunctionとはRedisキーのprefixを分離するため、専用の環境変数名にしている。

const RATE_LIMIT_PLANNER_INSTALL_MINUTE = readPositiveIntEnv("RATE_LIMIT_PLANNER_INSTALL_MINUTE", 4);
const RATE_LIMIT_PLANNER_INSTALL_HOUR = readPositiveIntEnv("RATE_LIMIT_PLANNER_INSTALL_HOUR", 40);
const RATE_LIMIT_PLANNER_INSTALL_DAY = readPositiveIntEnv("RATE_LIMIT_PLANNER_INSTALL_DAY", 150);
const RATE_LIMIT_PLANNER_IP_MINUTE = readPositiveIntEnv("RATE_LIMIT_PLANNER_IP_MINUTE", 12);
const RATE_LIMIT_PLANNER_IP_HOUR = readPositiveIntEnv("RATE_LIMIT_PLANNER_IP_HOUR", 100);
const RATE_LIMIT_PLANNER_GLOBAL_DAY = readPositiveIntEnv("RATE_LIMIT_PLANNER_GLOBAL_DAY", 3_000);

/**
 * 一般トラフィック制限は、Upstash側の障害時は既定でfail-open。外部API予算チェック
 * (checkExternalApiBudget、rate-limit-infra.ts)はこれとは独立して常にfail-closed。
 * 他のEdge Functionと同じ環境変数名を共有する。
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

/** ログには固定ラベルだけを出す。APIキー・完全な座標・Place一覧・request/response本文は一切含めない。 */
function logOutcome(label: string): void {
  console.log(`[drive-route-planner] ${label}`);
}

function mapFailureReasonToLogLabel(reason: GoogleRoutesFailureReason): string {
  switch (reason) {
    case "timeout":
      return "drive_plan_base_route_timeout";
    case "rate_limited":
      return "drive_plan_base_route_rate_limited";
    case "server_error":
    case "client_error":
      return "drive_plan_base_route_server_error";
    case "invalid_response":
      return "drive_plan_base_route_invalid_response";
    case "budget_exceeded":
      return "drive_plan_base_route_budget_exceeded";
  }
}

// ===== 認証(publishable key) ===============================================

async function authenticateRequest(req: Request): Promise<boolean> {
  const { error } = await createSupabaseContext(req, { auth: "publishable" });
  return !error;
}

function isValidInstallId(value: string | null): value is string {
  return value !== null && INSTALL_ID_PATTERN.test(value);
}

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
 * prefix("rl:planner:...")は他のEdge Functionと完全に分離しており、互いの
 * カウントに影響しない。Upstash未設定/障害時はRATE_LIMIT_FAIL_OPENに従う。
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
        promise: getLimiter(redis, "rl:planner:install:minute", RATE_LIMIT_PLANNER_INSTALL_MINUTE, "1 m").limit(
          installHash
        ),
      },
      {
        kind: "install_hour",
        retryAfterSeconds: 3600,
        promise: getLimiter(redis, "rl:planner:install:hour", RATE_LIMIT_PLANNER_INSTALL_HOUR, "1 h").limit(
          installHash
        ),
      },
      {
        kind: "install_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:planner:install:day", RATE_LIMIT_PLANNER_INSTALL_DAY, "1 d").limit(
          installHash
        ),
      },
      {
        kind: "global_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:planner:global:day", RATE_LIMIT_PLANNER_GLOBAL_DAY, "1 d").limit("all"),
      },
    ];

    if (clientIp) {
      const ipHash = await hmacSha256Hex(clientIp, config.hashSecret);
      checks.push(
        {
          kind: "ip_minute",
          retryAfterSeconds: 60,
          promise: getLimiter(redis, "rl:planner:ip:minute", RATE_LIMIT_PLANNER_IP_MINUTE, "1 m").limit(ipHash),
        },
        {
          kind: "ip_hour",
          retryAfterSeconds: 3600,
          promise: getLimiter(redis, "rl:planner:ip:hour", RATE_LIMIT_PLANNER_IP_HOUR, "1 h").limit(ipHash),
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

  const validation = validateDrivePlanRequest(parsed);
  if (!validation.ok) {
    // reasonはサーバーログにも出さない(バリデーション対象はユーザー入力由来のため)。
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
  }

  try {
    const outcome = await buildDrivePlans(validation.data);
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
        "PLAN_GENERATION_FAILED",
        "ドライブプランを作成できませんでした。しばらくしてからもう一度お試しください。",
        corsHeaders
      );
    }

    logOutcome(outcome.plans.length > 0 ? "drive_plan_success" : "drive_plan_empty");
    return jsonResponse(200, { ok: true, data: { plans: outcome.plans, meta: outcome.meta } }, corsHeaders);
  } catch (error) {
    logSafeError("buildDrivePlans failed", error);
    return errorResponse(500, "INTERNAL_ERROR", "しばらくしてからもう一度お試しください。", corsHeaders);
  }
});
