/**
 * ai-trip-chatが受け取る/返す型・JSON Schema・実行時検証(v3、Drive Planning Assistant)。
 *
 * v1/v2(前回・前々回実装)はDay単位のしおりタイムラインへの提案を中心とした
 * 設計だったが、今回「旅行全体を管理するアプリ」をやめ、ドライブ計画を
 * 「今ドラの、未来・旅先版」(ほぼ1画面のチャットで完結する、知らない土地の
 * ドライブコース相談)へ作り直したことにともない、レスポンスも「会話から
 * ドライブ計画(origin/destination/テーマ/時間)を組み立てる」設計へ全面置き換えした。
 *
 * - assistantMessage: 会話への短い返答(1回に1つ程度の質問に絞る、と指示する)
 * - suggestedQuickReplies: ワンタップで送信できる短い返信候補
 * - planUpdates: 会話から読み取った、ドライブ計画への差分更新(実座標は含まない)
 * - nextAction: 「AIが勝手にルートを完成させる」のではなく「AIと一緒に候補を見ながら
 *   組み立てる」体験にするため、毎ターン1つだけ選ばせる次のアクション
 *   (ask/search_places/generate_routes/modify_routes/save/chat)。
 *   ユーザーが「温泉追加して」のようにカテゴリの実在候補を求めているだけなら
 *   search_placesとし、即座にルートへ組み込まず、まず候補をカードで提示する
 *   (アプリ側が実際に選ばれた候補だけをwaypointへ追加してルートを組み直す)。
 * - placeSearchCategory: nextAction === "search_places" のときのみ設定する検索カテゴリ
 *
 * missingInformation/conversationState/routeModificationRequestは独立フィールドとして
 * 設けず、assistantMessage + planUpdates + nextActionで同じ目的を達成する
 * (schemaを簡潔に保ち、AI出力の失敗面を増やさないため)。
 *
 * ai-route-planning/ai-types.tsと同じ設計方針(プロバイダーに依存しない共有の型は
 * ここに置き、OpenAI固有の実装はopenai-provider.tsに閉じ込める)を踏襲する。
 * 緯度経度・住所・保存済み場所名などの実座標情報はこの型に一切登場しない
 * (AIへ実座標を送らないという既存Security Policyを維持)。AIが具体的な場所を
 * 指定したい場合は、defaultOriginQuery/destinationQueryという検索意図の文字列
 * だけを返し、実座標はアプリ側がGoogle Places Text Searchで別途解決する。
 */

export const TRIP_CHAT_ROLE_OPTIONS = ["user", "assistant"] as const;
export type TripChatRole = (typeof TRIP_CHAT_ROLE_OPTIONS)[number];

/**
 * ドライブ計画のテーマ。自由文ではなく固定enumにし、クライアント側で既存の
 * DrivePlanPreferences(drive-route-planner)へ機械的にマッピングする
 * (今ドラのselectCategories()と同じ仕組みを再利用する)。
 */
export const DRIVE_PLAN_THEME_OPTIONS = [
  "scenic",
  "coastal",
  "mountain",
  "gourmet",
  "onsen",
  "history",
  "market",
  "activity",
  "omakase",
] as const;
export type DrivePlanTheme = (typeof DRIVE_PLAN_THEME_OPTIONS)[number];

/**
 * 「AIが勝手にルートを完成させる」のではなく「AIと一緒に候補を見ながら組み立てる」
 * 体験にするため、AIに毎ターン1つだけ選ばせる次のアクション。
 * - ask: 確認質問をする(通常会話。矛盾する希望がある場合等)
 * - search_places: ユーザーが「温泉追加して」等カテゴリの実在候補を求めている。
 *   即座にルートへ組み込まず、まずGoogle Placesの実在候補をカードで見せる
 * - generate_routes: 十分な情報が揃った、または「海沿い多めに」等ルート全体の
 *   条件変更があり、新しいルート提案を作るべきタイミング
 * - modify_routes: 既存の提案を、ユーザーが選んだ候補(place候補選択後等)を
 *   踏まえて組み直すべきタイミング(generate_routesとクライアント側の処理は同じ
 *   だが、意味を区別できるよう分けている)
 * - save: ユーザーがこの計画に満足し保存したい意図を明確に示した
 * - chat: 上記のいずれにも該当しない、単なる相槌・会話の継続
 */
export const NEXT_ACTION_OPTIONS = ["ask", "search_places", "generate_routes", "modify_routes", "save", "chat"] as const;
export type NextAction = (typeof NEXT_ACTION_OPTIONS)[number];

/**
 * search_placesのときにだけ使う、実在候補を探すカテゴリ。既存のGoogle Places
 * カテゴリ(drive-route-planner/google-places-client.tsと同じ7値)をそのまま使う。
 */
export const PLACE_SEARCH_CATEGORY_OPTIONS = [
  "restaurant",
  "cafe",
  "scenic",
  "onsen",
  "activity",
  "history",
  "market",
] as const;
export type PlaceSearchCategoryForChat = (typeof PLACE_SEARCH_CATEGORY_OPTIONS)[number];

/** "none"はplanUpdatesの各文字列フィールドで「変更なし」を表すこのGateway専用のsentinel。 */
const NONE = "none";

export const MAX_MESSAGES = 12;
export const MAX_MESSAGE_LENGTH = 800;
export const MAX_AREA_QUERY_LENGTH = 40;
export const MAX_ORIGIN_LABEL_LENGTH = 60;
export const MAX_DATE_TEXT_LENGTH = 40;
export const MAX_SEASON_HINT_LENGTH = 4;

/**
 * OpenAI Structured Outputs(strict: true)のJSON Schemaに指定したmaxLength等の
 * 文字列長制約は、実際には生成時にハード制約として強制されない(typeやrequired・
 * additionalProperties: falseほど厳密には守られない)。そのため実行時再検証
 * (validateTripChatResult)側の上限は、モデルが多少超過しても即座にリクエスト全体を
 * 失敗させない安全マージンとして、schema上の目安より少し余裕を持たせている
 * (会話ターンが進むほどAIの返答が長くなる傾向があり、実機で数ターン後に
 * 「AIに相談できませんでした」となる不具合の一因だったため)。
 */
export const MAX_ASSISTANT_MESSAGE_LENGTH = 700;
export const MAX_QUICK_REPLIES = 4;
export const MAX_QUICK_REPLY_LENGTH = 20;
export const MAX_QUERY_LENGTH = 60;
/** 現実的な追加スポット数の上限(drive-route-planner側のMAX_OPTIONAL_VIA_POINTSと同程度)。 */
export const MAX_STOPS = 8;
export const MAX_STOP_ID_LENGTH = 40;

export interface TripChatMessage {
  role: TripChatRole;
  content: string;
}

/**
 * 現在追加済みのoptional stop(候補カードから選んで追加した立ち寄り地点)を、
 * AIが安全に参照できる形にした構造体。実在施設名(displayName)は含むが、
 * 座標・住所は一切含まない(「最初に追加した温泉を消して」等を正確に処理するために
 * 個別ID・カテゴリ・追加順を渡す、セクション9)。
 */
export interface DrivePlanChatStop {
  id: string;
  category: PlaceSearchCategoryForChat;
  addedOrder: number;
  displayName: string;
}

/** ドライブ計画の現在の状態。実座標・住所は一切含まない。 */
export interface DrivePlanChatContext {
  areaQuery?: string;
  hasOrigin: boolean;
  originLabel?: string;
  hasDestination: boolean;
  destinationLabel?: string;
  hasHomeSaved: boolean;
  timeBudgetMinutes?: number;
  dateText?: string;
  /** '春'|'夏'|'秋'|'冬'。クライアント側で日付から機械的に算出した値。 */
  seasonHint?: string;
  themes: DrivePlanTheme[];
  hasRouteOptions: boolean;
  stops: DrivePlanChatStop[];
}

export interface TripChatRequest {
  messages: TripChatMessage[];
  context: DrivePlanChatContext;
}

export interface PlanUpdates {
  areaQuery?: string;
  /** 実在確認前の検索意図のみ(例: "高知駅")。座標・断定的な地点名の生成は禁止。 */
  defaultOriginQuery?: string;
  useHomeAsOrigin?: boolean;
  destinationQuery?: string;
  timeBudgetMinutes?: number;
  dateText?: string;
  addThemes: DrivePlanTheme[];
  removeThemes: DrivePlanTheme[];
  avoidHighways?: boolean;
  /**
   * 会話中に「室戸岬の方に行きたい」等、出発地点・目的地とは別の強い地理的希望が
   * 出た場合の検索意図(例: "室戸岬")。座標は含まない、実在確認前の文字列のみ。
   * 実在確認はアプリ側がGoogle Places Text Search経由で行い、ルート候補探索の
   * anchorをその方向へ強く偏らせる(drive-route-plannerのbiasPointと同じ仕組み)。
   */
  biasAreaQuery?: string;
  /**
   * ユーザーが明示的に削除を求めたstopのid(例:「最初に追加した温泉を消して」→
   * addedOrder最小のonsenカテゴリのstopのidを1件だけ入れる)。カテゴリ単位の全削除では
   * ない、個別idでの削除(セクション8・10)。該当が無ければ空配列。
   */
  removeStopIds: string[];
  /**
   * ユーザーが明示的に順序を述べた場合のみ(例:「温泉は最後にして」)、現在のstop id
   * すべてをその希望順で列挙する(部分的なヒントではなく、現在のid集合の完全な並び替え)。
   * それ以外は空配列(その場合、クライアント側が効率の良い順序へ自動で並べ替える)。
   */
  reorderStopIds: string[];
}

export interface TripChatResult {
  assistantMessage: string;
  suggestedQuickReplies: string[];
  planUpdates: PlanUpdates;
  nextAction: NextAction;
  /** nextAction === "search_places" のときのみ設定される。それ以外はundefined。 */
  placeSearchCategory?: PlaceSearchCategoryForChat;
}

/**
 * OpenAI Structured Outputs(strict: true)用のJSON Schema。strict modeは
 * 「実質すべてのプロパティが必須」という制約があるため、値が無い場合は
 * 空文字列・0・false・sentinel値("none")を使う設計にしている(TypeScript側の
 * optionalとは別に、スキーマ上は常に全フィールドを要求する)。
 */
export const TRIP_CHAT_RESULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    assistantMessage: { type: "string", maxLength: MAX_ASSISTANT_MESSAGE_LENGTH },
    suggestedQuickReplies: {
      type: "array",
      maxItems: MAX_QUICK_REPLIES,
      items: { type: "string", maxLength: MAX_QUICK_REPLY_LENGTH },
    },
    planUpdates: {
      type: "object",
      additionalProperties: false,
      properties: {
        areaQuery: { type: "string", maxLength: MAX_QUERY_LENGTH },
        defaultOriginQuery: { type: "string", maxLength: MAX_QUERY_LENGTH },
        useHomeAsOrigin: { type: "boolean" },
        destinationQuery: { type: "string", maxLength: MAX_QUERY_LENGTH },
        timeBudgetMinutes: { type: "integer", minimum: 0, maximum: 10080 },
        dateText: { type: "string", maxLength: MAX_DATE_TEXT_LENGTH },
        addThemes: { type: "array", maxItems: DRIVE_PLAN_THEME_OPTIONS.length, items: { type: "string", enum: [...DRIVE_PLAN_THEME_OPTIONS] } },
        removeThemes: { type: "array", maxItems: DRIVE_PLAN_THEME_OPTIONS.length, items: { type: "string", enum: [...DRIVE_PLAN_THEME_OPTIONS] } },
        avoidHighwaysState: { type: "string", enum: ["yes", "no", NONE] },
        biasAreaQuery: { type: "string", maxLength: MAX_QUERY_LENGTH },
        removeStopIds: { type: "array", maxItems: MAX_STOPS, items: { type: "string", maxLength: MAX_STOP_ID_LENGTH } },
        reorderStopIds: { type: "array", maxItems: MAX_STOPS, items: { type: "string", maxLength: MAX_STOP_ID_LENGTH } },
      },
      required: [
        "areaQuery",
        "defaultOriginQuery",
        "useHomeAsOrigin",
        "destinationQuery",
        "timeBudgetMinutes",
        "dateText",
        "addThemes",
        "removeThemes",
        "avoidHighwaysState",
        "biasAreaQuery",
        "removeStopIds",
        "reorderStopIds",
      ],
    },
    nextAction: { type: "string", enum: [...NEXT_ACTION_OPTIONS] },
    placeSearchCategoryState: { type: "string", enum: [...PLACE_SEARCH_CATEGORY_OPTIONS, NONE] },
  },
  required: ["assistantMessage", "suggestedQuickReplies", "planUpdates", "nextAction", "placeSearchCategoryState"],
} as const;

export type TripChatFailureReason =
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "invalid_response"
  | "budget_exceeded";

export type TripChatProviderOutcome =
  | { ok: true; result: TripChatResult }
  | { ok: false; reason: TripChatFailureReason };

/**
 * ai-trip-chatのAIProvider(index.ts)が呼び出す、プロバイダー非依存のインターフェース。
 * requestIdは安全なログ(会話内容・座標を含まない、リクエストの追跡用の短い相関ID)のためだけに使う。
 */
export interface TripChatProvider {
  chat(input: TripChatRequest, requestId: string): Promise<TripChatProviderOutcome>;
}

function isDrivePlanTheme(value: unknown): value is DrivePlanTheme {
  return typeof value === "string" && (DRIVE_PLAN_THEME_OPTIONS as readonly string[]).includes(value);
}

function isThemeArray(value: unknown): value is DrivePlanTheme[] {
  return Array.isArray(value) && value.every(isDrivePlanTheme);
}

/**
 * OpenAIの応答を無条件に信頼せず、実行時に改めてこのschemaへ厳密に照合する。
 * 不正なら null を返す。timeBudgetMinutes === 0 やクエリ文字列が空/"none"の場合は
 * 「変更なし」として扱い、TypeScript側の型ではundefinedへ正規化する。
 */
export function validateTripChatResult(value: unknown): TripChatResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;

  if (typeof record.assistantMessage !== "string" || record.assistantMessage.trim().length === 0) {
    return null;
  }
  if (record.assistantMessage.length > MAX_ASSISTANT_MESSAGE_LENGTH) {
    return null;
  }

  if (!Array.isArray(record.suggestedQuickReplies)) {
    return null;
  }
  const suggestedQuickReplies: string[] = [];
  for (const raw of record.suggestedQuickReplies) {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return null;
    }
    suggestedQuickReplies.push(raw);
  }

  if (typeof record.planUpdates !== "object" || record.planUpdates === null || Array.isArray(record.planUpdates)) {
    return null;
  }
  const pu = record.planUpdates as Record<string, unknown>;

  /** 空文字列/"none"は「変更なし」を意味するsentinelとしてundefinedへ正規化する。文字列以外はnullを返す(呼び出し側で応答全体を不正として扱う)。 */
  function normalizeOptionalString(raw: unknown): { ok: true; value: string | undefined } | { ok: false } {
    if (typeof raw !== "string") {
      return { ok: false };
    }
    const trimmed = raw.trim();
    return { ok: true, value: trimmed.length === 0 || trimmed === NONE ? undefined : trimmed };
  }

  const areaQueryResult = normalizeOptionalString(pu.areaQuery);
  const defaultOriginQueryResult = normalizeOptionalString(pu.defaultOriginQuery);
  const destinationQueryResult = normalizeOptionalString(pu.destinationQuery);
  const dateTextResult = normalizeOptionalString(pu.dateText);
  const biasAreaQueryResult = normalizeOptionalString(pu.biasAreaQuery);
  if (
    !areaQueryResult.ok ||
    !defaultOriginQueryResult.ok ||
    !destinationQueryResult.ok ||
    !dateTextResult.ok ||
    !biasAreaQueryResult.ok
  ) {
    return null;
  }
  const areaQuery = areaQueryResult.value;
  const defaultOriginQuery = defaultOriginQueryResult.value;
  const destinationQuery = destinationQueryResult.value;
  const dateText = dateTextResult.value;
  const biasAreaQuery = biasAreaQueryResult.value;

  if (typeof pu.useHomeAsOrigin !== "boolean") {
    return null;
  }

  if (typeof pu.timeBudgetMinutes !== "number" || !Number.isInteger(pu.timeBudgetMinutes) || pu.timeBudgetMinutes < 0) {
    return null;
  }
  const timeBudgetMinutes = pu.timeBudgetMinutes > 0 ? pu.timeBudgetMinutes : undefined;

  if (!isThemeArray(pu.addThemes) || !isThemeArray(pu.removeThemes)) {
    return null;
  }

  if (
    typeof pu.avoidHighwaysState !== "string" ||
    !["yes", "no", NONE].includes(pu.avoidHighwaysState)
  ) {
    return null;
  }
  const avoidHighways = pu.avoidHighwaysState === "yes" ? true : pu.avoidHighwaysState === "no" ? false : undefined;

  function isStringArray(raw: unknown): raw is string[] {
    return Array.isArray(raw) && raw.every((item) => typeof item === "string" && item.length > 0);
  }

  if (!isStringArray(pu.removeStopIds) || !isStringArray(pu.reorderStopIds)) {
    return null;
  }
  const removeStopIds = pu.removeStopIds;
  const reorderStopIds = pu.reorderStopIds;

  if (
    typeof record.nextAction !== "string" ||
    !(NEXT_ACTION_OPTIONS as readonly string[]).includes(record.nextAction)
  ) {
    return null;
  }
  const nextAction = record.nextAction as NextAction;

  if (
    typeof record.placeSearchCategoryState !== "string" ||
    !([...PLACE_SEARCH_CATEGORY_OPTIONS, NONE] as readonly string[]).includes(record.placeSearchCategoryState)
  ) {
    return null;
  }
  const placeSearchCategory =
    record.placeSearchCategoryState === NONE
      ? undefined
      : (record.placeSearchCategoryState as PlaceSearchCategoryForChat);

  return {
    assistantMessage: record.assistantMessage,
    suggestedQuickReplies,
    planUpdates: {
      areaQuery,
      defaultOriginQuery,
      useHomeAsOrigin: pu.useHomeAsOrigin || undefined,
      destinationQuery,
      timeBudgetMinutes,
      dateText,
      addThemes: pu.addThemes,
      removeThemes: pu.removeThemes,
      avoidHighways,
      biasAreaQuery,
      removeStopIds,
      reorderStopIds,
    },
    nextAction,
    placeSearchCategory,
  };
}
