import type { Coordinates } from '@/types/location';
import type { PlacePhotoRef } from '@/services/spot/google-places-client';

/**
 * '歴史'・'市場'はドライブ計画(気になる場所・区間探索)のために追加したカテゴリで、
 * 今すぐドライブのSpot Discovery画面(SPOT_BROWSE_FILTERS)には含めていない
 * (今すぐドライブ側のカテゴリチップ表示は変更しない)。
 */
export type SpotCategory = 'ごはん' | 'カフェ' | '絶景' | '温泉' | 'アクティビティ' | '歴史' | '市場';

/** スポット探索画面のカテゴリ切り替え用。「おすすめ」は絞り込まず全カテゴリから表示する特別な値。 */
export type SpotBrowseFilter = 'おすすめ' | SpotCategory;

/** 今すぐドライブ(Spot Discovery)のカテゴリチップ。既存の5種のまま変更しない。 */
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
  /** true: テスト・デモ用のモックデータ。false: Google Placesが返した実在スポット。 */
  isMock: boolean;
  /** 先頭1枚分の写真参照のみ。写真が無い/モックデータはnull。 */
  photoRef: PlacePhotoRef | null;
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
