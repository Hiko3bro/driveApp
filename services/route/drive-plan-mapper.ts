import type { DrivePlan, DrivePlanMeta, DrivePlanSuggestedPlace } from '@/services/route/drive-route-planner-client';
import { decodeGooglePolyline } from '@/services/route/polyline';
import type { Coordinates } from '@/types/location';
import type { RouteOption, RouteWaypoint } from '@/types/route';

export interface DrivePlanMapperContext {
  departureLabel: string;
  /** returnTarget === 'different' のときのみ指定する。 */
  destinationLabel?: string;
  /** ユーザーが実際に指定した経由地点(順序維持、捏造しない)。 */
  userViaPoints: { label: string; coordinates: Coordinates }[];
  avoidHighwaysApplied: boolean;
}

/** suggestedPlaces(複数、corridor型プラン用)を優先し、無ければ従来のsuggestedPlace(単数)を1件配列として扱う。 */
function resolveSuggestedPlaces(plan: DrivePlan): DrivePlanSuggestedPlace[] {
  if (plan.suggestedPlaces && plan.suggestedPlaces.length > 0) {
    return plan.suggestedPlaces;
  }
  return plan.suggestedPlace ? [plan.suggestedPlace] : [];
}

/**
 * markerの並び順。将来の外部ナビ連携(Google Maps等)で
 * origin → userViaPoints → suggestedPlace(複数の場合は順に) → destination(またはorigin)
 * という順序をそのまま使えるよう、waypoints配列自体をこの順序で構築する。
 * suggestedPlace(s)は実際にGoogle Routesのintermediatesへ含めて計測した候補
 * (plan-builder.ts参照)なので、Polylineが実際にこの地点を通っている。
 */
function buildWaypoints(plan: DrivePlan, context: DrivePlanMapperContext, path: Coordinates[]): RouteWaypoint[] {
  const waypoints: RouteWaypoint[] = context.userViaPoints.map((point) => ({
    name: point.label,
    coordinates: point.coordinates,
  }));

  for (const place of resolveSuggestedPlaces(plan)) {
    waypoints.push({
      name: place.name,
      coordinates: { latitude: place.latitude, longitude: place.longitude },
    });
  }

  waypoints.push({
    name: context.destinationLabel ?? context.departureLabel,
    coordinates: path[path.length - 1],
  });

  return waypoints;
}

function buildHighlight(plan: DrivePlan, context: DrivePlanMapperContext): string {
  const places = resolveSuggestedPlaces(plan);

  if (plan.corridorTheme === 'coastal' && places.length > 0) {
    const names = places.map((place) => place.name).join('・');
    return context.destinationLabel
      ? `${names}など海沿いの地点をつないで、${context.destinationLabel}へ向かう実際のルートです。`
      : `${names}など海沿いの地点をつないで戻る実際のルートです。`;
  }

  if (places.length > 0) {
    const names = places.map((place) => place.name).join('・');
    return context.destinationLabel
      ? `${names}に寄って、${context.destinationLabel}へ向かう実際のルートです。`
      : `${names}に寄って戻る実際のルートです。`;
  }
  return context.destinationLabel
    ? `${context.departureLabel}から${context.destinationLabel}までの実際のルートです。`
    : `${context.departureLabel}周辺を回る実際のルートです。`;
}

function buildName(index: number, plan: DrivePlan): string {
  if (plan.corridorTheme === 'coastal') {
    return '海沿いを通りやすいコース';
  }
  if (plan.suggestedPlace) {
    return `${plan.suggestedPlace.name}に寄るルート`;
  }
  return index === 0 ? '直行ルート' : `ルート${index + 1}`;
}

/**
 * drive-route-plannerが返したDrivePlan[]を、既存のRouteOption[]へ変換する。
 * 架空の道路名・景色説明・レビューは追加せず、Googleの実データ(距離・所要時間・
 * 実在するsuggestedPlaceの名前)だけから組み立てる。polylineのデコードに失敗した
 * (2点未満しか得られなかった)プランは採用しない。
 */
export function buildRouteOptionsFromDrivePlans(
  plans: DrivePlan[],
  meta: DrivePlanMeta,
  context: DrivePlanMapperContext
): RouteOption[] {
  const options: RouteOption[] = [];

  plans.forEach((plan, index) => {
    const path = decodeGooglePolyline(plan.encodedPolyline);
    if (path.length < 2) {
      return;
    }

    const tags: string[] = [];
    if (context.avoidHighwaysApplied) {
      tags.push('高速道路を避ける');
    }
    if (plan.corridorTheme === 'coastal') {
      tags.push('海沿い');
    } else if (plan.suggestedPlace) {
      tags.push('提案スポットあり');
    }

    options.push({
      id: plan.id,
      name: buildName(index, plan),
      description: '実際の道路データに基づくルートです。',
      distanceKm: Math.round((plan.distanceMeters / 1000) * 10) / 10,
      durationMinutes: Math.max(1, Math.round(plan.durationSeconds / 60)),
      tags,
      waypoints: buildWaypoints(plan, context, path),
      path,
      highlight: buildHighlight(plan, context),
      audience:
        plan.corridorTheme === 'coastal'
          ? '海沿いの景色を楽しみたい人向け'
          : plan.suggestedPlace
            ? '実在のスポットにも寄りたい人向け'
            : '実際の道路状況に沿って移動したい人向け',
      source: 'google',
      suggestedPlace: plan.suggestedPlace
        ? {
            id: plan.suggestedPlace.id,
            name: plan.suggestedPlace.name,
            coordinates: { latitude: plan.suggestedPlace.latitude, longitude: plan.suggestedPlace.longitude },
            primaryType: plan.suggestedPlace.primaryType,
          }
        : undefined,
      warning: plan.warning,
      targetDurationMinutes: meta.availableTimeMinutes,
      avoidHighwaysApplied: context.avoidHighwaysApplied,
      nearbySuggestions: plan.nearbySuggestions?.map((suggestion) => ({
        id: suggestion.id,
        name: suggestion.name,
        coordinates: { latitude: suggestion.latitude, longitude: suggestion.longitude },
        primaryType: suggestion.primaryType,
        addedMinutes: suggestion.addedMinutes,
      })),
      corridorTheme: plan.corridorTheme,
    });
  });

  return options;
}
