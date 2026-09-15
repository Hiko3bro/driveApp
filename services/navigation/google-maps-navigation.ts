import { Linking } from 'react-native';

import type { Coordinates } from '@/types/location';

/**
 * Google Maps Universal URLs(https://developers.google.com/maps/documentation/urls/get-started)
 * を使った外部ナビ連携。URL自体にAPIキーは不要。URL生成とLinking.openURL()の呼び出しだけを
 * 行い、画面側のUIロジックとは分離する。
 *
 * 重要な制約(README/docs/DECISIONS.mdにも記録): Google Maps側は渡したwaypointを踏まえて
 * 経路を再計算するため、アプリ内で表示したencodedPolylineと完全に同じ道路線になる保証は
 * ない。ただし origin → waypoints(userViaPoints → suggestedPlace → 追加スポットの順) →
 * destination という順序は必ず維持される。将来「全く同じ道路線でのターンバイターン案内」が
 * 必要になった場合は、Navigation SDK等を使ったアプリ内蔵ナビが別途必要になる。
 */

export interface GoogleMapsNavigationInput {
  origin: Coordinates;
  /** 経由地点。順序を維持したまま渡すこと(呼び出し元でuserViaPoints→suggestedPlace→追加スポットの順に組み立てる)。 */
  waypoints: Coordinates[];
  destination: Coordinates;
  avoidHighways?: boolean;
}

function formatCoordinate(coordinates: Coordinates): string {
  return `${coordinates.latitude},${coordinates.longitude}`;
}

/** URLSearchParamsのRuntime差異に依存しないよう、クエリ文字列は手動でencodeする。 */
function buildQueryString(params: [string, string][]): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

/**
 * Google Maps Universal URLを組み立てる。iOSでGoogle Mapsアプリがインストール済みなら
 * アプリを開き、無い場合はブラウザで開く(Google Maps側の標準仕様、アプリ側での分岐は不要)。
 */
export function buildGoogleMapsNavigationUrl(input: GoogleMapsNavigationInput): string {
  const params: [string, string][] = [
    ['api', '1'],
    ['origin', formatCoordinate(input.origin)],
    ['destination', formatCoordinate(input.destination)],
    ['travelmode', 'driving'],
    ['dir_action', 'navigate'],
  ];
  if (input.waypoints.length > 0) {
    params.push(['waypoints', input.waypoints.map(formatCoordinate).join('|')]);
  }
  if (input.avoidHighways) {
    params.push(['avoid', 'highways']);
  }
  return `https://www.google.com/maps/dir/?${buildQueryString(params)}`;
}

export type OpenGoogleMapsNavigationOutcome = { ok: true } | { ok: false; reason: 'unsupported' | 'unknown' };

/** Linking.openURL()をラップし、開けない場合も例外を投げず結果を返す。座標一覧はログに出さない。 */
export async function openGoogleMapsNavigation(
  input: GoogleMapsNavigationInput
): Promise<OpenGoogleMapsNavigationOutcome> {
  const url = buildGoogleMapsNavigationUrl(input);
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      return { ok: false, reason: 'unsupported' };
    }
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}
