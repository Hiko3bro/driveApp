import * as SecureStore from 'expo-secure-store';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { SavedPlace } from '@/types/location';

const SAVED_PLACES_KEY = 'drive-discovery.saved-places';
const MAX_SAVED_PLACES = 30;

function isSavedPlace(value: unknown): value is SavedPlace {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SavedPlace>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isValidCoordinates(candidate.coordinates) &&
    (candidate.category === undefined || typeof candidate.category === 'string')
  );
}

/**
 * 「大学」「彼女の家」のような、ユーザーが名前を付けて保存した地点。
 * home-location-store.tsと同じくexpo-secure-storeにのみ保存し、住所文字列ではなく
 * 緯度・経度を正として扱う。
 */
export async function getSavedPlaces(): Promise<SavedPlace[]> {
  try {
    const raw = await SecureStore.getItemAsync(SAVED_PLACES_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSavedPlace) : [];
  } catch {
    return [];
  }
}

export async function addSavedPlace(place: {
  name: string;
  coordinates: SavedPlace['coordinates'];
  category?: string;
}): Promise<SavedPlace | null> {
  const name = place.name.trim();
  if (!isValidCoordinates(place.coordinates) || name.length === 0) {
    return null;
  }

  const saved: SavedPlace = {
    id: `saved-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    coordinates: place.coordinates,
    category: place.category,
  };

  try {
    const current = await getSavedPlaces();
    const next = [saved, ...current].slice(0, MAX_SAVED_PLACES);
    await SecureStore.setItemAsync(SAVED_PLACES_KEY, JSON.stringify(next));
    return saved;
  } catch {
    return null;
  }
}

export async function removeSavedPlace(id: string): Promise<void> {
  try {
    const current = await getSavedPlaces();
    const next = current.filter((place) => place.id !== id);
    await SecureStore.setItemAsync(SAVED_PLACES_KEY, JSON.stringify(next));
  } catch {
    // 削除に失敗しても致命的ではないため無視する
  }
}
