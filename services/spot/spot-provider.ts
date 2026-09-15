import type { RouteOption } from '@/types/route';
import type { Spot } from '@/types/spot';

export class SpotDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotDiscoveryError';
  }
}

export type PlaceSearchCategory = 'restaurant' | 'cafe' | 'scenic' | 'onsen' | 'activity';

export interface SpotSearchParams {
  route: RouteOption;
  /**
   * 検索する1カテゴリ(Google Places側のcategory enumと同じ5値)。呼び出し元
   * (画面)が、タップされたカテゴリチップ(「おすすめ」ならAI解釈から導いた
   * 優先カテゴリ)を解決してから渡す。カテゴリごとに個別に呼び出すオンデマンド
   * 設計のため、この関数自体は複数カテゴリをまとめて取得しない。
   */
  category: PlaceSearchCategory;
}

/** 選択ルート周辺の、指定カテゴリのスポットを取得するための差し替え口。 */
export interface SpotProvider {
  getSpots(params: SpotSearchParams): Promise<Spot[]>;
}
