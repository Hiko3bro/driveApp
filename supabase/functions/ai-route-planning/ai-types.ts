/**
 * 生成AIの出力に関する、プロバイダーに依存しない共有の型・JSON Schema・実行時検証。
 * OpenAI固有の実装はopenai-provider.tsに閉じ込め、将来別プロバイダー(例: Gemini)へ
 * 差し替える際も、このファイルとGateway側(index.ts)は書き換えずに済むようにする。
 *
 * AI Gateway(index.ts) → AiProvider(このインターフェース) → OpenAiProvider(具体実装)
 */

export const PREFERRED_SCENERY_OPTIONS = ["ocean", "mountain", "night_view", "city", "nature"] as const;
export const DESIRED_STOP_OPTIONS = ["restaurant", "cafe", "scenic", "onsen", "activity"] as const;
export const DRIVING_STYLE_OPTIONS = ["relaxed", "balanced", "driving_focused"] as const;

export type PreferredScenery = (typeof PREFERRED_SCENERY_OPTIONS)[number];
export type DesiredStop = (typeof DESIRED_STOP_OPTIONS)[number];
export type DrivingStyle = (typeof DRIVING_STYLE_OPTIONS)[number];

/** 短い日本語要約の上限文字数。 */
export const MAX_INTERPRETATION_SUMMARY_LENGTH = 150;
/** 地名検索クエリの上限文字数(「生駒山」程度の短い語句を想定)。 */
export const MAX_REQUESTED_AREA_QUERY_LENGTH = 40;

/**
 * AIにドライブ嗜好を解釈させた結果。緯度経度・住所・URL・コード・電話番号・
 * メールアドレス、AIが創作した経路座標や架空スポット名は一切含まない
 * (そもそもこの型にそのようなフィールドを用意していない)。
 */
export interface AiRoutePreferences {
  avoidHighways: boolean;
  preferScenicRoads: boolean;
  preferCoastalRoads: boolean;
  preferMountainRoads: boolean;
  preferredScenery: PreferredScenery[];
  desiredStops: DesiredStop[];
  drivingStyle: DrivingStyle;
  /** 短い日本語の要約(MAX_INTERPRETATION_SUMMARY_LENGTH文字まで)。 */
  interpretationSummary: string;
  /**
   * 自由記述に「生駒を走りたい」のような強い地理的希望が含まれる場合の、検索したい
   * 地名・ランドマーク名(例: "生駒山")。AIはこの文字列だけを返し、座標を創作しない。
   * 実在確認はアプリ側がGoogle Places Text Search経由で別途行う。無ければ空文字列。
   */
  requestedAreaQuery: string;
  /**
   * wantsAiSuggestedDestination(最終地点「おまかせ」)がtrueの場合のみ、
   * 気分・時間・季節等から考えて良さそうな「立ち寄り先のタイプ」の検索語句
   * (例: "夜景スポット", "海の見える展望台")を入れる。実在する具体的な店舗・
   * 施設名を創作してはいけない(検索意図の文字列のみ)。実在確認・出発地点周辺への
   * 絞り込みはアプリ側がGoogle Places Text Search(locationBias)で行う。
   * wantsAiSuggestedDestinationがfalseの場合は空文字列。
   */
  suggestedGoalQuery: string;
  /**
   * suggestedGoalQueryとは体験の異なる、2つ目の立ち寄り先タイプの検索語句
   * (例: suggestedGoalQueryが"夜景スポット"なら、こちらは"温泉"等、方向性の違う
   * 候補)。ユーザーが複数の実在ゴール候補から選べるようにするため
   * (「AIが1件だけ勝手に決める」のではなく「性格の異なる候補を複数見せる」ため)。
   * wantsAiSuggestedDestinationがfalse、または2件目の案を思いつかない場合は空文字列。
   */
  suggestedGoalQueryAlt1: string;
  /** suggestedGoalQuery/suggestedGoalQueryAlt1とも異なる、3つ目の立ち寄り先タイプの検索語句。無ければ空文字列。 */
  suggestedGoalQueryAlt2: string;
}

/**
 * OpenAI Structured Outputs(text.format.type = "json_schema", strict: true)用の
 * JSON Schema。additionalProperties: falseで、定義したフィールド以外をモデルが
 * 出力できないようにし、配列・文字列にも上限を設けている。
 */
export const AI_ROUTE_PREFERENCES_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    avoidHighways: { type: "boolean" },
    preferScenicRoads: { type: "boolean" },
    preferCoastalRoads: { type: "boolean" },
    preferMountainRoads: { type: "boolean" },
    preferredScenery: {
      type: "array",
      items: { type: "string", enum: [...PREFERRED_SCENERY_OPTIONS] },
      maxItems: PREFERRED_SCENERY_OPTIONS.length,
    },
    desiredStops: {
      type: "array",
      items: { type: "string", enum: [...DESIRED_STOP_OPTIONS] },
      maxItems: DESIRED_STOP_OPTIONS.length,
    },
    drivingStyle: { type: "string", enum: [...DRIVING_STYLE_OPTIONS] },
    interpretationSummary: { type: "string", maxLength: MAX_INTERPRETATION_SUMMARY_LENGTH },
    requestedAreaQuery: { type: "string", maxLength: MAX_REQUESTED_AREA_QUERY_LENGTH },
    suggestedGoalQuery: { type: "string", maxLength: MAX_REQUESTED_AREA_QUERY_LENGTH },
    suggestedGoalQueryAlt1: { type: "string", maxLength: MAX_REQUESTED_AREA_QUERY_LENGTH },
    suggestedGoalQueryAlt2: { type: "string", maxLength: MAX_REQUESTED_AREA_QUERY_LENGTH },
  },
  required: [
    "avoidHighways",
    "preferScenicRoads",
    "preferCoastalRoads",
    "preferMountainRoads",
    "preferredScenery",
    "desiredStops",
    "drivingStyle",
    "interpretationSummary",
    "requestedAreaQuery",
    "suggestedGoalQuery",
    "suggestedGoalQueryAlt1",
    "suggestedGoalQueryAlt2",
  ],
} as const;

/**
 * AI呼び出しの失敗分類。ログラベルへそのまま対応させる
 * (timeout→ai_call_timeout, rate_limited→ai_call_rate_limited,
 *  server_error/client_error→ai_call_server_error, invalid_response→ai_output_invalid,
 *  budget_exceeded→ai_budget_exceeded)。
 * budget_exceededは、OpenAIへの各fetch試行の直前に行う予算チェックが
 * 通らなかった場合(そのfetchは送らない)を表す。
 */
export type AiFailureReason =
  | "timeout"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "invalid_response"
  | "budget_exceeded";

export type AiProviderOutcome =
  | { ok: true; preferences: AiRoutePreferences }
  | { ok: false; reason: AiFailureReason };

/**
 * プロバイダーへ渡してよい最小の入力。既存のAiRoutePlanningRequest(Gatewayの
 * リクエストschema)と同じ形で、緯度経度・住所・保存場所・GPS履歴などは
 * そもそもこの型に存在しない。
 */
export interface AiProviderInput {
  moods: string[];
  detourLevel?: string;
  availableTimeMinutes?: number;
  returnTarget?: string;
  hasFinalDestination: boolean;
  viaPointCount: number;
  returnDeadline?: string;
  aiNote: string;
  /** クライアント側で現在日付から機械的に算出した季節('春'|'夏'|'秋'|'冬')。天気・開花等の実況情報ではない。 */
  seasonHint?: string;
  /** 最終地点「おまかせ」が選ばれている場合のみtrue。trueの場合のみsuggestedGoalQueryを埋めてよい。 */
  wantsAiSuggestedDestination: boolean;
}

/** AI Gateway(index.ts)が呼び出す、プロバイダー非依存のインターフェース。 */
export interface AiProvider {
  interpret(input: AiProviderInput): Promise<AiProviderOutcome>;
}

/**
 * OpenAIのStructured Outputsを使った後も、アプリ側では応答を信頼せず、
 * 実行時に改めてこのschemaへ厳密に照合する(型だけでなく値の実検証)。
 * 不正なら null を返し、その内容をそのまま呼び出し元へ渡さないようにする。
 */
export function validateAiRoutePreferences(value: unknown): AiRoutePreferences | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;

  const allowedKeys = new Set([
    "avoidHighways",
    "preferScenicRoads",
    "preferCoastalRoads",
    "preferMountainRoads",
    "preferredScenery",
    "desiredStops",
    "drivingStyle",
    "interpretationSummary",
    "requestedAreaQuery",
    "suggestedGoalQuery",
    "suggestedGoalQueryAlt1",
    "suggestedGoalQueryAlt2",
  ]);
  if (!Object.keys(record).every((key) => allowedKeys.has(key))) {
    return null;
  }

  const booleanKeys = [
    "avoidHighways",
    "preferScenicRoads",
    "preferCoastalRoads",
    "preferMountainRoads",
  ] as const;
  for (const key of booleanKeys) {
    if (typeof record[key] !== "boolean") {
      return null;
    }
  }

  if (
    !Array.isArray(record.preferredScenery) ||
    record.preferredScenery.length > PREFERRED_SCENERY_OPTIONS.length ||
    !record.preferredScenery.every(
      (value_): value_ is PreferredScenery =>
        typeof value_ === "string" && (PREFERRED_SCENERY_OPTIONS as readonly string[]).includes(value_)
    )
  ) {
    return null;
  }

  if (
    !Array.isArray(record.desiredStops) ||
    record.desiredStops.length > DESIRED_STOP_OPTIONS.length ||
    !record.desiredStops.every(
      (value_): value_ is DesiredStop =>
        typeof value_ === "string" && (DESIRED_STOP_OPTIONS as readonly string[]).includes(value_)
    )
  ) {
    return null;
  }

  if (
    typeof record.drivingStyle !== "string" ||
    !(DRIVING_STYLE_OPTIONS as readonly string[]).includes(record.drivingStyle)
  ) {
    return null;
  }

  if (
    typeof record.interpretationSummary !== "string" ||
    record.interpretationSummary.length === 0 ||
    record.interpretationSummary.length > MAX_INTERPRETATION_SUMMARY_LENGTH
  ) {
    return null;
  }

  if (
    typeof record.requestedAreaQuery !== "string" ||
    record.requestedAreaQuery.length > MAX_REQUESTED_AREA_QUERY_LENGTH
  ) {
    return null;
  }
  const trimmedAreaQuery = record.requestedAreaQuery.trim();
  const requestedAreaQuery = trimmedAreaQuery === "none" ? "" : trimmedAreaQuery;

  if (
    typeof record.suggestedGoalQuery !== "string" ||
    record.suggestedGoalQuery.length > MAX_REQUESTED_AREA_QUERY_LENGTH
  ) {
    return null;
  }
  const trimmedGoalQuery = record.suggestedGoalQuery.trim();
  const suggestedGoalQuery = trimmedGoalQuery === "none" ? "" : trimmedGoalQuery;

  if (
    typeof record.suggestedGoalQueryAlt1 !== "string" ||
    record.suggestedGoalQueryAlt1.length > MAX_REQUESTED_AREA_QUERY_LENGTH
  ) {
    return null;
  }
  const trimmedGoalQueryAlt1 = record.suggestedGoalQueryAlt1.trim();
  const suggestedGoalQueryAlt1 = trimmedGoalQueryAlt1 === "none" ? "" : trimmedGoalQueryAlt1;

  if (
    typeof record.suggestedGoalQueryAlt2 !== "string" ||
    record.suggestedGoalQueryAlt2.length > MAX_REQUESTED_AREA_QUERY_LENGTH
  ) {
    return null;
  }
  const trimmedGoalQueryAlt2 = record.suggestedGoalQueryAlt2.trim();
  const suggestedGoalQueryAlt2 = trimmedGoalQueryAlt2 === "none" ? "" : trimmedGoalQueryAlt2;

  return {
    avoidHighways: record.avoidHighways as boolean,
    preferScenicRoads: record.preferScenicRoads as boolean,
    preferCoastalRoads: record.preferCoastalRoads as boolean,
    preferMountainRoads: record.preferMountainRoads as boolean,
    preferredScenery: record.preferredScenery as PreferredScenery[],
    desiredStops: record.desiredStops as DesiredStop[],
    drivingStyle: record.drivingStyle as DrivingStyle,
    interpretationSummary: record.interpretationSummary,
    requestedAreaQuery,
    suggestedGoalQuery,
    suggestedGoalQueryAlt1,
    suggestedGoalQueryAlt2,
  };
}
