import type { Coordinates } from '@/types/location';

export type SpotCategory = 'ごはん' | 'カフェ' | '絶景' | '温泉' | 'アクティビティ';

/** スポット探索画面のカテゴリ切り替え用。「おすすめ」は絞り込まず全カテゴリから表示する特別な値。 */
export type SpotBrowseFilter = 'おすすめ' | SpotCategory;

export const SPOT_BROWSE_FILTERS: SpotBrowseFilter[] = [
  'おすすめ',
  'ごはん',
  'カフェ',
  '絶景',
  '温泉',
  'アクティビティ',
];

export interface Spot {
  id: string;
  name: string;
  category: SpotCategory;
  description: string;
  extraMinutes: number;
  extraDistanceKm: number;
  coordinates: Coordinates;
  recommendation: string;
  /** 外部の実在スポットではなく、安全なモックデータであることを示す。 */
  isMock: true;
}

export interface SpotRoutePlan {
  routeId: string;
  selectedSpotIds: string[];
  distanceKm: number;
  durationMinutes: number;
  timeBudgetMinutes: number | null;
  isWithinBudget: boolean;
  budgetMessage: string | null;
  path: Coordinates[];
}

export const MAX_SELECTED_SPOTS = 3;
