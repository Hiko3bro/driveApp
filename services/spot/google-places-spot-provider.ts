import { haversineDistanceKm, isValidCoordinates } from '@/services/location/coordinates';
import { searchNearbyPlaces, type PlaceCandidate } from '@/services/spot/google-places-client';
import {
  SpotDiscoveryError,
  type PlaceSearchCategory,
  type SpotProvider,
  type SpotSearchParams,
} from '@/services/spot/spot-provider';
import type { AiRoutePreferences } from '@/types/ai-route-preferences';
import type { Coordinates } from '@/types/location';
import type { Spot, SpotCategory } from '@/types/spot';

/**
 * 実在するスポットを、Supabase Edge Function `google-places` から取得する実装。
 * Expoから直接Google Places APIを呼び出すことはない(google-places-client.ts経由)。
 *
 * 「周辺スポットを探す」は目的地・出発地点付近だけに偏らないよう、選択中ルートの
 * 実Polyline(route.path)から25%/50%/75%地点の実座標をアンカーとして使い、
 * ルートの走行途中で寄りやすいスポットを検索する。カテゴリチップは「タップされた
 * ときにそのカテゴリだけをオンデマンドで検索する」設計(呼び出し元のapp/spot-discovery.tsx
 * 側で、まだ取得していないカテゴリかどうかを管理する)。1回のgetSpots呼び出しは
 * 1カテゴリにつき最大3アンカー分(=最大3回のGoogle Places呼び出し)に抑える。
 */
const SEARCH_RADIUS_METERS = 6_000;
/** 1アンカーあたりの取得件数。3アンカー取得後、重複除外・上限適用する前の値。 */
const MAX_RESULTS_PER_ANCHOR = 5;
/** 1カテゴリの表示件数上限(重複除外後)。横スワイプのカード一覧に適した件数に抑える。 */
const MAX_RESULTS_PER_CATEGORY = 8;
/** 立ち寄りにかかる時間の見積もりに使う、控えめな巡航速度(km/h)。 */
const DETOUR_SPEED_KMH = 25;
const MIN_EXTRA_MINUTES = 3;
/** ルートPolyline上でスポットを検索するアンカー地点(区間の何%地点か)。 */
const ROUTE_ANCHOR_FRACTIONS = [0.25, 0.5, 0.75];

const CATEGORY_TO_SPOT_CATEGORY: Record<PlaceSearchCategory, SpotCategory> = {
  restaurant: 'ごはん',
  cafe: 'カフェ',
  scenic: '絶景',
  onsen: '温泉',
  activity: 'アクティビティ',
};

/** app/spot-discovery.tsxがカテゴリチップ(具体カテゴリ)からGoogle Places側のenumへ変換するための逆引き。 */
export const SPOT_CATEGORY_TO_PLACE_CATEGORY: Record<SpotCategory, PlaceSearchCategory> = {
  ごはん: 'restaurant',
  カフェ: 'cafe',
  絶景: 'scenic',
  温泉: 'onsen',
  アクティビティ: 'activity',
};

/**
 * AIが解釈した嗜好から「おすすめ」チップ用の優先カテゴリを1つ選ぶ。desiredStopsが
 * あれば先頭を使い、無ければscenicを既定にする(drive-route-planner側の
 * カテゴリ選定と同じ優先順位)。
 */
export function resolvePreferredSpotCategory(preferences?: AiRoutePreferences): PlaceSearchCategory {
  if (preferences && preferences.desiredStops.length > 0) {
    return preferences.desiredStops[0];
  }
  return 'scenic';
}

/**
 * 選択中ルートのPolyline(route.path)から、25%/50%/75%地点に最も近い実座標を
 * アンカーとして返す。短いルート(有効座標が4点未満)では同じ地点が重複しうるため、
 * インデックス単位で重複除外する。
 */
export function sampleRouteAnchors(path: Coordinates[]): Coordinates[] {
  const validPath = path.filter(isValidCoordinates);
  if (validPath.length === 0) {
    return [];
  }

  const seenIndices = new Set<number>();
  const anchors: Coordinates[] = [];
  for (const fraction of ROUTE_ANCHOR_FRACTIONS) {
    const index = Math.min(validPath.length - 1, Math.max(0, Math.round((validPath.length - 1) * fraction)));
    if (seenIndices.has(index)) {
      continue;
    }
    seenIndices.add(index);
    anchors.push(validPath[index]);
  }
  return anchors;
}

/**
 * 立ち寄りにかかる追加時間・距離を、最寄りのアンカー地点(=実際に検索に使った
 * ルート沿いの実座標)からの直線距離(haversine)を往復すると見なして見積もる。
 * Google Routesでの正確な迂回時間の実測は、選択後にservices/spot/spot-route-recalculation.tsが
 * 別途行う(ここはカード表示・即時のUI用の見積もり値)。
 */
function estimateDetour(anchor: Coordinates, spot: Coordinates): { extraDistanceKm: number; extraMinutes: number } {
  const oneWayKm = haversineDistanceKm(anchor, spot);
  const extraDistanceKm = Math.round(oneWayKm * 2 * 10) / 10;
  const extraMinutes = Math.max(MIN_EXTRA_MINUTES, Math.round((extraDistanceKm / DETOUR_SPEED_KMH) * 60));
  return { extraDistanceKm, extraMinutes };
}

function toSpot(candidate: PlaceCandidate, category: SpotCategory, anchor: Coordinates): Spot {
  const coordinates: Coordinates = { latitude: candidate.latitude, longitude: candidate.longitude };
  const { extraDistanceKm, extraMinutes } = estimateDetour(anchor, coordinates);
  return {
    id: candidate.id,
    name: candidate.name,
    category,
    description: '実在するスポットです。',
    extraMinutes,
    extraDistanceKm,
    coordinates,
    recommendation: 'ルート沿いから立ち寄りやすい場所です。',
    isMock: false,
  };
}

export class GooglePlacesSpotProvider implements SpotProvider {
  async getSpots(params: SpotSearchParams): Promise<Spot[]> {
    const { route, category } = params;
    const anchors = sampleRouteAnchors(route.path);
    if (anchors.length === 0) {
      throw new SpotDiscoveryError('ルート周辺の場所を確認できませんでした。ルートを選び直してください。');
    }

    const results = await Promise.all(
      anchors.map(async (anchor) => ({
        anchor,
        outcome: await searchNearbyPlaces({
          center: anchor,
          radiusMeters: SEARCH_RADIUS_METERS,
          category,
          maxResults: MAX_RESULTS_PER_ANCHOR,
        }),
      }))
    );

    // 全アンカーが失敗した場合のみ検索失敗として扱う(mockへは一切フォールバックしない)。
    // 一部のアンカーだけ成功した場合は、取得できた分だけの実在データとして返す
    // (架空データで穴埋めしない)。
    if (results.every((result) => !result.outcome.ok)) {
      throw new SpotDiscoveryError('スポットの検索に失敗しました。もう一度お試しください。');
    }

    const seenIds = new Set<string>();
    const spots: Spot[] = [];
    for (const { anchor, outcome } of results) {
      if (!outcome.ok) {
        continue;
      }
      for (const candidate of outcome.places) {
        if (seenIds.has(candidate.id) || spots.length >= MAX_RESULTS_PER_CATEGORY) {
          continue;
        }
        seenIds.add(candidate.id);
        spots.push(toSpot(candidate, CATEGORY_TO_SPOT_CATEGORY[category], anchor));
      }
    }
    return spots;
  }
}
