import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors } from '@/constants/design-tokens';

interface QuickReplyChipProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

/** チップ自体の高さを固定する。キーボード開閉で親の縦スペースが変わっても、chipの形は変化しない。 */
const CHIP_HEIGHT = 34;

/**
 * ワンタップでそのままメッセージとして送信する「クイック返信」チップ。
 * components/ui/option-chip.tsxはトグル選択(選択状態を保持する)のに対し、
 * これはタップ即座に1回だけアクションを起こす一時的なチップで、選択状態を持たない。
 *
 * 実機で「キーボードを閉じるとchipが縦に伸びて丸/縦長になる」不具合が確認されたため、
 * 高さを`height`で固定し、`alignSelf: 'flex-start'`と`flexGrow: 0`/`flexShrink: 0`で
 * 親(横スクロールのScrollView)の縦方向の空きスペースにstretchしないようにしている。
 */
export function QuickReplyChip({ label, onPress, disabled }: QuickReplyChipProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.chip, pressed && !disabled && styles.pressed, disabled && styles.disabled]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: CHIP_HEIGHT,
    maxWidth: 220,
    paddingHorizontal: 14,
    borderRadius: CHIP_HEIGHT / 2,
    borderWidth: 1.5,
    borderColor: Colors.accentBlue,
    backgroundColor: Colors.accentBlueMuted,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 13,
    color: Colors.accentBlue,
    fontWeight: '600',
  },
});
