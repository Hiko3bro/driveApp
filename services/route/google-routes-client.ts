import { getInstallId } from '@/services/device/install-id-store';
import type { Coordinates } from '@/types/location';

/**
 * Supabase Edge Function `google-routes` の1回のfetch試行あたりのタイムアウトは
 * サーバー側で8秒、失敗時は最大1回リトライする実装になっている。クライアント側は
 * その最悪ケースを上回る値をタイムアウトにし、クライアント側での自動リトライは
 * 行わない(サーバー側で既に最大1回リトライ済みのため)。
 */
const CLIENT_TIMEOUT_MS = 18_000;

export interface GoogleRoutesRequestInput {
  origin: Coordinates;
  destination: Coordinates;
  /** origin→destinationの間を通す経由地点(順序を維持)。 */
  intermediates?: Coordinates[];
  avoidHighways?: boolean;
}

/** アプリへ返す正規化済みのルート候補。Googleの生レスポンス形状への依存をアプリ側へ広げない。 */
export interface RouteCandidate {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  routeLabels: string[];
}

export type GoogleRoutesFailureReason =
  | 'config_missing'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'invalid_response';

export type GoogleRoutesOutcome =
  | { ok: true; routes: RouteCandidate[] }
  | { ok: false; reason: GoogleRoutesFailureReason };

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** サーバー応答を無条件に信頼せず、実行時に最低限の型・形状を検証する。想定外の形はnullにする(例外を投げない)。 */
function parseRouteCandidate(value: unknown): RouteCandidate | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isFiniteNumber(record.distanceMeters) ||
    record.distanceMeters < 0 ||
    !isFiniteNumber(record.durationSeconds) ||
    record.durationSeconds < 0 ||
    typeof record.encodedPolyline !== 'string' ||
    record.encodedPolyline.length === 0 ||
    !isStringArray(record.routeLabels)
  ) {
    return null;
  }
  return {
    distanceMeters: record.distanceMeters,
    durationSeconds: record.durationSeconds,
    encodedPolyline: record.encodedPolyline,
    routeLabels: record.routeLabels,
  };
}

function parseRoutesResponse(value: unknown): RouteCandidate[] | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== 'object' || record.data === null) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  if (!Array.isArray(data.routes)) {
    return null;
  }

  const routes: RouteCandidate[] = [];
  for (const item of data.routes) {
    const parsed = parseRouteCandidate(item);
    // 1件でも想定外の形なら、応答全体を不正として扱う(壊れた候補を黙って混ぜない)。
    if (!parsed) {
      return null;
    }
    routes.push(parsed);
  }
  return routes;
}

/**
 * Expo → Supabase Edge Function(google-routes) → Google Routes API という経路のみを使う。
 * Expoから直接Google Routes APIを呼び出すことはない。
 */
export async function computeGoogleRoute(input: GoogleRoutesRequestInput): Promise<GoogleRoutesOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      console.warn(
        '[google-routes-client] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です。.envを確認してください。'
      );
    }
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    origin: input.origin,
    destination: input.destination,
  };
  if (input.intermediates && input.intermediates.length > 0) {
    body.intermediates = input.intermediates;
  }
  if (input.avoidHighways) {
    body.avoidHighways = true;
  }

  try {
    const response = await fetch(`${config.url}/functions/v1/google-routes`, {
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
    const routes = parseRoutesResponse(json);
    if (!routes) {
      return { ok: false, reason: 'invalid_response' };
    }
    return { ok: true, routes };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}
