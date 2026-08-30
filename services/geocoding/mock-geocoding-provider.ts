import type { GeocodingProvider, GeocodingResult } from '@/services/geocoding/geocoding-provider';

/**
 * 住所検索は今回未実装のため、常に結果なしを返すモック実装。
 * UI側は「地図から直接指定する」導線を主として使う。
 */
export class MockGeocodingProvider implements GeocodingProvider {
  async searchByAddress(_query: string): Promise<GeocodingResult[]> {
    return [];
  }
}
