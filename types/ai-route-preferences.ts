/**
 * Supabase Edge Function `ai-route-planning` が返す `AiRoutePreferences` の
 * クライアント側の型定義。Edge Function側(supabase/functions/ai-route-planning/ai-types.ts)
 * はDeno環境でアプリのtsconfigに含まれないため、この型は手動で同期させる。
 * フィールドを変更する場合は両方を必ず一緒に更新すること。
 */

export const PREFERRED_SCENERY_OPTIONS = ['ocean', 'mountain', 'night_view', 'city', 'nature'] as const;
export const DESIRED_STOP_OPTIONS = ['restaurant', 'cafe', 'scenic', 'onsen', 'activity'] as const;
export const DRIVING_STYLE_OPTIONS = ['relaxed', 'balanced', 'driving_focused'] as const;

export type PreferredScenery = (typeof PREFERRED_SCENERY_OPTIONS)[number];
export type DesiredStop = (typeof DESIRED_STOP_OPTIONS)[number];
export type DrivingStyle = (typeof DRIVING_STYLE_OPTIONS)[number];

/**
 * AIがユーザーの自由記述から解釈したドライブの嗜好。緯度経度・住所・実在/架空の
 * 道路名や店舗名は含まれない(Edge Function側でそもそも生成させていない)。
 */
export interface AiRoutePreferences {
  avoidHighways: boolean;
  preferScenicRoads: boolean;
  preferCoastalRoads: boolean;
  preferMountainRoads: boolean;
  preferredScenery: PreferredScenery[];
  desiredStops: DesiredStop[];
  drivingStyle: DrivingStyle;
  interpretationSummary: string;
  /** 自由記述に含まれていた強い地理的希望の検索クエリ(例: "生駒山")。無ければ空文字列。 */
  requestedAreaQuery: string;
  /** 最終地点「おまかせ」の場合のみ、AIが考えた立ち寄り先のタイプの検索クエリ(例: "夜景スポット")。無ければ空文字列。 */
  suggestedGoalQuery: string;
  /** suggestedGoalQueryとは体験の異なる2つ目の候補。無ければ空文字列。 */
  suggestedGoalQueryAlt1: string;
  /** 3つ目の候補。無ければ空文字列。 */
  suggestedGoalQueryAlt2: string;
}

/** AI解釈が実際に使われたか、サーバー側で安全側にフォールバックされたか。 */
export interface AiInterpretationResult {
  aiUsed: boolean;
  fallback: boolean;
  preferences: AiRoutePreferences;
}
