import * as SecureStore from 'expo-secure-store';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { Coordinates } from '@/types/location';

const HOME_LOCATION_KEY = 'drive-discovery.home-location';

/**
 * 自宅座標はexpo-secure-storeにのみ保存し、住所文字列ではなく
 * 緯度・経度を正として扱う。座標そのものをログに出力してはいけない。
 */
export async function getHomeLocation(): Promise<Coordinates | null> {
  try {
    const raw = await SecureStore.getItemAsync(HOME_LOCATION_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidCoordinates(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    // secure-storeが利用できない環境(例: Web)や読み込み失敗時は未登録として扱う
    return null;
  }
}

export async function saveHomeLocation(coordinates: Coordinates): Promise<boolean> {
  if (!isValidCoordinates(coordinates)) {
    return false;
  }

  try {
    await SecureStore.setItemAsync(HOME_LOCATION_KEY, JSON.stringify(coordinates));
    return true;
  } catch {
    return false;
  }
}

export async function clearHomeLocation(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(HOME_LOCATION_KEY);
  } catch {
    // 削除に失敗しても致命的ではないため無視する
  }
}
