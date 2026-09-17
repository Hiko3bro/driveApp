import { StyleSheet, Text, View } from 'react-native';

import { PlaceActionButtons } from '@/components/ui/place-action-buttons';
import { PlacePhotoHero, type PlacePhotoCategory } from '@/components/ui/place-photo-hero';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { buildGoogleMapsPlaceUrl, buildWebSearchUrl, openExternalUrl } from '@/services/navigation/google-maps-view';
import type { PlacePhotoRef } from '@/services/spot/google-places-client';

interface PlaceCandidateCardProps {
  placeId: string;
  name: string;
  categoryLabel: string;
  category: PlacePhotoCategory;
  area: string | null;
  factDescription: string;
  routeFitDescription: string;
  extraMinutes: number;
  extraDistanceKm?: number;
  photoRef: PlacePhotoRef | null;
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryDisabled?: boolean;
  primaryVariant?: 'primary' | 'secondary';
  /** 画面上で最初に見える2〜3件は'high'、それ以外は'low'(呼び出し元がindexから渡す)。 */
  photoPriority?: 'high' | 'low';
  /** このCardが実際に見えている(見えそうな)間だけtrue。既定はtrue(候補一覧は件数が少なく常に一括表示されるため)。 */
  visible?: boolean;
}

/**
 * ドライブ計画チャットのPlace候補カード(フル情報版)。写真(上部、名前・カテゴリ・事実の
 * 短い説明を重ねる) → 追加時間・距離・ルート適合性の文(下部) → Google Maps/Web/ここに寄る、
 * という順で並べる(写真の上にはCTA・追加時間・警告等は置かない)。
 */
export function PlaceCandidateCard({
  placeId,
  name,
  categoryLabel,
  category,
  area,
  factDescription,
  routeFitDescription,
  extraMinutes,
  extraDistanceKm,
  photoRef,
  primaryLabel,
  onPrimaryPress,
  primaryDisabled,
  primaryVariant,
  photoPriority = 'high',
  visible = true,
}: PlaceCandidateCardProps) {
  return (
    <View style={styles.card}>
      <PlacePhotoHero
        placeId={placeId}
        name={name}
        categoryLabel={categoryLabel}
        category={category}
        description={factDescription}
        photoRef={photoRef}
        visible={visible}
        priority={photoPriority}
      />

      <View style={styles.body}>
        <Text style={styles.metaLine}>
          ルートから目安+{extraMinutes}分{extraDistanceKm !== undefined ? `(往復約${extraDistanceKm}km)` : ''}
        </Text>
        <Text style={styles.routeFitText}>{routeFitDescription}</Text>

        <PlaceActionButtons
          primaryLabel={primaryLabel}
          onPrimaryPress={onPrimaryPress}
          primaryDisabled={primaryDisabled}
          primaryVariant={primaryVariant}
          placeName={name}
          onGoogleMapsPress={() => {
            void openExternalUrl(buildGoogleMapsPlaceUrl({ name, placeId }));
          }}
          onWebPress={() => {
            void openExternalUrl(buildWebSearchUrl({ name, area }));
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  body: {
    padding: Spacing.md,
    gap: Spacing.xs + 2,
  },
  metaLine: {
    fontSize: Typography.secondary.fontSize,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
  routeFitText: {
    fontSize: Typography.secondary.fontSize,
    lineHeight: Typography.secondary.lineHeight,
    color: Colors.textSecondary,
  },
});
