export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MapRegion extends Coordinates {
  latitudeDelta: number;
  longitudeDelta: number;
}

export type DepartureSource = 'current' | 'home' | 'custom';

export interface DepartureSelection {
  source: DepartureSource;
  coordinates: Coordinates;
  label: string;
}

/** 場所の選び方(地図から選ぶ/保存済み場所から選ぶ/最近使った場所から選ぶ)。将来の検索追加にも拡張しやすいよう区別しておく。 */
export type PlaceSource = 'map' | 'saved' | 'recent';

/** 地図等で選んだ、ラベル付きの1地点。 */
export interface PlaceSelection {
  label: string;
  coordinates: Coordinates;
}

/**
 * 条件入力ウィザードの「経由したい場所はある?」で追加した、ユーザーが実際に
 * 立ち寄りたいと指定した場所。AIへの候補ではなく、優先度の高い確定希望として扱う。
 */
export interface ViaPoint extends PlaceSelection {
  id: string;
  category?: string;
}

/** 端末内(expo-secure-store)に保存する、名前付きのお気に入り地点。 */
export interface SavedPlace {
  id: string;
  name: string;
  coordinates: Coordinates;
  category?: string;
}

/** 端末内に保存する、直近で選んだ場所の履歴(最大数はrecent-places-store側で管理)。 */
export interface RecentPlace {
  id: string;
  label: string;
  coordinates: Coordinates;
  usedAt: string;
}
