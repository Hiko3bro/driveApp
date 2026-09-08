import type { Coordinates } from '@/types/location';

/**
 * Google Encoded Polyline Algorithm Format(https://developers.google.com/maps/documentation/utilities/polylinealgorithm)
 * の小さな自前デコーダー。専用パッケージは追加せず、react-native-mapsの
 * Polylineへそのまま渡せる{ latitude, longitude }[]へ変換する。
 *
 * 壊れた・途中で途切れた文字列を渡された場合も例外を投げず、それまでに
 * デコードできた分だけ(あるいは空配列)を返す。呼び出し側は返ってきた配列の
 * 長さで採用可否を判断すること(このファイル自体はクラッシュしない)。
 */

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

export function decodeGooglePolyline(encoded: string): Coordinates[] {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    return [];
  }

  const points: Coordinates[] = [];
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
