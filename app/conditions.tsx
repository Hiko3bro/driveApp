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
  MAX_SELECTED_MOODS,
  MOOD_LABELS,
  RETURN_TARGET_LABELS,
  formatMinutesLabel,
  type AvailableTime,
  type DetourLevel,
  type DriveConditions,
  type Mood,
  type ReturnTarget,
} from '@/types/drive';

const AVAILABLE_TIME_OPTIONS = Object.keys(AVAILABLE_TIME_LABELS) as AvailableTime[];
const MOOD_OPTIONS = Object.keys(MOOD_LABELS) as Mood[];
const RETURN_TARGET_OPTIONS = Object.keys(RETURN_TARGET_LABELS) as ReturnTarget[];
const RETURN_DEADLINE_OPTIONS = ['指定なし', '17:00', '18:00', '19:00', '20:00', '21:00'];
const CUSTOM_MINUTE_OPTIONS = [30, 45, 90, 150, 240, 300];

/** 「今日の気分」から、既存の寄り道量ロジック(DetourLevel)へ変換する。 */
function deriveDetourLevel(moods: Mood[]): DetourLevel {
  if (moods.includes('detourRich')) {
    return 'many';
  }
  if (moods.includes('short')) {
    return 'few';
  }
  return 'normal';
}

export default function ConditionsScreen() {
  const { departure, setConditions, setRoutes } = useDriveFlow();

  const [moods, setMoods] = useState<Mood[]>([]);
  const [moodNotice, setMoodNotice] = useState<string | null>(null);
  const [availableTime, setAvailableTime] = useState<AvailableTime>('2h');
  const [customMinutes, setCustomMinutes] = useState<number>(90);
  const [returnTarget, setReturnTarget] = useState<ReturnTarget>('same-as-departure');
  const [returnDeadline, setReturnDeadline] = useState<string>('指定なし');
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

  const handleToggleMood = (mood: Mood) => {
    setMoodNotice(null);
    if (moods.includes(mood)) {
      setMoods(moods.filter((value) => value !== mood));
      return;
    }
    if (moods.length >= MAX_SELECTED_MOODS) {
      setMoodNotice(`今日の気分は最大${MAX_SELECTED_MOODS}つまで選べます。`);
      return;
    }
    setMoods([...moods, mood]);
  };

  const handleSubmit = async () => {
    const conditions: DriveConditions = {
      availableTime,
      customAvailableMinutes: availableTime === 'custom' ? customMinutes : undefined,
      moods,
      returnTarget,
      returnDeadline: returnDeadline === '指定なし' ? undefined : returnDeadline,
      detourLevel: deriveDetourLevel(moods),
    };

    setSubmitting(true);
    setSubmissionError(null);
    setConditions(conditions);

    try {
      const provider = getRouteProvider();
      const routes = await provider.getRoutes({ departure, conditions });
      if (routes.length === 0) {
        throw new RoutePlanningError('選んだ条件ではルートを作れません。条件を変更してください。');
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
        <Text style={styles.heading}>今日はどんなドライブにする?</Text>
        <Text style={styles.departureLabel}>出発地点: {departure.label}</Text>

        <Section title="今日の気分" subtitle="気になるものだけ選んでください(選ばなくてもOK)">
          <ChipRow>
            {MOOD_OPTIONS.map((value) => (
              <OptionChip
                key={value}
                label={MOOD_LABELS[value]}
                selected={moods.includes(value)}
                onPress={() => handleToggleMood(value)}
              />
            ))}
          </ChipRow>
          {moodNotice && <Text style={styles.noticeText}>{moodNotice}</Text>}
        </Section>

        <Section title="どれくらい走る?">
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
          {availableTime === 'custom' && (
            <ChipRow>
              {CUSTOM_MINUTE_OPTIONS.map((minutes) => (
                <OptionChip
                  key={minutes}
                  label={formatMinutesLabel(minutes)}
                  selected={customMinutes === minutes}
                  onPress={() => setCustomMinutes(minutes)}
                />
              ))}
            </ChipRow>
          )}
        </Section>

        <Section title="戻り方">
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

        <Section title="何時ごろ戻る?">
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

        {submissionError && <Text style={styles.errorText}>{submissionError}</Text>}
        <PrimaryButton
          label={submitting ? 'ルートを探しています…' : '今日のルートを見つける'}
          onPress={handleSubmit}
          disabled={submitting}
          style={styles.submitButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
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
  heading: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 6,
  },
  departureLabel: {
    fontSize: 14,
    color: '#5b6770',
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#8b959c',
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  submitButton: {
    marginTop: 12,
  },
  noticeText: {
    color: '#7a5b18',
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
    marginBottom: 8,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 4,
  },
});
