import * as Location from 'expo-location';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { Coordinates } from '@/types/location';

export type CurrentLocationResult =
  | { status: 'granted'; coordinates: Coordinates }
  | { status: 'denied' }
  | { status: 'error' };

/**
 * 現在地の使用許可を求め、許可された場合のみ座標を取得する。
 * 拒否された場合や取得に失敗した場合も例外を投げず、
 * 呼び出し側が状態に応じて再試行/他の選択肢を案内できるようにする。
 */
export async function requestCurrentLocation(): Promise<CurrentLocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return { status: 'denied' };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const coordinates: Coordinates = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
    if (!isValidCoordinates(coordinates)) {
      return { status: 'error' };
    }

    return {
      status: 'granted',
      coordinates,
    };
  } catch {
    return { status: 'error' };
  }
}
