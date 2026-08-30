import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OptionChip } from '@/components/ui/option-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { getRouteProvider, RoutePlanningError } from '@/services/route';
import {
  AVAILABLE_TIME_LABELS,
  DETOUR_LEVEL_LABELS,
  MOOD_LABELS,
  RETURN_TARGET_LABELS,
  type AvailableTime,
  type DetourLevel,
  type DriveConditions,
  type Mood,
  type ReturnTarget,
} from '@/types/drive';

const AVAILABLE_TIME_OPTIONS = Object.keys(AVAILABLE_TIME_LABELS) as AvailableTime[];
const MOOD_OPTIONS = Object.keys(MOOD_LABELS) as Mood[];
const RETURN_TARGET_OPTIONS = Object.keys(RETURN_TARGET_LABELS) as ReturnTarget[];
const DETOUR_LEVEL_OPTIONS = Object.keys(DETOUR_LEVEL_LABELS) as DetourLevel[];
const RETURN_DEADLINE_OPTIONS = ['指定なし', '17:00', '18:00', '19:00', '20:00', '21:00'];

export default function ConditionsScreen() {
  const { departure, setConditions, setRoutes } = useDriveFlow();

  const [availableTime, setAvailableTime] = useState<AvailableTime>('2h');
  const [mood, setMood] = useState<Mood>('omakase');
  const [returnTarget, setReturnTarget] = useState<ReturnTarget>('same-as-departure');
  const [returnDeadline, setReturnDeadline] = useState<string>('指定なし');
  const [detourLevel, setDetourLevel] = useState<DetourLevel>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  useEffect(() => {
    if (!departure) {
      router.replace('/departure');
    }
  }, [departure]);

  if (!departure) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0a7ea4" />
        </View>
      </SafeAreaView>
    );
  }

  const handleSubmit = async () => {
    const conditions: DriveConditions = {
      availableTime,
      mood,
      returnTarget,
      returnDeadline: returnDeadline === '指定なし' ? undefined : returnDeadline,
      detourLevel,
    };

    setSubmitting(true);
    setSubmissionError(null);
    setConditions(conditions);

    try {
      const provider = getRouteProvider();
      const routes = await provider.getRoutes({ departure, conditions });
      if (routes.length === 0) {
        throw new RoutePlanningError('選択した条件ではルートを作れません。条件を変更してください。');
      }
      setRoutes(routes);
      router.push('/route-compare');
    } catch (error) {
      setRoutes([]);
      setSubmissionError(
        error instanceof RoutePlanningError
          ? error.message
          : 'ルートを作成できませんでした。条件を確認して、もう一度お試しください。'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.departureLabel}>出発地点: {departure.label}</Text>

        <Section title="使える時間">
          <ChipRow>
            {AVAILABLE_TIME_OPTIONS.map((value) => (
              <OptionChip
                key={value}
                label={AVAILABLE_TIME_LABELS[value]}
                selected={availableTime === value}
                onPress={() => setAvailableTime(value)}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="気分">
          <ChipRow>
            {MOOD_OPTIONS.map((value) => (
              <OptionChip
                key={value}
                label={MOOD_LABELS[value]}
                selected={mood === value}
                onPress={() => setMood(value)}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="帰着地点">
          <ChipRow>
            {RETURN_TARGET_OPTIONS.map((value) => (
              <OptionChip
                key={value}
                label={RETURN_TARGET_LABELS[value]}
                selected={returnTarget === value}
                onPress={() => setReturnTarget(value)}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="帰着時刻(目安)">
          <ChipRow>
            {RETURN_DEADLINE_OPTIONS.map((value) => (
              <OptionChip
                key={value}
                label={value}
                selected={returnDeadline === value}
                onPress={() => setReturnDeadline(value)}
              />
            ))}
          </ChipRow>
        </Section>

        <Section title="寄り道">
          <ChipRow>
            {DETOUR_LEVEL_OPTIONS.map((value) => (
              <OptionChip
                key={value}
                label={DETOUR_LEVEL_LABELS[value]}
                selected={detourLevel === value}
                onPress={() => setDetourLevel(value)}
              />
            ))}
          </ChipRow>
        </Section>

        {submissionError && <Text style={styles.errorText}>{submissionError}</Text>}
        <PrimaryButton
          label={submitting ? 'ルートを探しています…' : 'ルートを提案してもらう'}
          onPress={handleSubmit}
          disabled={submitting}
          style={styles.submitButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    padding: 20,
    paddingBottom: 40,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  departureLabel: {
    fontSize: 14,
    color: '#5b6770',
    marginBottom: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  submitButton: {
    marginTop: 12,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 4,
  },
});
