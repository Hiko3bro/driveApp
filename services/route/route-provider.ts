import type { DriveConditions } from '@/types/drive';
import type { DepartureSelection } from '@/types/location';
import type { RouteOption } from '@/types/route';

export class RoutePlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutePlanningError';
  }
}

export interface RouteSearchParams {
  departure: DepartureSelection;
  conditions: DriveConditions;
}

/**
 * ルート提案の取得口。実装はモック(MockRouteProvider)と、将来の
 * Google Routes API連携(GoogleRoutesProvider)とで差し替えられるようにする。
 */
export interface RouteProvider {
  getRoutes(params: RouteSearchParams): Promise<RouteOption[]>;
}
