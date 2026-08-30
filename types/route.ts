import type { Coordinates } from '@/types/location';

export interface RouteWaypoint {
  name: string;
  coordinates: Coordinates;
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
}
