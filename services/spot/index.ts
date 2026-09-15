import { GooglePlacesSpotProvider } from '@/services/spot/google-places-spot-provider';
import type { SpotProvider } from '@/services/spot/spot-provider';

export { SpotDiscoveryError } from '@/services/spot/spot-provider';
export type { PlaceSearchCategory, SpotProvider, SpotSearchParams } from '@/services/spot/spot-provider';
export {
  resolvePreferredSpotCategory,
  SPOT_CATEGORY_TO_PLACE_CATEGORY,
} from '@/services/spot/google-places-spot-provider';

/**
 * 本番の寄り道スポット探索は、Supabase Edge Function(google-places)経由で
 * 実在スポットを取得する。テスト・デモ用のMockSpotProviderは
 * services/spot/mock-spot-provider.tsに残しているが、ここからは呼ばない。
 */
export function getSpotProvider(): SpotProvider {
  return new GooglePlacesSpotProvider();
}
