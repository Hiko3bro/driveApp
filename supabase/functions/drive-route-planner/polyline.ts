/**
 * Google Encoded Polyline Algorithm Format
 * (https://developers.google.com/maps/documentation/utilities/polylinealgorithm) の
 * 小さな自前デコーダー。
 *
 * services/route/polyline.ts (Expo/RN側)と全く同じアルゴリズムの移植版。Deno(Edge
 * Function)とExpo(React Native)は別のモジュールグラフ・別のビルドで動くため、
 * `@/` パスエイリアス経由での共有importができず、意図的にこのファイルへ複製している。
 * アルゴリズムを変更する場合は両方のファイルを同期させること。
 *
 * 壊れた・途中で途切れた文字列を渡された場合も例外を投げず、それまでにデコードできた
 * 分だけ(あるいは空配列)を返す。
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

interface DecodedValue {
  value: number;
  nextIndex: number;
}

function decodeSignedValue(encoded: string, startIndex: number, len: number): DecodedValue | null {
  let index = startIndex;
  let shift = 0;
  let result = 0;
  let byte: number;

  do {
    if (index >= len) {
      return null;
    }
    byte = encoded.charCodeAt(index) - 63;
    index += 1;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const delta = result & 1 ? ~(result >> 1) : result >> 1;
  return { value: delta, nextIndex: index };
}

export function decodeGooglePolyline(encoded: string): LatLng[] {
  if (typeof encoded !== "string" || encoded.length === 0) {
    return [];
  }

  const points: LatLng[] = [];
  const len = encoded.length;
  let index = 0;
  let lat = 0;
  let lng = 0;

  try {
    while (index < len) {
      const latResult = decodeSignedValue(encoded, index, len);
      if (!latResult) {
        return points;
      }
      lat += latResult.value;
      index = latResult.nextIndex;

      const lngResult = decodeSignedValue(encoded, index, len);
      if (!lngResult) {
        return points;
      }
      lng += lngResult.value;
      index = lngResult.nextIndex;

      const latitude = lat / 1e5;
      const longitude = lng / 1e5;
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
      ) {
        return points;
      }
      points.push({ latitude, longitude });
    }
  } catch {
    return points;
  }

  return points;
}

/**
 * デコード済みpath上の、指定した割合(0〜1)地点の座標を線形補間で求める。
 * 「基本ルートのPolylineから25%/50%/75%地点」のようなcorridor anchorを得るために使う。
 * pathが2点未満の場合はnull。
 */
export function pointAtFraction(path: LatLng[], fraction: number): LatLng | null {
  if (path.length < 2) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  const targetIndex = clamped * (path.length - 1);
  const lowerIndex = Math.floor(targetIndex);
  const upperIndex = Math.min(path.length - 1, lowerIndex + 1);
  const t = targetIndex - lowerIndex;
  const lower = path[lowerIndex];
  const upper = path[upperIndex];
  return {
    latitude: lower.latitude + (upper.latitude - lower.latitude) * t,
    longitude: lower.longitude + (upper.longitude - lower.longitude) * t,
  };
}
