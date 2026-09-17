import type { Coordinates } from '@/types/location';

export interface RouteWaypoint {
  name: string;
  coordinates: Coordinates;
}

/**
 * ルート自体を変えるほどではない(=基本ルートがほぼ同じ)実在スポット。別ルートとして
 * 水増しする代わりに、このルートの「近くのおすすめ」として提示する
 * (Route diversityとOptional spot diversityの分離)。
 */
export interface RouteNearbySuggestion {
  id: string;
  name: string;
  coordinates: Coordinates;
  primaryType: string | null;
  /** このスポットへ寄った場合の、このルートの所要時間からの増加分(分、整数)。 */
  addedMinutes: number;
}

export interface RouteOption {
  id: string;
  name: string;
  description: string;
  distanceKm: number;
  durationMinutes: number;
  tags: string[];
  waypoints: RouteWaypoint[];
  /** 地図表示用の経路座標列(出発地点〜目的地まで)。 */
  path: Coordinates[];
  /** おすすめ理由。 */
  highlight: string;
  /** どんな人向けのルートかを表す短い説明。 */
  audience: string;
  /** ルートの出どころ。'google'はGoogle Routes API由来の実ルート、'mock'は演出用の仮ルート。未指定は'mock'相当として扱う。 */
  source?: 'mock' | 'google';
  /** drive-route-plannerがこのプランを成立させるために提案した、実在の経由地点(あれば)。 */
  suggestedPlace?: {
    id: string;
    name: string;
    coordinates: Coordinates;
    primaryType: string | null;
  };
  /** 時間超過など、簡潔な注意書き。問題が無ければundefined/null。 */
  warning?: string | null;
  /** 比較用の目安時間(分)。drive-route-planner経由のプランにのみ設定される。 */
  targetDurationMinutes?: number;
  /** このルートの実測にavoidHighwaysが適用されたかどうか(外部ナビURL組み立て用)。 */
  avoidHighwaysApplied?: boolean;
  /** このルートの近くにある、別ルートにするほどではない実在スポット(あれば)。 */
  nearbySuggestions?: RouteNearbySuggestion[];
  /** UI文言選択用(例:「海沿いを通りやすいコース」)。現状'coastal'のみ。 */
  corridorTheme?: 'coastal';
}
