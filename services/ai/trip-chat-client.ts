import { getInstallId } from '@/services/device/install-id-store';

/**
 * Supabase Edge Function `ai-trip-chat` のクライアント(v3、Drive Planning Assistant)。
 * services/ai/route-planning-client.tsと同じ方針(タイムアウト・実行時応答検証・
 * クライアント側は自動リトライしない)を踏襲する。
 *
 * v1/v2(Day単位のscope/days/proposedDays)から、Day概念を持たない
 * 「会話からドライブ計画(origin/destination/テーマ/時間)を組み立てる」設計へ変更した。
 */
const CLIENT_TIMEOUT_MS = 18_000;

export type TripChatRole = 'user' | 'assistant';

export interface TripChatClientMessage {
  role: TripChatRole;
  content: string;
}

export type DrivePlanTheme =
  | 'scenic'
  | 'coastal'
  | 'mountain'
  | 'gourmet'
  | 'onsen'
  | 'history'
  | 'market'
  | 'activity'
  | 'omakase';

const DRIVE_PLAN_THEMES: readonly DrivePlanTheme[] = [
  'scenic',
  'coastal',
  'mountain',
  'gourmet',
  'onsen',
  'history',
  'market',
  'activity',
  'omakase',
];

export interface DrivePlanChatStop {
  id: string;
  category: PlaceSearchCategoryForChat;
  addedOrder: number;
  displayName: string;
}

/** ドライブ計画の現在の状態。実座標・住所は送らない。 */
export interface DrivePlanChatContext {
  areaQuery?: string;
  hasOrigin: boolean;
  originLabel?: string;
  hasDestination: boolean;
  destinationLabel?: string;
  hasHomeSaved: boolean;
  timeBudgetMinutes?: number;
  dateText?: string;
  seasonHint?: '春' | '夏' | '秋' | '冬';
  themes: DrivePlanTheme[];
  hasRouteOptions: boolean;
  stops: DrivePlanChatStop[];
}

export interface TripChatRequestInput {
  /** 直近のN件だけを送る(呼び出し元で絞り込むこと)。最後の要素は必ずrole: 'user'。 */
  messages: TripChatClientMessage[];
  context: DrivePlanChatContext;
}

export interface TripChatPlanUpdates {
  areaQuery?: string;
  defaultOriginQuery?: string;
  useHomeAsOrigin?: boolean;
  destinationQuery?: string;
  timeBudgetMinutes?: number;
  dateText?: string;
  addThemes: DrivePlanTheme[];
  removeThemes: DrivePlanTheme[];
  avoidHighways?: boolean;
  /** 出発地点・目的地とは別の、会話中に出た強い地理的希望の検索意図(例: "室戸岬")。 */
  biasAreaQuery?: string;
  /** ユーザーが明示的に削除を求めたstopのid(通常0〜1件)。 */
  removeStopIds: string[];
  /** ユーザーが明示的に順序を述べた場合のみ、現在のstop id全件をその希望順で列挙したもの。 */
  reorderStopIds: string[];
}

export const NEXT_ACTION_OPTIONS = ['ask', 'search_places', 'generate_routes', 'modify_routes', 'save', 'chat'] as const;
export type NextAction = (typeof NEXT_ACTION_OPTIONS)[number];

export type PlaceSearchCategoryForChat =
  | 'restaurant'
  | 'cafe'
  | 'scenic'
  | 'onsen'
  | 'activity'
  | 'history'
  | 'market';

const PLACE_SEARCH_CATEGORIES: readonly PlaceSearchCategoryForChat[] = [
  'restaurant',
  'cafe',
  'scenic',
  'onsen',
  'activity',
  'history',
  'market',
];

export interface TripChatResult {
  assistantMessage: string;
  suggestedQuickReplies: string[];
  planUpdates: TripChatPlanUpdates;
  nextAction: NextAction;
  placeSearchCategory?: PlaceSearchCategoryForChat;
}

export type TripChatFailureReason = 'config_missing' | 'network' | 'timeout' | 'http_error' | 'invalid_response';

export type TripChatOutcome = { ok: true; result: TripChatResult } | { ok: false; reason: TripChatFailureReason };

function getSupabaseConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return null;
  }
  return { url, publishableKey };
}

function isDrivePlanTheme(value: unknown): value is DrivePlanTheme {
  return typeof value === 'string' && (DRIVE_PLAN_THEMES as readonly string[]).includes(value);
}

function isThemeArray(value: unknown): value is DrivePlanTheme[] {
  return Array.isArray(value) && value.every(isDrivePlanTheme);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** サーバー応答を無条件に信頼せず、実行時に最低限の型・形状を検証する。想定外の形はnullにする(例外を投げない)。 */
function parsePlanUpdates(value: unknown): TripChatPlanUpdates | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.areaQuery !== undefined && typeof record.areaQuery !== 'string') return null;
  if (record.defaultOriginQuery !== undefined && typeof record.defaultOriginQuery !== 'string') return null;
  if (record.destinationQuery !== undefined && typeof record.destinationQuery !== 'string') return null;
  if (record.dateText !== undefined && typeof record.dateText !== 'string') return null;
  if (record.biasAreaQuery !== undefined && typeof record.biasAreaQuery !== 'string') return null;
  if (record.useHomeAsOrigin !== undefined && typeof record.useHomeAsOrigin !== 'boolean') return null;
  if (record.avoidHighways !== undefined && typeof record.avoidHighways !== 'boolean') return null;
  if (record.timeBudgetMinutes !== undefined && typeof record.timeBudgetMinutes !== 'number') return null;
  if (!isThemeArray(record.addThemes) || !isThemeArray(record.removeThemes)) {
    return null;
  }
  if (!isStringArray(record.removeStopIds) || !isStringArray(record.reorderStopIds)) {
    return null;
  }
  return {
    areaQuery: record.areaQuery as string | undefined,
    defaultOriginQuery: record.defaultOriginQuery as string | undefined,
    useHomeAsOrigin: record.useHomeAsOrigin as boolean | undefined,
    destinationQuery: record.destinationQuery as string | undefined,
    timeBudgetMinutes: record.timeBudgetMinutes as number | undefined,
    dateText: record.dateText as string | undefined,
    addThemes: record.addThemes,
    removeThemes: record.removeThemes,
    avoidHighways: record.avoidHighways as boolean | undefined,
    biasAreaQuery: record.biasAreaQuery as string | undefined,
    removeStopIds: record.removeStopIds,
    reorderStopIds: record.reorderStopIds,
  };
}

function parseTripChatResponse(value: unknown): TripChatResult | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== 'object' || record.data === null) {
    return null;
  }
  const data = record.data as Record<string, unknown>;
  if (typeof data.assistantMessage !== 'string' || data.assistantMessage.length === 0) {
    return null;
  }
  if (!Array.isArray(data.suggestedQuickReplies) || !data.suggestedQuickReplies.every((v) => typeof v === 'string')) {
    return null;
  }
  const planUpdates = parsePlanUpdates(data.planUpdates);
  if (!planUpdates) {
    return null;
  }
  if (typeof data.nextAction !== 'string' || !(NEXT_ACTION_OPTIONS as readonly string[]).includes(data.nextAction)) {
    return null;
  }
  const nextAction = data.nextAction as NextAction;

  let placeSearchCategory: PlaceSearchCategoryForChat | undefined;
  if (data.placeSearchCategory !== undefined) {
    if (
      typeof data.placeSearchCategory !== 'string' ||
      !(PLACE_SEARCH_CATEGORIES as readonly string[]).includes(data.placeSearchCategory)
    ) {
      return null;
    }
    placeSearchCategory = data.placeSearchCategory as PlaceSearchCategoryForChat;
  }

  return {
    assistantMessage: data.assistantMessage,
    suggestedQuickReplies: data.suggestedQuickReplies,
    planUpdates,
    nextAction,
    placeSearchCategory,
  };
}

/**
 * Expo → Supabase Edge Function(ai-trip-chat) → OpenAIという経路のみを使う。
 * 実座標・住所はこの関数の入力にも出力にも一切登場しない(既存Security Policyを維持)。
 */
export async function requestTripChat(input: TripChatRequestInput): Promise<TripChatOutcome> {
  const config = getSupabaseConfig();
  if (!config) {
    if (__DEV__) {
      console.warn(
        '[trip-chat-client] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です。.envを確認してください。'
      );
    }
    return { ok: false, reason: 'config_missing' };
  }

  const installId = await getInstallId();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const response = await fetch(`${config.url}/functions/v1/ai-trip-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.publishableKey,
        'x-install-id': installId,
      },
      body: JSON.stringify({
        messages: input.messages,
        context: input.context,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { ok: false, reason: 'http_error' };
    }

    const json: unknown = await response.json();
    const result = parseTripChatResponse(json);
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
