import { Pressable, StyleSheet, Text, View } from 'react-native';

interface SelectionCardProps {
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}

export function SelectionCard({ title, subtitle, onPress, disabled }: SelectionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        Boolean(disabled) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 64,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 16,
    justifyContent: 'center',
    marginBottom: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#5b6770',
  },
});
