import type { Coordinates } from '@/types/location';

export interface GeocodingResult {
  label: string;
  coordinates: Coordinates;
}

/**
 * 住所文字列から座標を検索するための差し替え口。
 * 将来Google Geocoding API等へ接続する際は、この interface を
 * 実装したProviderを追加し、getGeocodingProvider() の返却先を切り替える。
 */
export interface GeocodingProvider {
  searchByAddress(query: string): Promise<GeocodingResult[]>;
}
