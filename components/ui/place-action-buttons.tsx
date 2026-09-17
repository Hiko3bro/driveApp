import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing } from '@/constants/design-tokens';

interface PlaceActionButtonsProps {
  primaryLabel: string;
  onPrimaryPress: () => void;
  primaryDisabled?: boolean;
  primaryVariant?: 'primary' | 'secondary';
  placeName: string;
  onGoogleMapsPress: () => void;
  onWebPress: () => void;
  /** 今ドラ等、Google Maps/Webをより控えめに(小さいテキストリンク2つ)表示したい場合。 */
  compact?: boolean;
}

/**
 * 候補カードのCTA行。プライマリ「ここに寄る」を最も目立たせ、セカンダリ「Google Maps」
 * 「Web」はその下に控えめに並べる(ボタン数を多く見せすぎない)。URL生成自体は
 * services/navigation/google-maps-view.tsを使う(呼び出し元がonPress内でopenExternalUrlを呼ぶ)。
 */
export function PlaceActionButtons({
  primaryLabel,
  onPrimaryPress,
  primaryDisabled,
  primaryVariant = 'primary',
  placeName,
  onGoogleMapsPress,
  onWebPress,
  compact,
}: PlaceActionButtonsProps) {
  return (
    <View style={styles.container}>
      {!compact && (
        <PrimaryButton
          label={primaryLabel}
          variant={primaryVariant}
          disabled={primaryDisabled}
          onPress={onPrimaryPress}
        />
      )}
      <View style={styles.secondaryRow}>
        <Pressable
          onPress={onGoogleMapsPress}
          hitSlop={8}
          style={({ pressed }) => [styles.secondaryLink, pressed && styles.secondaryLinkPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${placeName}をGoogle Mapsで開く`}>
          <Text style={styles.secondaryLinkText}>Google Maps</Text>
        </Pressable>
        <Pressable
          onPress={onWebPress}
          hitSlop={8}
          style={({ pressed }) => [styles.secondaryLink, pressed && styles.secondaryLinkPressed]}
          accessibilityRole="button"
          accessibilityLabel={`${placeName}をWebで調べる`}>
          <Text style={styles.secondaryLinkText}>Web</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    justifyContent: 'center',
  },
  secondaryLink: {
    borderRadius: Radius.sm,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  secondaryLinkPressed: {
    opacity: 0.6,
  },
  secondaryLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
});
