import { isValidCoordinates } from '@/services/location/coordinates';
import { resolveEffectiveTimeBudget } from '@/services/route/time-budget';
import type { DriveConditions } from '@/types/drive';
import type { Coordinates } from '@/types/location';
import type { RouteOption } from '@/types/route';
import { MAX_SELECTED_SPOTS, type Spot, type SpotRoutePlan } from '@/types/spot';

export class SpotRoutePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotRoutePlanError';
  }
}

function buildUpdatedPath(routePath: Coordinates[], spots: Spot[]): Coordinates[] {
  const validRoutePath = routePath.filter(isValidCoordinates);
  if (validRoutePath.length === 0) {
    throw new SpotRoutePlanError('ルートの地図情報を確認できませんでした。ルートを選び直してください。');
  }

  const insertionIndex = Math.max(1, validRoutePath.length - 1);
  return [
    ...validRoutePath.slice(0, insertionIndex),
    ...spots.map((spot) => spot.coordinates),
    ...validRoutePath.slice(insertionIndex),
  ];
}

/** 選択順のスポットを加えた距離・時間・表示経路をモックで再計算する。 */
export function calculateSpotRoutePlan(
  route: RouteOption,
  spots: Spot[],
  conditions: DriveConditions,
  now = new Date()
): SpotRoutePlan {
  if (
    !Number.isFinite(route.distanceKm) ||
    route.distanceKm < 0 ||
    !Number.isFinite(route.durationMinutes) ||
    route.durationMinutes < 0
  ) {
    throw new SpotRoutePlanError('ルートの距離または時間を確認できませんでした。ルートを選び直してください。');
  }
  if (spots.length > MAX_SELECTED_SPOTS) {
    throw new SpotRoutePlanError(`経由地は最大${MAX_SELECTED_SPOTS}件まで追加できます。`);
  }

  const ids = spots.map((spot) => spot.id);
  if (new Set(ids).size !== ids.length) {
    throw new SpotRoutePlanError('同じスポットを重複して追加することはできません。');
  }
  if (
    spots.some(
      (spot) =>
        !spot.isMock ||
        !isValidCoordinates(spot.coordinates) ||
        !Number.isFinite(spot.extraMinutes) ||
        spot.extraMinutes < 0 ||
        !Number.isFinite(spot.extraDistanceKm) ||
        spot.extraDistanceKm < 0
    )
  ) {
    throw new SpotRoutePlanError('スポット情報を確認できませんでした。スポットを選び直してください。');
  }

  const durationMinutes = route.durationMinutes + spots.reduce((sum, spot) => sum + spot.extraMinutes, 0);
  const distanceKm = route.distanceKm + spots.reduce((sum, spot) => sum + spot.extraDistanceKm, 0);
  const budget = resolveEffectiveTimeBudget(conditions, now);
  const isWithinBudget = budget.ok && durationMinutes <= budget.minutes;
  const budgetMessage = budget.ok
    ? isWithinBudget
      ? null
      : `このスポットを追加すると約${durationMinutes}分となり、時間予算の${budget.minutes}分を超えます。別のスポットを選んでください。`
    : budget.message;

  return {
    routeId: route.id,
    selectedSpotIds: ids,
    distanceKm: Math.round(distanceKm * 10) / 10,
    durationMinutes: Math.ceil(durationMinutes),
    timeBudgetMinutes: budget.ok ? budget.minutes : null,
    isWithinBudget,
    budgetMessage,
    path: buildUpdatedPath(route.path, spots),
  };
}
