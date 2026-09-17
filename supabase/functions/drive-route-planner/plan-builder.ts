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
 * ユーザーが「使える時間」を指定していない場合(availableTimeMinutes === undefined)は、
 * 目標収束(computeScore/target-time anchor)ではなく、基本ルートからの増加分
 * (addedMinutes)で候補を評価する。内部的な探索用のヒューリスティック値を使うことは
 * あっても、それをユーザー指定の時間であるかのようにmeta/RouteOptionへ出さない。
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
 * - 最終的な採否・並び順は、常に実際のGoogle Routes所要時間と評価基準(時間予算との
 *   差、またはaddedMinutes)で決める。anchor・半径はあくまで検索範囲を絞るヒューリスティック。
 *
 * 候補の多様性について: 最良の1件(スコア/addedMinutesが最も良い候補)は常にそのまま
 * 選ばれるが、2件目以降は「まだ選ばれていないanchor(方位/オフセット方向)由来の候補」を
 * 優先して選ぶ(interleaveByAnchor・selectFinalCandidates・
 * selectDiverseAddedMinutesCandidates参照)。同じ方向に固まった似たような候補ばかりに
 * ならないようにするための軽量heuristicで、重いGIS処理(Polyline類似度比較等)は
 * 導入していない。
 */
import { computeRoutes, type GoogleRoutesFailureReason } from "../google-routes/google-routes-provider.ts";
import type { RouteCandidate } from "../google-routes/route-types.ts";
import { searchNearbyPlaces, searchTextPlaces } from "../google-places/google-places-provider.ts";
import { isLikelyFoodPlace, type PlaceCandidate, type PlaceCategory } from "../google-places/place-types.ts";
import type { DrivePlanRequest, DrivePreferences, LatLng } from "./plan-types.ts";
import { decodeGooglePolyline, pointAtFraction } from "./polyline.ts";
import { buildPoolFingerprint, getPoolFromCache, savePoolToCache } from "./spot-pool-cache.ts";

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

// ===== ルート類似度判定(軽量、重いGISライブラリは使わない) ==========================
//
// 「基本ルートはほぼ同じで、寄るスポットが違うだけ」の候補を、別ルートとして水増しせず
// 検出するための軽量heuristic。Polylineから一定間隔でサンプリングした点同士の近接割合
// だけで判定する(投影法・道路網トポロジ等の厳密な計算は行わない)。

const SIMILARITY_SAMPLE_POINTS = 12;
const SIMILARITY_MATCH_RADIUS_METERS = 500;
/** サンプル点のこの割合以上が近接していれば「同じルート」とみなす。 */
const SIMILARITY_OVERLAP_RATIO = 0.7;

/** Polylineをdecodeし、fraction 0〜1の等間隔でcount個サンプリングする。 */
function sampleRoutePoints(encodedPolyline: string, count: number): LatLng[] {
  const path = decodeGooglePolyline(encodedPolyline);
  if (path.length < 2) {
    return [];
  }
  const points: LatLng[] = [];
  for (let i = 0; i < count; i++) {
    const fraction = count === 1 ? 0 : i / (count - 1);
    const point = pointAtFraction(path, fraction);
    if (point) {
      points.push(point);
    }
  }
  return points;
}

/** aの各サンプル点について、bのいずれかの点がSIMILARITY_MATCH_RADIUS_METERS以内にあるかを見て、一致率を返す。 */
function computeOverlapRatio(a: LatLng[], b: LatLng[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  let matched = 0;
  for (const pointA of a) {
    if (b.some((pointB) => haversineMeters(pointA, pointB) < SIMILARITY_MATCH_RADIUS_METERS)) {
      matched += 1;
    }
  }
  return matched / a.length;
}

/**
 * 2つのGoogle Routes実測結果が「体験として別のルート」と言えるかどうかを、Polylineの
 * サンプル点の近接割合だけで軽量に判定する。重いGIS処理(道路網トポロジ比較・
 * 正確な投影計算等)は行わない。片方向だけの一致率が高くても類似と判定する
 * (長さが違う2ルートで、短い方がもう一方に完全に含まれるケースも「似ている」とみなすため)。
 */
function isSimilarRoute(a: { encodedPolyline: string }, b: { encodedPolyline: string }): boolean {
  const samplesA = sampleRoutePoints(a.encodedPolyline, SIMILARITY_SAMPLE_POINTS);
  const samplesB = sampleRoutePoints(b.encodedPolyline, SIMILARITY_SAMPLE_POINTS);
  const ratioAtoB = computeOverlapRatio(samplesA, samplesB);
  const ratioBtoA = computeOverlapRatio(samplesB, samplesA);
  return Math.max(ratioAtoB, ratioBtoA) >= SIMILARITY_OVERLAP_RATIO;
}

/**
 * 調査用の安全なログ(セクション21)。候補数・採用anchor数・biasPoint使用有無のみ。
 * 座標・場所名・user text全文・Secretは一切含めない。
 */
function logDiversityOutcome(
  label: string,
  scored: { anchorIndex: number }[],
  selected: { anchorIndex: number }[],
  biasApplied: boolean
): void {
  const scoredAnchors = new Set(scored.map((item) => item.anchorIndex)).size;
  const selectedAnchors = new Set(selected.map((item) => item.anchorIndex)).size;
  console.log(
    `[drive-route-planner] diversity label=${label} candidateCount=${scored.length} selectedCount=${selected.length} scoredAnchorSectors=${scoredAnchors} selectedAnchorSectors=${selectedAnchors} biasApplied=${biasApplied}`
  );
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

// ===== optionalなwaypointの順序最適化(セクション6・7: Uターン防止) ========================
//
// userViaPoints(ユーザーが明示的に置いた、順序固定の必須経由地点)には一切適用しない。
// 「候補カードから選んで追加した」spot等、順序に意味を持たない地点群だけを対象に、
// 総移動距離+Uターンpenaltyが最小になる順へ並べ替える軽量heuristic。
// 追加のGoogle API呼び出しは一切行わない(純粋な幾何計算のみ、コストへの影響ゼロ)。

/** この角度(度)を超える進行方向の反転を「Uターン」とみなす。 */
const U_TURN_BEARING_THRESHOLD_DEG = 120;
/** Uターン1件あたりのpenalty(メートル換算)。距離スコアへ直接加算する。 */
const U_TURN_PENALTY_METERS = 8_000;
/** 組み合わせ爆発を避けるため、全順列探索はこの件数まで(4件で最大24通り)。 */
const MAX_ORDER_PERMUTATION_POINTS = 4;

function angleDiffDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/** origin→…→destinationという並びの総移動距離に、進行方向が大きく反転する箇所へのpenaltyを加えたスコア。小さいほど良い。 */
function scoreWaypointOrder(fromPoint: LatLng, toPoint: LatLng, order: LatLng[]): number {
  const sequence = [fromPoint, ...order, toPoint];
  let total = 0;
  for (let i = 0; i < sequence.length - 1; i++) {
    total += haversineMeters(sequence[i], sequence[i + 1]);
  }
  for (let i = 1; i < sequence.length - 1; i++) {
    const bearingIn = bearingDegrees(sequence[i - 1], sequence[i]);
    const bearingOut = bearingDegrees(sequence[i], sequence[i + 1]);
    if (angleDiffDegrees(bearingIn, bearingOut) > U_TURN_BEARING_THRESHOLD_DEG) {
      total += U_TURN_PENALTY_METERS;
    }
  }
  return total;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of permutations(rest)) {
      result.push([items[i], ...perm]);
    }
  }
  return result;
}

/**
 * fromPoint(通常はorigin、またはuserViaPointsの最後)からtoPoint(destinationまたはorigin)へ
 * 向かう途中に挟む、順序に意味を持たない地点群(pointsは最大4件を想定)を、
 * 総移動距離+Uターンpenaltyが最小になる順へ並べ替えて返す。5件以上の場合は組み合わせ
 * 爆発を避け、入力順のまま返す(実運用上、候補カード経由で一度に追加する数はごく少数)。
 */
function orderWaypointsForEfficiency(fromPoint: LatLng, toPoint: LatLng, points: LatLng[]): LatLng[] {
  if (points.length <= 1 || points.length > MAX_ORDER_PERMUTATION_POINTS) {
    return points;
  }
  let bestOrder = points;
  let bestScore = Infinity;
  for (const order of permutations(points)) {
    const score = scoreWaypointOrder(fromPoint, toPoint, order);
    if (score < bestScore) {
      bestScore = score;
      bestOrder = order;
    }
  }
  return bestOrder;
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
 * 基本ルートだけで既に時間予算を超えている場合(または時間指定なしで寄り道候補を
 * 探す場合)に、それでもPlaces候補探索を行うだけの明確な希望があるかどうか。
 * 何も無ければ(=このデフォルトのscenicへのフォールバックだけの状態では)、
 * 無理に寄り道せず基本ルートのみを返す。
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
/**
 * 上限を45kmのまま固定していると、150分を超える指定(例: 5時間)でもすべて同じ半径に
 * クランプされ、「近場の候補を組み合わせて時間を埋める」状態になり長時間指定で
 * 遠方の地域代表スポットを探せなかった(セクション11)。areaConstraintがある場合は
 * clampRadialToAreaConstraintで地域の半径までさらに制約されるため、ここでの上限を
 * 大きく取っても県外まで飛ぶわけではない(area制約が無い場合の今ドラ長時間ループ向けの
 * 安全弁として200kmを上限にした)。
 */
function resolveLoopRadialMeters(targetMinutesForRadius: number): number {
  return clamp(targetMinutesForRadius * 300, 5_000, 200_000);
}

/** 「目的地あり」ケースの、直行区間からの左右オフセット距離(メートル)。同じ理由で上限を引き上げた。 */
function resolveDestinationOffsetMeters(remainingMinutes: number): number {
  return clamp(remainingMinutes * 200, 3_000, 100_000);
}

const LOOP_ANCHOR_BEARINGS = [0, 120, 240, 60, 180, 300];

/**
 * biasPoint(実在確認済みの、ユーザーが地名で強く希望した地点)がある場合に、
 * 残りのanchorをそちらの方角へ寄せて生成する角度オフセット。左右対称に散らし、
 * 「生駒の方向」全体の中でも多少の違いが出るようにする(全く同じ1点だけに
 * 収束させない)。
 */
const BIAS_ANCHOR_SPREAD_DEGREES = [35, -35, 65, -65];

/**
 * origin(またはuserViaPoints最後の点)を中心に、複数方向へradial距離だけ離れたanchorを生成する。
 * biasPointが指定されている場合、biasPoint自体を最優先(index 0)のanchorとして必ず含め
 * (=Places検索のcenterをその実在地点そのものにする)、残りのanchorもbiasPointの方角へ
 * 偏らせる。これにより「生駒を走りたい」等の強い地理的希望が、実際のanchor配置(=検索
 * range)へ確実に反映される。biasPointが無い場合は、固定の複数方向(コンパス方位)へ
 * 均等に散らす(実際の地形は分からないため、軽量heuristicとして方角の違いだけを担保する)。
 */
function generateLoopAnchors(basePoint: LatLng, radialMeters: number, anchorCount: number, biasPoint?: LatLng): LatLng[] {
  if (biasPoint) {
    const anchors: LatLng[] = [biasPoint];
    const bearingToBias = bearingDegrees(basePoint, biasPoint);
    for (const offset of BIAS_ANCHOR_SPREAD_DEGREES) {
      if (anchors.length >= anchorCount) break;
      anchors.push(projectPoint(basePoint, (bearingToBias + offset + 360) % 360, radialMeters));
    }
    return anchors.slice(0, anchorCount);
  }
  return LOOP_ANCHOR_BEARINGS.slice(0, anchorCount).map((bearing) => projectPoint(basePoint, bearing, radialMeters));
}

/**
 * lastRequiredPoint→destinationの直行区間の中点から、進行方向に対して左右・および
 * さらに先(遠回り方向)へオフセットしたanchorを生成する。biasPointが指定されている
 * 場合は、それ自体をanchorへ必ず含める(区間から外れていても、ユーザーの明示的な
 * 希望を優先してGoogle Routesで実際に評価する)。
 */
function generateDestinationAnchors(
  lastRequiredPoint: LatLng,
  destinationLatLng: LatLng,
  offsetMeters: number,
  anchorCount: number,
  biasPoint?: LatLng
): LatLng[] {
  const mid = midpoint(lastRequiredPoint, destinationLatLng);
  const forwardBearing = bearingDegrees(lastRequiredPoint, destinationLatLng);
  const leftBearing = (forwardBearing - 90 + 360) % 360;
  const rightBearing = (forwardBearing + 90) % 360;

  const anchors = biasPoint
    ? [biasPoint, projectPoint(mid, leftBearing, offsetMeters), projectPoint(mid, rightBearing, offsetMeters)]
    : [
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

/** どのanchor(方位/オフセット方向)から見つかった候補かを保持する。最終選抜の多様性判定に使う。 */
interface AnchoredCandidate {
  candidate: PlaceCandidate;
  anchorIndex: number;
}

async function searchAnchors(plan: { anchor: LatLng; category: PlaceCategory }[]): Promise<AnchoredCandidate[]> {
  const results = await Promise.all(
    plan.map(({ anchor, category }, anchorIndex) =>
      searchNearbyPlaces({
        center: anchor,
        radiusMeters: ANCHOR_SEARCH_RADIUS_METERS,
        category,
        maxResults: ANCHOR_MAX_RESULTS,
        rankPreference: "DISTANCE",
      }).then((outcome) => ({ outcome, anchorIndex }))
    )
  );
  const candidates: AnchoredCandidate[] = [];
  for (const { outcome, anchorIndex } of results) {
    if (outcome.ok) {
      for (const candidate of outcome.places) {
        candidates.push({ candidate, anchorIndex });
      }
    }
  }
  return candidates;
}

/**
 * anchorごとにグルーピングし、ラウンドロビンで並べ替える。評価予算
 * (MAX_CANDIDATES_TO_EVALUATE)へスライスする前にこれを通すことで、1つのanchorが
 * 多くの候補を返しても評価予算を独占せず、複数anchor由来の候補を確実に評価対象へ
 * 残す(=最終的な候補の多様性が失われる根本原因への対処)。
 */
function interleaveByAnchor(items: AnchoredCandidate[]): AnchoredCandidate[] {
  const buckets = new Map<number, AnchoredCandidate[]>();
  for (const item of items) {
    const bucket = buckets.get(item.anchorIndex);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(item.anchorIndex, [item]);
    }
  }
  const anchorIndices = [...buckets.keys()];
  const interleaved: AnchoredCandidate[] = [];
  let row = 0;
  while (interleaved.length < items.length) {
    let addedAny = false;
    for (const anchorIndex of anchorIndices) {
      const bucket = buckets.get(anchorIndex) as AnchoredCandidate[];
      if (row < bucket.length) {
        interleaved.push(bucket[row]);
        addedAny = true;
      }
    }
    if (!addedAny) {
      break;
    }
    row += 1;
  }
  return interleaved;
}

// ===== 候補の無料事前フィルタ ================================================

/**
 * 実機で「高知駅から出発→高知駅に寄る」という不自然な候補が報告されたため、
 * 150m→800mへ拡大した(駅前広場やロータリー等、同じ地点とみなすべき範囲を
 * 広めに取る)。出発地点・目的地・既存waypointのいずれからもこの距離未満の
 * 候補は採用しない。
 */
const MIN_DISTANCE_FROM_MANDATORY_METERS = 800;
const MIN_DISTANCE_BETWEEN_CANDIDATES_METERS = 300;
export type AreaConstraint = { center: LatLng; radiusMeters: number; label?: string; prefecture?: string };

/**
 * areaConstraint(「高知県でドライブ」等の強い地域制約)が指定された場合の候補除外判定。
 * candidate.prefecture(Google Places addressComponentsのadministrative_area_level_1から
 * 取得、料金tierへの影響が無いことを確認済み)が取得できていれば、それをHard Constraintの
 * 主判定にする:
 *   - areaConstraint.prefecture(クライアントがGoogle Placesから取り出したcanonicalな
 *     都道府県名)が指定されていれば、candidate.prefectureとの**厳密一致**(===)で判定する。
 *     どちらもGoogleのadministrative_area_level_1由来の同一形式の文字列のため、あいまい
 *     一致は不要かつ危険(labelが「和歌山駅」のような都道府県名以外の表示名になる
 *     ケースがあり、その場合.includes()による部分一致は機能しない。和歌山県指定なのに
 *     四国・兵庫県が候補に混入した不具合の直接の原因だった)。
 *   - areaConstraint.prefectureが無い場合のみ、後方互換としてlabelとのあいまい一致
 *     (.includes())にフォールバックする。
 * prefectureが取得できない候補(一部の自然地形等でaddressComponentsが薄い場合がある)は、
 * 代表地点からの距離による判定へフォールバックする(「県境付近で自然に少し跨ぐ」程度を
 * 許容する軽い係数)。
 */
const AREA_CONSTRAINT_BUFFER = 1.15;

function isOutsideAreaConstraint(
  point: LatLng,
  areaConstraint: AreaConstraint | undefined,
  prefecture?: string | null
): boolean {
  if (!areaConstraint) {
    return false;
  }
  if (areaConstraint.prefecture && prefecture) {
    return areaConstraint.prefecture !== prefecture;
  }
  if (areaConstraint.label && prefecture) {
    const matches = areaConstraint.label.includes(prefecture) || prefecture.includes(areaConstraint.label);
    return !matches;
  }
  return haversineMeters(point, areaConstraint.center) > areaConstraint.radiusMeters * AREA_CONSTRAINT_BUFFER;
}

/**
 * areaConstraintが指定されている場合、anchor生成用のradial距離自体を制約半径の90%までに
 * クランプする(5時間等の長時間指定でも、指定地域の外までanchorを飛ばさないための一次防御。
 * isOutsideAreaConstraintによる候補フィルタが二次防御)。
 */
function clampRadialToAreaConstraint(radialMeters: number, areaConstraint?: AreaConstraint): number {
  if (!areaConstraint) {
    return radialMeters;
  }
  return Math.min(radialMeters, areaConstraint.radiusMeters * 0.9);
}
/**
 * 「同じようなルートばかり出る」問題への対処として、候補を少し多めに評価してから
 * 類似度で絞り込む方針(セクション1参照)に変更した。1ラウンドあたりの評価数を
 * 4→5へ、後述のROUND_ANCHOR_COUNTSと合わせても、最大2ラウンドでPlaces最大6回・
 * Routes評価最大10回程度に収まる(ユーザー許容の目安の範囲内)。
 */
const MAX_CANDIDATES_TO_EVALUATE = 5;

/**
 * Places APIを無駄に消費しないよう、Routesで実測する前にコスト0のフィルタで
 * 候補を絞り込む: 重複ID除外、必須地点(出発/経由/目的地)に近すぎる候補除外、
 * 既に採用した候補と近すぎる候補除外(簡易diversity)。各anchorの検索半径は
 * Google側のlocationRestrictionで既に保証されるため、ここでは再チェックしない。
 */
interface PrefilterOptions {
  areaConstraint?: AreaConstraint;
  /** trueの場合、primaryTypeが飲食店寄りの候補を除外する(ユーザーが明示的にrestaurant/cafeを求めた検索では使わない)。 */
  excludeFood?: boolean;
}

function prefilterCandidates(
  rawCandidates: AnchoredCandidate[],
  mandatoryPoints: LatLng[],
  options: PrefilterOptions = {}
): AnchoredCandidate[] {
  const seenIds = new Set<string>();
  const kept: AnchoredCandidate[] = [];
  let rejectedByArea = 0;
  let rejectedByFood = 0;

  for (const item of rawCandidates) {
    const candidate = item.candidate;
    if (seenIds.has(candidate.id)) {
      continue;
    }
    seenIds.add(candidate.id);

    if (options.excludeFood && isLikelyFoodPlace(candidate.primaryType)) {
      rejectedByFood++;
      continue;
    }

    const point: LatLng = { latitude: candidate.latitude, longitude: candidate.longitude };

    if (isOutsideAreaConstraint(point, options.areaConstraint, candidate.prefecture)) {
      rejectedByArea++;
      continue;
    }

    const tooCloseToMandatory = mandatoryPoints.some(
      (mandatory) => haversineMeters(point, mandatory) < MIN_DISTANCE_FROM_MANDATORY_METERS
    );
    if (tooCloseToMandatory) {
      continue;
    }

    const tooCloseToKept = kept.some(
      (existing) =>
        haversineMeters(point, { latitude: existing.candidate.latitude, longitude: existing.candidate.longitude }) <
        MIN_DISTANCE_BETWEEN_CANDIDATES_METERS
    );
    if (tooCloseToKept) {
      continue;
    }

    kept.push(item);
  }

  if (options.areaConstraint || options.excludeFood) {
    // safe debug log(セクション30): 件数のみ。座標・施設名・Secretは出さない。
    console.log(
      `[drive-route-planner] prefilter rawCount=${rawCandidates.length} keptCount=${kept.length} areaRejected=${rejectedByArea} foodRejected=${rejectedByFood}`
    );
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
/** ラウンドごとのanchor数(1回目4件+2回目2件=Places最大6リクエストに収める)。 */
const ROUND_ANCHOR_COUNTS = [4, 2];

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

/**
 * ルート自体を変えるほどではない(=基本ルートがほぼ同じ)候補を、別ルートとして
 * 水増しする代わりにここへ集約する。「Route diversityとOptional spot diversityを
 * 分離する」方針(このルートの近くにある、実際に立ち寄れる実在スポット)。
 */
export interface NearbySuggestion {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType: string | null;
  /** このスポットへ寄った場合の、このルートの基準所要時間からの増加分(分、整数)。 */
  addedMinutes: number;
}

export interface DrivePlan {
  id: string;
  distanceMeters: number;
  durationSeconds: number;
  encodedPolyline: string;
  source: "google";
  suggestedPlace?: SuggestedPlace;
  warning?: string | null;
  nearbySuggestions?: NearbySuggestion[];
  /**
   * corridor型のプラン(現状は海沿いのみ)が、実際にルートへ組み込んだ複数の実在
   * 経由スポット(1〜2件、原則出発地点に近い順)。単一suggestedPlaceでは表現できない
   * 「海沿いの地点を複数つないだルート」を表すために追加した。
   */
  suggestedPlaces?: SuggestedPlace[];
  /** UI側の文言選択用(例:「海沿いを通りやすいコース」)。現状'coastal'のみ。 */
  corridorTheme?: "coastal";
}

export interface DrivePlanMeta {
  /** ユーザーが「使える時間」を指定した場合のみ設定する。未指定ならキー自体を含めない。 */
  availableTimeMinutes?: number;
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

/** nearby候補群を、採用したルートの実測所要時間を基準にしたNearbySuggestion[]へ変換する。 */
function toNearbySuggestions(
  items: { candidate: PlaceCandidate; durationMinutes: number }[],
  selectedDurationMinutes: number
): NearbySuggestion[] {
  return items.map((item) => ({
    id: item.candidate.id,
    name: item.candidate.name,
    latitude: item.candidate.latitude,
    longitude: item.candidate.longitude,
    primaryType: item.candidate.primaryType,
    addedMinutes: Math.max(0, Math.round(item.durationMinutes - selectedDurationMinutes)),
  }));
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
  anchorIndex: number;
}

async function evaluateCandidates(
  candidates: AnchoredCandidate[],
  origin: LatLng,
  destinationLatLng: LatLng,
  userViaPoints: LatLng[],
  avoidHighways: boolean,
  targetMinutes: number,
  optionalViaPoints: LatLng[] = [],
  preserveOptionalOrder = false
): Promise<ScoredCandidate[]> {
  const fromPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
  const evaluations = await Promise.all(
    candidates.map(async ({ candidate, anchorIndex }): Promise<ScoredCandidate | null> => {
      const candidatePoint: LatLng = { latitude: candidate.latitude, longitude: candidate.longitude };
      const trailingPoints = preserveOptionalOrder
        ? [...optionalViaPoints, candidatePoint]
        : orderWaypointsForEfficiency(fromPoint, destinationLatLng, [...optionalViaPoints, candidatePoint]);
      const outcome = await computeRoutes({
        origin,
        destination: destinationLatLng,
        intermediates: [...userViaPoints, ...trailingPoints],
        avoidHighways,
      });
      if (!outcome.ok || outcome.routes.length === 0) {
        // この候補だけ除外する(リクエスト全体は失敗させない)。
        return null;
      }
      const route = outcome.routes[0];
      const durationMinutes = route.durationSeconds / 60;
      return { candidate, route, durationMinutes, score: computeScore(durationMinutes, targetMinutes), anchorIndex };
    })
  );
  return evaluations.filter((item): item is ScoredCandidate => item !== null);
}

/**
 * target-time anchor方式による適応的探索。最大2ラウンドまで。
 * 1ラウンド目の最良候補が理想帯(85〜110%)から大きく外れる場合のみ、
 * anchor距離を拡大/縮小してもう1ラウンドだけ追加探索する。
 *
 * targetMinutesは、ユーザーが時間を指定した場合はその値、指定していない場合は
 * anchor距離計算専用の内部ヒューリスティック値(呼び出し元がユーザーへ一切
 * 露出しない)。
 */
interface AdaptiveSearchResult {
  scored: ScoredCandidate[];
  /** 調査用。実際に実行した探索ラウンド数(1〜MAX_SEARCH_ROUNDS)。 */
  roundsUsed: number;
}

/** categoriesにrestaurant/cafeが含まれない場合のみ、飲食店寄りの候補を除外する(明示的なご飯・カフェ希望は尊重する)。 */
function shouldExcludeFood(categories: PlaceCategory[]): boolean {
  return !categories.includes("restaurant") && !categories.includes("cafe");
}

// ===== Spot Pool(Text Search中心の広い候補集め、セクション2・4・6・7) ========================
//
// 「Nearby Searchで近くの場所を少数拾い、その中からRouteを作る」という従来の構造を、
// 「planning areaでテーマ別に広くSpot Poolを作り、そこから品質の高い候補を選ぶ」構造へ
// 補強する。Nearby Searchは主に「選ばれたRouteの近くにある場所」用途(既存のcorridor探索・
// 通常anchor探索)に残しつつ、areaConstraint.label(実在確認済みの地域名)がある場合は、
// Text Search(地域全体を対象にできる)で観光地・景勝地寄りの候補を追加取得し、
// 主目的地・主要waypointの選定にこちらを優先的に使う。

export type PoolTheme = "coastal" | "mountain" | "scenic" | "onsen" | "history" | "market";

/**
 * ハードコードしているのは検索語句(query)であって実在スポット名ではない
 * (「特定の場所を返す」のではなく「検索して実在確認する」ための語句)。
 */
const THEME_TEXT_QUERIES: Partial<Record<PoolTheme, string[]>> = {
  coastal: ["{area} 海岸 観光", "{area} 岬 絶景", "{area} ビーチ"],
  mountain: ["{area} 山 絶景", "{area} 展望台", "{area} 渓谷"],
  scenic: ["{area} 観光地", "{area} 景勝地", "{area} 絶景スポット"],
  onsen: ["{area} 日帰り温泉", "{area} 天然温泉 日帰り", "{area} 温泉 入浴"],
  history: ["{area} 神社 仏閣", "{area} 城", "{area} 歴史的建造物"],
  market: ["{area} 市場", "{area} 朝市"],
};

/** 温泉検索で、宿泊専用と思われる施設(villa等)を除外するための簡易ヒューリスティック(名前ベース)。 */
const LODGING_ONLY_PATTERN = /ヴィラ|villa|一棟貸し|コテージ|貸別荘|ロッジ|ペンション|民宿|hotel|ホテル|旅館|inn\b/i;

const MAX_POOL_TEXT_QUERIES = 3;
/** google-places Edge Function(place-types.ts)のMAX_TEXT_MAX_RESULTS(5)を超えないこと。 */
const POOL_TEXT_SEARCH_MAX_RESULTS = 5;
/** google-places Edge Function(place-types.ts)のMAX_TEXT_BIAS_RADIUS_METERSと合わせる。 */
/** google-places側のMAX_TEXT_BIAS_RADIUS_METERS(Google公式仕様で50km)と合わせる。 */
const MAX_TEXT_LOCATION_BIAS_RADIUS_METERS = 50_000;

/**
 * areaConstraint.labelを使い、テーマ別に複数のText Searchクエリを並列実行してSpot Poolを作る。
 * labelが無い(今ドラ等、planning area概念が無いケース)場合は空配列を返し、呼び出し元は
 * 既存のanchor+Nearby Search探索へフォールバックする。Place IDでの重複排除・
 * excludePlaceIdsによる除外・食事系primaryType除外・(onsenのみ)宿泊専用施設除外・
 * planning area整合性チェック(isOutsideAreaConstraint、prefecture優先)をここで行う。
 */
async function buildSpotPool(
  theme: PoolTheme,
  region: AreaConstraint,
  excludePlaceIds: Set<string>,
  poolContext?: { availableTimeMinutes?: number; hasDestination: boolean }
): Promise<PlaceCandidate[]> {
  const queries = THEME_TEXT_QUERIES[theme];
  if (!region.label || !queries) {
    return [];
  }

  // 同一planning session内で同条件を再検索しただけの場合、同じText Searchを繰り返さない
  // (セクション13・25・26)。fingerprintは座標・自由記述文を含まない、決定的な文字列。
  const fingerprint = await buildPoolFingerprint({
    theme,
    areaLabel: region.label,
    prefecture: region.prefecture,
    radiusMeters: region.radiusMeters,
    availableTimeMinutes: poolContext?.availableTimeMinutes,
    hasDestination: poolContext?.hasDestination ?? false,
  });
  const cached = await getPoolFromCache(fingerprint);
  const rawPlaces: PlaceCandidate[] = [];
  if (cached) {
    rawPlaces.push(...cached);
  } else {
    const results = await Promise.all(
      queries.slice(0, MAX_POOL_TEXT_QUERIES).map((template) =>
        searchTextPlaces({
          textQuery: template.replace("{area}", region.label as string),
          maxResults: POOL_TEXT_SEARCH_MAX_RESULTS,
          locationBias: {
            center: region.center,
            radiusMeters: Math.min(region.radiusMeters, MAX_TEXT_LOCATION_BIAS_RADIUS_METERS),
          },
        })
      )
    );
    const seenRaw = new Set<string>();
    for (const outcome of results) {
      if (!outcome.ok) {
        continue;
      }
      for (const place of outcome.places) {
        if (seenRaw.has(place.id)) {
          continue;
        }
        seenRaw.add(place.id);
        rawPlaces.push(place);
      }
    }
    // excludePlaceIds(このリクエストだけの「既出」フィルタ)を反映する前の生Poolをキャッシュする。
    // こうすることで、次回別のexcludePlaceIdsで呼ばれても(例: 別の案を見せて→既出を除外)
    // Text Search自体は再実行せず、フィルタだけその場でやり直せる。空(全クエリ失敗・
    // 該当なし)の結果はキャッシュしない(一時的なAPI障害等による空結果がTTLの間
    // ずっと使われ続けるのを防ぐため)。
    if (rawPlaces.length > 0) {
      void savePoolToCache(fingerprint, rawPlaces);
    }
  }

  const pool: PlaceCandidate[] = [];
  for (const place of rawPlaces) {
    if (excludePlaceIds.has(place.id)) {
      continue;
    }
    if (theme === "onsen" && LODGING_ONLY_PATTERN.test(place.name)) {
      continue;
    }
    if (isLikelyFoodPlace(place.primaryType)) {
      continue;
    }
    const point: LatLng = { latitude: place.latitude, longitude: place.longitude };
    if (isOutsideAreaConstraint(point, region, place.prefecture)) {
      continue;
    }
    pool.push(place);
  }
  // safe debug log(セクション30): theme・件数・cache hit/missのみ。座標・施設名・Secretは出さない。
  console.log(
    `[drive-route-planner] spotPool theme=${theme} cacheHit=${Boolean(cached)} rawCount=${rawPlaces.length} pooledCount=${pool.length}`
  );
  return pool;
}

/** Poolで見つかった候補に、originから見た方位セクター(60°刻み)をanchorIndexとして割り当てる。既存のanchorベース候補とindexが衝突しないよう、大きなoffsetを足す。 */
const POOL_SECTOR_COUNT = 6;
const POOL_ANCHOR_INDEX_BASE = 1000;

function poolCandidatesToAnchored(pool: PlaceCandidate[], origin: LatLng): AnchoredCandidate[] {
  return pool.map((candidate) => {
    const bearing = bearingDegrees(origin, { latitude: candidate.latitude, longitude: candidate.longitude });
    const sector = Math.floor(bearing / (360 / POOL_SECTOR_COUNT));
    return { candidate, anchorIndex: POOL_ANCHOR_INDEX_BASE + sector };
  });
}

async function runAdaptiveSearch(
  generateAnchors: AnchorGenerator,
  categories: PlaceCategory[],
  mandatoryPoints: LatLng[],
  origin: LatLng,
  destinationLatLng: LatLng,
  userViaPoints: LatLng[],
  avoidHighways: boolean,
  targetMinutes: number,
  areaConstraint?: AreaConstraint,
  optionalViaPoints: LatLng[] = [],
  preserveOptionalOrder = false,
  excludePlaceIds: Set<string> = new Set()
): Promise<AdaptiveSearchResult> {
  let radialMultiplier = 1;
  let roundsUsed = 0;
  const allScored: ScoredCandidate[] = [];
  const seenCandidateIds = new Set<string>();
  const prefilterOptions: PrefilterOptions = { areaConstraint, excludeFood: shouldExcludeFood(categories) };

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    roundsUsed = round + 1;
    const anchorCount = ROUND_ANCHOR_COUNTS[round] ?? ROUND_ANCHOR_COUNTS[ROUND_ANCHOR_COUNTS.length - 1];
    const anchors = generateAnchors(radialMultiplier, anchorCount);
    const searchPlan = buildAnchorSearchPlan(anchors, categories);
    const rawCandidates = await searchAnchors(searchPlan);
    // ラウンド0のみ、areaConstraint.labelがあればText Search中心のSpot Poolも合わせて
    // 候補に加える(主目的地・主要waypointの質を上げるため、Nearby Search結果だけに
    // 依存しない)。Poolはテーマ(categories[0])ごとに1回だけ構築する(ラウンドを跨いで
    // 何度も同じText Searchを叩かない)。
    if (round === 0 && areaConstraint?.label && categories.length > 0) {
      const hasDestinationForPool = destinationLatLng.latitude !== origin.latitude || destinationLatLng.longitude !== origin.longitude;
      const pool = await buildSpotPool(categories[0] as unknown as PoolTheme, areaConstraint, excludePlaceIds, {
        availableTimeMinutes: targetMinutes,
        hasDestination: hasDestinationForPool,
      });
      rawCandidates.push(...poolCandidatesToAnchored(pool, origin));
    }
    // interleaveByAnchorで、評価予算(MAX_CANDIDATES_TO_EVALUATE)を1つのanchorが
    // 独占しないようにしてからスライスする(anchor間の多様性を評価対象の時点で確保する)。
    const shortlisted = interleaveByAnchor(prefilterCandidates(rawCandidates, mandatoryPoints, prefilterOptions))
      .filter((item) => !seenCandidateIds.has(item.candidate.id) && !excludePlaceIds.has(item.candidate.id))
      .slice(0, MAX_CANDIDATES_TO_EVALUATE);
    shortlisted.forEach((item) => seenCandidateIds.add(item.candidate.id));

    if (shortlisted.length > 0) {
      const scored = await evaluateCandidates(
        shortlisted,
        origin,
        destinationLatLng,
        userViaPoints,
        avoidHighways,
        targetMinutes,
        optionalViaPoints,
        preserveOptionalOrder
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

export interface FinalSelectionResult {
  /** 実際に別ルートとして採用する候補(本当に体験の違うものだけ)。 */
  selected: ScoredCandidate[];
  /** selectedと同じインデックスに対応する、「基本ルートがほぼ同じ」と判定された近隣候補(あれば)。 */
  nearby: ScoredCandidate[][];
}

/**
 * 理想帯の候補を優先し、その後score順(=時間予算への収束を維持)。そのうえで、
 * 同じanchor(方位/オフセット方向)からの候補が並ばないよう、2パスで選抜する:
 * パス1は「まだ選ばれていないanchor由来」の候補をscore順に優先して選ぶため、
 * 最良の1件(=最も収束した候補)は従来どおり必ず選ばれる。パス2は、多様なanchorの
 * 候補が足りず枠が埋まらない場合だけ、従来どおりscore順で残りを埋める
 * (実際の地形・候補分布によっては1〜2方向にしか候補が無いこともあるため)。
 *
 * 「3件返すこと自体を優先しない」方針(セクション1)のため、パス2も無条件に
 * score順で埋めるのではなく、既に選んだルートとPolyline的に類似する候補
 * (isSimilarRoute)は新しい別ルートにせず、対応するselected[]のnearby候補として
 * 集約する(セクション7: Route diversityとOptional spot diversityの分離)。
 * 本当に別ルートと言える候補が見つからなければ、maxCountに満たなくても
 * 架空の3案で埋めない。
 */
function selectFinalCandidates(
  scored: ScoredCandidate[],
  targetMinutes: number,
  maxCount: number,
  priorityAnchorIndex?: number
): FinalSelectionResult {
  const inBand = scored.filter((item) => isWithinIdealBand(item.durationMinutes, targetMinutes));
  const outOfBand = scored.filter((item) => !isWithinIdealBand(item.durationMinutes, targetMinutes));
  inBand.sort((a, b) => a.score - b.score);
  outOfBand.sort((a, b) => a.score - b.score);
  const ordered = [...inBand, ...outOfBand];

  const selected: ScoredCandidate[] = [];
  const nearby: ScoredCandidate[][] = [];

  /** 既に選んだルートのうち、このitemと「同じルート」とみなせるもののインデックスを返す(無ければ-1)。 */
  const findDuplicateIndex = (item: ScoredCandidate): number => {
    const point: LatLng = { latitude: item.candidate.latitude, longitude: item.candidate.longitude };
    for (let i = 0; i < selected.length; i++) {
      const existing = selected[i];
      const existingPoint: LatLng = { latitude: existing.candidate.latitude, longitude: existing.candidate.longitude };
      if (haversineMeters(point, existingPoint) < MIN_DISTANCE_BETWEEN_CANDIDATES_METERS) {
        return i;
      }
      if (isSimilarRoute(item.route, existing.route)) {
        return i;
      }
    }
    return -1;
  };

  const usedAnchors = new Set<number>();

  // 優先anchor(biasPoint、例:「生駒」)由来の候補があれば、scoreの順位に関わらず
  // 必ず1件目として採用する。時間予算への収束より、ユーザーが明示した地理的希望を
  // 優先するため(セクション4: 「AI interpretation結果を強く反映」)。
  if (priorityAnchorIndex !== undefined) {
    const priorityCandidates = ordered.filter((item) => item.anchorIndex === priorityAnchorIndex);
    if (priorityCandidates.length > 0) {
      selected.push(priorityCandidates[0]);
      nearby.push([]);
      usedAnchors.add(priorityAnchorIndex);
    }
  }

  // パス1: anchorの多様性を優先しつつ、既選択ルートと類似する候補はnearbyへ回す。
  for (const item of ordered) {
    if (selected.length >= maxCount) {
      break;
    }
    if (usedAnchors.has(item.anchorIndex)) {
      continue;
    }
    const dupIndex = findDuplicateIndex(item);
    if (dupIndex >= 0) {
      nearby[dupIndex].push(item);
      continue;
    }
    selected.push(item);
    nearby.push([]);
    usedAnchors.add(item.anchorIndex);
  }

  // パス2: 多様なanchorの候補だけでは枠が埋まらない場合、score順で残りを検討する。
  // ただし既選択ルートと類似する候補は、無理に別ルートとして埋めずnearbyへ回す
  // (=本当に別と言える候補が無ければmaxCount未満のまま返す)。
  for (const item of ordered) {
    if (selected.length >= maxCount) {
      break;
    }
    if (selected.includes(item)) {
      continue;
    }
    const dupIndex = findDuplicateIndex(item);
    if (dupIndex >= 0) {
      nearby[dupIndex].push(item);
      continue;
    }
    selected.push(item);
    nearby.push([]);
  }

  return { selected, nearby };
}

/**
 * Route完成後の最終Validation(セクション4相当)。Spot Pool・anchor探索の時点で
 * isOutsideAreaConstraintによる除外は既に行っているが、万一すり抜けた候補が無いか
 * ここでもう一段チェックする(多層防御)。selectedとnearbyを対応するインデックスで
 * 一緒にフィルタし、除外された分だけ件数が減る(条件違反のRouteを水増しでは埋めない)。
 */
function filterSelectedByAreaConstraint(result: FinalSelectionResult, areaConstraint?: AreaConstraint): FinalSelectionResult {
  if (!areaConstraint) {
    return result;
  }
  const selected: ScoredCandidate[] = [];
  const nearby: ScoredCandidate[][] = [];
  let rejected = 0;
  for (let i = 0; i < result.selected.length; i++) {
    const item = result.selected[i];
    const point: LatLng = { latitude: item.candidate.latitude, longitude: item.candidate.longitude };
    if (isOutsideAreaConstraint(point, areaConstraint, item.candidate.prefecture)) {
      rejected++;
      continue;
    }
    selected.push(item);
    // nearby候補自体も同じ最終チェックを通す(候補追加カードとして提示されるため)。
    nearby.push(
      result.nearby[i].filter((nearbyItem) => {
        const nearbyPoint: LatLng = { latitude: nearbyItem.candidate.latitude, longitude: nearbyItem.candidate.longitude };
        return !isOutsideAreaConstraint(nearbyPoint, areaConstraint, nearbyItem.candidate.prefecture);
      })
    );
  }
  if (rejected > 0) {
    // safe debug log(セクション16): 件数のみ。座標・施設名・Secretは出さない。
    console.log(`[drive-route-planner] finalAreaValidation rejectedCount=${rejected} keptCount=${selected.length}`);
  }
  return { selected, nearby };
}

// ===== 基本ルートからの増加分(addedMinutes)で評価する探索 ==========================
//
// 以下2つの状況で使う共通ロジック:
// 1. 時間指定ありで、基本ルート自体が既に時間予算を超えている場合
//    (「120分に近づける」評価ができないため、増加分の小さい候補を優先する)。
// 2. 時間指定なし・目的地ありの場合(目標収束スコアという概念自体が存在しないため、
//    最初から増加分ベースで評価する)。

const ADDED_MINUTES_MAX_CANDIDATES = 3;
const ADDED_MINUTES_MAX_PLANS = 2;
/** 基本ルートのPolylineから、この割合(25%/50%/75%)の地点をcorridor anchorとして使う。 */
const CORRIDOR_ANCHOR_FRACTIONS = [0.25, 0.5, 0.75];

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

/** 時間指定なしの場合の、寄り道候補に添える中立的な注記(架空の予算超過表現にしない)。 */
function buildAddedMinutesNoteWarning(addedMinutes: number): string | undefined {
  const rounded = Math.round(addedMinutes);
  if (rounded <= 1) {
    return undefined;
  }
  return `寄り道すると、直行ルートより約${rounded}分長くなります。`;
}

/**
 * 基本ルートのPolylineを(既定で)25%/50%/75%地点でサンプリングし、corridor anchorとして使う。
 * 固定1点(midpoint)だけの検索より、実在候補が見つかる確率を上げる狙い。fractionsを
 * 指定すると、coastal corridorの理想帯収束(ラウンド2)でより広く散らした地点を使える。
 * デコードに失敗した(2点未満)場合は空配列を返し、呼び出し元がフォールバックする。
 */
function sampleCorridorAnchors(basePlan: DrivePlan, fractions: number[] = CORRIDOR_ANCHOR_FRACTIONS): LatLng[] {
  const path = decodeGooglePolyline(basePlan.encodedPolyline);
  if (path.length < 2) {
    return [];
  }
  const anchors: LatLng[] = [];
  for (const fraction of fractions) {
    const point = pointAtFraction(path, fraction);
    if (point) {
      anchors.push(point);
    }
  }
  return anchors;
}

interface AddedMinutesCandidate {
  candidate: PlaceCandidate;
  route: RouteCandidate;
  durationMinutes: number;
  addedMinutes: number;
  anchorIndex: number;
}

interface AddedMinutesSelectionResult {
  selected: AddedMinutesCandidate[];
  nearby: AddedMinutesCandidate[][];
}

/**
 * addedMinutes昇順を基本としつつ、同じanchor由来の候補が並ばないよう2パスで選抜する
 * (selectFinalCandidatesと同じ軽量heuristic)。最良の1件(addedMinutes最小)は
 * 従来どおり必ず選ばれる。既に選んだルートとPolyline的に類似する候補は、別ルートに
 * せずnearbyへ回す(セクション7、selectFinalCandidatesと同じ方針)。
 */
function selectDiverseAddedMinutesCandidates(
  scored: AddedMinutesCandidate[],
  maxCount: number,
  priorityAnchorIndex?: number
): AddedMinutesSelectionResult {
  const ordered = [...scored].sort((a, b) => a.addedMinutes - b.addedMinutes);
  const selected: AddedMinutesCandidate[] = [];
  const nearby: AddedMinutesCandidate[][] = [];
  const usedAnchors = new Set<number>();

  const findDuplicateIndex = (item: AddedMinutesCandidate): number => {
    for (let i = 0; i < selected.length; i++) {
      if (isSimilarRoute(item.route, selected[i].route)) {
        return i;
      }
    }
    return -1;
  };

  // 優先anchor(biasPoint)由来の候補があれば、addedMinutesの順位に関わらず必ず1件目にする。
  if (priorityAnchorIndex !== undefined) {
    const priorityCandidates = ordered.filter((item) => item.anchorIndex === priorityAnchorIndex);
    if (priorityCandidates.length > 0) {
      selected.push(priorityCandidates[0]);
      nearby.push([]);
      usedAnchors.add(priorityAnchorIndex);
    }
  }

  for (const item of ordered) {
    if (selected.length >= maxCount) break;
    if (usedAnchors.has(item.anchorIndex)) continue;
    const dupIndex = findDuplicateIndex(item);
    if (dupIndex >= 0) {
      nearby[dupIndex].push(item);
      continue;
    }
    selected.push(item);
    nearby.push([]);
    usedAnchors.add(item.anchorIndex);
  }
  for (const item of ordered) {
    if (selected.length >= maxCount) break;
    if (selected.includes(item)) continue;
    const dupIndex = findDuplicateIndex(item);
    if (dupIndex >= 0) {
      nearby[dupIndex].push(item);
      continue;
    }
    selected.push(item);
    nearby.push([]);
  }
  return { selected, nearby };
}

interface AddedMinutesExploreOptions {
  maxCandidates: number;
  maxPlans: number;
  /** 未指定なら基本ルートに警告を付けない。 */
  buildBaseWarning?: (baseDurationMinutes: number) => string;
  buildCandidateWarning: (addedMinutes: number, actualMinutes: number) => string | undefined;
}

/**
 * 基本ルート(origin→userViaPoints→destination/origin)からの増加分(addedMinutes)を
 * 基準に、scenic/desiredStops等の明確な希望があるときだけ寄り道候補を探す。景色・
 * 寄り道の希望を完全に捨てず、実在するPlaceを経由地点として使うことで間接的に反映する。
 * 大量探索は行わない(Places最大3回・candidate最大3件・Routes評価最大3回)。
 * 良い候補が無ければ基本ルートのみを返す(無理に複数案を作らない)。
 */
async function exploreAddedMinutesCandidates(
  basePlan: DrivePlan,
  baseDurationMinutes: number,
  request: DrivePlanRequest,
  options: AddedMinutesExploreOptions
): Promise<DrivePlan[]> {
  const { origin, userViaPoints, returnTarget, preferences } = request;
  const hasDestination = returnTarget === "different";
  const destinationLatLng: LatLng = hasDestination ? (request.destination as LatLng) : origin;

  const basePlanWithWarning: DrivePlan = options.buildBaseWarning
    ? { ...basePlan, warning: options.buildBaseWarning(baseDurationMinutes) }
    : basePlan;

  // biasPoint(強い地理的希望、例:「生駒」)があれば、scenic等の希望が明示されて
  // いなくても探索する(地名の希望を黙って無視しない、セクション4)。
  if (!hasExplorablePreference(preferences) && !request.biasPoint) {
    return [basePlanWithWarning];
  }

  const categories = selectCategories(preferences);
  const lastRequiredPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
  // まず基本ルートのPolylineから25/50/75%のcorridor anchorを試し、デコードできなかった
  // 場合のみ、従来どおり固定1点(直行区間の中点、またはループ側の最終必須地点)へ後退する。
  // biasPointが指定されている場合は、最優先anchorとして必ず先頭に加える。
  const corridorAnchors = sampleCorridorAnchors(basePlan);
  const baseAnchors =
    corridorAnchors.length > 0
      ? corridorAnchors
      : [hasDestination ? midpoint(lastRequiredPoint, destinationLatLng) : lastRequiredPoint];
  const anchors = request.biasPoint ? [request.biasPoint, ...baseAnchors] : baseAnchors;
  const searchPlan = buildAnchorSearchPlan(anchors, categories);

  const rawCandidates = await searchAnchors(searchPlan);

  const mandatoryPoints: LatLng[] = [origin, ...userViaPoints, ...(request.optionalViaPoints ?? [])];
  if (hasDestination) {
    mandatoryPoints.push(destinationLatLng);
  }
  const prefilterOptions: PrefilterOptions = {
    areaConstraint: request.areaConstraint,
    excludeFood: shouldExcludeFood(categories),
  };
  // interleaveByAnchorで評価予算を1つのanchorが独占しないようにしてからスライスする
  // (selectFinalCandidatesと同じ多様性確保の考え方)。
  const shortlisted = interleaveByAnchor(prefilterCandidates(rawCandidates, mandatoryPoints, prefilterOptions)).slice(
    0,
    options.maxCandidates
  );

  if (shortlisted.length === 0) {
    return [basePlanWithWarning];
  }

  const optionalViaPoints = request.optionalViaPoints ?? [];
  const evaluations = await Promise.all(
    shortlisted.map(async ({ candidate, anchorIndex }): Promise<AddedMinutesCandidate | null> => {
      const candidatePoint: LatLng = { latitude: candidate.latitude, longitude: candidate.longitude };
      const trailingPoints = request.preserveOptionalOrder
        ? [...optionalViaPoints, candidatePoint]
        : orderWaypointsForEfficiency(lastRequiredPoint, destinationLatLng, [...optionalViaPoints, candidatePoint]);
      const outcome = await computeRoutes({
        origin,
        destination: destinationLatLng,
        intermediates: [...userViaPoints, ...trailingPoints],
        avoidHighways: preferences.avoidHighways,
      });
      if (!outcome.ok || outcome.routes.length === 0) {
        return null;
      }
      const route = outcome.routes[0];
      const durationMinutes = route.durationSeconds / 60;
      return { candidate, route, durationMinutes, addedMinutes: durationMinutes - baseDurationMinutes, anchorIndex };
    })
  );

  const scored = evaluations.filter((item): item is AddedMinutesCandidate => item !== null);
  const { selected, nearby } = selectDiverseAddedMinutesCandidates(
    scored,
    options.maxPlans,
    request.biasPoint ? 0 : undefined
  );

  const candidatePlans: DrivePlan[] = selected.map((item, index) => ({
    id: `plan-added-${index}`,
    distanceMeters: item.route.distanceMeters,
    durationSeconds: item.route.durationSeconds,
    encodedPolyline: item.route.encodedPolyline,
    source: "google",
    suggestedPlace: toSuggestedPlace(item.candidate),
    warning: options.buildCandidateWarning(item.addedMinutes, item.durationMinutes),
    nearbySuggestions:
      nearby[index].length > 0 ? toNearbySuggestions(nearby[index], item.durationMinutes) : undefined,
  }));

  return [basePlanWithWarning, ...candidatePlans];
}

// ===== 時間指定ありの場合(スコアリング・収束アルゴリズムは不変、最終選抜のみanchorの多様性を追加) ====

async function buildPlansWithTimeBudget(
  request: DrivePlanRequest,
  availableTimeMinutes: number,
  basePlan: DrivePlan | undefined,
  baseDurationMinutes: number | undefined,
  destinationLatLng: LatLng
): Promise<BuildPlansOutcome> {
  const { origin, userViaPoints, returnTarget, preferences } = request;
  const hasDestination = returnTarget === "different";

  if (basePlan && baseDurationMinutes !== undefined && baseDurationMinutes > availableTimeMinutes) {
    // ユーザーが指定した必須区間だけで既に予算超過。viaPointsは絶対に削らない。
    // scenic/desiredStops等の明確な希望があれば、時間超過を承知の上で希望を反映した
    // 候補も最小限探索する(無ければ基本ルートのみ、無理に3案作らない)。
    const plans = await exploreAddedMinutesCandidates(basePlan, baseDurationMinutes, request, {
      maxCandidates: ADDED_MINUTES_MAX_CANDIDATES,
      maxPlans: ADDED_MINUTES_MAX_PLANS,
      buildBaseWarning: (b) => buildOverBudgetBaseWarning(b, availableTimeMinutes, hasDestination),
      buildCandidateWarning: (_added, actual) => buildOverBudgetCandidateWarning(actual, availableTimeMinutes, hasDestination),
    });
    return {
      ok: true,
      plans,
      meta: { availableTimeMinutes, baseDurationMinutes, overBudget: true },
    };
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
  const mandatoryPoints: LatLng[] = [origin, ...userViaPoints, ...(request.optionalViaPoints ?? [])];
  if (hasDestination) {
    mandatoryPoints.push(destinationLatLng);
  }

  let anchorGenerator: AnchorGenerator;
  if (hasDestination) {
    const lastRequiredPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    anchorGenerator = (radialMultiplier, anchorCount) =>
      generateDestinationAnchors(
        lastRequiredPoint,
        destinationLatLng,
        clampRadialToAreaConstraint(resolveDestinationOffsetMeters(remainingMinutes), request.areaConstraint) *
          radialMultiplier,
        anchorCount,
        request.biasPoint
      );
  } else {
    const basePoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    anchorGenerator = (radialMultiplier, anchorCount) =>
      generateLoopAnchors(
        basePoint,
        clampRadialToAreaConstraint(resolveLoopRadialMeters(remainingMinutes), request.areaConstraint) *
          radialMultiplier,
        anchorCount,
        request.biasPoint
      );
  }

  const { scored, roundsUsed } = await runAdaptiveSearch(
    anchorGenerator,
    categories,
    mandatoryPoints,
    origin,
    destinationLatLng,
    userViaPoints,
    preferences.avoidHighways,
    availableTimeMinutes,
    request.areaConstraint,
    request.optionalViaPoints,
    request.preserveOptionalOrder,
    new Set(request.excludePlaceIds ?? [])
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

  const { selected, nearby } = filterSelectedByAreaConstraint(
    selectFinalCandidates(scored, availableTimeMinutes, 3, request.biasPoint ? 0 : undefined),
    request.areaConstraint
  );
  logDiversityOutcome("buildPlansWithTimeBudget", scored, selected, Boolean(request.biasPoint));

  if (selected.length === 0) {
    return {
      ok: true,
      plans: basePlan
        ? [{ ...basePlan, warning: basePlan.warning ?? "指定した地域内で提案できる候補地点が見つかりませんでした。" }]
        : [],
      meta: { availableTimeMinutes, baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
    };
  }

  const candidatePlans: DrivePlan[] = selected.map((item, index) => ({
    id: `plan-${index}`,
    distanceMeters: item.route.distanceMeters,
    durationSeconds: item.route.durationSeconds,
    encodedPolyline: item.route.encodedPolyline,
    source: "google",
    suggestedPlace: toSuggestedPlace(item.candidate),
    warning: resolveTimeBandWarning(item.durationMinutes, availableTimeMinutes),
    nearbySuggestions:
      nearby[index].length > 0 ? toNearbySuggestions(nearby[index], item.durationMinutes) : undefined,
  }));

  return {
    ok: true,
    plans: candidatePlans,
    meta: { availableTimeMinutes, baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
  };
}

// ===== 時間指定なしの場合(新規) ===============================================

/**
 * 時間指定なし・目的地なしの場合にのみ使う、anchor距離計算専用の内部ヒューリスティック。
 * このアプリの標準的な立ち寄りドライブの目安として使うが、ユーザーへは一切表示せず、
 * meta.availableTimeMinutes/RouteOption.targetDurationMinutesにも出さない
 * (ユーザーが指定した時間であるかのように見せないため)。
 */
const NO_TIME_HEURISTIC_TARGET_MINUTES = 120;

async function buildPlansWithoutTimeBudget(
  request: DrivePlanRequest,
  basePlan: DrivePlan | undefined,
  baseDurationMinutes: number | undefined,
  destinationLatLng: LatLng
): Promise<BuildPlansOutcome> {
  const { origin, userViaPoints, returnTarget, preferences } = request;

  if (returnTarget === "different") {
    // 目的地あり + 時間指定なし: 基本ルート(直行)を基準に、目標収束スコアではなく
    // addedMinutes(基本ルートからの増加分)で寄り道候補を評価する。時間予算という
    // 概念自体が無いため、overBudgetは常にfalse。
    if (!basePlan || baseDurationMinutes === undefined) {
      // returnTarget === "different"では常に基本ルートを計算しているため、
      // 通常ここには来ない安全策。
      return { ok: true, plans: [], meta: { overBudget: false } };
    }
    const plans = await exploreAddedMinutesCandidates(basePlan, baseDurationMinutes, request, {
      maxCandidates: ADDED_MINUTES_MAX_CANDIDATES,
      maxPlans: ADDED_MINUTES_MAX_PLANS,
      buildCandidateWarning: (added) => buildAddedMinutesNoteWarning(added),
    });
    return { ok: true, plans, meta: { baseDurationMinutes, overBudget: false } };
  }

  // 目的地なし + 時間指定なし: 内部ヒューリスティックのtargetMinutesはanchor距離計算
  // にのみ使う。「目安時間より長め/短め」といった、ユーザーが指定していない時間を
  // 前提にした警告は一切出さない。
  const targetMinutes = NO_TIME_HEURISTIC_TARGET_MINUTES;
  const remainingMinutes =
    baseDurationMinutes !== undefined ? targetMinutes - baseDurationMinutes : targetMinutes;

  if (remainingMinutes < MIN_REMAINING_MINUTES_FOR_SEARCH) {
    return {
      ok: true,
      plans: basePlan ? [basePlan] : [],
      meta: { baseDurationMinutes, overBudget: false },
    };
  }

  const categories = selectCategories(preferences);
  const mandatoryPoints: LatLng[] = [origin, ...userViaPoints, ...(request.optionalViaPoints ?? [])];
  const basePoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
  const anchorGenerator: AnchorGenerator = (radialMultiplier, anchorCount) =>
    generateLoopAnchors(
      basePoint,
      clampRadialToAreaConstraint(resolveLoopRadialMeters(remainingMinutes), request.areaConstraint) * radialMultiplier,
      anchorCount,
      request.biasPoint
    );

  const { scored, roundsUsed } = await runAdaptiveSearch(
    anchorGenerator,
    categories,
    mandatoryPoints,
    origin,
    destinationLatLng,
    userViaPoints,
    preferences.avoidHighways,
    targetMinutes,
    request.areaConstraint,
    request.optionalViaPoints,
    request.preserveOptionalOrder,
    new Set(request.excludePlaceIds ?? [])
  );

  if (scored.length === 0) {
    return {
      ok: true,
      plans: basePlan
        ? [{ ...basePlan, warning: basePlan.warning ?? "周辺で提案できる候補地点が見つかりませんでした。" }]
        : [],
      meta: { baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
    };
  }

  // 内部ヒューリスティックに基づく理想帯選別(selectFinalCandidates)自体は、複数の
  // 異なる長さの候補から多様性を持って選ぶための内部処理として使ってよいが、
  // 「目安時間より長め/短め」の警告文は出さない(resolveTimeBandWarningを呼ばない)。
  const { selected, nearby } = filterSelectedByAreaConstraint(
    selectFinalCandidates(scored, targetMinutes, 3, request.biasPoint ? 0 : undefined),
    request.areaConstraint
  );
  logDiversityOutcome("buildPlansWithoutTimeBudget", scored, selected, Boolean(request.biasPoint));

  if (selected.length === 0) {
    return {
      ok: true,
      plans: basePlan
        ? [{ ...basePlan, warning: basePlan.warning ?? "指定した地域内で提案できる候補地点が見つかりませんでした。" }]
        : [],
      meta: { baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
    };
  }

  const candidatePlans: DrivePlan[] = selected.map((item, index) => ({
    id: `plan-${index}`,
    distanceMeters: item.route.distanceMeters,
    durationSeconds: item.route.durationSeconds,
    encodedPolyline: item.route.encodedPolyline,
    source: "google",
    suggestedPlace: toSuggestedPlace(item.candidate),
    nearbySuggestions:
      nearby[index].length > 0 ? toNearbySuggestions(nearby[index], item.durationMinutes) : undefined,
  }));

  return {
    ok: true,
    plans: candidatePlans,
    meta: { baseDurationMinutes, overBudget: false, searchRoundsUsed: roundsUsed },
  };
}

// ===== 海沿いcorridor(「海沿い」はgoalだけでなくルート全体で扱う) ========================

/** 海沿いスポット検索の半径(海岸線は一般スポットより疎らなため、通常のanchor半径より広め)。 */
const COASTAL_SEARCH_RADIUS_METERS = 15_000;
/** ラウンド2(理想帯より短い場合)で探索範囲を広げる際の半径。 */
const COASTAL_SEARCH_RADIUS_METERS_WIDE = 25_000;
/** corridor内で採用する海沿いwaypoint同士の最小間隔(近すぎる2点を両方採用しない)。 */
const COASTAL_MIN_SPACING_METERS = 2_000;
/** Waypointsを増やしすぎない、という指示に従い、corridorへ組み込む海沿い地点は最初2件まで。 */
const MAX_COASTAL_WAYPOINTS = 2;
/** 理想帯より短い場合のみ、ラウンド2でちょうど1件追加を許容する上限(それでも3件まで)。 */
const MAX_TOTAL_COASTAL_WAYPOINTS = 3;
/** 目的地ありcorridorのラウンド2(理想帯より短い場合)で使う、より広く散らしたfraction列。 */
const WIDE_CORRIDOR_ANCHOR_FRACTIONS = [0.15, 0.5, 0.85];

/** ラウンド2で、見つかった海沿い候補の方角に沿ってさらに遠くを探す際の左右スプレッド(度)。 */
const COASTAL_BEARING_FOLLOW_SPREAD_DEGREES = [0, 25, -25];

/**
 * basePlanの有無・ラウンド(通常/wide)に応じたcoastal検索anchorを組み立てる。
 * loop(basePlan無し)でwide(理想帯より短い)の場合、単純に全方位のanchorを一律拡大すると
 * 海と無関係な方角(山側・内陸)へ広がるだけで実効性が薄いため、直前のラウンドで実際に
 * 見つかった海沿い候補の方角(previousBearingFromOrigin)へ沿って、より遠くを重点的に
 * 探す(同じ海岸線をさらに先まで辿るイメージ)。
 */
function buildCoastalAnchors(
  request: DrivePlanRequest,
  basePlan: DrivePlan | undefined,
  destinationLatLng: LatLng,
  targetMinutesForWarning: number | undefined,
  wide: boolean,
  previousBearingFromOrigin?: number,
  sectorBearing?: number
): LatLng[] {
  const { origin, userViaPoints, returnTarget } = request;
  const hasDestination = returnTarget === "different";

  if (basePlan) {
    const fractions = wide ? WIDE_CORRIDOR_ANCHOR_FRACTIONS : CORRIDOR_ANCHOR_FRACTIONS;
    const anchors = sampleCorridorAnchors(basePlan, fractions);
    if (anchors.length > 0) {
      return anchors;
    }
    const lastRequiredPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    return [hasDestination ? midpoint(lastRequiredPoint, destinationLatLng) : lastRequiredPoint];
  }

  // 出発地点に戻る・経由地点も無いループ(基本ルート計測自体が無い)の場合、
  // 複数方位のloop anchorをそのままcoastal検索のcenterとして使う。
  const baseRadial = resolveLoopRadialMeters(targetMinutesForWarning ?? NO_TIME_HEURISTIC_TARGET_MINUTES);
  if (wide && previousBearingFromOrigin !== undefined) {
    const radial = clampRadialToAreaConstraint(baseRadial * EXPAND_FACTOR, request.areaConstraint);
    return COASTAL_BEARING_FOLLOW_SPREAD_DEGREES.map((offset) =>
      projectPoint(origin, (previousBearingFromOrigin + offset + 360) % 360, radial)
    );
  }
  const radial = clampRadialToAreaConstraint(wide ? baseRadial * EXPAND_FACTOR : baseRadial, request.areaConstraint);
  // sectorBearingが指定されている場合(Hard Themeを複数Route Optionへ適用するための、
  // 方向別の独立したcorridor生成、セクション8)、その方向へ絞ってanchorを生成する。
  // 指定が無い場合は既存どおり固定の複数方位(コンパス方位)へ均等に散らす。
  if (sectorBearing !== undefined) {
    return COASTAL_BEARING_FOLLOW_SPREAD_DEGREES.map((offset) =>
      projectPoint(origin, (sectorBearing + offset + 360) % 360, radial)
    );
  }
  return generateLoopAnchors(origin, radial, 3);
}

/**
 * anchor群の周辺で実在する海沿いスポットを検索し、重複・近接・mandatory/area制約で絞り込む。
 * areaConstraint.labelがある場合、Nearby Search(anchor周辺のbeach/marina/fishing_pier)に
 * 加えて、地域全体を対象にしたText Search Pool(桂浜・室戸岬のような観光地寄りの候補も
 * 拾える)も候補ソースへ合流させる(セクション9: 「同一方面に偏りすぎない」ための多様な
 * 候補確保)。
 */
async function findCoastalCandidates(
  anchors: LatLng[],
  mandatoryPoints: LatLng[],
  maxWaypoints: number,
  searchRadiusMeters: number,
  areaConstraint?: AreaConstraint,
  excludePlaceIds: Set<string> = new Set()
): Promise<PlaceCandidate[]> {
  const rawResults = await Promise.all(
    anchors.map((anchor) =>
      searchNearbyPlaces({
        center: anchor,
        radiusMeters: searchRadiusMeters,
        category: "coastal",
        maxResults: 3,
        rankPreference: "DISTANCE",
      })
    )
  );

  const poolPlaces = areaConstraint
    ? await buildSpotPool("coastal", areaConstraint, excludePlaceIds, { hasDestination: false })
    : [];

  const candidateStream: PlaceCandidate[] = [...poolPlaces];
  for (const outcome of rawResults) {
    if (outcome.ok) {
      candidateStream.push(...outcome.places);
    }
  }

  const coastalCandidates: PlaceCandidate[] = [];
  {
    for (const place of candidateStream) {
      if (coastalCandidates.length >= maxWaypoints) {
        break;
      }
      if (excludePlaceIds.has(place.id)) {
        continue;
      }
      if (coastalCandidates.some((existing) => existing.id === place.id)) {
        continue;
      }
      const point: LatLng = { latitude: place.latitude, longitude: place.longitude };
      if (isOutsideAreaConstraint(point, areaConstraint, place.prefecture)) {
        continue;
      }
      const tooCloseToMandatory = mandatoryPoints.some(
        (mandatory) => haversineMeters(point, mandatory) < MIN_DISTANCE_FROM_MANDATORY_METERS
      );
      if (tooCloseToMandatory) {
        continue;
      }
      const tooCloseToExisting = coastalCandidates.some(
        (existing) =>
          haversineMeters(point, { latitude: existing.latitude, longitude: existing.longitude }) <
          COASTAL_MIN_SPACING_METERS
      );
      if (tooCloseToExisting) {
        continue;
      }
      coastalCandidates.push(place);
    }
  }
  return coastalCandidates;
}

function buildCoastalPlan(
  route: RouteCandidate,
  coastalCandidates: PlaceCandidate[],
  targetMinutesForWarning: number | undefined
): DrivePlan {
  const durationMinutes = route.durationSeconds / 60;
  return {
    id: "plan-coastal-corridor",
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    encodedPolyline: route.encodedPolyline,
    source: "google",
    suggestedPlace: toSuggestedPlace(coastalCandidates[0]),
    suggestedPlaces: coastalCandidates.map(toSuggestedPlace),
    corridorTheme: "coastal",
    warning:
      targetMinutesForWarning !== undefined
        ? resolveTimeBandWarning(durationMinutes, targetMinutesForWarning)
        : undefined,
  };
}

/**
 * 「海沿いを走りたい」を、最終地点だけでなくルート全体(corridor)へ反映する。
 * 基本ルートのPolyline(またはloopの場合は複数方位)沿いに複数のanchorを置き、
 * それぞれの周辺で実在する海沿いスポット(beach/marina/fishing_pier、WebFetchで
 * Google公式Table Aを確認済みの実在type)を検索し、重複しない最大2〜3件を
 * origin→...→coastal→optionalViaPoints→destination/originの順でGoogle Routesへ渡して
 * 実際にルート形状を海側へ寄せる(optionalViaPointsとの結合順序はorderWaypointsForEfficiency
 * で最適化する)。実在する海沿いスポットが見つからなければ、架空の候補で埋めずnullを返す。
 *
 * availableTimeMinutes(targetMinutesForWarning)が指定されている場合、既存のtarget-time
 * anchor探索(runAdaptiveSearch)と同じ理想帯(85〜110%)へ収束するよう、最大
 * MAX_SEARCH_ROUNDS回まで適応的に探索範囲・waypoint数を調整する(「海沿いだから
 * 時間目標を無視する」ことがないように、セクション1)。理想帯に届かない場合も、
 * それまでで最も理想に近かった結果を採用する(架空の延長はしない)。
 */
async function buildCoastalCorridorPlan(
  request: DrivePlanRequest,
  mandatoryPoints: LatLng[],
  destinationLatLng: LatLng,
  basePlan: DrivePlan | undefined,
  targetMinutesForWarning: number | undefined,
  sectorBearing?: number
): Promise<DrivePlan | null> {
  const { origin, userViaPoints, preferences } = request;
  const optionalViaPoints = request.optionalViaPoints ?? [];
  const excludePlaceIds = new Set(request.excludePlaceIds ?? []);

  /** originに近い順に並べ替えたうえで、optionalViaPointsと合わせて経路を実測する。 */
  const evaluateCoastalSet = async (
    candidates: PlaceCandidate[]
  ): Promise<{ plan: DrivePlan; durationMinutes: number } | null> => {
    if (candidates.length === 0) {
      return null;
    }
    const sorted = [...candidates].sort(
      (a, b) =>
        haversineMeters(origin, { latitude: a.latitude, longitude: a.longitude }) -
        haversineMeters(origin, { latitude: b.latitude, longitude: b.longitude })
    );
    const coastalPoints = sorted.map((c) => ({ latitude: c.latitude, longitude: c.longitude }));
    const lastFixedPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    const trailingPoints = request.preserveOptionalOrder
      ? [...coastalPoints, ...optionalViaPoints]
      : orderWaypointsForEfficiency(lastFixedPoint, destinationLatLng, [...coastalPoints, ...optionalViaPoints]);

    const outcome = await computeRoutes({
      origin,
      destination: destinationLatLng,
      intermediates: [...userViaPoints, ...trailingPoints],
      avoidHighways: preferences.avoidHighways,
    });
    if (!outcome.ok || outcome.routes.length === 0) {
      return null;
    }
    const route = outcome.routes[0];
    return { plan: buildCoastalPlan(route, sorted, targetMinutesForWarning), durationMinutes: route.durationSeconds / 60 };
  };

  // ラウンドをまたいで海沿い候補を積み増していく(ラウンド2で見つかった候補で
  // ラウンド1の候補を置き換えるのではなく、追加する)。これにより「須磨1件では
  // 短すぎるが、須磨+もう1件でちょうど良い」のような中間解を逃さない。
  // 「短すぎる」と判定された次のラウンドでは、一度に大きく増やして大幅な
  // オーバーシュートを招かないよう、常にちょうど1件だけ追加を試みる
  // (MAX_COASTAL_WAYPOINTS=3を超えない範囲で)。
  const accumulated: PlaceCandidate[] = [];
  let slotsThisRound = MAX_COASTAL_WAYPOINTS;
  let wide = false;
  let searchRadius = COASTAL_SEARCH_RADIUS_METERS;
  let bestPlan: DrivePlan | null = null;
  let bestRatioDiff = Infinity;
  // 直前までに見つかった海沿い候補のうち、originから最も遠いもの(フロンティア)の
  // originから見た方角。理想帯より短い場合、この方角へさらに遠くを探す(セクション1)。
  let previousBearingFromOrigin: number | undefined;

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    const remainingSlots = Math.min(slotsThisRound, MAX_TOTAL_COASTAL_WAYPOINTS - accumulated.length);
    if (remainingSlots <= 0) {
      break;
    }
    const anchors = buildCoastalAnchors(
      request,
      basePlan,
      destinationLatLng,
      targetMinutesForWarning,
      wide,
      previousBearingFromOrigin,
      sectorBearing
    );
    const exclusionPoints = [
      ...mandatoryPoints,
      ...accumulated.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
    ];
    const found = await findCoastalCandidates(
      anchors,
      exclusionPoints,
      remainingSlots,
      searchRadius,
      request.areaConstraint,
      excludePlaceIds
    );
    if (found.length === 0) {
      // これ以上の探索では新しい候補が見つからない。bestPlan(あれば)をそのまま返す。
      break;
    }
    accumulated.push(...found);

    const farthest = accumulated.reduce((frontier, c) =>
      haversineMeters(origin, { latitude: c.latitude, longitude: c.longitude }) >
      haversineMeters(origin, { latitude: frontier.latitude, longitude: frontier.longitude })
        ? c
        : frontier
    );
    previousBearingFromOrigin = bearingDegrees(origin, { latitude: farthest.latitude, longitude: farthest.longitude });

    const result = await evaluateCoastalSet(accumulated);
    if (!result) {
      break;
    }

    if (targetMinutesForWarning === undefined) {
      // 時間指定が無ければ収束判定の対象外。ここまでで見つかった実在候補をそのまま採用する。
      return result.plan;
    }

    const ratio = result.durationMinutes / targetMinutesForWarning;
    const ratioDiff = Math.abs(ratio - 1);
    if (ratioDiff < bestRatioDiff) {
      bestRatioDiff = ratioDiff;
      bestPlan = result.plan;
    }

    if (isWithinIdealBand(result.durationMinutes, targetMinutesForWarning) || round === MAX_SEARCH_ROUNDS - 1) {
      break;
    }

    if (ratio < IDEAL_BAND_MIN_RATIO) {
      // 短すぎる: より遠いcoastal anchor・より広い検索半径で、一度に大きく増やしすぎず
      // ちょうど1件だけ追加を試みる(大幅なオーバーシュートを避けるため)。
      wide = true;
      searchRadius = COASTAL_SEARCH_RADIUS_METERS_WIDE;
      slotsThisRound = 1;
    } else if (ratio > IDEAL_BAND_MAX_RATIO) {
      // 長すぎる: origin寄りの1件だけに絞って再計算し、それを採用して終了する。
      const nearest = accumulated.reduce((n, c) =>
        haversineMeters(origin, { latitude: c.latitude, longitude: c.longitude }) <
        haversineMeters(origin, { latitude: n.latitude, longitude: n.longitude })
          ? c
          : n
      );
      const truncated = await evaluateCoastalSet([nearest]);
      if (truncated) {
        const truncatedRatio = truncated.durationMinutes / targetMinutesForWarning;
        const truncatedRatioDiff = Math.abs(truncatedRatio - 1);
        if (truncatedRatioDiff < bestRatioDiff) {
          bestRatioDiff = truncatedRatioDiff;
          bestPlan = truncated.plan;
        }
      }
      break;
    } else {
      break; // 惜しい範囲(0.80〜0.85 または 1.10〜1.20)は追加探索しない(他の探索経路と同じ方針)。
    }
  }

  return bestPlan;
}

/** corridorPlanを、既存候補(anchor探索結果)の先頭へ優先的に差し込み、類似する候補はnearbySuggestionsへ畳み込む。 */
function mergeCorridorPlanIntoOutcome(outcome: BuildPlansOutcome, corridorPlan: DrivePlan): BuildPlansOutcome {
  if (!outcome.ok) {
    return outcome;
  }

  const basePlanEntry = outcome.plans.find((plan) => plan.id === "plan-base");
  const nonBasePlans = outcome.plans.filter((plan) => plan.id !== "plan-base");

  const dedupedOthers: DrivePlan[] = [];
  const mergedNearby: NearbySuggestion[] = [];
  for (const plan of nonBasePlans) {
    const similar = isSimilarRoute(plan, corridorPlan);
    if (similar) {
      if (plan.suggestedPlace) {
        mergedNearby.push({
          ...plan.suggestedPlace,
          addedMinutes: Math.max(0, Math.round(plan.durationSeconds / 60 - corridorPlan.durationSeconds / 60)),
        });
      }
      continue;
    }
    dedupedOthers.push(plan);
  }

  const finalCorridorPlan: DrivePlan = {
    ...corridorPlan,
    nearbySuggestions:
      mergedNearby.length > 0 ? [...(corridorPlan.nearbySuggestions ?? []), ...mergedNearby] : corridorPlan.nearbySuggestions,
  };

  const combined: DrivePlan[] = [];
  if (basePlanEntry) {
    combined.push(basePlanEntry);
  }
  combined.push(finalCorridorPlan, ...dedupedOthers);

  return { ok: true, plans: combined.slice(0, 3), meta: outcome.meta };
}

/** 方向別に独立したcoastal corridorを生成する際の基準方位(120°間隔で3方向)。 */
const CORRIDOR_SECTOR_BEARINGS = [0, 120, 240];
const MAX_THEME_ROUTE_PLANS = 3;

/**
 * Hard Theme(海沿い)を1案だけでなく全Route Optionへ適用するため(セクション8)、
 * 出発地点へ戻るループ・目的地なしの場合に限り、異なる方向(セクター)から複数の
 * 独立したcoastal corridorを生成する(例: A東側海沿い/B西側海沿い/C別の海岸)。
 * 目的地が固定されている場合(userViaPoints/destinationあり)は、origin→destinationの
 * 道自体が1本しか無いため、この方向別diversityという概念は成立せず、既存どおり
 * 単一のcorridorプランをbuildCoastalCorridorPlan単体で構築する(呼び出し元で分岐)。
 * 各セクターの生成で既に使った実在Place IDは次のセクターから除外し、同じ海岸が
 * 複数案にまたがって使われないようにする。isSimilarRouteで、方角は違っても実質同じ
 * ルート形状になった場合はさらに除外する。
 */
/**
 * originから見た実在候補の方角を貪欲法で選び、互いになるべく離れた(=方向として
 * 多様な)方角を最大count個返す。固定のコンパス方位(0°/120°/240°)だと、高知県の
 * ように海岸線が特定方向(南側)に偏る地域では、北向き等の候補が存在しない方角を
 * 無駄に探索してしまう(セクション27で実際に発生した不具合)。実在するPoolの分布
 * そのものから方角を選ぶことで、この無駄をなくし、かつ確実に候補がある方向を選べる。
 */
function selectDiverseBearings(origin: LatLng, pool: PlaceCandidate[], count: number): number[] {
  const bearings = pool.map((place) => bearingDegrees(origin, { latitude: place.latitude, longitude: place.longitude }));
  if (bearings.length === 0) {
    return [];
  }
  const selected: number[] = [bearings[0]];
  const remaining = bearings.slice(1);
  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestMinDiff = -1;
    for (let i = 0; i < remaining.length; i++) {
      const minDiff = Math.min(...selected.map((s) => angleDiffDegrees(s, remaining[i])));
      if (minDiff > bestMinDiff) {
        bestMinDiff = minDiff;
        bestIndex = i;
      }
    }
    selected.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  return selected;
}

async function buildMultiSectorCoastalPlans(
  request: DrivePlanRequest,
  mandatoryPoints: LatLng[],
  destinationLatLng: LatLng,
  targetMinutesForWarning: number | undefined
): Promise<DrivePlan[]> {
  const plans: DrivePlan[] = [];
  const usedPlaceIds = new Set(request.excludePlaceIds ?? []);

  // 実在する海沿いPoolを先に1回作り、実際に候補が存在する方角だけをセクターとして使う。
  // buildSpotPoolはfingerprintキャッシュを使うため、各セクターのbuildCoastalCorridorPlan
  // 内で再度呼ばれてもText Searchは再実行されない(同じ地域・テーマならcache hit)。
  let sectorBearings: number[] = CORRIDOR_SECTOR_BEARINGS;
  if (request.areaConstraint?.label) {
    const scoutPool = await buildSpotPool("coastal", request.areaConstraint, usedPlaceIds, { hasDestination: false });
    const diverseBearings = selectDiverseBearings(request.origin, scoutPool, MAX_THEME_ROUTE_PLANS);
    if (diverseBearings.length > 0) {
      sectorBearings = diverseBearings;
    }
  }

  for (const sectorBearing of sectorBearings) {
    if (plans.length >= MAX_THEME_ROUTE_PLANS) {
      break;
    }
    const sectorRequest: DrivePlanRequest = { ...request, excludePlaceIds: [...usedPlaceIds] };
    const plan = await buildCoastalCorridorPlan(
      sectorRequest,
      mandatoryPoints,
      destinationLatLng,
      undefined,
      targetMinutesForWarning,
      sectorBearing
    );
    if (!plan) {
      continue;
    }
    if (plans.some((existing) => isSimilarRoute(existing, plan))) {
      continue;
    }
    plans.push(plan);
    for (const place of plan.suggestedPlaces ?? []) {
      usedPlaceIds.add(place.id);
    }
  }

  // safe debug log(セクション30): 件数のみ。座標・施設名・Secretは出さない。
  console.log(`[drive-route-planner] multiSectorCoastal finalRouteCount=${plans.length}`);
  return plans.map((plan, index) => ({ ...plan, id: `plan-coastal-${index}` }));
}

/**
 * ドライブプランを構築する(1〜3件)。
 *
 * - 目的地あり(returnTarget === "different")、出発地点へ戻る(userViaPointsあり/なし)
 *   のいずれも扱う。
 * - availableTimeMinutesが指定されている場合は既存の時間予算ロジック(動作変更なし)、
 *   未指定の場合は基本ルートからの増加分(addedMinutes)またはanchor距離計算専用の
 *   内部ヒューリスティックを使う、別ロジックを使う(ユーザー指定に見せない)。
 * - Google APIの呼び出しが失敗した場合にmockへフォールバックすることはない
 *   (呼び出し元がok:falseまたはplans:[]を見て、エラー/空状態を適切に扱う)。
 * - preferCoastalRoadsがtrueの場合、既存のanchor探索に加えて海沿いcorridorプラン
 *   (buildCoastalCorridorPlan)を試み、成功すれば最優先候補として結果へ差し込む
 *   (「海沿い」を最終地点だけでなくルート全体の経由地点として反映するため)。
 *
 * 条件の優先順位(上ほど優先):
 *   1. userViaPoints・destination等のユーザー必須地点(順序・件数を一切変更しない)
 *   2. areaConstraint(「高知県でドライブ」等の強い地域制約、候補・anchorをこの範囲に制約)
 *   3. 明示的なルートcorridor希望(preferCoastalRoads等)
 *   4. optionalViaPoints(候補カードから選んで既に追加済みのspot。必ず経由するが、
 *      順序はorderWaypointsForEfficiencyで効率よく並べ替えてよい)
 *   5. availableTimeMinutes(時間目標への収束)
 *   6. その他の柔らかいテーマ(preferredScenery等)
 * time targetとmandatory locationが両立しない場合(基本ルート自体が既に予算超過)は、
 * warningを出したうえでmandatoryを優先する(既存のbuildOverBudgetBaseWarning参照)。
 */
export async function buildDrivePlans(request: DrivePlanRequest): Promise<BuildPlansOutcome> {
  const { origin, destination, userViaPoints, returnTarget, availableTimeMinutes, preferences } = request;

  // returnTarget === "different" の場合、plan-types.tsのバリデーションにより
  // destinationは必ず存在する。
  const destinationLatLng: LatLng = returnTarget === "different" ? (destination as LatLng) : origin;

  // 出発地点へ戻る・経由地点も無い場合は、測定すべき「必須区間」自体が存在しない
  // (出発地=目的地、経由地なしのリクエストは実質「移動なし」のため)。この場合は
  // 基本ルートの計測をスキップし、候補地点(最低1件)を前提とした探索のみを行う。
  // この基本ルート計測は時間指定の有無に関わらず共通(availableTimeMinutesに依存しない)。
  // optionalViaPoints(候補カードから選んで既に追加済みのspot)がある場合も、それを
  // 必ず含む基本ルートを計測する対象とする(空の基本ルートへフォールバックした際に
  // 既存の選択が消えてしまわないようにするため、セクション11: 状態を失わない)。
  const hasMandatorySegment =
    returnTarget === "different" || userViaPoints.length > 0 || (request.optionalViaPoints?.length ?? 0) > 0;

  let baseDurationMinutes: number | undefined;
  let basePlan: DrivePlan | undefined;

  if (hasMandatorySegment) {
    const lastFixedPoint = userViaPoints.length > 0 ? userViaPoints[userViaPoints.length - 1] : origin;
    const orderedOptionalForBase = request.preserveOptionalOrder
      ? (request.optionalViaPoints ?? [])
      : orderWaypointsForEfficiency(lastFixedPoint, destinationLatLng, request.optionalViaPoints ?? []);
    const baseOutcome = await computeRoutes({
      origin,
      destination: destinationLatLng,
      intermediates: [...userViaPoints, ...orderedOptionalForBase],
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
  }

  // lockToProvidedStops: 既に選択済みのRouteへ、ユーザーが選んだ1件のOptional Stopだけを
  // 追加する操作(ドライブ計画チャットの候補カード選択・modify_routes)専用。
  // userViaPoints/optionalViaPointsを通る基本ルート(=直前で計測済みのbasePlan)だけを
  // そのまま返し、残り時間を埋めるための追加anchor探索(Spot Pool/Nearby Search、
  // buildPlansWithTimeBudget/buildPlansWithoutTimeBudgetの候補探索フェーズ)を一切行わない。
  // これにより、以前選ばれていたsuggestedPlace(anchor探索の結果)をuserViaPointsとして
  // 渡しておけば、再探索によって別の場所へ差し替えられることなく、指定した地点群だけを
  // 通るルートがそのまま返る(実機で「温泉を追加したら選択していたRouteが失われた」
  // 不具合の修正)。基本ルート自体が計測できていない場合(via pointが1つも無い等)は、
  // 通常どおりのフローへフォールバックする。
  if (request.lockToProvidedStops && basePlan && baseDurationMinutes !== undefined) {
    const isOverBudget = availableTimeMinutes !== undefined && baseDurationMinutes > availableTimeMinutes;
    const lockedPlan: DrivePlan = isOverBudget
      ? {
          ...basePlan,
          warning: buildOverBudgetBaseWarning(baseDurationMinutes, availableTimeMinutes as number, returnTarget === "different"),
        }
      : basePlan;
    return {
      ok: true,
      plans: [lockedPlan],
      meta: { availableTimeMinutes, baseDurationMinutes, overBudget: isOverBudget },
    };
  }

  const outcome =
    availableTimeMinutes === undefined
      ? await buildPlansWithoutTimeBudget(request, basePlan, baseDurationMinutes, destinationLatLng)
      : await buildPlansWithTimeBudget(request, availableTimeMinutes, basePlan, baseDurationMinutes, destinationLatLng);

  if (!outcome.ok || !preferences.preferCoastalRoads) {
    return outcome;
  }

  const mandatoryPoints: LatLng[] = [origin, ...userViaPoints, ...(request.optionalViaPoints ?? [])];
  if (returnTarget === "different") {
    mandatoryPoints.push(destinationLatLng);
  }

  if (!basePlan && returnTarget !== "different") {
    // 出発地点へ戻るループ・目的地なし: Hard Theme(海沿い)を全Route Optionへ適用する
    // (セクション8)。異なる方向から複数の独立したcorridorを生成し、1つも作れなければ
    // 既存のanchor探索結果へフォールバックする(架空の海沿い候補では埋めない)。
    const corridorPlans = await buildMultiSectorCoastalPlans(request, mandatoryPoints, destinationLatLng, availableTimeMinutes);
    if (corridorPlans.length > 0) {
      return { ok: true, plans: corridorPlans, meta: outcome.meta };
    }
    return outcome;
  }

  // 目的地固定(destinationあり、またはuserViaPointsで既に区間が決まっている)の場合は
  // origin→destinationの道自体が1本のため、単一のcorridorプランを最優先候補として差し込む。
  const corridorPlan = await buildCoastalCorridorPlan(
    request,
    mandatoryPoints,
    destinationLatLng,
    basePlan,
    availableTimeMinutes
  );
  if (!corridorPlan) {
    // 実在する海沿いスポットが見つからなかった場合、無理にcorridorを作らず
    // 既存のanchor探索結果(通常のscenic候補等)をそのまま返す。
    return outcome;
  }

  return mergeCorridorPlanIntoOutcome(outcome, corridorPlan);
}
