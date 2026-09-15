import { MockRouteProvider } from '@/services/route/mock-route-provider';
import type { RouteProvider } from '@/services/route/route-provider';

export { RoutePlanningError } from '@/services/route/route-provider';
export type { RouteProvider, RouteSearchParams } from '@/services/route/route-provider';

/**
 * テスト・デモ用のモックルート取得口。本番のplanning flow(app/conditions.tsx)は
 * 実際の道路データを使うdrive-route-planner(services/route/drive-route-planner-client.ts)
 * を直接使い、このMockRouteProviderは呼ばない。
 */
export function getRouteProvider(): RouteProvider {
  return new MockRouteProvider();
}
