import { MockRouteProvider } from '@/services/route/mock-route-provider';
import type { RouteProvider } from '@/services/route/route-provider';

export { RoutePlanningError } from '@/services/route/route-provider';
export type { RouteProvider, RouteSearchParams } from '@/services/route/route-provider';

/**
 * ルート提案の取得方法をここで切り替える。
 * Google Routes API等の有料APIを導入する際は、ここを
 * `new GoogleRoutesProvider()` に差し替える。
 */
export function getRouteProvider(): RouteProvider {
  return new MockRouteProvider();
}
