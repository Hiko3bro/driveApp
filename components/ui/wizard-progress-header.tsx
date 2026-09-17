import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';

interface WizardProgressHeaderProps {
  /** 現在のステップ番号(1始まり)。 */
  step: number;
  /** ステップの総数。 */
  total: number;
  /** ステップの見出し。空文字なら見出し行を表示しない(ネイティブヘッダーに任せる画面用)。 */
  title?: string;
  /** 指定すると内側に「戻る」リンクを表示する。 */
  onBack?: () => void;
}

/** 業務フォームっぽくなりすぎないよう、数字+軽いドットバーだけで進捗を示す。 */
export function WizardProgressHeader({ step, total, title = '', onBack }: WizardProgressHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} style={styles.backButton}>
            <Text style={styles.backLabel}>戻る</Text>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        <Text style={styles.progressLabel}>
          {step} / {total}
        </Text>
      </View>
      <View style={styles.dots}>
        {Array.from({ length: total }, (_, index) => (
          <View key={index} style={[styles.dot, index < step && styles.dotFilled]} />
        ))}
      </View>
      {title.length > 0 && <Text style={styles.title}>{title}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
    backgroundColor: Colors.background,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    minWidth: 44,
    minHeight: 32,
    justifyContent: 'center',
  },
  backLabel: {
    fontSize: Typography.body.fontSize,
    color: Colors.accentBlue,
    fontWeight: '600',
  },
  progressLabel: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textTertiary,
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    gap: Spacing.xs,
  },
  dot: {
    flex: 1,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceElevated,
  },
  dotFilled: {
    backgroundColor: Colors.accentBlue,
  },
  title: {
    fontSize: Typography.screenTitle.fontSize - 7,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
});
