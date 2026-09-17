import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Spacing, Typography } from '@/constants/design-tokens';

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  /** 事実確認できない説明("きっとこの辺りが良いはず"等)は書かず、確認できた状況のみを渡すこと。 */
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** 候補0件・検索結果無し等を、単なるエラーではなく落ち着いた案内として表示する。 */
export function EmptyState({ icon = 'search-outline', message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={Colors.textTertiary} />
      </View>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction && (
        <PrimaryButton label={actionLabel} variant="secondary" onPress={onAction} style={styles.action} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    color: Colors.textSecondary,
    fontSize: Typography.secondary.fontSize,
    lineHeight: Typography.secondary.lineHeight,
    textAlign: 'center',
  },
  action: {
    marginTop: Spacing.xs,
  },
});
