import type { Coordinates } from '@/types/location';

export type SpotCategory = '絶景' | 'カフェ' | 'グルメ' | '休憩' | '穴場';

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
