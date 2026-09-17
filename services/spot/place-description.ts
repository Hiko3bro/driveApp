/**
 * Place候補カードに表示する短い説明文を、Google Placesが実際に返したデータ(市区町村・
 * 都道府県・primaryType由来のカテゴリ)だけから決定的なテンプレートで組み立てる。
 * AIへの新規問い合わせは行わない(源泉かけ流し・絶景・SNSで人気・行列店・歴史100年等の
 * 未確認の主張を一切作らないための意図的な選択。取得していない情報は書かない)。
 *
 * 「場所の事実」(buildPlaceFactDescription)と「ルート適合性」(buildRouteFitDescription)は
 * 常に別の文として分離する。前者はPlace自体の説明、後者は「なぜ今回のドライブに合うか」で
 * 混同しない(指示の例: 事実="白浜エリアにある温泉施設です。" / ルート適合="今回の海沿い
 * ドライブの途中に追加しやすい候補です。")。
 */

import type { PlaceSearchCategoryForChat } from '@/services/ai/trip-chat-client';

export type PlaceDescriptionCategory = PlaceSearchCategoryForChat;

const CATEGORY_LABELS: Record<PlaceDescriptionCategory, string> = {
  restaurant: '飲食店',
  cafe: 'カフェ',
  scenic: '景勝地',
  onsen: '温泉・入浴施設',
  activity: '体験・アクティビティ施設',
  history: '歴史・文化スポット',
  market: '市場',
};

const THEME_LABELS: Record<string, string> = {
  coastal: '海沿い',
  mountain: '山沿い',
  river: '川沿い',
  onsen: '温泉',
  scenic: '景勝地めぐり',
  gourmet: 'グルメ',
  history: '歴史散策',
};

export interface PlaceFactInput {
  locality: string | null;
  prefecture: string | null;
  category: PlaceDescriptionCategory;
}

/** 「事実」の文。取得できているエリア情報(市区町村→都道府県の順)だけを使い、無ければカテゴリのみの一般文にフォールバックする。 */
export function buildPlaceFactDescription({ locality, prefecture, category }: PlaceFactInput): string {
  const area = locality ?? prefecture;
  const categoryLabel = CATEGORY_LABELS[category];
  return area ? `${area}にある${categoryLabel}です。` : `この周辺にある${categoryLabel}です。`;
}

export interface RouteFitInput {
  theme?: string;
}

/** 「ルート適合性」の文。テーマが分かればそれに触れ、不明なら一般的な文にする。 */
export function buildRouteFitDescription({ theme }: RouteFitInput): string {
  const themeLabel = theme ? THEME_LABELS[theme] : undefined;
  return themeLabel
    ? `今回の${themeLabel}ドライブの途中に追加しやすい候補です。`
    : 'ルートの途中に追加しやすい候補です。';
}
