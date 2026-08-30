import { MockGeocodingProvider } from '@/services/geocoding/mock-geocoding-provider';
import type { GeocodingProvider } from '@/services/geocoding/geocoding-provider';

export type { GeocodingProvider, GeocodingResult } from '@/services/geocoding/geocoding-provider';

/**
 * 住所検索の取得方法をここで切り替える。
 * Google Geocoding API等を導入する際は、ここを
 * 実装済みのProviderに差し替える。
 */
export function getGeocodingProvider(): GeocodingProvider {
  return new MockGeocodingProvider();
}
