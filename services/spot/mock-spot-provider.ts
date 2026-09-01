import { isValidCoordinates, normalizeGeneratedCoordinates } from '@/services/location/coordinates';
import {
  SpotDiscoveryError,
  type SpotProvider,
  type SpotSearchParams,
} from '@/services/spot/spot-provider';
import type { Coordinates } from '@/types/location';
import type { Spot, SpotCategory } from '@/types/spot';

const EARTH_RADIUS_KM = 6371;

interface SpotTemplate {
  id: string;
  name: string;
  category: SpotCategory;
  description: string;
  recommendation: string;
  extraMinutes: number;
  extraDistanceKm: number;
  bearing: number;
  offsetKm: number;
}

const SPOT_TEMPLATES: SpotTemplate[] = [
  // ごはん
  {
    id: 'local-table',
    name: 'サンプル旅の小皿店',
    category: 'ごはん',
    description: '土地らしい軽食を楽しむ体験を想定した、架空の飲食スポットです。',
    recommendation: '移動だけで終わらず、短い食の体験を加えられます。',
    extraMinutes: 7,
    extraDistanceKm: 1.1,
    bearing: -55,
    offsetKm: 0.28,
  },
  {
    id: 'street-diner',
    name: 'サンプル街角食堂',
    category: 'ごはん',
    description: 'ふらっと立ち寄れる軽食どころを想定した、架空の食事スポットです。',
    recommendation: '小腹を満たしたいときに合わせやすい位置を想定しています。',
    extraMinutes: 6,
    extraDistanceKm: 0.9,
    bearing: 95,
    offsetKm: 0.26,
  },
  // カフェ
  {
    id: 'quiet-cafe',
    name: 'サンプル木陰カフェ',
    category: 'カフェ',
    description: '静かにひと休みできる想定で配置した、実在しないカフェスポットです。',
    recommendation: '短い休憩を挟み、気分を切り替えたいときに向いています。',
    extraMinutes: 5,
    extraDistanceKm: 0.7,
    bearing: 120,
    offsetKm: 0.22,
  },
  {
    id: 'back-alley-cafe',
    name: 'サンプル路地裏カフェ',
    category: 'カフェ',
    description: '路地の奥にひっそりある想定の、架空の小さなカフェスポットです。',
    recommendation: '運転の合間に短く一息つきたいときに向いています。',
    extraMinutes: 4,
    extraDistanceKm: 0.5,
    bearing: -80,
    offsetKm: 0.19,
  },
  // 絶景
  {
    id: 'sky-terrace',
    name: 'サンプル空色テラス',
    category: '絶景',
    description: '風景を眺めながら短時間で立ち寄れる、架空の小さな展望スペースです。',
    recommendation: 'ルートから大きく外れず、景色の変化を楽しめる想定です。',
    extraMinutes: 3,
    extraDistanceKm: 0.4,
    bearing: 35,
    offsetKm: 0.18,
  },
  {
    id: 'ridge-view',
    name: 'サンプル稜線ビューポイント',
    category: '絶景',
    description: '尾根越しの眺めを楽しめる想定で配置した、架空の展望ポイントです。',
    recommendation: '写真を撮りたくなるような景色の変化を想定しています。',
    extraMinutes: 5,
    extraDistanceKm: 0.6,
    bearing: 150,
    offsetKm: 0.3,
  },
  // 温泉
  {
    id: 'footbath-spring',
    name: 'サンプル湯けむりの足湯',
    category: '温泉',
    description: '気軽に立ち寄れる足湯を想定した、架空の温泉スポットです。',
    recommendation: '運転の疲れをほぐす短い休憩として想定しています。',
    extraMinutes: 8,
    extraDistanceKm: 1.3,
    bearing: 10,
    offsetKm: 0.34,
  },
  {
    id: 'satoyama-bath',
    name: 'サンプル里山の日帰り湯',
    category: '温泉',
    description: '里山の中にある想定の、架空の日帰り温泉スポットです。',
    recommendation: 'ゆっくり浸かって旅の疲れを取りたいときに向いています。',
    extraMinutes: 9,
    extraDistanceKm: 1.5,
    bearing: -170,
    offsetKm: 0.36,
  },
  // アクティビティ
  {
    id: 'hidden-path',
    name: 'サンプルひみつの小径',
    category: 'アクティビティ',
    description: '偶然見つける楽しさを表現するための、架空の散策スポットです。',
    recommendation: '予定調和ではない小さな発見を、少し歩いて楽しめます。',
    extraMinutes: 6,
    extraDistanceKm: 0.8,
    bearing: -135,
    offsetKm: 0.24,
  },
  {
    id: 'kayak-experience',
    name: 'サンプル水辺のミニカヤック体験',
    category: 'アクティビティ',
    description: '水辺で短時間のカヤック体験ができる想定の、架空のアクティビティスポットです。',
    recommendation: '体を動かして気分転換したいときに向いています。',
    extraMinutes: 10,
    extraDistanceKm: 1.6,
    bearing: 60,
    offsetKm: 0.3,
  },
];

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** 球面上の移動として計算し、極・日付変更線付近でも有限座標へ正規化する。 */
function offsetCoordinate(base: Coordinates, bearingDegrees: number, distanceKm: number): Coordinates | null {
  if (!isValidCoordinates(base) || !Number.isFinite(bearingDegrees) || !Number.isFinite(distanceKm)) {
    return null;
  }

  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const latitude1 = toRadians(base.latitude);
  const longitude1 = toRadians(base.longitude);
  const bearing = toRadians(bearingDegrees);
  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
      Math.cos(latitude1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude1),
      Math.cos(angularDistance) - Math.sin(latitude1) * Math.sin(latitude2)
    );

  return normalizeGeneratedCoordinates({
    latitude: toDegrees(latitude2),
    longitude: toDegrees(longitude2),
  });
}

/** 選択ルートの有効な座標列を基準に、安全な架空スポットを生成する。 */
export class MockSpotProvider implements SpotProvider {
  async getSpots({ route }: SpotSearchParams): Promise<Spot[]> {
    const validPath = route.path.filter(isValidCoordinates);
    if (validPath.length === 0) {
      throw new SpotDiscoveryError(
        'ルート周辺の場所を確認できませんでした。ルートを選び直してください。'
      );
    }

    const spots = SPOT_TEMPLATES.flatMap((template, index) => {
      const pathIndex =
        validPath.length === 1
          ? 0
          : Math.round((index * (validPath.length - 1)) / (SPOT_TEMPLATES.length - 1));
      const base = validPath[pathIndex];
      const coordinates = offsetCoordinate(base, template.bearing, template.offsetKm);
      if (!coordinates || !isValidCoordinates(coordinates)) {
        return [];
      }

      return [
        {
          id: `mock-${route.id}-${template.id}`,
          name: template.name,
          category: template.category,
          description: template.description,
          recommendation: template.recommendation,
          extraMinutes: template.extraMinutes,
          extraDistanceKm: template.extraDistanceKm,
          coordinates,
          isMock: true as const,
        },
      ];
    });

    if (spots.length === 0) {
      throw new SpotDiscoveryError(
        '安全なスポット候補を作れませんでした。別のルートを選んでください。'
      );
    }

    return spots;
  }
}
