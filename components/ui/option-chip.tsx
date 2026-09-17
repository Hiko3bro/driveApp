import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';

interface OptionChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export function OptionChip({ label, selected, onPress }: OptionChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}>
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
    marginBottom: Spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  selected: {
    borderColor: Colors.accentBlue,
    backgroundColor: Colors.accentBlueMuted,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: Typography.body.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  // 選択時はborder/background/text colorだけで表現し、fontWeightは変えない
  // (太字化で文字幅が変わりchipが一瞬「巨大化」して見える不具合の修正、セクション22)。
  selectedLabel: {
    color: Colors.accentBlue,
  },
});
