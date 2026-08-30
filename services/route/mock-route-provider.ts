import {
  RoutePlanningError,
  type RouteProvider,
  type RouteSearchParams,
} from '@/services/route/route-provider';
import { isValidCoordinates, normalizeGeneratedCoordinates } from '@/services/location/coordinates';
import type { AvailableTime, DetourLevel, Mood } from '@/types/drive';
import type { Coordinates } from '@/types/location';
import type { RouteOption, RouteWaypoint } from '@/types/route';

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 出発地点から指定した方角(度)・距離(km)だけ離れた座標を近似計算する。 */
function offsetCoordinate(base: Coordinates, bearingDeg: number, distanceKm: number): Coordinates {
  const bearingRad = toRad(bearingDeg);
  const latDeltaDeg = (distanceKm / 111) * Math.cos(bearingRad);
  const lngDeltaDeg =
    (distanceKm / (111 * Math.cos(toRad(base.latitude)) || 1)) * Math.sin(bearingRad);

  const generated = normalizeGeneratedCoordinates({
    latitude: base.latitude + latDeltaDeg,
    longitude: base.longitude + lngDeltaDeg,
  });

  // 有効な出発地点と有限の距離からは通常到達しないが、ネイティブ地図へ
  // 不正座標を渡さないため、計算不能時は直前の有効座標を維持する。
  return generated ?? { ...base };
}

function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pathDistanceKm(path: Coordinates[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineDistanceKm(path[i - 1], path[i]);
  }
  return total;
}

const AVAILABLE_TIME_MINUTES: Record<AvailableTime, number> = {
  '1h': 60,
  '2h': 120,
  '3h': 180,
  'half-day': 360,
};

const DETOUR_LEVEL_BUDGET_USAGE: Record<DetourLevel, number> = {
  few: 0.65,
  normal: 0.8,
  many: 0.95,
};

const MIN_ROUTE_BUDGET_MINUTES = 10;
const MIN_MEANINGFUL_ROUTE_KM = 0.1;
const SCALE_SEARCH_ITERATIONS = 36;

interface RouteLeg {
  bearing: number;
  distanceKm: number;
  name: string;
}

interface RouteArchetype {
  id: string;
  name: string;
  description: (mood: Mood) => string;
  highlight: (mood: Mood) => string;
  tags: (mood: Mood) => string[];
  averageSpeedKmH: number;
  legs: RouteLeg[];
}

interface RouteGeometry {
  waypoints: RouteWaypoint[];
  path: Coordinates[];
  distanceKm: number;
  durationMinutes: number;
}

const MOOD_SPOT_NAME: Record<Mood, string> = {
  view: '見晴らしの丘',
  sea: '海沿いの休憩ポイント',
  mountain: '山あいの展望台',
  cafe: '小さなカフェ',
  nightview: '夜景スポット',
  hidden: '地元の穴場',
  omakase: 'おすすめスポット',
};

const ROUTE_ARCHETYPES: RouteArchetype[] = [
  {
    id: 'scenic',
    name: '景色重視ルート',
    description: () => '遠回りでも、道中の景色を楽しめることを優先したルートです。',
    highlight: (mood) => `${MOOD_SPOT_NAME[mood]}を通る、見晴らしの良い道を選びました。`,
    tags: (mood) => ['景色重視', MOOD_SPOT_NAME[mood]],
    averageSpeedKmH: 25,
    legs: [
      { bearing: 25, distanceKm: 1, name: '眺めの良い道' },
      { bearing: 70, distanceKm: 1, name: '景色ポイント' },
      { bearing: 130, distanceKm: 1, name: '展望スポット' },
    ],
  },
  {
    id: 'detour',
    name: '寄り道重視ルート',
    description: () => '気になる場所に立ち寄りながら進む、寄り道多めのルートです。',
    highlight: (mood) => `${MOOD_SPOT_NAME[mood]}を含む、寄り道スポットを多めに配置しました。`,
    tags: (mood) => ['寄り道重視', MOOD_SPOT_NAME[mood]],
    averageSpeedKmH: 20,
    legs: [
      { bearing: 60, distanceKm: 0.8, name: '寄り道スポットA' },
      { bearing: -20, distanceKm: 0.8, name: '寄り道スポットB' },
      { bearing: 80, distanceKm: 0.8, name: '寄り道スポットC' },
      { bearing: -40, distanceKm: 0.8, name: '寄り道スポットD' },
    ],
  },
  {
    id: 'short',
    name: '短時間ルート',
    description: () => '無理なく戻れることを優先した、短時間で回れるルートです。',
    highlight: () => '移動時間を抑えつつ、要所だけを効率よく回れます。',
    tags: () => ['短時間', '効率重視'],
    averageSpeedKmH: 35,
    legs: [{ bearing: 85, distanceKm: 1, name: '立ち寄りスポット' }],
  },
];

function minutesUntilDeadline(deadline: string, now: Date): number {
  const match = /^(\d{2}):(\d{2})$/.exec(deadline);
  if (!match) {
    throw new RoutePlanningError('帰着時刻を確認できませんでした。時刻を選び直してください。');
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new RoutePlanningError('帰着時刻を確認できませんでした。時刻を選び直してください。');
  }

  const deadlineAt = new Date(now);
  deadlineAt.setHours(hours, minutes, 0, 0);
  return Math.floor((deadlineAt.getTime() - now.getTime()) / 60_000);
}

function effectiveTimeBudgetMinutes(params: RouteSearchParams, now = new Date()): number {
  const availableMinutes = AVAILABLE_TIME_MINUTES[params.conditions.availableTime];
  const deadline = params.conditions.returnDeadline;
  if (!deadline) {
    return availableMinutes;
  }

  const deadlineMinutes = minutesUntilDeadline(deadline, now);
  if (deadlineMinutes <= 0) {
    throw new RoutePlanningError('選択した帰着時刻はすでに過ぎています。条件を変更してください。');
  }

  const effectiveMinutes = Math.min(availableMinutes, deadlineMinutes);
  if (effectiveMinutes < MIN_ROUTE_BUDGET_MINUTES) {
    throw new RoutePlanningError('帰着時刻までの時間が短すぎます。使える時間か帰着時刻を変更してください。');
  }
  return effectiveMinutes;
}

function createGeometry(
  archetype: RouteArchetype,
  params: RouteSearchParams,
  legScaleKm: number
): RouteGeometry {
  const { departure, conditions } = params;
  const waypoints: RouteWaypoint[] = [];
  const path: Coordinates[] = [departure.coordinates];
  let current = departure.coordinates;

  archetype.legs.forEach((leg) => {
    const next = offsetCoordinate(current, leg.bearing, leg.distanceKm * legScaleKm);
    waypoints.push({ name: leg.name, coordinates: next });
    path.push(next);
    current = next;
  });

  if (conditions.returnTarget === 'same-as-departure') {
    path.push(departure.coordinates);
  } else {
    const destination = offsetCoordinate(current, 0, 0.5 * legScaleKm);
    waypoints.push({ name: '到着地点', coordinates: destination });
    path.push(destination);
  }

  const distanceKm = pathDistanceKm(path);
  return {
    waypoints,
    path,
    distanceKm,
    durationMinutes: Math.max(10, Math.ceil((distanceKm / archetype.averageSpeedKmH) * 60)),
  };
}

function buildRoute(
  archetype: RouteArchetype,
  params: RouteSearchParams
): RouteOption {
  const { departure, conditions } = params;
  if (!isValidCoordinates(departure.coordinates)) {
    throw new RoutePlanningError('出発地点を確認できませんでした。出発地点を選び直してください。');
  }
  const effectiveBudget = effectiveTimeBudgetMinutes(params);
  const routeBudget = Math.max(
    MIN_ROUTE_BUDGET_MINUTES,
    Math.floor(effectiveBudget * DETOUR_LEVEL_BUDGET_USAGE[conditions.detourLevel])
  );
  const maximumDistanceKm = (archetype.averageSpeedKmH * routeBudget) / 60;

  // 各legへ予算全体を掛けず、帰路を含む完成経路が時間内に収まる最大縮尺を二分探索する。
  let lowerScale = 0;
  let upperScale = maximumDistanceKm;
  let geometry = createGeometry(archetype, params, lowerScale);
  for (let i = 0; i < SCALE_SEARCH_ITERATIONS; i += 1) {
    const candidateScale = (lowerScale + upperScale) / 2;
    const candidate = createGeometry(archetype, params, candidateScale);
    if (candidate.durationMinutes <= routeBudget) {
      lowerScale = candidateScale;
      geometry = candidate;
    } else {
      upperScale = candidateScale;
    }
  }

  if (geometry.distanceKm < MIN_MEANINGFUL_ROUTE_KM || geometry.durationMinutes > effectiveBudget) {
    throw new RoutePlanningError('選択した条件では安全なルートを作れません。条件を変更してください。');
  }

  return {
    id: archetype.id,
    name: archetype.name,
    description: archetype.description(conditions.mood),
    distanceKm: Math.round(geometry.distanceKm * 10) / 10,
    durationMinutes: geometry.durationMinutes,
    tags: archetype.tags(conditions.mood),
    waypoints: geometry.waypoints,
    path: geometry.path,
    highlight: archetype.highlight(conditions.mood),
  };
}

/**
 * 開発中に利用するモックのルート提案プロバイダー。
 * 出発地点とドライブ条件から、地図上で違いが分かる3ルート分の
 * ダミー座標を生成する。実際の道路形状とは一致しない。
 */
export class MockRouteProvider implements RouteProvider {
  async getRoutes(params: RouteSearchParams): Promise<RouteOption[]> {
    return ROUTE_ARCHETYPES.map((archetype) => buildRoute(archetype, params));
  }
}
