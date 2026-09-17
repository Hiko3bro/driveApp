import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { PlaceInfoOverlay } from '@/components/ui/place-info-overlay';
import { Radius, Spacing } from '@/constants/design-tokens';
import { useCandidatePhoto } from '@/services/spot/place-photo-cache';
import type { PlacePhotoRef } from '@/services/spot/google-places-client';
import type { PlaceSearchCategoryForChat } from '@/services/ai/trip-chat-client';

export type PlacePhotoCategory = PlaceSearchCategoryForChat;

/** カテゴリ別の背景色・アイコン(写真が無い/取得できない場合のプレースホルダー用。生成AI画像は使わない)。 */
const CATEGORY_VISUALS: Record<PlacePhotoCategory, { color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  restaurant: { color: '#c9834a', icon: 'restaurant-outline' },
  cafe: { color: '#a67c52', icon: 'cafe-outline' },
  scenic: { color: '#3f8f82', icon: 'image-outline' },
  onsen: { color: '#c77b7b', icon: 'water-outline' },
  activity: { color: '#5f8fc7', icon: 'bicycle-outline' },
  history: { color: '#7c6ba3', icon: 'business-outline' },
  market: { color: '#b8942f', icon: 'basket-outline' },
};

interface PlacePhotoHeroProps {
  /** Google Place ID。写真cacheのキー(queue優先度の識別にも使う)。 */
  placeId: string;
  name: string;
  categoryLabel: string;
  category: PlacePhotoCategory;
  /** 事実ベースの短い説明(1〜2行)。写真上に重ねる(ルート適合性の文は含めない)。空文字なら表示しない。 */
  description: string;
  photoRef: PlacePhotoRef | null;
  /** コンパクト表示(今ドラ等、高さを抑えたい場合)。既定はドライブ計画向けのフル高さ。 */
  compact?: boolean;
  /**
   * このCardが画面に実際に見えている(または直後に見えそうな)間だけtrue。falseの間は
   * fetchを一切発生させない(=真のlazy load、実機で「非表示のPlaceまで写真取得している」
   * 不具合の修正)。既定はtrue(可視性を意識しない既存呼び出し元との互換用)。
   */
  visible?: boolean;
  /**
   * 画面上で最初に見える2〜3件は'high'(即fetch)、それ以外は'low'(concurrency制御付き
   * queueの後方、他のhigh優先度が終わってから)を呼び出し元がindexから渡す。既定は'high'
   * (優先度を意識しない既存呼び出し元との互換用)。
   */
  priority?: 'high' | 'low';
}

/**
 * 候補カードの「写真+場所らしさ」を担うヒーロー画像。表示された候補分だけ、1Place1枚を
 * useCandidatePhoto経由(placeIdキーのキャッシュ・同時fetch数制限・session上限込み)で
 * 取得する。取得失敗/写真無し/予算切れ/session上限到達のいずれでも、同じ高さのカテゴリ別
 * プレースホルダーへフォールバックし、name/category/descriptionは変わらず表示する
 * (レイアウトが崩れない)。
 */
export function PlacePhotoHero({
  placeId,
  name,
  categoryLabel,
  category,
  description,
  photoRef,
  compact,
  visible = true,
  priority = 'high',
}: PlacePhotoHeroProps) {
  const photoState = useCandidatePhoto(placeId, photoRef, visible, priority);
  const visuals = CATEGORY_VISUALS[category];
  const hasPhoto = photoState.status === 'available';

  return (
    <View
      style={[styles.container, compact && styles.containerCompact, !hasPhoto && { backgroundColor: visuals.color }]}
      accessibilityLabel={`${name}の写真`}>
      {hasPhoto && (
        <Image
          source={{ uri: photoState.photoUri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          accessibilityLabel={`${name}の写真`}
        />
      )}
      {!hasPhoto && (
        <View style={styles.placeholderIconWrap}>
          <Ionicons name={visuals.icon} size={compact ? 28 : 36} color="rgba(255,255,255,0.55)" />
        </View>
      )}

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.72)']}
        style={styles.gradient}
        pointerEvents="none"
      />

      <View style={styles.badgeRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{categoryLabel}</Text>
        </View>
      </View>

      <View style={styles.overlayBottom}>
        <PlaceInfoOverlay name={name} description={description} compact={compact} />
      </View>

      {hasPhoto && photoState.attributions.length > 0 && (
        <Text style={styles.attribution} numberOfLines={1}>
          写真: {photoState.attributions[0]}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    // やや縦長にして写真の印象を強める(4:3、以前は16:10)。
    aspectRatio: 4 / 3,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  containerCompact: {
    // 実機で写真+下部の情報+CTAの合計が画面高さを超え、footer等と詰まって見える不具合が
    // あったため、コンパクト表示時の写真高さをさらに抑える(セクション21・23)。
    aspectRatio: 16 / 9,
  },
  placeholderIconWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '65%',
  },
  badgeRow: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
  badge: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm - 2,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  overlayBottom: {
    padding: Spacing.md,
  },
  attribution: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    fontSize: 9,
    color: 'rgba(255,255,255,0.8)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});
