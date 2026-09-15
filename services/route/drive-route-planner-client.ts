import { getInstallId } from '@/services/device/install-id-store';
import type { AiRoutePreferences } from '@/types/ai-route-preferences';
import type { Coordinates } from '@/types/location';

/**
 * Supabase Edge Function `drive-route-planner` は内部でGoogle Places(1〜2回)・
 * Google Routes(最大5回、並列)を呼ぶため、単一のgoogle-routes/google-places呼び出しより
 * 時間がかかる。クライアント側の自動リトライは行わず(サーバー側で個々のGoogle呼び出しは
 * 既に最大1回リトライ済み)、複数回のGoogle呼び出しを考慮した余裕のあるタイムアウトにする。
 */
const CLIENT_TIMEOUT_MS = 30_000;

export type DrivePlanReturnTarget = 'same-as-departure' | 'different';

/** OpenAIへは送らない。Google Places/Routesの検索条件としてのみ使う。 */
export interface DrivePlanPreferences {
  avoidHighways: boolean;
  preferScenicRoads: boolean;
  preferCoastalRoads: boolean;
  preferMountainRoads: boolean;
  preferredScenery: string[];
  desiredStops: string[];
  drivingStyle: string;
}

export interface DrivePlanRequestInput {
  origin: Coordinates;
  /** returnTargetが'different'のときのみ指定する。実際にユーザーが選んだ座標のみ。 */
  destination?: Coordinates;
  /** ユーザーが実際に指定した経由地点(順序を維持、捏造しない)。 */
  userViaPoints: Coordinates[];
  returnTarget: DrivePlanReturnTarget;
  availableTimeMinutes: number;
  preferences: DrivePlanPreferences;
}

export interface DrivePlanSuggestedPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
}

export interface DrivePlan {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  source: 'google';
  suggestedPlace?: DrivePlanSuggestedPlace;
  warning?: string | null;
}

export interface DrivePlanMeta {
  availableTimeMinutes: number;
  baseDurationMinutes?: number;
  overBudget: boolean;
  /** 調査用。候補探索を何ラウンド実行したか。 */
  searchRoundsUsed?: number;
}

export type DrivePlanFailureReason = 'config_missing' | 'network' | 'timeout' | 'http_error' | 'invalid_response';

export type DrivePlanOutcome =
  | { ok: true; plans: DrivePlan[]; meta: DrivePlanMeta }
  | { ok: false; reason: DrivePlanFailureReason };

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

function parseSuggestedPlace(value: unknown): DrivePlanSuggestedPlace | null {
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

/** サーバー応答を無条件に信頼せず、実行時に最低限の型・形状を検証する。想定外の形はnullにする(例外を投げない)。 */
function parseDrivePlan(value: unknown): DrivePlan | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    !isFiniteNumber(record.distanceMeters) ||
    !isFiniteNumber(record.durationSeconds) ||
    typeof record.encodedPolyline !== 'string' ||
    record.encodedPolyline.length === 0 ||
    record.source !== 'google'
  ) {
    return null;
  }

  let suggestedPlace: DrivePlanSuggestedPlace | undefined;
  if (record.suggestedPlace !== undefined) {
    const parsed = parseSuggestedPlace(record.suggestedPlace);
    if (!parsed) {
      return null;
    }
    suggestedPlace = parsed;
  }

  let warning: string | null | undefined;
  if (record.warning !== undefined) {
    if (record.warning !== null && typeof record.warning !== 'string') {
      return null;
    }
    warning = record.warning;
  }

  return {
    id: record.id,
    distanceMeters: record.distanceMeters,
    durationSeconds: record.durationSeconds,
    encodedPolyline: record.encodedPolyline,
    source: 'google',
    suggestedPlace,
    warning,
  };
}

function parseMeta(value: unknown): DrivePlanMeta | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isFiniteNumber(record.availableTimeMinutes) || typeof record.overBudget !== 'boolean') {
    return null;
  }
  let baseDurationMinutes: number | undefined;
  if (record.baseDurationMinutes !== undefined) {
    if (!isFiniteNumber(record.baseDurationMinutes)) {
      return null;
    }
    baseDurationMinutes = record.baseDurationMinutes;
  }
  let searchRoundsUsed: number | undefined;
  if (record.searchRoundsUsed !== undefined) {
    if (!isFiniteNumber(record.searchRoundsUsed)) {
      return null;
    }
    searchRoundsUsed = record.searchRoundsUsed;
  }
  return {
    availableTimeMinutes: record.availableTimeMinutes,
    baseDurationMinutes,
    overBudget: record.overBudget,
    searchRoundsUsed,
  };
}

function parseDrivePlanResponse(value: unknown): { plans: DrivePlan[]; meta: DrivePlanMeta } | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== 'object' || record.data === null) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  if (!Array.isArray(data.plans)) {
    return null;
  }

  const plans: DrivePlan[] = [];
  for (const item of data.plans) {
    const parsed = parseDrivePlan(item);
    // 1件でも想定外の形なら、応答全体を不正として扱う(壊れた候補を黙って混ぜない)。
    if (!parsed) {
      return null;
    }
    plans.push(parsed);
  }

  const meta = parseMeta(data.meta);
  if (!meta) {
    return null;
  }

  return { plans, meta };
}

/** AiRoutePreferencesから、drive-route-plannerへ送ってよい7フィールドだけを抜き出す(interpretationSummaryは送らない)。 */
export function toDrivePlanPreferences(preferences: AiRoutePreferences): DrivePlanPreferences {
  return {
    avoidHighways: preferences.avoidHighways,
    preferScenicRoads: preferences.preferScenicRoads,
    preferCoastalRoads: preferences.preferCoastalRoads,
    preferMountainRoads: preferences.preferMountainRoads,
    preferredScenery: preferences.preferredScenery,
    desiredStops: preferences.desiredStops,
    drivingStyle: preferences.drivingStyle,
  };
}

/**
 * Expo → Supabase Edge Function(drive-route-planner) → Google Places/Routes という
 * 経路のみを使う。Expoから直接Google APIを呼び出すことはない。この関数が受け取る
 * 座標・嗜好をOpenAIへ送る処理はここには一切存在しない。
 */
export async function requestDrivePlans(input: DrivePlanRequestInput): Promise<DrivePlanOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      // 開発時の設定ミスを分かりやすくするためのログ。秘密値は一切含めない。
      console.warn(
        '[drive-route-planner-client] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です。.envを確認してください。'
      );
    }
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  const body: Record<string, unknown> = {
    origin: input.origin,
    userViaPoints: input.userViaPoints,
    returnTarget: input.returnTarget,
    availableTimeMinutes: input.availableTimeMinutes,
    preferences: input.preferences,
  };
  if (input.returnTarget === 'different' && input.destination) {
    body.destination = input.destination;
  }

  try {
    const response = await fetch(`${config.url}/functions/v1/drive-route-planner`, {
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
    const parsed = parseDrivePlanResponse(json);
    if (!parsed) {
      return { ok: false, reason: 'invalid_response' };
    }
    return { ok: true, plans: parsed.plans, meta: parsed.meta };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}
