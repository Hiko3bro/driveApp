/**
 * Upstash Redis / レート制限の共有インフラ。index.ts(一般トラフィック制限)と
 * openai-provider.ts(外部API予算チェック、fetch試行ごとに呼ぶ)の両方から
 * importされるため、循環importを避けるために独立したファイルにしている。
 */
import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

/** 環境変数を正の整数として読む。未設定・不正な値は必ずfallbackへ安全側に倒す。 */
export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * サーバー側ログ専用。ユーザー入力(aiNote等)・位置情報・秘密情報は絶対に渡さないこと。
 * 予期せぬ例外もerror.messageではなくerror.nameだけを記録する
 * (JSON.parseの例外はメッセージに入力の断片を含むことがあるため)。
 */
export function logSafeError(context: string, error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[ai-route-planning] ${context}: ${kind}`);
}

/** Upstash未設定(ローカル開発等)かどうかをこの3つの有無だけで判定する。 */
export function getUpstashConfig(): { url: string; token: string; hashSecret: string } | null {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
  const hashSecret = Deno.env.get("RATE_LIMIT_HASH_SECRET");
  if (!url || !token || !hashSecret) {
    return null;
  }
  return { url, token, hashSecret };
}

// Edge Functionのインスタンスがウォーム状態で再利用される間は使い回す
// (毎リクエストでRedisクライアント/Ratelimitインスタンスを作り直さない)。
let cachedRedis: Redis | null = null;
const limiterCache = new Map<string, Ratelimit>();

export function getRedisClient(url: string, token: string): Redis {
  if (!cachedRedis) {
    cachedRedis = new Redis({ url, token });
  }
  return cachedRedis;
}

/**
 * prefixは軸・時間窓ごとに完全に分離した文字列を渡すこと(例: "rl:install:minute")。
 * @upstash/ratelimitの実装(node_modules配布物のdist/index.mjsで確認済み)では、
 * 実際のRedisキーは`${prefix}:${identifier}:${bucket}`という形で組み立てられる。
 * cacheKeyとprefixを同一にして両方を一意にし、食い違いによる事故を防いでいる。
 */
export function getLimiter(redis: Redis, prefix: string, limit: number, window: string): Ratelimit {
  let limiter = limiterCache.get(prefix);
  if (!limiter) {
    limiter = new Ratelimit({ redis, limiter: Ratelimit.fixedWindow(limit, window), prefix });
    limiterCache.set(prefix, limiter);
  }
  return limiter;
}

/**
 * install-id・IPアドレスをそのままRedisキーに使わず、サーバー側secret
 * (RATE_LIMIT_HASH_SECRET)によるHMAC-SHA256で匿名化する。追加の暗号ライブラリは
 * 使わず、Deno標準のWeb Crypto APIだけで実装している。
 */
export async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type ExternalApiName = "openai" | "google-routes" | "google-places";

/** 将来、外部API呼び出し直前でcheckExternalApiBudget()から参照する1日あたりの上限。 */
const OPENAI_DAILY_LIMIT = readPositiveIntEnv("OPENAI_DAILY_LIMIT", 5_000);
const GOOGLE_ROUTES_DAILY_LIMIT = readPositiveIntEnv("GOOGLE_ROUTES_DAILY_LIMIT", 5_000);
const GOOGLE_PLACES_DAILY_LIMIT = readPositiveIntEnv("GOOGLE_PLACES_DAILY_LIMIT", 300);

const EXTERNAL_API_DAILY_LIMITS: Record<ExternalApiName, number> = {
  openai: OPENAI_DAILY_LIMIT,
  "google-routes": GOOGLE_ROUTES_DAILY_LIMIT,
  "google-places": GOOGLE_PLACES_DAILY_LIMIT,
};

/**
 * 外部API(OpenAI/Google Routes/Google Places)を実際に呼び出す直前にだけ呼ぶ。
 * OpenAIについては、リトライで2回目のfetchを実際に送る場合、その直前にも
 * もう一度呼ぶこと(=fetch試行1回ごとに1回、openai-provider.ts参照)。
 * バリデーションエラーや、外部APIを呼ばずに終わるリクエストの分はカウントしない。
 *
 * 常にfail-closed(Upstash未設定・障害時はfalseを返し、外部API呼び出しをブロックする)。
 * 課金が発生する外部APIを、予算管理基盤が使えない状態で呼ばせないため。
 */
export async function checkExternalApiBudget(api: ExternalApiName): Promise<boolean> {
  const config = getUpstashConfig();
  if (!config) {
    return false;
  }
  try {
    const redis = getRedisClient(config.url, config.token);
    const limiter = getLimiter(redis, `budget:${api}:day`, EXTERNAL_API_DAILY_LIMITS[api], "1 d");
    const result = await limiter.limit(api);
    return result.success;
  } catch (error) {
    logSafeError(`checkExternalApiBudget(${api}) failed`, error);
    return false;
  }
}
