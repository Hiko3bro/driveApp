import * as SecureStore from 'expo-secure-store';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { RecentPlace } from '@/types/location';

const RECENT_PLACES_KEY = 'drive-discovery.recent-places';
const MAX_RECENT_PLACES = 8;
/** これより近い2点は「同じ場所」とみなし、履歴を重複させない(おおよそ50m程度)。 */
const SAME_LOCATION_THRESHOLD_DEG = 0.0005;

function isRecentPlace(value: unknown): value is RecentPlace {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<RecentPlace>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.label === 'string' &&
    isValidCoordinates(candidate.coordinates) &&
    typeof candidate.usedAt === 'string'
  );
}

function sameApproximateLocation(
  a: RecentPlace['coordinates'],
  b: RecentPlace['coordinates']
): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < SAME_LOCATION_THRESHOLD_DEG &&
    Math.abs(a.longitude - b.longitude) < SAME_LOCATION_THRESHOLD_DEG
  );
}

/** 直近で選んだ場所の履歴(最大 MAX_RECENT_PLACES 件)。expo-secure-storeにのみ保存する。 */
export async function getRecentPlaces(): Promise<RecentPlace[]> {
  try {
    const raw = await SecureStore.getItemAsync(RECENT_PLACES_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentPlace) : [];
  } catch {
    return [];
  }
}

/** 場所を選ぶたびに呼び出し、履歴の先頭に記録する。同じ場所の重複は取り除く。 */
export async function recordRecentPlace(place: {
  label: string;
  coordinates: RecentPlace['coordinates'];
}): Promise<void> {
  const label = place.label.trim();
  if (!isValidCoordinates(place.coordinates) || label.length === 0) {
    return;
  }

  const entry: RecentPlace = {
    id: `recent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label,
    coordinates: place.coordinates,
    usedAt: new Date().toISOString(),
  };

  try {
    const current = await getRecentPlaces();
    const deduped = current.filter(
      (existing) => !sameApproximateLocation(existing.coordinates, entry.coordinates)
    );
    const next = [entry, ...deduped].slice(0, MAX_RECENT_PLACES);
    await SecureStore.setItemAsync(RECENT_PLACES_KEY, JSON.stringify(next));
  } catch {
    // 記録に失敗しても致命的ではないため無視する
  }
}
