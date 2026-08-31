import type { RouteOption } from '@/types/route';
import type { Spot } from '@/types/spot';

export class SpotDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotDiscoveryError';
  }
}

export interface SpotSearchParams {
  route: RouteOption;
}

/** 選択ルート周辺のスポットを取得するための差し替え口。 */
export interface SpotProvider {
  getSpots(params: SpotSearchParams): Promise<Spot[]>;
}
