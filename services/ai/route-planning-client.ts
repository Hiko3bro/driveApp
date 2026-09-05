import { getInstallId } from '@/services/device/install-id-store';
import { resolveAvailableMinutes } from '@/services/route/time-budget';
import type { AiInterpretationResult, AiRoutePreferences } from '@/types/ai-route-preferences';
import { DESIRED_STOP_OPTIONS, DRIVING_STYLE_OPTIONS, PREFERRED_SCENERY_OPTIONS } from '@/types/ai-route-preferences';
import type { DriveConditions } from '@/types/drive';

/**
 * Supabase Edge Function `ai-route-planning` の1回のfetch試行あたりのタイムアウトは
 * サーバー側で8秒、失敗時は最大1回リトライ(300msのbackoffを挟む)する実装になっている。
 * そのためクライアント側は「8秒より少し余裕を持った値」ではなく、サーバーの
 * 最悪ケース(約8秒 + 300ms + 約8秒)を上回る値をタイムアウトにする。
 * クライアント側では自動リトライは行わない(サーバー側で既に最大1回リトライ済みのため)。
 */
const CLIENT_TIMEOUT_MS = 18_000;

export type AiRoutePlanningFailureReason =
  | 'skipped'
  | 'config_missing'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'invalid_response';

export type AiRoutePlanningOutcome =
  | { ok: true; result: AiInterpretationResult }
  | { ok: false; reason: AiRoutePlanningFailureReason };

/** aiNoteが空(未入力)ならAI Gatewayを呼び出す意味がないため、呼び出し前に判定する。 */
export function shouldRequestAiInterpretation(conditions: DriveConditions): boolean {
  return Boolean(conditions.aiNote && conditions.aiNote.trim().length > 0);
}

function getSupabaseConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

/**
 * Edge Functionへ送るのは、AIが嗜好を解釈するために最小限必要な構造化条件と
 * 自由記述だけ。緯度経度・住所・保存場所名・GPS履歴・DriveRecord・Diaryなどは
 * この関数の入力にも出力にも一切登場しない。
 */
function buildRequestPayload(conditions: DriveConditions) {
  return {
    moods: conditions.moods,
    detourLevel: conditions.detourLevel,
    availableTimeMinutes: resolveAvailableMinutes(conditions),
    returnTarget: conditions.returnTarget,
    hasFinalDestination: Boolean(conditions.finalDestination),
    viaPointCount: conditions.viaPoints.length,
    returnDeadline: conditions.returnDeadline,
    aiNote: conditions.aiNote,
  };
}

function isStringArrayOf<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && (allowed as readonly string[]).includes(item));
}

/** サーバー応答を無条件に信頼せず、実行時に最低限の型・形状を検証する。想定外の形は落とさずnullにする。 */
function parseAiRoutePreferences(value: unknown): AiRoutePreferences | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;

  if (
    typeof record.avoidHighways !== 'boolean' ||
    typeof record.preferScenicRoads !== 'boolean' ||
    typeof record.preferCoastalRoads !== 'boolean' ||
    typeof record.preferMountainRoads !== 'boolean' ||
    !isStringArrayOf(record.preferredScenery, PREFERRED_SCENERY_OPTIONS) ||
    !isStringArrayOf(record.desiredStops, DESIRED_STOP_OPTIONS) ||
    typeof record.drivingStyle !== 'string' ||
    !(DRIVING_STYLE_OPTIONS as readonly string[]).includes(record.drivingStyle) ||
    typeof record.interpretationSummary !== 'string'
  ) {
    return null;
  }

  return {
    avoidHighways: record.avoidHighways,
    preferScenicRoads: record.preferScenicRoads,
    preferCoastalRoads: record.preferCoastalRoads,
    preferMountainRoads: record.preferMountainRoads,
    preferredScenery: record.preferredScenery,
    desiredStops: record.desiredStops,
    drivingStyle: record.drivingStyle as AiRoutePreferences['drivingStyle'],
    interpretationSummary: record.interpretationSummary,
  };
}

function parseAiInterpretationResult(value: unknown): AiInterpretationResult | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== 'object' || record.data === null) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  if (typeof data.aiUsed !== 'boolean' || typeof data.fallback !== 'boolean') {
    return null;
  }
  const preferences = parseAiRoutePreferences(data.preferences);
  if (!preferences) {
    return null;
  }
  return { aiUsed: data.aiUsed, fallback: data.fallback, preferences };
}

/**
 * Expo → Supabase Edge Function(ai-route-planning) → OpenAI という経路のみを使う。
 * Expoアプリから直接OpenAIを呼び出すことはない。OPENAI_API_KEY等のサーバー側秘密情報も
 * ここには一切登場しない(publishable keyのみを使う)。
 *
 * クライアント側では自動リトライを行わない。失敗時は呼び出し元がフォールバックメッセージを
 * 出し、構造化条件だけでルート比較へ進める設計を前提にしている。
 */
export async function requestAiRoutePreferences(conditions: DriveConditions): Promise<AiRoutePlanningOutcome> {
  if (!shouldRequestAiInterpretation(conditions)) {
    return { ok: false, reason: 'skipped' };
  }

  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      // 開発時の設定ミスを分かりやすくするためのログ。秘密値は一切含めない。
      console.warn(
        '[route-planning-client] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です。.envを確認してください。'
      );
    }
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.url}/functions/v1/ai-route-planning`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        'x-install-id': installId,
      },
      body: JSON.stringify(buildRequestPayload(conditions)),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: 'http_error' };
    }

    const json: unknown = await response.json();
    const result = parseAiInterpretationResult(json);
    if (!result) {
      return { ok: false, reason: 'invalid_response' };
    }
    return { ok: true, result };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout' };
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}
