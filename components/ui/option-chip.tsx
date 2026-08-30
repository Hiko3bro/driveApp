import { Pressable, StyleSheet, Text } from 'react-native';

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
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    marginRight: 8,
    marginBottom: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  selected: {
    borderColor: '#0a7ea4',
    backgroundColor: '#e5f4f8',
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 14,
    color: '#334',
    fontWeight: '500',
  },
  selectedLabel: {
    color: '#0a7ea4',
    fontWeight: '700',
  },
});
