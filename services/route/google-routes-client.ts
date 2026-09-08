import { getInstallId } from '@/services/device/install-id-store';
import type { Coordinates } from '@/types/location';

/**
 * Supabase Edge Function `google-routes` の1回のfetch試行あたりのタイムアウトは
 * サーバー側で8秒、失敗時は最大1回リトライ(300msのbackoff)する実装になっている。
 * クライアント側はその最悪ケース(約8秒+300ms+約8秒)を上回る値をタイムアウトにし、
 * クライアント側での自動リトライは行わない(サーバー側で既に最大1回リトライ済みのため)。
 */
const CLIENT_TIMEOUT_MS = 20_000;

/** Edge Function側(google-routes/route-types.ts)のMAX_INTERMEDIATESと合わせる。 */
const MAX_INTERMEDIATES = 10;

export interface GoogleRouteCandidate {
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  routeLabels: string[];
}

export interface GoogleRoutesRequestInput {
  origin: Coordinates;
  destination: Coordinates;
  /** 実際にユーザーが指定した経由地点の座標のみ。捏造した座標は渡さない。 */
  intermediates?: Coordinates[];
  avoidHighways?: boolean;
}

export type GoogleRoutesFailureReason = 'config_missing' | 'network' | 'timeout' | 'http_error' | 'invalid_response';

export type GoogleRoutesOutcome =
  | { ok: true; routes: GoogleRouteCandidate[] }
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
function parseRouteCandidate(value: unknown): GoogleRouteCandidate | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !isFiniteNumber(record.distanceMeters) ||
    !isFiniteNumber(record.durationSeconds) ||
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

function parseGoogleRoutesResponse(value: unknown): GoogleRouteCandidate[] | null {
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

  const routes: GoogleRouteCandidate[] = [];
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
 * Expoアプリから直接Google Routes APIを呼び出すことはない。GOOGLE_ROUTES_API_KEY等の
 * サーバー側秘密情報もここには一切登場しない(publishable keyのみを使う)。
 */
export async function requestGoogleRoutes(input: GoogleRoutesRequestInput): Promise<GoogleRoutesOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      // 開発時の設定ミスを分かりやすくするためのログ。秘密値は一切含めない。
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
    body.intermediates = input.intermediates.slice(0, MAX_INTERMEDIATES);
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
    const routes = parseGoogleRoutesResponse(json);
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
