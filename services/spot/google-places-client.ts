import { getInstallId } from '@/services/device/install-id-store';
import type { Coordinates } from '@/types/location';

/**
 * Supabase Edge Function `google-places` の1回のfetch試行あたりのタイムアウトは
 * サーバー側で8秒、失敗時は最大1回リトライ(300msのbackoff)する実装になっている。
 * クライアント側はその最悪ケースを上回る値をタイムアウトにし、クライアント側での
 * 自動リトライは行わない(サーバー側で既に最大1回リトライ済みのため)。
 */
const CLIENT_TIMEOUT_MS = 18_000;

export type PlaceSearchCategory = 'restaurant' | 'cafe' | 'scenic' | 'onsen' | 'activity';

export interface PlaceSearchInput {
  center: Coordinates;
  radiusMeters: number;
  category: PlaceSearchCategory;
  maxResults?: number;
}

export interface PlaceCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
}

export type PlaceSearchFailureReason = 'config_missing' | 'network' | 'timeout' | 'http_error' | 'invalid_response';

export type PlaceSearchOutcome =
  | { ok: true; places: PlaceCandidate[] }
  | { ok: false; reason: PlaceSearchFailureReason };

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
    (record.primaryType !== null && typeof record.primaryType !== 'string')
  ) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    latitude: record.latitude,
    longitude: record.longitude,
    primaryType: record.primaryType,
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
