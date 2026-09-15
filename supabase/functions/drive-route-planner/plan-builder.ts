/**
 * drive-route-planner の中心ロジック。既存の google-routes-provider.ts /
 * google-places-provider.ts を(HTTP経由ではなく)直接importして再利用し、
 * 「target-time anchor」方式でPlaces候補探索 → 事前フィルタ → Routes実測 →
 * 時間予算での評価(最大2ラウンドの適応的再探索) → 1〜3プランへの正規化までを
 * このファイル1つで行う。
 *
 * target-time anchor方式を採る理由: 単純な「center + 大きなradius + POPULARITY」
 * では、検索範囲内の近い人気スポットばかりが選ばれ、時間予算(例: 120分)に
 * 遠く及ばない短いルートになってしまう(実機確認で58/42/40分という結果になった
 * 問題)。そこで、目標時間に相当するおおよその距離だけ離れた地点(anchor)を
 * 複数方向に生成し、その周辺だけをrankPreference: DISTANCEで検索することで、
 * 「近くの人気スポット」ではなく「目標時間帯にある実在スポット」を探す。
 * anchor自体は座標計算だけの仮想点であり、Places検索のcenterとしてのみ使う
 * (candidateとして扱ったり、architecture外へ露出したりしない)。
 *
 * 重要な不変条件:
 * - ユーザー指定のuserViaPointsは、順序・件数を一切変更しない。候補地点は
 *   常にuserViaPointsの「後・目的地(または出発地点)の前」に1件だけ追加する。
 * - candidate placeは必ずGoogle Placesが返した実在の地点であり、かつ実際に
 *   その候補を含めてGoogle Routesへ投げたintermediatesの1つとして評価する
 *   (地図上のコメントだけに存在し、実際のルートを通らない状態を作らない)。
 * - Google API呼び出し(searchNearbyPlaces / computeRoutes)は既存providerを
 *   そのまま呼ぶため、Upstashレート制限・1日あたりの予算チェック
 *   (checkExternalApiBudget)はどちらも既存実装のまま自動的に適用される。
 * - 最終的な採否・並び順は、常に実際のGoogle Routes所要時間と時間予算との
 *   差(score)で決める。anchor・半径はあくまで検索範囲を絞るヒューリスティック。
 */
import { computeRoutes, type GoogleRoutesFailureReason } from "../google-routes/google-routes-provider.ts";
import type { RouteCandidate } from "../google-routes/route-types.ts";
import { searchNearbyPlaces } from "../google-places/google-places-provider.ts";
import type { PlaceCandidate, PlaceCategory } from "../google-places/place-types.ts";
import type { DrivePlanRequest, DrivePreferences, LatLng } from "./plan-types.ts";

// ===== 地理計算 =============================================================

const EARTH_RADIUS_METERS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 2点の緯度経度の単純平均。厳密な地図投影は求めない、簡易近似。 */
function midpoint(a: LatLng, b: LatLng): LatLng {
  return { latitude: (a.latitude + b.latitude) / 2, longitude: (a.longitude + b.longitude) / 2 };
}

/** fromからtoへの初期方位角(度、北0°・時計回り)。 */
function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLng = toRad(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * 起点から指定した方位角(度)・距離(メートル)だけ離れた地点を大圏距離で計算する
 * (架空の「場所」ではなく、Places検索のcenterとしてのみ使う仮想の座標)。
 */
function projectPoint(base: LatLng, bearingDeg: number, distanceMeters: number): LatLng {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearingRad = toRad(bearingDeg);
  const lat1 = toRad(base.latitude);
  const lng1 = toRad(base.longitude);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { latitude: toDeg(lat2), longitude: ((toDeg(lng2) + 540) % 360) - 180 };
}

// ===== カテゴリ選定(最大2件) ================================================

function selectCategories(preferences: DrivePreferences): PlaceCategory[] {
  const categories: PlaceCategory[] = [];

  if (preferences.desiredStops.length > 0) {
    // desiredStopsの値はplace-types.tsのPlaceCategoryと完全に同じ5値のenumのため、
    // そのままcategoryとして使える。
    categories.push(preferences.desiredStops[0] as PlaceCategory);
  }

  const wantsScenic =
    preferences.preferScenicRoads ||
    preferences.preferCoastalRoads ||
    preferences.preferMountainRoads ||
    preferences.preferredScenery.length > 0;

  if ((wantsScenic || categories.length === 0) && !categories.includes("scenic")) {
    categories.push("scenic");
  }

  return categories.slice(0, 2);
}

/**
 * 基本ルートだけで既に時間予算を超えている場合に、それでもPlaces候補探索を行う
 * だけの明確な希望があるかどうか。何も無ければ(=このデフォルトのscenicへの
 * フォールバックだけの状態では)、無理に寄り道せず基本ルートのみを返す。
 */
function hasExplorablePreference(preferences: DrivePreferences): boolean {
  return (
    preferences.desiredStops.length > 0 ||
    preferences.preferScenicRoads ||
    preferences.preferCoastalRoads ||
    preferences.preferMountainRoads ||
    preferences.preferredScenery.length > 0
  );
}

// ===== target-time anchor生成 ================================================

/** 「出発地点へ戻る」ケースのradial距離(メートル)。目標時間からのヒューリスティック。 */
function resolveLoopRadialMeters(targetMinutesForRadius: number): number {
  return clamp(targetMinutesForRadius * 300, 5_000, 45_000);
}

/** 「目的地あり」ケースの、直行区間からの左右オフセット距離(メートル)。 */
function resolveDestinationOffsetMeters(remainingMinutes: number): number {
  return clamp(remainingMinutes * 200, 3_000, 25_000);
}

const LOOP_ANCHOR_BEARINGS = [0, 120, 240];

/** origin(またはuserViaPoints最後の点)を中心に、複数方向へradial距離だけ離れたanchorを生成する。 */
function generateLoopAnchors(basePoint: LatLng, radialMeters: number, anchorCount: number): LatLng[] {
  return LOOP_ANCHOR_BEARINGS.slice(0, anchorCount).map((bearing) => projectPoint(basePoint, bearing, radialMeters));
}

/**
 * lastRequiredPoint→destinationの直行区間の中点から、進行方向に対して左右・および
 * さらに先(遠回り方向)へオフセットしたanchorを生成する。
 */
function generateDestinationAnchors(
  lastRequiredPoint: LatLng,
  destinationLatLng: LatLng,
  offsetMeters: number,
  anchorCount: number
): LatLng[] {
  const mid = midpoint(lastRequiredPoint, destinationLatLng);
  const forwardBearing = bearingDegrees(lastRequiredPoint, destinationLatLng);
  const leftBearing = (forwardBearing - 90 + 360) % 360;
  const rightBearing = (forwardBearing + 90) % 360;

  const anchors = [
    projectPoint(mid, leftBearing, offsetMeters),
    projectPoint(mid, rightBearing, offsetMeters),
    projectPoint(mid, forwardBearing, offsetMeters),
  ];
  return anchors.slice(0, anchorCount);
}

type AnchorGenerator = (radialMultiplier: number, anchorCount: number) => LatLng[];

/** anchorへカテゴリを分散させる(全anchor×全categoryの組み合わせ爆発を避ける)。 */
function buildAnchorSearchPlan(
  anchors: LatLng[],
  categories: PlaceCategory[]
): { anchor: LatLng; category: PlaceCategory }[] {
  return anchors.map((anchor, index) => ({ anchor, category: categories[index % categories.length] }));
}

const ANCHOR_SEARCH_RADIUS_METERS = 6_000;
const ANCHOR_MAX_RESULTS = 5;

async function searchAnchors(plan: { anchor: LatLng; category: PlaceCategory }[]): Promise<PlaceCandidate[]> {
  const results = await Promise.all(
    plan.map(({ anchor, category }) =>
      searchNearbyPlaces({
        center: anchor,
        radiusMeters: ANCHOR_SEARCH_RADIUS_METERS,
        category,
        maxResults: ANCHOR_MAX_RESULTS,
        rankPreference: "DISTANCE",
      })
    )
  );
  const candidates: PlaceCandidate[] = [];
  for (const result of results) {
    if (result.ok) {
      candidates.push(...result.places);
    }
  }
  return candidates;
}

// ===== 候補の無料事前フィルタ ================================================

const MIN_DISTANCE_FROM_MANDATORY_METERS = 150;
const MIN_DISTANCE_BETWEEN_CANDIDATES_METERS = 300;
const MAX_CANDIDATES_TO_EVALUATE = 4;

/**
 * Places APIを無駄に消費しないよう、Routesで実測する前にコスト0のフィルタで
 * 候補を絞り込む: 重複ID除外、必須地点(出発/経由/目的地)に近すぎる候補除外、
 * 既に採用した候補と近すぎる候補除外(簡易diversity)。各anchorの検索半径は
 * Google側のlocationRestrictionで既に保証されるため、ここでは再チェックしない。
 */
function prefilterCandidates(rawCandidates: PlaceCandidate[], mandatoryPoints: LatLng[]): PlaceCandidate[] {
  const seenIds = new Set<string>();
  const kept: PlaceCandidate[] = [];

  for (const candidate of rawCandidates) {
    if (seenIds.has(candidate.id)) {
      continue;
    }
    seenIds.add(candidate.id);

    const point: LatLng = { latitude: candidate.latitude, longitude: candidate.longitude };

    const tooCloseToMandatory = mandatoryPoints.some(
      (mandatory) => haversineMeters(point, mandatory) < MIN_DISTANCE_FROM_MANDATORY_METERS
    );
    if (tooCloseToMandatory) {
      continue;
    }

    const tooCloseToKept = kept.some(
      (existing) =>
        haversineMeters(point, { latitude: existing.latitude, longitude: existing.longitude }) <
        MIN_DISTANCE_BETWEEN_CANDIDATES_METERS
    );
    if (tooCloseToKept) {
      continue;
    }

    kept.push(candidate);
  }

  return kept;
}

// ===== スコアリング・理想帯 ===================================================

/** 超過は2倍、不足はそのまま減点。小さいほど良い。 */
function computeScore(actualMinutes: number, availableMinutes: number): number {
  return actualMinutes > availableMinutes
    ? (actualMinutes - availableMinutes) * 2
    : availableMinutes - actualMinutes;
}

const IDEAL_BAND_MIN_RATIO = 0.85;
const IDEAL_BAND_MAX_RATIO = 1.1;
const EXPAND_TRIGGER_RATIO = 0.8;
const SHRINK_TRIGGER_RATIO = 1.2;
const EXPAND_FACTOR = 1.5;
const SHRINK_FACTOR = 0.75;
const MAX_SEARCH_ROUNDS = 2;
/** ラウンドごとのanchor数(1回目3件+2回目2件=Places最大5リクエストに収める)。 */
const ROUND_ANCHOR_COUNTS = [3, 2];

function isWithinIdealBand(actualMinutes: number, targetMinutes: number): boolean {
  const ratio = actualMinutes / targetMinutes;
  return ratio >= IDEAL_BAND_MIN_RATIO && ratio <= IDEAL_BAND_MAX_RATIO;
}

function resolveTimeBandWarning(actualMinutes: number, targetMinutes: number): string | undefined {
  const ratio = actualMinutes / targetMinutes;
  if (ratio < IDEAL_BAND_MIN_RATIO) {
    return "目安時間より短めのルートです。";
  }
  if (ratio > IDEAL_BAND_MAX_RATIO) {
    return "目安時間より長めのルートです。";
  }
  return undefined;
}

// ===== 公開の型 ==============================================================

export interface SuggestedPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
}

export interface DrivePlan {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  source: "google";
  suggestedPlace?: SuggestedPlace;
  warning?: string | null;
}

export interface DrivePlanMeta {
  availableTimeMinutes: number;
  baseDurationMinutes?: number;
  overBudget: boolean;
  /** 調査用。候補探索を何ラウンド実行したか(1〜2)。候補探索自体を行わなかった場合は未設定。 */
  searchRoundsUsed?: number;
}

export type BuildPlansOutcome =
  | { ok: true; plans: DrivePlan[]; meta: DrivePlanMeta }
  | { ok: false; reason: GoogleRoutesFailureReason };

const MIN_REMAINING_MINUTES_FOR_SEARCH = 15;

function toSuggestedPlace(candidate: PlaceCandidate): SuggestedPlace {
  return {
    id: candidate.id,
    name: candidate.name,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    primaryType: candidate.primaryType,
  };
}

function toBasePlan(route: RouteCandidate): DrivePlan {
  return {
    id: "plan-base",
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    encodedPolyline: route.encodedPolyline,
    source: "google",
  };
}

interface ScoredCandidate {
  candidate: PlaceCandidate;
  route: RouteCandidate;
  durationMinutes: number;
  score: number;
}

async function evaluateCandidates(
  candidates: PlaceCandidate[],
  origin: LatLng,
  destinationLatLng: LatLng,
  userViaPoints: LatLng[],
  avoidHighways: boolean,
  targetMinutes: number
): Promise<ScoredCandidate[]> {
  const evaluations = await Promise.all(
    candidates.map(async (candidate): Promise<ScoredCandidate | null> => {
      const outcome = await computeRoutes({
        origin,
        destination: destinationLatLng,
        intermediates: [...userViaPoints, { latitude: candidate.latitude, longitude: candidate.longitude }],
        avoidHighways,
      });
      if (!outcome.ok || outcome.routes.length === 0) {
        // この候補だけ除外する(リクエスト全体は失敗させない)。
        return null;
      }
      const route = outcome.routes[0];
      const durationMinutes = route.durationSeconds / 60;
      return { candidate, route, durationMinutes, score: computeScore(durationMinutes, targetMinutes) };
    })
  );
  return evaluations.filter((item): item is ScoredCandidate => item !== null);
}

/**
 * target-time anchor方式による適応的探索。最大2ラウンドまで。
 * 1ラウンド目の最良候補が理想帯(85〜110%)から大きく外れる場合のみ、
 * anchor距離を拡大/縮小してもう1ラウンドだけ追加探索する。
 */
interface AdaptiveSearchResult {
  scored: ScoredCandidate[];
  /** 調査用。実際に実行した探索ラウンド数(1〜MAX_SEARCH_ROUNDS)。 */
  roundsUsed: number;
}

async function runAdaptiveSearch(
  generateAnchors: AnchorGenerator,
  categories: PlaceCategory[],
  mandatoryPoints: LatLng[],
  origin: LatLng,
  destinationLatLng: LatLng,
  userViaPoints: LatLng[],
  avoidHighways: boolean,
  targetMinutes: number
): Promise<AdaptiveSearchResult> {
  let radialMultiplier = 1;
  let roundsUsed = 0;
  const allScored: ScoredCandidate[] = [];
  const seenCandidateIds = new Set<string>();

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    roundsUsed = round + 1;
    const anchorCount = ROUND_ANCHOR_COUNTS[round] ?? ROUND_ANCHOR_COUNTS[ROUND_ANCHOR_COUNTS.length - 1];
    const anchors = generateAnchors(radialMultiplier, anchorCount);
    const searchPlan = buildAnchorSearchPlan(anchors, categories);
    const rawCandidates = await searchAnchors(searchPlan);
    const shortlisted = prefilterCandidates(rawCandidates, mandatoryPoints)
      .filter((candidate) => !seenCandidateIds.has(candidate.id))
      .slice(0, MAX_CANDIDATES_TO_EVALUATE);
    shortlisted.forEach((candidate) => seenCandidateIds.add(candidate.id));

    if (shortlisted.length > 0) {
      const scored = await evaluateCandidates(
        shortlisted,
        origin,
        destinationLatLng,
        userViaPoints,
        avoidHighways,
        targetMinutes
      );
      allScored.push(...scored);
    }

    if (allScored.length === 0) {
      // 候補が1件も評価できていない場合、収束判断ができないため打ち切る
      // (見つからないものを探して追加のGoogle呼び出しを重ねない)。
      break;
    }

    allScored.sort((a, b) => a.score - b.score);
    const bestRatio = allScored[0].durationMinutes / targetMinutes;

    if (bestRatio >= IDEAL_BAND_MIN_RATIO && bestRatio <= IDEAL_BAND_MAX_RATIO) {
      break; // 理想帯に到達
    }
    if (round === MAX_SEARCH_ROUNDS - 1) {
      break; // 最大ラウンドに到達
    }
    if (bestRatio < EXPAND_TRIGGER_RATIO) {
      radialMultiplier *= EXPAND_FACTOR;
    } else if (bestRatio > SHRINK_TRIGGER_RATIO) {
      radialMultiplier *= SHRINK_FACTOR;
    } else {
      break; // 惜しい範囲(0.80〜0.85 または 1.10〜1.20)は追加探索しない
    }
  }

  return { scored: allScored, roundsUsed };
}

/** 理想帯の候補を優先し、その後score順。近すぎる候補(300m未満)は除外して多様性を保つ。 */
function selectFinalCandidates(scored: ScoredCandidate[], targetMinutes: number, maxCount: number): ScoredCandidate[] {
  const inBand = scored.filter((item) => isWithinIdealBand(item.durationMinutes, targetMinutes));
  const outOfBand = scored.filter((item) => !isWithinIdealBand(item.durationMinutes, targetMinutes));
  inBand.sort((a, b) => a.score - b.score);
  outOfBand.sort((a, b) => a.score - b.score);

  const selected: ScoredCandidate[] = [];
  for (const item of [...inBand, ...outOfBand]) {
    const point: LatLng = { latitude: item.candidate.latitude, longitude: item.candidate.longitude };
    const tooClose = selected.some(
      (existing) =>
        haversineMeters(point, { latitude: existing.candidate.latitude, longitude: existing.candidate.longitude }) <
        MIN_DISTANCE_BETWEEN_CANDIDATES_METERS
    );
    if (tooClose) {
      continue;
    }
    selected.push(item);
    if (selected.length >= maxCount) {
      break;
    }
  }
  return selected;
}

// ===== 基本ルート自体が時間超過している場合の、希望を反映した最小限の探索 ===========

/** 予算超過時は「120分に近づける」ことが不可能なため、基本ルートからの増加分だけを見て評価する。 */
const OVER_BUDGET_MAX_CANDIDATES = 3;
const OVER_BUDGET_MAX_PLANS = 2;

function buildOverBudgetBaseWarning(baseDurationMinutes: number, availableTimeMinutes: number, hasDestination: boolean): string {
  const overMinutes = Math.round(baseDurationMinutes - availableTimeMinutes);
  return hasDestination
    ? `目的地まで向かうだけでも、目安時間を約${overMinutes}分超えます。`
    : `指定した場所を回るだけでも、目安時間を約${overMinutes}分超えます。`;
}

function buildOverBudgetCandidateWarning(actualMinutes: number, availableTimeMinutes: number, hasDestination: boolean): string {
  const overMinutes = Math.round(actualMinutes - availableTimeMinutes);
  return hasDestination
    ? `この目的地までは目安時間内に到着できません。このプランは約${overMinutes}分超える予定です。`
    : `指定した場所を回るには目安時間内では戻れません。このプランは約${overMinutes}分超える予定です。`;
}

interface OverBudgetScoredCandidate {
  candidate: PlaceCandidate;
  route: RouteCandidate;
  durationMinutes: number;
  addedMinutes: number;
}

/**
 * 基本ルート(origin→userViaPoints→destination/origin)だけで既に時間予算を超えている
 * 場合に、scenic/desiredStops等の明確な希望があるときだけ呼ぶ。景色・寄り道の希望を
 * 完全に捨てず、実在するPlaceを経由地点として使うことで間接的に反映する。
 * 「120分に近づける」評価はできないため、基本ルートからの増加分(addedMinutes)が
 * 小さい候補を優先する。大量探索は行わない(Places最大1〜2回・candidate最大3件・
 * Routes評価最大3回)。良い候補が無ければ基本ルートのみを返す(無理に3案作らない)。
 */
async function exploreOverBudgetCandidates(
  basePlan: DrivePlan,
  baseDurationMinutes: number,
  request: DrivePlanRequest
): Promise<DrivePlan[]> {
  const { origin, userViaPoints, returnTarget, availableTimeMinutes, preferences } = request;
  const hasDestination = returnTarget === "different";
  const destinationLatLng: LatLng = hasDestination ? (request.destination as LatLng) : origin;

  const basePlanWithWarning: DrivePlan = {
    ...basePlan,
    warning: buildOverBudgetBaseWarning(baseDurationMinutes, availableTimeMinutes, hasDestination),
  };

  if (!hasExplorablePreference(preferences)) {
    return [basePlanWithWarning];
  }

  const categories = selectCategories(preferences);
  const lastRequiredPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
  // 増加分を小さく保ちたいため、直行区間の中点(目的地あり)またはuserViaPoints最後の点
  // (出発地点へ戻る)を検索centerとし、小さめの固定半径・DISTANCE優先で探す
  // (target-time anchor方式のような大きな探索はしない)。
  const searchAnchorPoint = hasDestination ? midpoint(lastRequiredPoint, destinationLatLng) : lastRequiredPoint;
  const searchPlan = categories.map((category) => ({ anchor: searchAnchorPoint, category }));

  const rawCandidates = await searchAnchors(searchPlan);

  const mandatoryPoints: LatLng[] = [origin, ...userViaPoints];
  if (hasDestination) {
    mandatoryPoints.push(destinationLatLng);
  }
  const shortlisted = prefilterCandidates(rawCandidates, mandatoryPoints).slice(0, OVER_BUDGET_MAX_CANDIDATES);

  if (shortlisted.length === 0) {
    return [basePlanWithWarning];
  }

  const evaluations = await Promise.all(
    shortlisted.map(async (candidate): Promise<OverBudgetScoredCandidate | null> => {
      const outcome = await computeRoutes({
        origin,
        destination: destinationLatLng,
        intermediates: [...userViaPoints, { latitude: candidate.latitude, longitude: candidate.longitude }],
        avoidHighways: preferences.avoidHighways,
      });
      if (!outcome.ok || outcome.routes.length === 0) {
        return null;
      }
      const route = outcome.routes[0];
      const durationMinutes = route.durationSeconds / 60;
      return { candidate, route, durationMinutes, addedMinutes: durationMinutes - baseDurationMinutes };
    })
  );

  const scored = evaluations.filter((item): item is OverBudgetScoredCandidate => item !== null);
  scored.sort((a, b) => a.addedMinutes - b.addedMinutes);

  const candidatePlans: DrivePlan[] = scored.slice(0, OVER_BUDGET_MAX_PLANS).map((item, index) => ({
    id: `plan-over-${index}`,
    distanceMeters: item.route.distanceMeters,
    durationSeconds: item.route.durationSeconds,
    encodedPolyline: item.route.encodedPolyline,
    source: "google",
    suggestedPlace: toSuggestedPlace(item.candidate),
    warning: buildOverBudgetCandidateWarning(item.durationMinutes, availableTimeMinutes, hasDestination),
  }));

  return [basePlanWithWarning, ...candidatePlans];
}

/**
 * 時間予算を考慮した1〜3件のドライブプランを構築する。
 *
 * - 目的地あり(returnTarget === "different")、出発地点へ戻る(userViaPointsあり/なし)
 *   のいずれも扱う。
 * - Google APIの呼び出しが失敗した場合にmockへフォールバックすることはない
 *   (呼び出し元がok:falseまたはplans:[]を見て、エラー/空状態を適切に扱う)。
 */
export async function buildDrivePlans(request: DrivePlanRequest): Promise<BuildPlansOutcome> {
  const { origin, destination, userViaPoints, returnTarget, availableTimeMinutes, preferences } = request;

  // returnTarget === "different" の場合、plan-types.tsのバリデーションにより
  // destinationは必ず存在する。
  const destinationLatLng: LatLng = returnTarget === "different" ? (destination as LatLng) : origin;

  // 出発地点へ戻る・経由地点も無い場合は、測定すべき「必須区間」自体が存在しない
  // (出発地=目的地、経由地なしのリクエストは実質「移動なし」のため)。この場合は
  // 基本ルートの計測をスキップし、候補地点(最低1件)を前提とした探索のみを行う。
  const hasMandatorySegment = returnTarget === "different" || userViaPoints.length > 0;

  let baseDurationMinutes: number | undefined;
  let basePlan: DrivePlan | undefined;

  if (hasMandatorySegment) {
    const baseOutcome = await computeRoutes({
      origin,
      destination: destinationLatLng,
      intermediates: userViaPoints,
      avoidHighways: preferences.avoidHighways,
    });

    if (!baseOutcome.ok) {
      return { ok: false, reason: baseOutcome.reason };
    }
    if (baseOutcome.routes.length === 0) {
      return { ok: false, reason: "invalid_response" };
    }

    const baseRoute = baseOutcome.routes[0];
    baseDurationMinutes = baseRoute.durationSeconds / 60;
    basePlan = toBasePlan(baseRoute);

    if (baseDurationMinutes > availableTimeMinutes) {
      // ユーザーが指定した必須区間だけで既に予算超過。viaPointsは絶対に削らない。
      // scenic/desiredStops等の明確な希望があれば、時間超過を承知の上で希望を反映した
      // 候補も最小限探索する(無ければ基本ルートのみ、無理に3案作らない)。
      const plans = await exploreOverBudgetCandidates(basePlan, baseDurationMinutes, request);
      return {
        ok: true,
        plans,
        meta: { availableTimeMinutes, baseDurationMinutes, overBudget: true },
      };
    }
  }

  // remainingMinutesは、userViaPointsが無い場合はavailableTimeMinutesそのものになる
  // (baseDurationMinutesがundefinedのため)。これがそのまま「出発地点に戻る・経由地
  // なし」ケースのanchor距離ヒューリスティックの基準にもなる。
  const remainingMinutes =
    baseDurationMinutes !== undefined ? availableTimeMinutes - baseDurationMinutes : availableTimeMinutes;

  if (remainingMinutes < MIN_REMAINING_MINUTES_FOR_SEARCH) {
    return {
      ok: true,
      plans: basePlan ? [basePlan] : [],
      meta: { availableTimeMinutes, baseDurationMinutes, overBudget: false },
    };
  }

  const categories = selectCategories(preferences);
  const mandatoryPoints: LatLng[] = [origin, ...userViaPoints];
  if (returnTarget === "different") {
    mandatoryPoints.push(destinationLatLng);
  }

  let anchorGenerator: AnchorGenerator;
  if (returnTarget === "different") {
    const lastRequiredPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    anchorGenerator = (radialMultiplier, anchorCount) =>
      generateDestinationAnchors(
        lastRequiredPoint,
        destinationLatLng,
        resolveDestinationOffsetMeters(remainingMinutes) * radialMultiplier,
        anchorCount
      );
  } else {
    const basePoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    anchorGenerator = (radialMultiplier, anchorCount) =>
      generateLoopAnchors(basePoint, resolveLoopRadialMeters(remainingMinutes) * radialMultiplier, anchorCount);
  }

  const { scored, roundsUsed } = await runAdaptiveSearch(
    anchorGenerator,
    categories,
    mandatoryPoints,
    origin,
    destinationLatLng,
    userViaPoints,
    preferences.avoidHighways,
    availableTimeMinutes
  );

  if (scored.length === 0) {
    return {
      ok: true,
      plans: basePlan
        ? [{ ...basePlan, warning: basePlan.warning ?? "周辺で提案できる候補地点が見つかりませんでした。" }]
        : [],
      meta: { availableTimeMinutes, baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
    };
  }

  const finalSelection = selectFinalCandidates(scored, availableTimeMinutes, 3);

  const candidatePlans: DrivePlan[] = finalSelection.map((item, index) => ({
    id: `plan-${index}`,
    distanceMeters: item.route.distanceMeters,
    durationSeconds: item.route.durationSeconds,
    encodedPolyline: item.route.encodedPolyline,
    source: "google",
    suggestedPlace: toSuggestedPlace(item.candidate),
    warning: resolveTimeBandWarning(item.durationMinutes, availableTimeMinutes),
  }));

  return {
    ok: true,
    plans: candidatePlans,
    meta: { availableTimeMinutes, baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
  };
}
