import { computeGoogleRoute } from '@/services/route/google-routes-client';
import { decodeGooglePolyline } from '@/services/route/polyline';
import { resolveEffectiveTimeBudget } from '@/services/route/time-budget';
import type { DriveConditions } from '@/types/drive';
import type { Coordinates } from '@/types/location';
import type { RouteOption } from '@/types/route';
import type { Spot, SpotRoutePlan } from '@/types/spot';

/**
 * 選択した寄り道スポットを追加した後の距離・時間・Polylineを、
 * services/spot/spot-route-plan.ts(Haversineの見積もり)ではなく、
 * 既存のdeploy済みEdge Function `google-routes` を使って実際の道路データで再計算する。
 * ExpoからGoogle Routes APIを直接呼び出すことはない(google-routes-client.ts経由)。
 *
 * waypoint順は origin → userViaPoints → suggestedPlace → selectedSpots → destination
 * (ループの場合はdestination=origin)。この順序は、Google Mapsの外部ナビへ渡す
 * waypoint順(app/route-plan.tsxのnavWaypoints)と必ず一致させること。
 */

export type SpotRouteRecalculationFailureReason =
  | 'config_missing'
  | 'network'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'no_route_found';

export type SpotRouteRecalculationOutcome =
  | { ok: true; plan: SpotRoutePlan }
  | { ok: false; reason: SpotRouteRecalculationFailureReason };

export interface SpotRouteRecalculationInput {
  route: RouteOption;
  /** 選択順のスポット(0件の場合は呼び出し不要、呼び出し元でrouteの実測値をそのまま使うこと)。 */
  spots: Spot[];
  conditions: DriveConditions;
  origin: Coordinates;
  /** ループ(出発地点に戻る)の場合はoriginと同じ座標を渡す。 */
  destination: Coordinates;
}

export async function recalculateSpotRouteWithGoogleRoutes(
  input: SpotRouteRecalculationInput,
  now = new Date()
): Promise<SpotRouteRecalculationOutcome> {
  const { route, spots, conditions, origin, destination } = input;

  const intermediates: Coordinates[] = [
    ...conditions.viaPoints.map((point) => point.coordinates),
    ...(route.suggestedPlace ? [route.suggestedPlace.coordinates] : []),
    ...spots.map((spot) => spot.coordinates),
  ];

  const outcome = await computeGoogleRoute({
    origin,
    destination,
    intermediates,
    avoidHighways: route.avoidHighwaysApplied,
  });

  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }

  const candidate = outcome.routes[0];
  if (!candidate) {
    return { ok: false, reason: 'no_route_found' };
  }

  const path = decodeGooglePolyline(candidate.encodedPolyline);
  if (path.length < 2) {
    return { ok: false, reason: 'invalid_response' };
  }

  const distanceKm = Math.round((candidate.distanceMeters / 1000) * 10) / 10;
  const durationMinutes = Math.max(1, Math.ceil(candidate.durationSeconds / 60));
  const budget = resolveEffectiveTimeBudget(conditions, now);
  // budget.minutesがundefined(=時間指定なし)の場合は、超過しようのない状態として扱う。
  const isWithinBudget = budget.ok && (budget.minutes === undefined || durationMinutes <= budget.minutes);
  // 時間予算超過はブロックせず警告のみに使う(呼び出し元は常に決定・ナビ操作を続行可能にすること)。
  let budgetMessage: string | null;
  if (!budget.ok) {
    budgetMessage = budget.message;
  } else if (budget.minutes === undefined || isWithinBudget) {
    budgetMessage = null;
  } else {
    budgetMessage = `この寄り道をすると目安時間を約${durationMinutes - budget.minutes}分超えそうです。`;
  }

  return {
    ok: true,
    plan: {
      routeId: route.id,
      selectedSpotIds: spots.map((spot) => spot.id),
      distanceKm,
      durationMinutes,
      timeBudgetMinutes: budget.ok ? budget.minutes ?? null : null,
      isWithinBudget,
      budgetMessage,
      path,
    },
  };
}
