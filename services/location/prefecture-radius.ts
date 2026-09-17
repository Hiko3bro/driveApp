/**
 * 「高知県でドライブ」のような都道府県名から、planning area(候補・anchorをその範囲内へ
 * 制約するための代表半径)を見積もるための静的テーブル。Google Places側に新しいfield
 * (viewport等)を追加せず、料金ティアへ一切影響を与えずに実装するための簡略化
 * (行政界の厳密なpolygonではなく、代表地点からの距離による安全な範囲制約でよい、という
 * ユーザー自身の明示的な許可に基づく)。値は各都道府県のおおよその広さの目安であり、
 * 実在確認された座標そのものではない(座標はGoogle Places Text Search側から得る)。
 */
export const PREFECTURE_RADIUS_METERS: Record<string, number> = {
  北海道: 200_000,
  青森県: 90_000,
  岩手県: 100_000,
  宮城県: 70_000,
  秋田県: 90_000,
  山形県: 80_000,
  福島県: 100_000,
  茨城県: 70_000,
  栃木県: 65_000,
  群馬県: 70_000,
  埼玉県: 55_000,
  千葉県: 70_000,
  東京都: 55_000,
  神奈川県: 45_000,
  新潟県: 110_000,
  富山県: 55_000,
  石川県: 80_000,
  福井県: 65_000,
  山梨県: 55_000,
  長野県: 110_000,
  岐阜県: 90_000,
  静岡県: 100_000,
  愛知県: 65_000,
  三重県: 80_000,
  滋賀県: 50_000,
  京都府: 70_000,
  大阪府: 40_000,
  兵庫県: 100_000,
  奈良県: 55_000,
  和歌山県: 70_000,
  鳥取県: 65_000,
  島根県: 100_000,
  岡山県: 70_000,
  広島県: 85_000,
  山口県: 90_000,
  徳島県: 60_000,
  香川県: 40_000,
  愛媛県: 85_000,
  高知県: 100_000,
  福岡県: 80_000,
  佐賀県: 45_000,
  長崎県: 90_000,
  熊本県: 85_000,
  大分県: 70_000,
  宮崎県: 90_000,
  鹿児島県: 100_000,
  沖縄県: 90_000,
};

/** areaQueryの既定半径(都道府県名を含まない地名・ランドマーク名等)。既存のText Search bias半径と同じ値。 */
export const DEFAULT_AREA_RADIUS_METERS = 30_000;

/**
 * areaQueryの文字列に都道府県名が含まれていれば、対応する目安半径を返す。含まれなければ既定値。
 * canonicalPrefecture(Google Placesのaddress ComponentsからcanonicalなAdministrative
 * Areaとして解決済みの都道府県名、例:「和歌山県」)が分かっている場合は、それをテーブルの
 * 直接キーとして優先する。「和歌山方面」のような、都道府県名を含まない/部分一致しない
 * 言い回しでも正しい半径を引けるようにするため(部分一致だけに頼っていた旧実装のバグ修正)。
 */
export function resolveAreaRadiusMeters(areaQuery: string, canonicalPrefecture?: string | null): number {
  if (canonicalPrefecture && PREFECTURE_RADIUS_METERS[canonicalPrefecture] !== undefined) {
    return PREFECTURE_RADIUS_METERS[canonicalPrefecture];
  }
  for (const [prefecture, radius] of Object.entries(PREFECTURE_RADIUS_METERS)) {
    if (areaQuery.includes(prefecture)) {
      return radius;
    }
  }
  return DEFAULT_AREA_RADIUS_METERS;
}
