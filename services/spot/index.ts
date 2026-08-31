import { MockSpotProvider } from '@/services/spot/mock-spot-provider';
import type { SpotProvider } from '@/services/spot/spot-provider';

export { SpotDiscoveryError } from '@/services/spot/spot-provider';
export type { SpotProvider, SpotSearchParams } from '@/services/spot/spot-provider';

/** 将来のPlaces API接続時は、この返却先だけを差し替える。 */
export function getSpotProvider(): SpotProvider {
  return new MockSpotProvider();
}
