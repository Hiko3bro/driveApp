import type { RecordedTrackPoint } from '@/types/drive-recording';

/** 共有カード内の相対座標(0〜1、左上原点)。実際の緯度経度は保持しない。 */
export interface SharePoint {
  x: number;
  y: number;
}

/** 既定の除外割合。開始・終了地点付近の記録点を、前後それぞれこの割合だけ間引く。 */
const DEFAULT_ENDPOINT_MASK_RATIO = 0.08;
/** 除外しすぎて経路が消えないよう、除外割合の上限を設ける。 */
const MAX_ENDPOINT_MASK_RATIO = 0.4;

/**
 * 配列の先頭・末尾付近を、それぞれ`ratio`の割合だけ取り除く小さなユーティリティ。
 * 将来、共有画像の開始・終了地点付近を隠すプライバシーマスクとして使う想定だが、
 * 現時点でも共有用ルート線の生成(`projectTrackToSharePoints`)からデフォルトで利用している。
 * 入力配列は変更せず、常に新しい配列を返す。
 */
export function maskRouteEndpoints<T>(points: T[], ratio: number = DEFAULT_ENDPOINT_MASK_RATIO): T[] {
  if (points.length < 3 || ratio <= 0) {
    return points;
  }

  const safeRatio = Math.min(ratio, MAX_ENDPOINT_MASK_RATIO);
  const cut = Math.min(Math.floor(points.length * safeRatio), Math.floor((points.length - 2) / 2));
  if (cut <= 0) {
    return points;
  }

  return points.slice(cut, points.length - cut);
}

/**
 * 記録した生のGPS座標(`DriveDiaryEntry.track`)を書き換えず、共有カード内で描画できる
 * 0〜1の相対座標(`SharePoint`)へ変換する。地図タイルは使わず、緯度経度の分布だけから
 * 「ルート線」の形を作る。開始・終了地点付近は`maskRouteEndpoints`で既定の割合だけ間引く。
 */
export function projectTrackToSharePoints(
  track: RecordedTrackPoint[],
  options?: { endpointMaskRatio?: number }
): SharePoint[] {
  if (track.length === 0) {
    return [];
  }

  const masked = maskRouteEndpoints(track, options?.endpointMaskRatio ?? DEFAULT_ENDPOINT_MASK_RATIO);
  const source = masked.length >= 2 ? masked : track;

  const coordinates = source.map((point) => point.coordinates);
  const latitudes = coordinates.map((c) => c.latitude);
  const longitudes = coordinates.map((c) => c.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  // 経度1度あたりの距離は緯度によって変わるため、平均緯度のcosで経度方向を補正し、
  // 実際の移動比率に近い形でルート線が左右に間延び・圧縮しないようにする。
  const longitudeScale = Math.cos((centerLat * Math.PI) / 180) || 1;
  const latitudeSpan = maxLat - minLat || 1e-6;
  const longitudeSpan = (maxLng - minLng) * longitudeScale || 1e-6;
  const span = Math.max(latitudeSpan, longitudeSpan);

  return coordinates.map((c) => {
    const x = 0.5 + ((c.longitude - centerLng) * longitudeScale) / span;
    const y = 0.5 - (c.latitude - centerLat) / span;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
    };
  });
}
