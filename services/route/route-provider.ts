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
 * テスト・デモ用のモックルート取得口(MockRouteProvider)。本番のplanning flowは
 * services/route/drive-route-planner-client.tsを直接使うため、この抽象化は経由しない。
 */
export interface RouteProvider {
  getRoutes(params: RouteSearchParams): Promise<RouteOption[]>;
}
