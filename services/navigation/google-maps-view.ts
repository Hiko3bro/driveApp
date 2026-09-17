import { Linking } from 'react-native';

/**
 * 候補カードの「Google Mapsで見る」「Webで見る」ボタン用。google-maps-navigation.ts(複数
 * waypointのターンバイターン案内用)とは責務が異なるため別ファイルにしている。ここで作る
 * URLはいずれもAPIキー不要(Google Maps Universal URLs / 通常のWeb検索URL)。
 */

export interface GoogleMapsPlaceViewInput {
  name: string;
  /** あればPlace IDで一意に特定する(query_place_id)。無ければ名前だけの検索になる。 */
  placeId?: string;
}

/** URLSearchParamsのRuntime差異に依存しないよう、クエリ文字列は手動でencodeする。 */
function buildQueryString(params: [string, string][]): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

/** 単体のPlaceをGoogle Mapsで表示するためのURL(ターンバイターン案内は行わない、閲覧のみ)。 */
export function buildGoogleMapsPlaceUrl({ name, placeId }: GoogleMapsPlaceViewInput): string {
  const params: [string, string][] = [
    ['api', '1'],
    ['query', name],
  ];
  if (placeId) {
    params.push(['query_place_id', placeId]);
  }
  return `https://www.google.com/maps/search/?${buildQueryString(params)}`;
}

export interface WebSearchViewInput {
  name: string;
  area?: string | null;
}

/** 「Placeの名前 + 地域名」でのシンプルな外部ブラウザ検索(新しい検索APIは使わない)。 */
export function buildWebSearchUrl({ name, area }: WebSearchViewInput): string {
  const query = area ? `${name} ${area}` : name;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export type OpenExternalUrlOutcome = { ok: true } | { ok: false; reason: 'unsupported' | 'unknown' };

/** Linking.openURL()をラップし、開けない場合も例外を投げず結果を返す。 */
export async function openExternalUrl(url: string): Promise<OpenExternalUrlOutcome> {
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
