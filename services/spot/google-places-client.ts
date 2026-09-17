import { getInstallId } from '@/services/device/install-id-store';
import type { Coordinates } from '@/types/location';

/**
 * Supabase Edge Function `google-places` の1回のfetch試行あたりのタイムアウトは
 * サーバー側で8秒、失敗時は最大1回リトライ(300msのbackoff)する実装になっている。
 * クライアント側はその最悪ケースを上回る値をタイムアウトにし、クライアント側での
 * 自動リトライは行わない(サーバー側で既に最大1回リトライ済みのため)。
 */
const CLIENT_TIMEOUT_MS = 18_000;

/**
 * 'history'(歴史・城・神社寺・歴史的建築)・'market'(市場)は、ドライブ計画
 * (気になる場所・区間探索)のために追加したカテゴリ。今すぐドライブ側の
 * Spot Discoveryのカテゴリチップには表示しない(types/spot.tsのSPOT_BROWSE_FILTERS参照)。
 */
export type PlaceSearchCategory = 'restaurant' | 'cafe' | 'scenic' | 'onsen' | 'activity' | 'history' | 'market';

export interface PlaceSearchInput {
  center: Coordinates;
  radiusMeters: number;
  category: PlaceSearchCategory;
  maxResults?: number;
}

/** Place写真1件への参照。実画像バイナリやAPIキーはこの型に含めない。 */
export interface PlacePhotoRef {
  name: string;
  attributions: string[];
}

export interface PlaceCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
  /** addressComponents由来の市区町村名。取得できない場合はnull(場所固有の説明文生成に使う)。 */
  locality: string | null;
  /**
   * addressComponents(administrative_area_level_1)由来のcanonicalな都道府県名
   * (例:「和歌山県」)。取得できない場合はnull。planning area Hard Constraintの
   * 判定(destinationQuery等の解決結果が指定地域内かどうか)に使う。
   */
  prefecture: string | null;
  /** 先頭1枚分の写真参照のみ。写真が無いPlaceはnull。 */
  photoRef: PlacePhotoRef | null;
}

export type PlaceSearchFailureReason = 'config_missing' | 'network' | 'timeout' | 'http_error' | 'invalid_response';

export type PlaceSearchOutcome =
  | { ok: true; places: PlaceCandidate[] }
  | { ok: false; reason: PlaceSearchFailureReason };

export type PlacePhotoFailureReason =
  | 'config_missing'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'budget_exceeded';

export type PlacePhotoOutcome =
  | { ok: true; photoUri: string }
  | { ok: false; reason: PlacePhotoFailureReason };

function getSupabaseConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** サーバー応答を無条件に信頼せず、想定外の形はnullにする(想定と違えば写真無しとして扱う、例外は投げない)。 */
function parsePhotoRef(value: unknown): PlacePhotoRef | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.length === 0) {
    return null;
  }
  const attributions: string[] = [];
  if (Array.isArray(record.attributions)) {
    for (const item of record.attributions) {
      if (typeof item === 'string' && item.length > 0) {
        attributions.push(item);
      }
    }
  }
  return { name: record.name, attributions };
}

/** サーバー応答を無条件に信頼せず、実行時に最低限の型・形状を検証する。想定外の形はnullにする(例外を投げない)。 */
function parsePlaceCandidate(value: unknown): PlaceCandidate | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    typeof record.name !== 'string' ||
    record.name.length === 0 ||
    !isFiniteNumber(record.latitude) ||
    !isFiniteNumber(record.longitude) ||
    (record.primaryType !== null && typeof record.primaryType !== 'string') ||
    (record.locality !== undefined && record.locality !== null && typeof record.locality !== 'string') ||
    (record.prefecture !== undefined && record.prefecture !== null && typeof record.prefecture !== 'string')
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    latitude: record.latitude,
    longitude: record.longitude,
    primaryType: record.primaryType,
    locality: typeof record.locality === 'string' ? record.locality : null,
    prefecture: typeof record.prefecture === 'string' ? record.prefecture : null,
    photoRef: parsePhotoRef(record.photoRef),
  };
}

function parsePlaceSearchResponse(value: unknown): PlaceCandidate[] | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== 'object' || record.data === null) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  if (!Array.isArray(data.places)) {
    return null;
  }

  const places: PlaceCandidate[] = [];
  for (const item of data.places) {
    const parsed = parsePlaceCandidate(item);
    // 1件でも想定外の形なら、応答全体を不正として扱う(壊れた候補を黙って混ぜない)。
    if (!parsed) {
      return null;
    }
    places.push(parsed);
  }
  return places;
}

/**
 * Expo → Supabase Edge Function(google-places) → Google Places API という経路のみを使う。
 * Expoから直接Google Places APIを呼び出すことはない。GOOGLE_PLACES_API_KEY等の
 * サーバー側秘密情報もここには一切登場しない(publishable keyのみを使う)。
 */
export async function searchNearbyPlaces(input: PlaceSearchInput): Promise<PlaceSearchOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      console.warn(
        '[google-places-client] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です。.envを確認してください。'
      );
    }
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  const body = {
    center: input.center,
    radiusMeters: input.radiusMeters,
    category: input.category,
    maxResults: input.maxResults ?? 5,
    rankPreference: 'POPULARITY' as const,
  };

  try {
    const response = await fetch(`${config.url}/functions/v1/google-places`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        'x-install-id': installId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: 'http_error' };
    }

    const json: unknown = await response.json();
    const places = parsePlaceSearchResponse(json);
    if (!places) {
      return { ok: false, reason: 'invalid_response' };
    }
    return { ok: true, places };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Text Search(地域名・施設名等の自由文から、実在する代表地点を解決する)。
 * ドライブ計画のチャットで、AIが返した検索意図の文字列(例:「高知駅」)を実在確認
 * するために使う。座標はこの呼び出しの結果としてのみ得られ、AIが直接座標を
 * 生成することはない。既存の`google-places` Edge Functionへ`mode:'text'`を
 * 付けて送るだけで、Nearby Search(`searchNearbyPlaces`)側の挙動には影響しない。
 *
 * locationBiasは、「夜景スポット」のような一般的な語句が出発地点等から無関係に
 * 離れた場所へマッチしないよう、検索の重み付け中心を指定する任意パラメータ
 * (今ドラ「おまかせ」最終地点・強い地理的希望の解決で使う)。
 */
export async function searchPlaceByText(
  query: string,
  maxResults = 1,
  locationBias?: { center: Coordinates; radiusMeters: number }
): Promise<PlaceSearchOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      console.warn(
        '[google-places-client] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です。.envを確認してください。'
      );
    }
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  const body: Record<string, unknown> = { mode: 'text' as const, textQuery: query, maxResults };
  if (locationBias) {
    body.locationBias = { center: locationBias.center, radiusMeters: locationBias.radiusMeters };
  }

  try {
    const response = await fetch(`${config.url}/functions/v1/google-places`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        'x-install-id': installId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: 'http_error' };
    }

    const json: unknown = await response.json();
    const places = parsePlaceSearchResponse(json);
    if (!places) {
      return { ok: false, reason: 'invalid_response' };
    }
    return { ok: true, places };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}

function parsePhotoUriResponse(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== 'object' || record.data === null) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  return typeof data.photoUri === 'string' && data.photoUri.startsWith('https://') ? data.photoUri : null;
}

/**
 * 候補カードに表示する写真を1枚だけ取得する(Photo Media)。表示された候補分だけ、
 * 呼び出し側(services/spot/place-photo-cache.ts)でキャッシュ・重複防止した上で呼ぶこと。
 * 検索と同じくExpo→Supabase Edge Function(google-places, mode:'photo')経由のみを使う。
 */
export async function getPlacePhotoUri(photoName: string, maxWidthPx = 480): Promise<PlacePhotoOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.url}/functions/v1/google-places`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        'x-install-id': installId,
      },
      body: JSON.stringify({ mode: 'photo' as const, photoName, maxWidthPx }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: response.status === 503 ? 'budget_exceeded' : 'http_error' };
    }

    const json: unknown = await response.json();
    const photoUri = parsePhotoUriResponse(json);
    if (!photoUri) {
      return { ok: false, reason: 'invalid_response' };
    }
    return { ok: true, photoUri };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}
