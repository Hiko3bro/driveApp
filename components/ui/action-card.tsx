import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';

interface ActionCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  /** trueの場合、Home最上部の主要導線(今ドラ等)向けの大きめ表示にする。 */
  large?: boolean;
  disabled?: boolean;
}

/**
 * icon + title + short descriptionのdark surfaceカード(高沢さん側Homeのカード感を参考に
 * 移植した共通コンポーネント)。Home・今ドラの主要導線に使う。
 */
export function ActionCard({ icon, title, description, onPress, large, disabled }: ActionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}。${description}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.card,
        large && styles.cardLarge,
        Boolean(disabled) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <View style={[styles.iconWrap, large && styles.iconWrapLarge]}>
        <Ionicons name={icon} size={large ? 26 : 20} color={Colors.accentBlue} />
      </View>
      <Text style={[styles.title, large && styles.titleLarge]} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.description} numberOfLines={2}>
        {description}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.xl,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  cardLarge: {
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentBlueMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  iconWrapLarge: {
    width: 52,
    height: 52,
    borderRadius: Radius.lg,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: Typography.cardTitle.fontSize,
    fontWeight: Typography.cardTitle.fontWeight,
  },
  titleLarge: {
    fontSize: Typography.screenTitle.fontSize - 6,
  },
  description: {
    color: Colors.textSecondary,
    fontSize: Typography.secondary.fontSize,
    lineHeight: Typography.secondary.lineHeight,
  },
});
