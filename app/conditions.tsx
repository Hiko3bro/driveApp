import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  type AvailableTime,
  type DetourLevel,
  type DriveConditions,
  type Mood,
  type ReturnTarget,
} from '@/types/drive';

const AVAILABLE_TIME_OPTIONS = Object.keys(AVAILABLE_TIME_LABELS) as AvailableTime[];
const MOOD_OPTIONS = Object.keys(MOOD_LABELS) as Mood[];
const RETURN_TARGET_OPTIONS = Object.keys(RETURN_TARGET_LABELS) as ReturnTarget[];

type ReturnDeadlineMode = 'none' | 'custom';

/** 「自分で入力」で指定できる時間の上限(時間)。半日を大きく超えない範囲に収める。 */
const MAX_CUSTOM_HOURS = 12;
const MAX_MINUTE_PART = 59;
/** 0分・負数など不正な入力を安全な範囲へ収めるための下限・上限(分)。 */
const MIN_CUSTOM_TOTAL_MINUTES = 10;
const MAX_CUSTOM_TOTAL_MINUTES = MAX_CUSTOM_HOURS * 60;

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

/** 数字以外の文字を取り除く。 */
function sanitizeDigits(text: string): string {
  return text.replace(/[^0-9]/g, '');
}

/** テキスト入力を整数へ変換し、[min, max]の範囲へ安全に収める。空文字や非数値はminとして扱う。 */
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

export default function ConditionsScreen() {
  const { departure, setConditions, setRoutes } = useDriveFlow();

  const [moods, setMoods] = useState<Mood[]>([]);
  const [moodNotice, setMoodNotice] = useState<string | null>(null);
  const [availableTime, setAvailableTime] = useState<AvailableTime>('2h');
  const [customHoursText, setCustomHoursText] = useState('2');
  const [customMinutesText, setCustomMinutesText] = useState('0');
  const [returnTarget, setReturnTarget] = useState<ReturnTarget>('same-as-departure');
  const [returnDeadlineMode, setReturnDeadlineMode] = useState<ReturnDeadlineMode>('none');
  const [returnHourText, setReturnHourText] = useState('18');
  const [returnMinuteText, setReturnMinuteText] = useState('0');
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
    // 入力途中の文字列(空・桁あふれ等)も、ここで必ず安全な整数へ丸めてから使う。
    const customHours = clampInt(customHoursText, 0, MAX_CUSTOM_HOURS);
    const customMinutesPart = clampInt(customMinutesText, 0, MAX_MINUTE_PART);
    const customAvailableMinutes = Math.min(
      Math.max(customHours * 60 + customMinutesPart, MIN_CUSTOM_TOTAL_MINUTES),
      MAX_CUSTOM_TOTAL_MINUTES
    );

    const returnHour = clampInt(returnHourText, 0, 23);
    const returnMinute = clampInt(returnMinuteText, 0, 59);

    const conditions: DriveConditions = {
      availableTime,
      customAvailableMinutes: availableTime === 'custom' ? customAvailableMinutes : undefined,
      moods,
      returnTarget,
      returnDeadline:
        returnDeadlineMode === 'custom' ? `${pad2(returnHour)}:${pad2(returnMinute)}` : undefined,
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
            <View style={styles.timeInputRow}>
              <View style={styles.timeInputField}>
                <TextInput
                  style={styles.timeInputBox}
                  value={customHoursText}
                  onChangeText={(text) => setCustomHoursText(sanitizeDigits(text).slice(0, 2))}
                  onBlur={() =>
                    setCustomHoursText(String(clampInt(customHoursText, 0, MAX_CUSTOM_HOURS)))
                  }
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="2"
                  placeholderTextColor="#9aa5ab"
                />
                <Text style={styles.timeInputUnit}>時間</Text>
              </View>
              <View style={styles.timeInputField}>
                <TextInput
                  style={styles.timeInputBox}
                  value={customMinutesText}
                  onChangeText={(text) => setCustomMinutesText(sanitizeDigits(text).slice(0, 2))}
                  onBlur={() =>
                    setCustomMinutesText(String(clampInt(customMinutesText, 0, MAX_MINUTE_PART)))
                  }
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="30"
                  placeholderTextColor="#9aa5ab"
                />
                <Text style={styles.timeInputUnit}>分</Text>
              </View>
            </View>
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
            <OptionChip
              label="指定なし"
              selected={returnDeadlineMode === 'none'}
              onPress={() => setReturnDeadlineMode('none')}
            />
            <OptionChip
              label="時刻を指定"
              selected={returnDeadlineMode === 'custom'}
              onPress={() => setReturnDeadlineMode('custom')}
            />
          </ChipRow>
          {returnDeadlineMode === 'custom' && (
            <View style={styles.timeInputRow}>
              <View style={styles.timeInputField}>
                <TextInput
                  style={styles.timeInputBox}
                  value={returnHourText}
                  onChangeText={(text) => setReturnHourText(sanitizeDigits(text).slice(0, 2))}
                  onBlur={() => setReturnHourText(String(clampInt(returnHourText, 0, 23)))}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="18"
                  placeholderTextColor="#9aa5ab"
                />
                <Text style={styles.timeInputUnit}>時</Text>
              </View>
              <View style={styles.timeInputField}>
                <TextInput
                  style={styles.timeInputBox}
                  value={returnMinuteText}
                  onChangeText={(text) => setReturnMinuteText(sanitizeDigits(text).slice(0, 2))}
                  onBlur={() => setReturnMinuteText(String(clampInt(returnMinuteText, 0, 59)))}
                  keyboardType="number-pad"
                  maxLength={2}
                  placeholder="30"
                  placeholderTextColor="#9aa5ab"
                />
                <Text style={styles.timeInputUnit}>分</Text>
              </View>
            </View>
          )}
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
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  timeInputField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeInputBox: {
    width: 56,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    fontSize: 16,
    color: '#11181C',
    textAlign: 'center',
  },
  timeInputUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334',
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
