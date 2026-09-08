import type { GoogleRouteCandidate } from '@/services/route/google-routes-client';
import { decodeGooglePolyline } from '@/services/route/polyline';
import type { Coordinates } from '@/types/location';
import type { RouteOption, RouteWaypoint } from '@/types/route';

/** Googleのroutes.routeLabels(既知の値のみ)を、技術用語を出さない日本語ラベルへ変換する。 */
const ROUTE_LABEL_TEXT: Record<string, string> = {
  DEFAULT_ROUTE: 'おすすめルート',
  DEFAULT_ROUTE_ALTERNATE: '別ルート',
};

function buildRouteName(index: number, routeLabels: string[]): string {
  const known = routeLabels.find((label) => ROUTE_LABEL_TEXT[label]);
  if (known) {
    const base = ROUTE_LABEL_TEXT[known];
    return index === 0 ? base : `${base}${index + 1}`;
  }
  return `ルート${index + 1}`;
}

export interface GoogleRouteMapperContext {
  departureLabel: string;
  destinationLabel: string;
  /** ユーザーが実際に指定した経由地点(捏造しない、実座標・実ラベルのみ)。 */
  viaPoints: { label: string; coordinates: Coordinates }[];
  /** avoidHighwaysが実際にGoogleへのリクエストへ適用されたかどうか(タグ表示用)。 */
  avoidHighwaysApplied: boolean;
}

/**
 * Google Routes APIから正規化されたRouteCandidate[]を、既存のRouteOption[]へ変換する。
 * 架空の道路名・ルート説明は追加せず、Googleの実データ(距離・所要時間・実際に
 * ユーザーが指定した経由地点/目的地)だけから組み立てる。polylineのデコードに
 * 失敗した(2点未満しか得られなかった)候補は採用しない。
 */
export function buildRouteOptionsFromGoogleCandidates(
  candidates: GoogleRouteCandidate[],
  context: GoogleRouteMapperContext
): RouteOption[] {
  const options: RouteOption[] = [];

  candidates.forEach((candidate, index) => {
    const path = decodeGooglePolyline(candidate.encodedPolyline);
    if (path.length < 2) {
      return;
    }

    const waypoints: RouteWaypoint[] = [
      ...context.viaPoints.map((point) => ({ name: point.label, coordinates: point.coordinates })),
      { name: context.destinationLabel, coordinates: path[path.length - 1] },
    ];

    const tags: string[] = [];
    if (context.avoidHighwaysApplied) {
      tags.push('高速道路を避ける');
    }

    options.push({
      id: `google-route-${index}`,
      name: buildRouteName(index, candidate.routeLabels),
      description: '実際の道路データに基づくルートです。',
      distanceKm: Math.round((candidate.distanceMeters / 1000) * 10) / 10,
      durationMinutes: Math.max(1, Math.round(candidate.durationSeconds / 60)),
      tags,
      waypoints,
      path,
      highlight: `${context.departureLabel}から${context.destinationLabel}までの実際のルートです。`,
      audience: '実際の道路状況に沿って移動したい人向け',
      source: 'google',
    });
  });

  return options;
}
