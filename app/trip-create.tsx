import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { buildTripFromDateRange, saveTrip, TripDateRangeError } from '@/services/trip/trip-store';

function sanitizeDigits(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

function clampInt(text: string, min: number, max: number): number {
  const parsed = Number.parseInt(sanitizeDigits(text), 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(Math.max(parsed, min), max);
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function NumberField({
  label,
  value,
  onChangeText,
  min,
  max,
  width = 60,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  min: number;
  max: number;
  width?: number;
}) {
  return (
    <View style={styles.dateField}>
      <TextInput
        style={[styles.dateInput, { width }]}
        value={value}
        onChangeText={(text) => onChangeText(sanitizeDigits(text).slice(0, 4))}
        onBlur={() => onChangeText(String(clampInt(value, min, max)))}
        keyboardType="number-pad"
        placeholderTextColor="#9aa5ab"
        accessibilityLabel={label}
      />
      <Text style={styles.dateFieldLabel}>{label}</Text>
    </View>
  );
}

export default function TripCreateScreen() {
  const now = new Date();
  const [title, setTitle] = useState('');
  const [startYear, setStartYear] = useState(String(now.getFullYear()));
  const [startMonth, setStartMonth] = useState(String(now.getMonth() + 1));
  const [startDay, setStartDay] = useState(String(now.getDate()));
  const [endYear, setEndYear] = useState(String(now.getFullYear()));
  const [endMonth, setEndMonth] = useState(String(now.getMonth() + 1));
  const [endDay, setEndDay] = useState(String(now.getDate() + 2));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async () => {
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const startDate = `${clampInt(startYear, now.getFullYear(), now.getFullYear() + 3)}-${pad2(clampInt(startMonth, 1, 12))}-${pad2(clampInt(startDay, 1, 31))}`;
      const endDate = `${clampInt(endYear, now.getFullYear(), now.getFullYear() + 3)}-${pad2(clampInt(endMonth, 1, 12))}-${pad2(clampInt(endDay, 1, 31))}`;
      const trip = buildTripFromDateRange(title, startDate, endDate);
      const ok = await saveTrip(trip);
      if (!ok) {
        setError('旅行プランを保存できませんでした。もう一度お試しください。');
        return;
      }
      router.replace({ pathname: '/trip-detail', params: { tripId: trip.id } });
    } catch (caught: unknown) {
      setError(
        caught instanceof TripDateRangeError ? caught.message : '旅行プランを作成できませんでした。もう一度お試しください。'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>旅行プランを作る</Text>
          <Text style={styles.subtleText}>旅行名と日程を入れると、日ごとのドライブを計画できます。</Text>

          <Text style={styles.label}>旅行名</Text>
          <TextInput
            style={styles.textField}
            value={title}
            onChangeText={setTitle}
            placeholder="例: 高知旅行"
            placeholderTextColor="#9aa5ab"
            accessibilityLabel="旅行名"
          />

          <Text style={styles.label}>開始日</Text>
          <View style={styles.dateRow}>
            <NumberField label="年" value={startYear} onChangeText={setStartYear} min={now.getFullYear()} max={now.getFullYear() + 3} width={72} />
            <NumberField label="月" value={startMonth} onChangeText={setStartMonth} min={1} max={12} />
            <NumberField label="日" value={startDay} onChangeText={setStartDay} min={1} max={31} />
          </View>

          <Text style={styles.label}>終了日</Text>
          <View style={styles.dateRow}>
            <NumberField label="年" value={endYear} onChangeText={setEndYear} min={now.getFullYear()} max={now.getFullYear() + 3} width={72} />
            <NumberField label="月" value={endMonth} onChangeText={setEndMonth} min={1} max={12} />
            <NumberField label="日" value={endDay} onChangeText={setEndDay} min={1} max={31} />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label={isSaving ? '作成しています…' : 'この内容で作る'} onPress={handleCreate} disabled={isSaving} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: 24,
    gap: 12,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
  },
  subtleText: {
    fontSize: 13,
    color: '#8b959c',
    lineHeight: 19,
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#11181C',
    marginTop: 8,
  },
  textField: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#11181C',
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  dateField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateInput: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    fontSize: 16,
    color: '#11181C',
    textAlign: 'center',
  },
  dateFieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334',
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    lineHeight: 19,
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
