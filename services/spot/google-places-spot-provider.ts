import type { SpotProvider, SpotSearchParams } from '@/services/spot/spot-provider';
import type { Spot } from '@/types/spot';

/**
 * 将来Google Places APIへ差し替えるための実装先。
 * 現在はAPI・実在スポット・Google評価を接続しない。
 */
export class GooglePlacesSpotProvider implements SpotProvider {
  async getSpots(_params: SpotSearchParams): Promise<Spot[]> {
    throw new Error(
      'GooglePlacesSpotProvider is not implemented yet. Use MockSpotProvider until an external Places API is introduced.'
    );
  }
}
