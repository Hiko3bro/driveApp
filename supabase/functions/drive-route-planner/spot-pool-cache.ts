/**
 * Spot Pool(Text Search中心の広い候補集め)のセッションキャッシュ。「別の案見せて」等の
 * 再検索のたびに同じText Searchを繰り返さないための、Upstash Redisベースのfingerprint
 * キャッシュ(セクション13・25・26)。既存のレート制限インフラ(ai-route-planning/
 * rate-limit-infra.ts)と同じRedisクライアントを再利用し、新しい依存関係は追加しない。
 *
 * 予算チェック(checkExternalApiBudget)・rate limit・retry・safe loggingは一切変更・
 * 迂回しない。このキャッシュは「同じGoogle検索を繰り返さない」ための補助であり、
 * 予算チェック自体の代替ではない(キャッシュがヒットしなければ、これまでどおり
 * checkExternalApiBudgetを経由してGoogleを呼ぶ)。
 */
import { getRedisClient, getUpstashConfig, logSafeError } from "../ai-route-planning/rate-limit-infra.ts";
import type { PlaceCandidate } from "../google-places/place-types.ts";

/** Poolの保持時間(秒)。同一planning sessionの目安として30分。 */
const POOL_CACHE_TTL_SECONDS = 30 * 60;
/** 1つのfingerprintあたり保存するPoolの最大件数(Redisの1エントリサイズを抑えるため)。 */
const MAX_CACHED_POOL_SIZE = 30;

/**
 * 座標・自由記述文は一切含めない、決定的なfingerprintを作る(themeとlabel・prefecture・
 * 半径・時間帯・目的地有無のみ)。prefecture(canonicalな都道府県名)を含めることで、
 * 同じareaLabel文字列でも、area解決側の修正でcanonical化の結果が変わった場合に
 * 別のfingerprintになる(修正前の不正なキャッシュと衝突しない)。
 */
export async function buildPoolFingerprint(parts: {
  theme: string;
  areaLabel: string;
  prefecture?: string;
  radiusMeters: number;
  availableTimeMinutes?: number;
  hasDestination: boolean;
}): Promise<string> {
  const raw = JSON.stringify({
    theme: parts.theme,
    areaLabel: parts.areaLabel,
    prefecture: parts.prefecture ?? "none",
    // 半径・時間は大まかな帯(10km・30分単位)にまとめ、わずかな違いでcache missにならないようにする。
    radiusBand: Math.round(parts.radiusMeters / 10_000),
    timeBand: parts.availableTimeMinutes !== undefined ? Math.round(parts.availableTimeMinutes / 30) : "none",
    hasDestination: parts.hasDestination,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * キーprefixを"pool:v2:"にしているのは、和歌山県で四国・兵庫県が候補に混入した不具合の
 * 修正前に作られた可能性のある古いキャッシュ("pool:"のまま)を、TTL(30分)を待たず
 * 即座に無効化するため。新しいバグ修正を行い既存キャッシュを信用できなくなった場合は、
 * 同様にこのprefixをさらに繰り上げること。
 *
 * キャッシュ読み取り。Upstash未設定・障害時はnullを返す(fail-open、Poolは通常どおり
 * その場で構築される。予算チェック自体はfail-closedのまま変更していない)。
 */
export async function getPoolFromCache(fingerprint: string): Promise<PlaceCandidate[] | null> {
  const config = getUpstashConfig();
  if (!config) {
    return null;
  }
  try {
    const redis = getRedisClient(config.url, config.token);
    const cached = await redis.get<PlaceCandidate[]>(`pool:v2:${fingerprint}`);
    return Array.isArray(cached) ? cached : null;
  } catch (error) {
    logSafeError("getPoolFromCache failed", error);
    return null;
  }
}

/** キャッシュ書き込み。失敗してもリクエスト自体は継続する(キャッシュは最適化であり必須ではない)。 */
export async function savePoolToCache(fingerprint: string, pool: PlaceCandidate[]): Promise<void> {
  const config = getUpstashConfig();
  if (!config) {
    return;
  }
  try {
    const redis = getRedisClient(config.url, config.token);
    await redis.set(`pool:v2:${fingerprint}`, pool.slice(0, MAX_CACHED_POOL_SIZE), { ex: POOL_CACHE_TTL_SECONDS });
  } catch (error) {
    logSafeError("savePoolToCache failed", error);
  }
}
