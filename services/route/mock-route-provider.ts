import {
  RoutePlanningError,
  type RouteProvider,
  type RouteSearchParams,
} from '@/services/route/route-provider';
import { resolveEffectiveTimeBudget } from '@/services/route/time-budget';
import { isValidCoordinates, normalizeGeneratedCoordinates } from '@/services/location/coordinates';
import { MOOD_LABELS, type DetourLevel, type DriveConditions, type Mood } from '@/types/drive';
import type { Coordinates, ViaPoint } from '@/types/location';
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

/** 解決済みの1ルート案の設計図。conditions(気分・寄り道量)から都度組み立てる。 */
interface RouteArchetype {
  id: string;
  name: string;
  description: string;
  highlight: string;
  tags: string[];
  /** どんな人向けのルートかを表す短い説明。 */
  audience: string;
  averageSpeedKmH: number;
  legs: RouteLeg[];
  /** 有効時間予算のうち、このルートが使う割合。 */
  budgetUsageRatio: number;
}

interface RouteGeometry {
  waypoints: RouteWaypoint[];
  path: Coordinates[];
  distanceKm: number;
  durationMinutes: number;
}

const MOOD_SPOT_NAME: Record<Mood, string> = {
  scenic: '見晴らしの丘',
  coastal: '海沿いの絶景ポイント',
  mountain: '山あいの展望台',
  nightDrive: '夜景スポット',
  leisurely: 'のんびり過ごせる休憩処',
  detourRich: '気になる寄り道スポット',
  driveFocused: '走りごたえのある道',
  omakase: 'おすすめスポット',
};
const DEFAULT_SPOT_NAME = '気になるスポット';

const SCENIC_LEGS: RouteLeg[] = [
  { bearing: 25, distanceKm: 1, name: '眺めの良い道' },
  { bearing: 70, distanceKm: 1, name: '景色ポイント' },
  { bearing: 130, distanceKm: 1, name: '展望スポット' },
];

const BALANCED_LEG_PATTERNS: Record<DetourLevel, RouteLeg[]> = {
  few: [
    { bearing: 40, distanceKm: 1, name: '寄り道ポイントA' },
    { bearing: -30, distanceKm: 1, name: '寄り道ポイントB' },
  ],
  normal: [
    { bearing: 40, distanceKm: 0.9, name: '寄り道ポイントA' },
    { bearing: -30, distanceKm: 0.9, name: '寄り道ポイントB' },
    { bearing: 90, distanceKm: 0.9, name: '寄り道ポイントC' },
  ],
  many: [
    { bearing: 60, distanceKm: 0.8, name: '寄り道スポットA' },
    { bearing: -20, distanceKm: 0.8, name: '寄り道スポットB' },
    { bearing: 80, distanceKm: 0.8, name: '寄り道スポットC' },
    { bearing: -40, distanceKm: 0.8, name: '寄り道スポットD' },
  ],
};

const DRIVE_FOCUSED_LEGS: RouteLeg[] = [{ bearing: 85, distanceKm: 1, name: '走りごたえのある区間' }];
const EASYGOING_LEGS: RouteLeg[] = [{ bearing: 100, distanceKm: 0.6, name: 'のんびりスポット' }];

/** 経由したい場所(先頭1件)を「◯◯経由」のような一言に変換する。ジオメトリ自体は変えない、表示専用の差別化材料。 */
function viaPointsHighlightSuffix(viaPoints: ViaPoint[]): string {
  if (viaPoints.length === 0) {
    return '';
  }
  const [first] = viaPoints;
  return viaPoints.length > 1
    ? ` ${first.label}など、経由したい場所にも寄れるよう考えています。`
    : ` ${first.label}にも寄れるよう考えています。`;
}

/** 選んだ「今日の気分」の1つ目を代表スポット名に反映する。未選択時は汎用の名前を使う。 */
function primarySpotName(moods: Mood[]): string {
  const primary = moods[0];
  return primary ? MOOD_SPOT_NAME[primary] : DEFAULT_SPOT_NAME;
}

/** 選んだ気分をタグへ変換する。重複や既に使ったタグ(exclude)は除き、最大2件まで。 */
function extraMoodTags(moods: Mood[], exclude: Mood[]): string[] {
  const tags: string[] = [];
  for (const mood of moods) {
    if (exclude.includes(mood)) {
      continue;
    }
    const label = MOOD_LABELS[mood];
    if (!tags.includes(label)) {
      tags.push(label);
    }
    if (tags.length >= 2) {
      break;
    }
  }
  return tags;
}

/** 「のんびり」を選んでいれば控えめに、「とにかく走りたい」を選んでいれば速めにペースを調整する。 */
function paceAdjustedSpeedKmH(baseSpeedKmH: number, moods: Mood[]): number {
  const delta = (moods.includes('leisurely') ? -4 : 0) + (moods.includes('driveFocused') ? 4 : 0);
  return Math.max(12, baseSpeedKmH + delta);
}

/**
 * 「今日の気分」「寄り道の量」から、地図上で違いが分かる3ルート分の設計図を組み立てる。
 * 3案の役割(景色重視/バランス/3案目)は固定し、中身(速さ・寄り道の数・文言)を
 * 選んだ条件に応じて変える。
 */
function buildArchetypes(conditions: DriveConditions): RouteArchetype[] {
  const { moods, detourLevel, viaPoints } = conditions;
  const spotName = primarySpotName(moods);
  const sharedBudgetUsage = DETOUR_LEVEL_BUDGET_USAGE[detourLevel];
  const viaSuffix = viaPointsHighlightSuffix(viaPoints);

  const scenic: RouteArchetype = {
    id: 'scenic',
    name: '景色重視ルート',
    description: '遠回りでも、道中の景色を楽しめることを優先したルートです。',
    highlight: `${spotName}を通る、見晴らしの良い道を選びました。${viaSuffix}`,
    tags: ['景色重視', ...extraMoodTags(moods, ['scenic'])],
    audience: '景色を眺めながらゆったり走りたい人向け',
    averageSpeedKmH: paceAdjustedSpeedKmH(25, moods),
    legs: SCENIC_LEGS,
    budgetUsageRatio: sharedBudgetUsage,
  };

  const balanced: RouteArchetype = {
    id: 'balanced',
    name: 'バランスルート',
    description: '景色・寄り道・移動時間のバランスを取った、迷ったときに選びやすいルートです。',
    highlight: `${spotName}も含め、寄り道と移動時間のバランスを取りました。${viaSuffix}`,
    tags: ['バランス', ...extraMoodTags(moods, [])],
    audience: '欲張らずバランスよく楽しみたい人向け',
    averageSpeedKmH: paceAdjustedSpeedKmH(27, moods),
    legs: BALANCED_LEG_PATTERNS[detourLevel],
    budgetUsageRatio: sharedBudgetUsage,
  };

  const thirdSlot: RouteArchetype = moods.includes('driveFocused')
    ? {
        id: 'drive-focused',
        name: 'たっぷり走るルート',
        description: '寄り道は控えめに、走ること自体をしっかり楽しめるルートです。',
        highlight: `走りごたえのある道を選び、ドライブの時間そのものを長く取りました。${viaSuffix}`,
        tags: ['走行重視', '効率よく移動'],
        audience: 'とにかくたくさん走りたい人向け',
        averageSpeedKmH: 32,
        legs: DRIVE_FOCUSED_LEGS,
        budgetUsageRatio: 0.95,
      }
    : {
        id: 'easygoing',
        name: 'のんびりルート',
        description: '急がず、ゆったりとしたペースで走ることを優先したルートです。',
        highlight: `${spotName}の近くを、のんびりしたペースで走ります。${viaSuffix}`,
        tags: ['のんびり', ...extraMoodTags(moods, ['leisurely'])],
        audience: '急がずゆったり過ごしたい人向け',
        averageSpeedKmH: 18,
        legs: EASYGOING_LEGS,
        budgetUsageRatio: 0.9,
      };

  return [scenic, balanced, thirdSlot];
}

function effectiveTimeBudgetMinutes(params: RouteSearchParams, now = new Date()): number {
  const result = resolveEffectiveTimeBudget(params.conditions, now);
  if (!result.ok) {
    throw new RoutePlanningError(result.message);
  }
  return result.minutes;
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
  } else if (conditions.finalDestination && isValidCoordinates(conditions.finalDestination.coordinates)) {
    const destination = conditions.finalDestination.coordinates;
    waypoints.push({ name: conditions.finalDestination.label, coordinates: destination });
    path.push(destination);
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
  const { departure } = params;
  if (!isValidCoordinates(departure.coordinates)) {
    throw new RoutePlanningError('出発地点を確認できませんでした。出発地点を選び直してください。');
  }
  const effectiveBudget = effectiveTimeBudgetMinutes(params);
  const routeBudget = Math.max(
    MIN_ROUTE_BUDGET_MINUTES,
    Math.floor(effectiveBudget * archetype.budgetUsageRatio)
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
    description: archetype.description,
    distanceKm: Math.round(geometry.distanceKm * 10) / 10,
    durationMinutes: geometry.durationMinutes,
    tags: archetype.tags,
    waypoints: geometry.waypoints,
    path: geometry.path,
    highlight: archetype.highlight,
    audience: archetype.audience,
  };
}

/**
 * 開発中に利用するモックのルート提案プロバイダー。
 * 出発地点とドライブ条件(今日の気分・寄り道の量など)から、地図上・体感で
 * 違いが分かる3ルート分のダミー座標を生成する。実際の道路形状とは一致しない。
 */
export class MockRouteProvider implements RouteProvider {
  async getRoutes(params: RouteSearchParams): Promise<RouteOption[]> {
    const archetypes = buildArchetypes(params.conditions);
    return archetypes.map((archetype) => buildRoute(archetype, params));
  }
}
