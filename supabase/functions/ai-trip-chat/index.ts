// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "@supabase/server";
import {
  DRIVE_PLAN_THEME_OPTIONS,
  MAX_AREA_QUERY_LENGTH,
  MAX_DATE_TEXT_LENGTH,
  MAX_MESSAGES,
  MAX_MESSAGE_LENGTH,
  MAX_ORIGIN_LABEL_LENGTH,
  MAX_SEASON_HINT_LENGTH,
  MAX_STOP_ID_LENGTH,
  MAX_STOPS,
  PLACE_SEARCH_CATEGORY_OPTIONS,
  TRIP_CHAT_ROLE_OPTIONS,
  type DrivePlanChatContext,
  type DrivePlanChatStop,
  type DrivePlanTheme,
  type PlaceSearchCategoryForChat,
  type TripChatMessage,
  type TripChatRequest,
} from "./chat-types.ts";
import { createOpenAiTripChatProvider } from "./openai-provider.ts";
import {
  getLimiter,
  getRedisClient,
  getUpstashConfig,
  hmacSha256Hex,
  logSafeError,
  readPositiveIntEnv,
} from "../ai-route-planning/rate-limit-infra.ts";

/**
 * ai-trip-chat: 「知らない土地でどんな道を走るか・どんな場所に寄るかをAIと相談する」
 * Drive Planning Assistant(v3)のGateway。ai-route-planningと同じ構成
 * (Gateway → Provider → OpenAiProvider)・同じセキュリティ方針を踏襲した、
 * 独立したEdge Function。
 *
 * v1/v2(前回・前々回実装)はDay単位のタイムライン(scope/days/proposedDays)を
 * 中心とした設計だったが、今回「旅行全体を管理するアプリ」から「今ドラの、
 * 未来・旅先版」(ほぼ1画面のチャットでドライブコースを相談する)へ方向転換した
 * ため、リクエスト・レスポンスの両方を全面的に置き換えた。
 *
 * 設計方針(ai-route-planningと共通):
 * - 緯度経度・住所・保存済み場所の名称など、AIに不要な位置情報は構造上
 *   そもそも受け取れない(DrivePlanChatContextにそのようなフィールドを用意しない)。
 * - ユーザーの発言は「データ」として渡し、Prompt Injection対策を行う
 *   (openai-provider.tsのinstructions/input分離を参照)。
 * - AIには外部アクションを実行する権限(tool/function calling等)を与えない。
 * - AIが具体的な場所を指定したい場合は、defaultOriginQuery/destinationQuery
 *   (検索意図の文字列のみ)を返させ、実在確認はアプリ側がGoogle Places
 *   Text Search経由で別途行う(場所を創作させない)。
 * - OpenAI呼び出しの外部API予算は、既存の"openai"バケットをai-route-planningと共有する。
 * - ログには固定ラベルだけを出す(会話内容・提案内容・秘密情報は一切含めない)。
 */

// ===== 定数 ============================================================

const MAX_BODY_BYTES = 16 * 1024;

const ALLOWED_SEASON_HINTS = ["春", "夏", "秋", "冬"] as const;

// ===== レート制限の設定値 ====================================================

const RATE_LIMIT_TRIPCHAT_INSTALL_MINUTE = readPositiveIntEnv("RATE_LIMIT_TRIPCHAT_INSTALL_MINUTE", 8);
const RATE_LIMIT_TRIPCHAT_INSTALL_HOUR = readPositiveIntEnv("RATE_LIMIT_TRIPCHAT_INSTALL_HOUR", 80);
const RATE_LIMIT_TRIPCHAT_INSTALL_DAY = readPositiveIntEnv("RATE_LIMIT_TRIPCHAT_INSTALL_DAY", 400);
const RATE_LIMIT_TRIPCHAT_IP_MINUTE = readPositiveIntEnv("RATE_LIMIT_TRIPCHAT_IP_MINUTE", 25);
const RATE_LIMIT_TRIPCHAT_IP_HOUR = readPositiveIntEnv("RATE_LIMIT_TRIPCHAT_IP_HOUR", 200);
const RATE_LIMIT_TRIPCHAT_GLOBAL_DAY = readPositiveIntEnv("RATE_LIMIT_TRIPCHAT_GLOBAL_DAY", 5_000);

const RATE_LIMIT_FAIL_OPEN = (Deno.env.get("RATE_LIMIT_FAIL_OPEN") ?? "true").toLowerCase() !== "false";

const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// ===== バリデーション ======================================================

type ValidationResult = { ok: true; data: TripChatRequest } | { ok: false; reason: string };

function validateMessage(value: unknown): TripChatMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.role !== "string" ||
    !(TRIP_CHAT_ROLE_OPTIONS as readonly string[]).includes(record.role)
  ) {
    return null;
  }
  if (
    typeof record.content !== "string" ||
    record.content.trim().length === 0 ||
    record.content.length > MAX_MESSAGE_LENGTH
  ) {
    return null;
  }
  return { role: record.role as TripChatMessage["role"], content: record.content };
}

function isDrivePlanTheme(value: unknown): value is DrivePlanTheme {
  return typeof value === "string" && (DRIVE_PLAN_THEME_OPTIONS as readonly string[]).includes(value);
}

function isPlaceSearchCategory(value: unknown): value is PlaceSearchCategoryForChat {
  return typeof value === "string" && (PLACE_SEARCH_CATEGORY_OPTIONS as readonly string[]).includes(value);
}

const ALLOWED_STOP_KEYS = new Set(["id", "category", "addedOrder", "displayName"]);

/** 座標・住所は一切受け取らない(そもそもこの型にフィールドが無い)。実在施設名(displayName)のみ許容する。 */
function validateStop(value: unknown): DrivePlanChatStop | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_STOP_KEYS.has(key))) {
    return null;
  }
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > MAX_STOP_ID_LENGTH) {
    return null;
  }
  if (!isPlaceSearchCategory(record.category)) {
    return null;
  }
  if (typeof record.addedOrder !== "number" || !Number.isInteger(record.addedOrder) || record.addedOrder < 0) {
    return null;
  }
  if (
    typeof record.displayName !== "string" ||
    record.displayName.length === 0 ||
    record.displayName.length > MAX_ORIGIN_LABEL_LENGTH
  ) {
    return null;
  }
  return { id: record.id, category: record.category, addedOrder: record.addedOrder, displayName: record.displayName };
}

function validateContext(value: unknown): DrivePlanChatContext | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "areaQuery",
    "hasOrigin",
    "originLabel",
    "hasDestination",
    "destinationLabel",
    "hasHomeSaved",
    "timeBudgetMinutes",
    "dateText",
    "seasonHint",
    "themes",
    "hasRouteOptions",
    "stops",
  ]);
  if (!Object.keys(record).every((key) => allowedKeys.has(key))) {
    return null;
  }

  let areaQuery: string | undefined;
  if (record.areaQuery !== undefined) {
    if (typeof record.areaQuery !== "string" || record.areaQuery.length > MAX_AREA_QUERY_LENGTH) {
      return null;
    }
    areaQuery = record.areaQuery;
  }

  if (typeof record.hasOrigin !== "boolean" || typeof record.hasDestination !== "boolean") {
    return null;
  }

  let originLabel: string | undefined;
  if (record.originLabel !== undefined) {
    if (typeof record.originLabel !== "string" || record.originLabel.length > MAX_ORIGIN_LABEL_LENGTH) {
      return null;
    }
    originLabel = record.originLabel;
  }
  let destinationLabel: string | undefined;
  if (record.destinationLabel !== undefined) {
    if (typeof record.destinationLabel !== "string" || record.destinationLabel.length > MAX_ORIGIN_LABEL_LENGTH) {
      return null;
    }
    destinationLabel = record.destinationLabel;
  }

  if (typeof record.hasHomeSaved !== "boolean") {
    return null;
  }

  let timeBudgetMinutes: number | undefined;
  if (record.timeBudgetMinutes !== undefined) {
    if (
      typeof record.timeBudgetMinutes !== "number" ||
      !Number.isInteger(record.timeBudgetMinutes) ||
      record.timeBudgetMinutes <= 0 ||
      record.timeBudgetMinutes > 10080
    ) {
      return null;
    }
    timeBudgetMinutes = record.timeBudgetMinutes;
  }

  let dateText: string | undefined;
  if (record.dateText !== undefined) {
    if (typeof record.dateText !== "string" || record.dateText.length > MAX_DATE_TEXT_LENGTH) {
      return null;
    }
    dateText = record.dateText;
  }

  let seasonHint: string | undefined;
  if (record.seasonHint !== undefined) {
    if (
      typeof record.seasonHint !== "string" ||
      record.seasonHint.length > MAX_SEASON_HINT_LENGTH ||
      !(ALLOWED_SEASON_HINTS as readonly string[]).includes(record.seasonHint)
    ) {
      return null;
    }
    seasonHint = record.seasonHint;
  }

  if (!Array.isArray(record.themes) || !record.themes.every(isDrivePlanTheme)) {
    return null;
  }

  if (typeof record.hasRouteOptions !== "boolean") {
    return null;
  }

  if (!Array.isArray(record.stops) || record.stops.length > MAX_STOPS) {
    return null;
  }
  const stops: DrivePlanChatStop[] = [];
  for (const item of record.stops) {
    const parsed = validateStop(item);
    if (!parsed) {
      return null;
    }
    stops.push(parsed);
  }

  return {
    areaQuery,
    hasOrigin: record.hasOrigin,
    originLabel,
    hasDestination: record.hasDestination,
    destinationLabel,
    hasHomeSaved: record.hasHomeSaved,
    timeBudgetMinutes,
    dateText,
    seasonHint,
    themes: record.themes,
    hasRouteOptions: record.hasRouteOptions,
    stops,
  };
}

function validateTripChatRequest(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["messages", "context"]);
  if (!Object.keys(record).every((key) => allowedKeys.has(key))) {
    return { ok: false, reason: "unexpected field present" };
  }

  if (!Array.isArray(record.messages) || record.messages.length === 0 || record.messages.length > MAX_MESSAGES) {
    return { ok: false, reason: "invalid messages" };
  }
  const messages: TripChatMessage[] = [];
  for (const rawMessage of record.messages) {
    const message = validateMessage(rawMessage);
    if (!message) {
      return { ok: false, reason: "invalid message" };
    }
    messages.push(message);
  }
  // 直近のメッセージがuserでない(=新しい質問が無い)リクエストは意味を持たないため拒否する。
  if (messages[messages.length - 1].role !== "user") {
    return { ok: false, reason: "last message must be from user" };
  }

  const context = validateContext(record.context);
  if (!context) {
    return { ok: false, reason: "invalid context" };
  }

  return { ok: true, data: { messages, context } };
}

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
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function errorResponse(status: number, code: string, message: string, corsHeaders: HeadersInit): Response {
  return jsonResponse(status, { ok: false, error: { code, message } }, corsHeaders);
}

/**
 * 安全なログ(会話内容・座標・住所は一切含まない)。requestIdは1リクエスト内で
 * openai-provider.tsのログと突き合わせて追跡するための相関ID、turnCountは
 * そのリクエストで送られた会話ターン数(内容ではなく件数のみ)。
 */
function logOutcome(requestId: string, turnCount: number, label: string): void {
  console.log(`[ai-trip-chat] requestId=${requestId} turnCount=${turnCount} ${label}`);
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
        promise: getLimiter(redis, "rl:tripchat:install:minute", RATE_LIMIT_TRIPCHAT_INSTALL_MINUTE, "1 m").limit(
          installHash
        ),
      },
      {
        kind: "install_hour",
        retryAfterSeconds: 3600,
        promise: getLimiter(redis, "rl:tripchat:install:hour", RATE_LIMIT_TRIPCHAT_INSTALL_HOUR, "1 h").limit(
          installHash
        ),
      },
      {
        kind: "install_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:tripchat:install:day", RATE_LIMIT_TRIPCHAT_INSTALL_DAY, "1 d").limit(
          installHash
        ),
      },
      {
        kind: "global_day",
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:tripchat:global:day", RATE_LIMIT_TRIPCHAT_GLOBAL_DAY, "1 d").limit("all"),
      },
    ];

    if (clientIp) {
      const ipHash = await hmacSha256Hex(clientIp, config.hashSecret);
      checks.push(
        {
          kind: "ip_minute",
          retryAfterSeconds: 60,
          promise: getLimiter(redis, "rl:tripchat:ip:minute", RATE_LIMIT_TRIPCHAT_IP_MINUTE, "1 m").limit(ipHash),
        },
        {
          kind: "ip_hour",
          retryAfterSeconds: 3600,
          promise: getLimiter(redis, "rl:tripchat:ip:hour", RATE_LIMIT_TRIPCHAT_IP_HOUR, "1 h").limit(ipHash),
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

// ===== AI呼び出し =====================================================

function mapFailureReasonToLogLabel(reason: string): string {
  switch (reason) {
    case "timeout":
      return "ai_call_timeout";
    case "rate_limited":
      return "ai_call_rate_limited";
    case "server_error":
    case "client_error":
      return "ai_call_server_error";
    case "invalid_response":
      return "ai_output_invalid";
    case "budget_exceeded":
      return "ai_budget_exceeded";
    default:
      return "ai_call_failed";
  }
}

const tripChatProvider = createOpenAiTripChatProvider();

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

  const validation = validateTripChatRequest(parsed);
  if (!validation.ok) {
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
  }

  const requestId = crypto.randomUUID().slice(0, 8);
  const turnCount = validation.data.messages.length;

  try {
    const outcome = await tripChatProvider.chat(validation.data, requestId);
    if (!outcome.ok) {
      logOutcome(requestId, turnCount, mapFailureReasonToLogLabel(outcome.reason));
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
        "AI_CHAT_FAILED",
        "AIに相談できませんでした。しばらくしてからもう一度お試しください。",
        corsHeaders
      );
    }

    logOutcome(requestId, turnCount, "ai_chat_success");
    return jsonResponse(200, { ok: true, data: outcome.result }, corsHeaders);
  } catch (error) {
    logSafeError(`tripChatProvider.chat failed requestId=${requestId}`, error);
    return errorResponse(500, "INTERNAL_ERROR", "しばらくしてからもう一度お試しください。", corsHeaders);
  }
});
