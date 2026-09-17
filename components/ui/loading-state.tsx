import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Colors, Spacing, Typography } from '@/constants/design-tokens';

interface LoadingStateProps {
  /** ユーザーに何をしているかが伝わる短い文言(例:「和歌山県から候補を探しています」)。内部API名・エラーコードは含めないこと。 */
  message: string;
}

/** spinnerだけでなく、何を待っているかが分かる文言を添えるローディング表示。 */
export function LoadingState({ message }: LoadingStateProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={Colors.accentBlue} />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  message: {
    color: Colors.textSecondary,
    fontSize: Typography.secondary.fontSize,
    textAlign: 'center',
  },
});
