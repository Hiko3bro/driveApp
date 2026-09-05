// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { createSupabaseContext } from "@supabase/server";
import type { AiFailureReason, AiProvider, AiRoutePreferences, PreferredScenery } from "./ai-types.ts";
import { createOpenAiProvider } from "./openai-provider.ts";
import {
  getLimiter,
  getRedisClient,
  getUpstashConfig,
  hmacSha256Hex,
  logSafeError,
  readPositiveIntEnv,
} from "./rate-limit-infra.ts";

/**
 * ai-route-planning: アプリの「AIに追加で伝えたいこと」を含む条件入力を安全に
 * 受け取り、OpenAI Responses APIでドライブ嗜好を構造化するGateway。
 * AI Gateway(このファイル) → AiProvider(ai-types.ts) → OpenAiProvider
 * (openai-provider.ts、具体実装)という構成にしており、将来別プロバイダーへ
 * 差し替える場合もGateway全体を書き直す必要はない。
 *
 * 設計方針:
 * - アプリ内部のDriveConditions/Context/画面stateを丸ごと受け取らない。
 *   ここで定義するAiRoutePlanningRequestだけを受け取る、最小のGateway入力とする。
 * - 正確な緯度経度・住所・保存済み場所の名称など、AIに不要な位置情報は
 *   構造上そもそも受け取れないようにする(該当フィールド自体を用意しない)。
 * - ユーザーの自由記述(aiNote)は「命令」ではなく「データ」として扱う
 *   (Prompt Injection対策。openai-provider.tsのinstructions/input分離を参照)。
 *   AIには外部アクションを実行する権限(tool/function calling等)を与えない。
 * - aiNoteが空、またはOpenAIの呼び出しが失敗した場合は、構造化条件だけから
 *   導ける安全なfallbackへ戻す(OpenAIを呼ばなくてもルート検索は続行できる)。
 * - ログにはユーザー入力の内容・位置情報・秘密情報を一切出力しない。
 * - クライアントへ返すエラーには内部実装の詳細を含めない。
 * - ログイン不要のアプリから呼べるよう、Supabase公式の@supabase/server
 *   (createSupabaseContext)でpublishable keyを検証する。apikeyヘッダーが
 *   無い/不正な場合は、他のバリデーションより先に401で拒否する
 *   (verify_jwtはこのプロジェクトのレガシーJWT鍵向けの仕組みのため無効のままとし、
 *   代わりにこの関数内でpublishable/secret鍵体系のapikeyを検証する)。
 * - OpenAI接続後の課金暴走を防ぐため、Upstash Redis(@upstash/ratelimit)による
 *   多層のレート制限を行う。x-install-id(端末単位)を主軸とし、IPアドレスは
 *   Supabaseのx-forwarded-forが常に得られるとは限らないため補助的に扱う。
 *   Upstashが未設定/障害時は、一般トラフィックの制限はfail-open(既定)で
 *   通すが、外部API予算チェック(checkExternalApiBudget、rate-limit-infra.ts)は
 *   必ずfail-closedとする。OpenAIへの各fetch試行(初回・リトライとも)の直前に
 *   個別に呼ぶ(openai-provider.ts参照)。生のinstall-id/IPはRedisキーに使わず、
 *   サーバー側secretでHMAC-SHA256ハッシュ化してから使う。
 */

// ===== 定数 ============================================================

/** リクエスト本文の上限バイト数。この程度の入力に対して十分すぎる余裕を持たせつつ、乱用を防ぐ。 */
const MAX_BODY_BYTES = 8 * 1024;

/** types/drive.ts の Mood と一致させる(Denoランタイムはアプリ側の型を直接importできないため、値を複製して同期を保つ)。 */
const ALLOWED_MOODS = [
  "scenic",
  "coastal",
  "mountain",
  "nightDrive",
  "leisurely",
  "detourRich",
  "driveFocused",
  "omakase",
] as const;
/** types/drive.ts の MAX_SELECTED_MOODS と一致。 */
const MAX_MOODS = 3;

/** types/drive.ts の DetourLevel と一致。 */
const ALLOWED_DETOUR_LEVELS = ["few", "normal", "many"] as const;

/** types/drive.ts の ReturnTarget と一致。 */
const ALLOWED_RETURN_TARGETS = ["same-as-departure", "different"] as const;

/**
 * app/conditions.tsx の「自分で入力」ステップと一致させる、使える時間(分)の許容範囲。
 * 下限15分はMIN_CUSTOM_TOTAL_MINUTES(15分未満は「次へ」をブロックする)、
 * 上限10080分(7日)はMAX_CUSTOM_DAYS(7日)に由来する。
 */
const MIN_AVAILABLE_TIME_MINUTES = 15;
const MAX_AVAILABLE_TIME_MINUTES = 7 * 24 * 60;

/** 経由したい場所の件数として現実的に妥当な上限(件数のみを受け取り、内容は受け取らない)。 */
const MAX_VIA_POINT_COUNT = 20;

/** AIに追加で伝えたいことの上限文字数。 */
const MAX_AI_NOTE_LENGTH = 500;

/** タイムゾーンオフセット付きISO 8601("YYYY-MM-DDTHH:mm:ss[.sss]±HH:mm"または末尾Z)の簡易検証。 */
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// OpenAI呼び出しのタイムアウト・リトライ回数はopenai-provider.ts側で管理する
// (OPENAI_TIMEOUT_MS・OPENAI_MAX_RETRIES)。アプリ側の再試行回数は別途アプリの
// コードで設計する(このGatewayの責務ではない)。

// ===== レート制限の設定値(すべて環境変数で上書き可能、コード直書きしない) ==========
// readPositiveIntEnv・外部API予算(OPENAI_DAILY_LIMIT等)はrate-limit-infra.tsへ移動した
// (openai-provider.tsのfetch試行ごとの予算チェックと共有するため)。

/** 検証用の初期値。本番ではSupabase Edge Function Secretsで同名の環境変数を設定して上書きする。 */
const RATE_LIMIT_INSTALL_MINUTE = readPositiveIntEnv("RATE_LIMIT_INSTALL_MINUTE", 8);
const RATE_LIMIT_INSTALL_HOUR = readPositiveIntEnv("RATE_LIMIT_INSTALL_HOUR", 120);
const RATE_LIMIT_INSTALL_DAY = readPositiveIntEnv("RATE_LIMIT_INSTALL_DAY", 800);
const RATE_LIMIT_IP_MINUTE = readPositiveIntEnv("RATE_LIMIT_IP_MINUTE", 40);
const RATE_LIMIT_IP_HOUR = readPositiveIntEnv("RATE_LIMIT_IP_HOUR", 300);
const RATE_LIMIT_GLOBAL_DAY = readPositiveIntEnv("RATE_LIMIT_GLOBAL_DAY", 10_000);

/**
 * install/IP/globalの一般トラフィック制限は、Upstash側の障害時に既定でfail-open
 * (制限を素通りさせる)にする。理由: 現時点ではまだ課金の発生する外部APIを
 * 呼んでいないため、Upstashの一時的な障害でアプリ全体が使えなくなる方が害が大きい。
 * 環境変数RATE_LIMIT_FAIL_OPEN=falseでfail-closedへ切り替えられる。
 * (外部API予算チェックcheckExternalApiBudget()は、これとは独立して常にfail-closed。)
 */
const RATE_LIMIT_FAIL_OPEN = (Deno.env.get("RATE_LIMIT_FAIL_OPEN") ?? "true").toLowerCase() !== "false";

/**
 * 一時的な診断用。trueの間だけ、どのlimiter種別が許可/拒否したか(ラベルと
 * 設定上限値のみ)をログへ出す。installId・IP・HMAC値・Secretの実値は
 * このログ機構では絶対に出力しない。本番運用時はfalse(既定)にすること。
 */
const RATE_LIMIT_DEBUG_LOG = (Deno.env.get("RATE_LIMIT_DEBUG_LOG") ?? "false").toLowerCase() === "true";

/**
 * x-install-id(Expoアプリ側でSecureStoreに保存するランダムUUID)の形式検証。
 * UUIDのバージョン欄は限定せず、一般的なUUID形式であることだけを確認する。
 */
const INSTALL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CORSを許可するOrigin。本番運用時は環境変数ALLOWED_ORIGINS(カンマ区切り)で
 * 上書きできる。未設定時はローカル開発用のExpo Web既定ポートのみを許可する
 * (ネイティブアプリ(iOS/Android)からのfetchはOriginヘッダー自体を送らないため、
 * このホワイトリストの影響を受けない)。
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

// ===== 型 ================================================================

type Mood = (typeof ALLOWED_MOODS)[number];
type DetourLevel = (typeof ALLOWED_DETOUR_LEVELS)[number];
type ReturnTarget = (typeof ALLOWED_RETURN_TARGETS)[number];

/**
 * このGatewayが受け取る最小のリクエスト形状。DriveConditionsから、AIによる
 * 条件解釈に必要な要素だけを抜き出したもの。finalDestination/viaPointsの
 * 実座標・名称、departureの緯度経度、自宅住所などは意図的に含まない。
 */
interface AiRoutePlanningRequest {
  /** DriveConditions.moods 相当。最大MAX_MOODS件。 */
  moods: Mood[];
  /** DriveConditions.detourLevel 相当。 */
  detourLevel?: DetourLevel;
  /** DriveConditions.availableTime/customAvailableMinutesを分に解決した値(MIN_AVAILABLE_TIME_MINUTES〜MAX_AVAILABLE_TIME_MINUTES分)。 */
  availableTimeMinutes?: number;
  /** DriveConditions.returnTarget 相当。実際の目的地情報は含まない。 */
  returnTarget?: ReturnTarget;
  /** finalDestinationの実座標は送らず、指定の有無だけを伝える。 */
  hasFinalDestination: boolean;
  /** viaPointsの実座標・名称は送らず、件数だけを伝える。 */
  viaPointCount: number;
  /** DriveConditions.returnDeadline(ISO 8601)。位置情報ではないため許可。 */
  returnDeadline?: string;
  /** DriveConditions.aiNote。最大MAX_AI_NOTE_LENGTH文字。 */
  aiNote?: string;
}

type ApiSuccessResponse<T> = { ok: true; data: T };
type ApiErrorResponse = { ok: false; error: { code: string; message: string } };

const ALLOWED_REQUEST_KEYS = new Set<keyof AiRoutePlanningRequest>([
  "moods",
  "detourLevel",
  "availableTimeMinutes",
  "returnTarget",
  "hasFinalDestination",
  "viaPointCount",
  "returnDeadline",
  "aiNote",
]);

// ===== バリデーション ======================================================

type ValidationResult =
  | { ok: true; data: AiRoutePlanningRequest }
  | { ok: false; reason: string };

/** 想定外フィールドが無いことを確認する(DriveConditions/Contextを丸ごと送られた場合もここで弾く)。 */
function hasOnlyAllowedKeys(record: Record<string, unknown>): boolean {
  return Object.keys(record).every((key) =>
    ALLOWED_REQUEST_KEYS.has(key as keyof AiRoutePlanningRequest)
  );
}

function validateAiRoutePlanningRequest(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  if (!hasOnlyAllowedKeys(record)) {
    return { ok: false, reason: "unexpected field present" };
  }

  if (!Array.isArray(record.moods) || record.moods.length > MAX_MOODS) {
    return { ok: false, reason: "invalid moods" };
  }
  if (
    !record.moods.every(
      (mood): mood is Mood =>
        typeof mood === "string" && (ALLOWED_MOODS as readonly string[]).includes(mood)
    )
  ) {
    return { ok: false, reason: "invalid mood value" };
  }
  const moods = record.moods as Mood[];

  let detourLevel: DetourLevel | undefined;
  if (record.detourLevel !== undefined) {
    if (
      typeof record.detourLevel !== "string" ||
      !(ALLOWED_DETOUR_LEVELS as readonly string[]).includes(record.detourLevel)
    ) {
      return { ok: false, reason: "invalid detourLevel" };
    }
    detourLevel = record.detourLevel as DetourLevel;
  }

  let availableTimeMinutes: number | undefined;
  if (record.availableTimeMinutes !== undefined) {
    const minutes = record.availableTimeMinutes;
    if (
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < MIN_AVAILABLE_TIME_MINUTES ||
      minutes > MAX_AVAILABLE_TIME_MINUTES
    ) {
      return { ok: false, reason: "invalid availableTimeMinutes" };
    }
    availableTimeMinutes = minutes;
  }

  let returnTarget: ReturnTarget | undefined;
  if (record.returnTarget !== undefined) {
    if (
      typeof record.returnTarget !== "string" ||
      !(ALLOWED_RETURN_TARGETS as readonly string[]).includes(record.returnTarget)
    ) {
      return { ok: false, reason: "invalid returnTarget" };
    }
    returnTarget = record.returnTarget as ReturnTarget;
  }

  if (typeof record.hasFinalDestination !== "boolean") {
    return { ok: false, reason: "hasFinalDestination must be boolean" };
  }

  if (
    typeof record.viaPointCount !== "number" ||
    !Number.isInteger(record.viaPointCount) ||
    record.viaPointCount < 0 ||
    record.viaPointCount > MAX_VIA_POINT_COUNT
  ) {
    return { ok: false, reason: "invalid viaPointCount" };
  }

  let returnDeadline: string | undefined;
  if (record.returnDeadline !== undefined) {
    if (
      typeof record.returnDeadline !== "string" ||
      !ISO_DATETIME_PATTERN.test(record.returnDeadline) ||
      !Number.isFinite(new Date(record.returnDeadline).getTime())
    ) {
      return { ok: false, reason: "invalid returnDeadline" };
    }
    returnDeadline = record.returnDeadline;
  }

  let aiNote: string | undefined;
  if (record.aiNote !== undefined) {
    if (typeof record.aiNote !== "string") {
      return { ok: false, reason: "aiNote must be a string" };
    }
    if (record.aiNote.length > MAX_AI_NOTE_LENGTH) {
      return { ok: false, reason: "aiNote too long" };
    }
    aiNote = record.aiNote;
  }

  return {
    ok: true,
    data: {
      moods,
      detourLevel,
      availableTimeMinutes,
      returnTarget,
      hasFinalDestination: record.hasFinalDestination,
      viaPointCount: record.viaPointCount,
      returnDeadline,
      aiNote,
    },
  };
}

// ===== 本文読み取り(サイズ上限つき) =========================================

/**
 * Content-Lengthヘッダーだけに頼らず、実際に読み取ったバイト数で上限を強制する。
 * ヘッダーが偽装・省略されていても、上限を超えた時点で読み取りを打ち切る。
 */
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

  // Originヘッダーが無い場合(ネイティブアプリからのfetch等)はCORS制御自体が不要。
  if (!originHeader) {
    return headers;
  }
  if (getAllowedOrigins().includes(originHeader)) {
    headers["Access-Control-Allow-Origin"] = originHeader;
  }
  // 許可リストに無いOriginの場合はヘッダーを付けない(ブラウザ側が読み取りをブロックする)。
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

function errorResponse(
  status: number,
  code: string,
  message: string,
  corsHeaders: HeadersInit
): Response {
  return jsonResponse(status, { ok: false, error: { code, message } }, corsHeaders);
}

// logSafeErrorはrate-limit-infra.tsからimportしている(openai-provider.tsとの共有のため)。

// ===== 認証(publishable key) ===============================================

/**
 * apikeyヘッダーのpublishable keyを、Supabase公式の@supabase/server
 * (createSupabaseContext)で検証する。
 *
 * withSupabase()(export default { fetch: withSupabase(...) }専用の
 * 自動ラッパー)ではなく、あえてcreateSupabaseContextを直接使っている。
 * withSupabase()は認証失敗時に独自形式のレスポンスを返す前提のAPIで、
 * 既存の{ok:false, error:{code,message}}という統一エラー形式や、
 * このファイルの他のチェック(POST制限・Content-Type制限・本文サイズ上限等)
 * との実行順序をこちらで制御できない。createSupabaseContextは公式ドキュメントで
 * 「401レスポンスを自分で組み立てたい場合に使う」ものとして案内されており、
 * 検証ロジック自体はwithSupabase()と同じ公式実装を使いながら、
 * レスポンス形式は既存のerrorResponse()に統一できる。
 */
async function authenticateRequest(req: Request): Promise<boolean> {
  const { error } = await createSupabaseContext(req, { auth: "publishable" });
  return !error;
}

/** x-install-idヘッダーの形式検証。本人認証ではなく、あくまで端末単位の識別子として扱う。 */
function isValidInstallId(value: string | null): value is string {
  return value !== null && INSTALL_ID_PATTERN.test(value);
}

/**
 * Supabaseのエッジゲートウェイはx-forwarded-forへ実際のクライアントIPを設定する
 * 想定だが、Supabase公式のGitHub Discussion(#7884)でも「半分近く空になる」という
 * 未解決の不具合報告があり、常に信頼できるとは限らない。そのため取得できた場合の
 * 「先頭の1つ」だけを補助的なIPとして扱い、取得できない場合はIP側の制限を
 * まるごとスキップする(installId制限とpublishable key認証は影響を受けない)。
 */
function extractClientIp(req: Request): string | null {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }
  const first = forwardedFor.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

// ===== レート制限(Upstash Redis) ===========================================
// getUpstashConfig・getRedisClient・getLimiter・hmacSha256Hexはrate-limit-infra.ts
// からimportしている(openai-provider.tsの外部API予算チェックと共有するため)。

/**
 * どのlimiterかを表す安全なラベル。ログにはこれだけを出し、生のinstallId/IP/
 * ハッシュ値は絶対に出さない。
 */
type RateLimitKind = "install_minute" | "install_hour" | "install_day" | "ip_minute" | "ip_hour" | "global_day";

interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

/** RATE_LIMIT_DEBUG_LOG=trueの間だけ、種別・可否・設定上限値を出す(生のID/IP/ハッシュ値は含めない)。 */
function logRateLimitDecision(kind: RateLimitKind, allowed: boolean, limit: number): void {
  if (!RATE_LIMIT_DEBUG_LOG) {
    return;
  }
  console.log(`[ai-route-planning] rate-limit ${kind}: ${allowed ? "ok" : "blocked"} (limit=${limit})`);
}

/**
 * install-id単位(分/時/日)・IP単位(分/時、取得できた場合のみ)・
 * Edge Function全体(1日)のレート制限をまとめてチェックする。
 * publishable key認証・POST/Content-Type/本文検証より前、
 * ただしメソッド・Content-Typeの安価なチェックより後に呼ぶ想定
 * (明らかに不正な形式のリクエストでRedisを消費しないため)。
 *
 * Upstash未設定、またはRedis呼び出し自体が失敗した場合はRATE_LIMIT_FAIL_OPEN
 * の設定に従う(既定はfail-open)。将来の外部API予算チェックとは異なり、
 * このチェックはまだ課金の発生する処理を保護するものではないため。
 */
async function checkGeneralRateLimit(
  installId: string,
  clientIp: string | null
): Promise<RateLimitCheckResult> {
  const config = getUpstashConfig();
  if (!config) {
    return { allowed: RATE_LIMIT_FAIL_OPEN };
  }

  try {
    const redis = getRedisClient(config.url, config.token);
    const installHash = await hmacSha256Hex(installId, config.hashSecret);

    const checks: {
      kind: RateLimitKind;
      limit: number;
      retryAfterSeconds: number;
      promise: Promise<{ success: boolean }>;
    }[] = [
      {
        kind: "install_minute",
        limit: RATE_LIMIT_INSTALL_MINUTE,
        retryAfterSeconds: 60,
        promise: getLimiter(redis, "rl:install:minute", RATE_LIMIT_INSTALL_MINUTE, "1 m").limit(
          installHash
        ),
      },
      {
        kind: "install_hour",
        limit: RATE_LIMIT_INSTALL_HOUR,
        retryAfterSeconds: 3600,
        promise: getLimiter(redis, "rl:install:hour", RATE_LIMIT_INSTALL_HOUR, "1 h").limit(
          installHash
        ),
      },
      {
        kind: "install_day",
        limit: RATE_LIMIT_INSTALL_DAY,
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:install:day", RATE_LIMIT_INSTALL_DAY, "1 d").limit(
          installHash
        ),
      },
      {
        kind: "global_day",
        limit: RATE_LIMIT_GLOBAL_DAY,
        retryAfterSeconds: 86_400,
        promise: getLimiter(redis, "rl:global:day", RATE_LIMIT_GLOBAL_DAY, "1 d").limit("all"),
      },
    ];

    if (clientIp) {
      const ipHash = await hmacSha256Hex(clientIp, config.hashSecret);
      checks.push(
        {
          kind: "ip_minute",
          limit: RATE_LIMIT_IP_MINUTE,
          retryAfterSeconds: 60,
          promise: getLimiter(redis, "rl:ip:minute", RATE_LIMIT_IP_MINUTE, "1 m").limit(ipHash),
        },
        {
          kind: "ip_hour",
          limit: RATE_LIMIT_IP_HOUR,
          retryAfterSeconds: 3600,
          promise: getLimiter(redis, "rl:ip:hour", RATE_LIMIT_IP_HOUR, "1 h").limit(ipHash),
        }
      );
    }

    const results = await Promise.all(checks.map((check) => check.promise));

    if (RATE_LIMIT_DEBUG_LOG) {
      results.forEach((result, index) => {
        logRateLimitDecision(checks[index].kind, result.success, checks[index].limit);
      });
    }

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

// ExternalApiName・checkExternalApiBudgetはrate-limit-infra.tsへ移動した。
// openai-provider.tsがOpenAIへのfetch試行ごとに直接呼び出す(index.tsはもう呼ばない)。

// ===== AI Gateway(OpenAI呼び出しの要否判定・予算チェック・fallback) ===============

/** ログには固定ラベルだけを出す(生のリクエスト内容・OpenAIレスポンス本文・APIキーは一切含めない)。 */
function logAiOutcome(label: string): void {
  console.log(`[ai-route-planning] ${label}`);
}

function mapFailureReasonToLogLabel(reason: AiFailureReason): string {
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
  }
}

/**
 * コスト削減のため、AIを呼んでも意味が無いリクエストではOpenAIを呼ばない。
 * 現時点ではaiNoteが空(=自由記述が無い)かどうかだけで判定する
 * (それ以外の条件は元々すべて構造化された選択肢のみで確定しているため)。
 */
function shouldUseAi(request: AiRoutePlanningRequest): boolean {
  return Boolean(request.aiNote && request.aiNote.trim().length > 0);
}

/**
 * AIを使わない/使えない場合に返す、構造化条件だけから機械的に導ける
 * デフォルトの嗜好。AIの創作的な判断は一切含まない、安全な最小限の推定。
 */
function buildFallbackPreferences(request: AiRoutePlanningRequest): AiRoutePreferences {
  const moods = request.moods;
  const preferredScenery: PreferredScenery[] = [];
  if (moods.includes("coastal")) preferredScenery.push("ocean");
  if (moods.includes("mountain")) preferredScenery.push("mountain");
  if (moods.includes("nightDrive")) preferredScenery.push("night_view");

  return {
    avoidHighways: false,
    preferScenicRoads: moods.includes("scenic"),
    preferCoastalRoads: moods.includes("coastal"),
    preferMountainRoads: moods.includes("mountain"),
    preferredScenery,
    desiredStops: [],
    drivingStyle: moods.includes("leisurely")
      ? "relaxed"
      : moods.includes("driveFocused")
        ? "driving_focused"
        : "balanced",
    interpretationSummary: "選んだ気分をもとに、条件に合うルートを探します。",
  };
}

interface PlanRouteWithAiResult {
  aiUsed: boolean;
  fallback: boolean;
  preferences: AiRoutePreferences;
}

// このGatewayが使うAiProviderの実装。将来Gemini等へ差し替える場合は、
// この1行を別プロバイダーのfactory呼び出しに変えるだけでよい。
const aiProvider: AiProvider = createOpenAiProvider();

/**
 * AIによる条件解釈の本体。
 * - aiNoteが無ければOpenAIを呼ばずに終わる(shouldUseAi)
 * - 外部API予算チェック(checkExternalApiBudget("openai"))は、ここではなく
 *   openai-provider.ts側で、実際にfetchを送る直前ごと(初回・リトライとも)に
 *   個別に消費される。バリデーション失敗・認証失敗・一般レート制限・AI不要
 *   リクエストでは、そもそもopenai-provider.tsまで到達しないため消費されない
 * - timeout/429/5xx/malformed response/schema検証失敗/予算超過のいずれでも
 *   例外を投げず、構造化条件だけによる安全なfallbackへ戻す
 */
async function planRouteWithAi(request: AiRoutePlanningRequest): Promise<PlanRouteWithAiResult> {
  if (!shouldUseAi(request)) {
    return { aiUsed: false, fallback: false, preferences: buildFallbackPreferences(request) };
  }

  const outcome = await aiProvider.interpret({
    moods: request.moods,
    detourLevel: request.detourLevel,
    availableTimeMinutes: request.availableTimeMinutes,
    returnTarget: request.returnTarget,
    hasFinalDestination: request.hasFinalDestination,
    viaPointCount: request.viaPointCount,
    returnDeadline: request.returnDeadline,
    aiNote: request.aiNote ?? "",
  });

  if (outcome.ok) {
    logAiOutcome("ai_call_success");
    return { aiUsed: true, fallback: false, preferences: outcome.preferences };
  }

  logAiOutcome(mapFailureReasonToLogLabel(outcome.reason));
  return { aiUsed: false, fallback: true, preferences: buildFallbackPreferences(request) };
}

// ===== エントリーポイント ===================================================

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("origin"));

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // apikey(publishable key)の検証は、他のどのチェックよりも先に行う。
  // 未認証の呼び出し元に、対応メソッドや入力形式などエンドポイントの
  // 情報を先に教えないため。
  if (!(await authenticateRequest(req))) {
    return errorResponse(401, "UNAUTHENTICATED", "認証できませんでした。", corsHeaders);
  }

  // x-install-idの形式チェックもRedisアクセスなしの安価なチェックのため、
  // レート制限より先に行う(不正な形式ならレート制限のキーも作れない)。
  const installId = req.headers.get("x-install-id");
  if (!isValidInstallId(installId)) {
    return errorResponse(400, "INVALID_INSTALL_ID", "リクエストを確認してください。", corsHeaders);
  }

  // メソッド・Content-Typeも同様にRedisアクセス無しで判定できるため、
  // レート制限(Redisへの実際のアクセスが発生する)より先に済ませる。
  // これにより、明らかに不正な形式のリクエストでRedisの呼び出し回数・
  // コストを消費しないようにしている。
  if (req.method !== "POST") {
    return errorResponse(
      405,
      "METHOD_NOT_ALLOWED",
      "対応していないHTTPメソッドです。",
      corsHeaders
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Typeはapplication/jsonにしてください。",
      corsHeaders
    );
  }

  const rateLimitResult = await checkGeneralRateLimit(installId, extractClientIp(req));
  if (!rateLimitResult.allowed) {
    const rateLimitHeaders: Record<string, string> = { ...corsHeaders };
    if (rateLimitResult.retryAfterSeconds) {
      rateLimitHeaders["Retry-After"] = String(rateLimitResult.retryAfterSeconds);
    }
    return errorResponse(
      429,
      "RATE_LIMITED",
      "しばらく時間をおいてから再度お試しください。",
      rateLimitHeaders
    );
  }

  const bodyResult = await readBodyWithLimit(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return errorResponse(
      413,
      "PAYLOAD_TOO_LARGE",
      "リクエスト本文が大きすぎます。",
      corsHeaders
    );
  }

  let parsed: unknown;
  try {
    parsed = bodyResult.text.length > 0 ? JSON.parse(bodyResult.text) : undefined;
  } catch {
    return errorResponse(400, "INVALID_JSON", "JSONの形式が正しくありません。", corsHeaders);
  }

  const validation = validateAiRoutePlanningRequest(parsed);
  if (!validation.ok) {
    // reasonはサーバーログにも出さない(バリデーション対象はユーザー入力そのものであり、
    // reason文字列がその内容を推測させる可能性があるため)。
    return errorResponse(400, "INVALID_REQUEST", "入力内容を確認してください。", corsHeaders);
  }

  try {
    const result = await planRouteWithAi(validation.data);
    return jsonResponse(200, { ok: true, data: result }, corsHeaders);
  } catch (error) {
    logSafeError("planRouteWithAi failed", error);
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "しばらくしてからもう一度お試しください。",
      corsHeaders
    );
  }
});
