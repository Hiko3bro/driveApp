import type { DrivePlan, DrivePlanMeta } from '@/services/route/drive-route-planner-client';
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

/**
 * markerの並び順。将来の外部ナビ連携(Google Maps等)で
 * origin → userViaPoints → suggestedPlace → destination(またはorigin)
 * という順序をそのまま使えるよう、waypoints配列自体をこの順序で構築する。
 * suggestedPlaceは実際にGoogle Routesのintermediatesへ含めて計測した候補
 * (plan-builder.ts参照)なので、Polylineが実際にこの地点を通っている。
 */
function buildWaypoints(plan: DrivePlan, context: DrivePlanMapperContext, path: Coordinates[]): RouteWaypoint[] {
  const waypoints: RouteWaypoint[] = context.userViaPoints.map((point) => ({
    name: point.label,
    coordinates: point.coordinates,
  }));

  if (plan.suggestedPlace) {
    waypoints.push({
      name: plan.suggestedPlace.name,
      coordinates: { latitude: plan.suggestedPlace.latitude, longitude: plan.suggestedPlace.longitude },
    });
  }

  waypoints.push({
    name: context.destinationLabel ?? context.departureLabel,
    coordinates: path[path.length - 1],
  });

  return waypoints;
}

function buildHighlight(plan: DrivePlan, context: DrivePlanMapperContext): string {
  if (plan.suggestedPlace) {
    return context.destinationLabel
      ? `${plan.suggestedPlace.name}に寄って、${context.destinationLabel}へ向かう実際のルートです。`
      : `${plan.suggestedPlace.name}に寄って戻る実際のルートです。`;
  }
  return context.destinationLabel
    ? `${context.departureLabel}から${context.destinationLabel}までの実際のルートです。`
    : `${context.departureLabel}周辺を回る実際のルートです。`;
}

function buildName(index: number, plan: DrivePlan): string {
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
    if (plan.suggestedPlace) {
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
      audience: plan.suggestedPlace ? '実在のスポットにも寄りたい人向け' : '実際の道路状況に沿って移動したい人向け',
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
    });
  });

  return options;
}
