import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapPointPicker } from '@/components/location/map-point-picker';
import { OptionChip } from '@/components/ui/option-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { WizardProgressHeader } from '@/components/ui/wizard-progress-header';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { requestAiRoutePreferences, shouldRequestAiInterpretation } from '@/services/ai/route-planning-client';
import { addSavedPlace, getSavedPlaces } from '@/services/location/saved-places-store';
import { getRecentPlaces, recordRecentPlace } from '@/services/location/recent-places-store';
import { getRouteProvider, RoutePlanningError } from '@/services/route';
import {
  AVAILABLE_TIME_LABELS,
  MAX_SELECTED_MOODS,
  MOOD_LABELS,
  RETURN_TARGET_LABELS,
  deriveDetourLevel,
  formatMinutesLabel,
  type AvailableTime,
  type DriveConditions,
  type Mood,
  type ReturnTarget,
} from '@/types/drive';
import type {
  Coordinates,
  MapRegion,
  PlaceSelection,
  RecentPlace,
  SavedPlace,
  ViaPoint,
} from '@/types/location';

const AVAILABLE_TIME_OPTIONS = Object.keys(AVAILABLE_TIME_LABELS) as AvailableTime[];
const MOOD_OPTIONS = Object.keys(MOOD_LABELS) as Mood[];
const RETURN_TARGET_OPTIONS = Object.keys(RETURN_TARGET_LABELS) as ReturnTarget[];

type StepId = 'mood' | 'time' | 'destination' | 'via' | 'deadline' | 'note' | 'confirm' | 'thinking';
/** X/7の進捗表示に使う、入力ステップだけの並び(確認・演出画面は番号の外)。 */
const STEP_ORDER: StepId[] = ['mood', 'time', 'destination', 'via', 'deadline', 'note'];
const PROGRESS_TOTAL = 7;
const STEP_TITLES: Record<Exclude<StepId, 'confirm' | 'thinking'>, string> = {
  mood: '今日の気分',
  time: 'どれくらい走る?',
  destination: '最後はどこにする?',
  via: '経由したい場所はある?',
  deadline: '何時ごろ戻る?',
  note: 'AIに追加で伝えたいこと',
};

type Overlay = 'none' | 'destination-map' | 'via-map' | 'via-name';
type DateMode = 'today' | 'tomorrow' | 'dayAfterTomorrow' | 'custom';
const DATE_MODE_OPTIONS: { value: DateMode; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: 'tomorrow', label: '明日' },
  { value: 'dayAfterTomorrow', label: '明後日' },
  { value: 'custom', label: '日付を指定' },
];

/** 「自分で入力」で指定できる日数の上限。半日〜数日程度の実用範囲に収める。 */
const MAX_CUSTOM_DAYS = 7;
const MAX_HOUR_PART = 23;
const MAX_MINUTE_PART = 59;
/** これ未満だと十分なルートを提案できないため、次へ進めずブロックする。 */
const MIN_CUSTOM_TOTAL_MINUTES = 15;

/**
 * 「考えています」画面の進行状況。実際の非同期処理の完了に合わせて切り替える
 * (固定時間のタイマーではない)。AIへ問い合わせない場合は最初から'planning'。
 */
type ThinkingPhase = 'interpreting' | 'planning';

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

function minutesToParts(totalMinutes: number): { days: number; hours: number; minutes: number } {
  const safe = Math.max(0, Math.round(totalMinutes));
  return {
    days: Math.floor(safe / 1440),
    hours: Math.floor((safe % 1440) / 60),
    minutes: safe % 60,
  };
}

function regionFromCoordinates(coordinates: Coordinates): MapRegion {
  return { ...coordinates, latitudeDelta: 0.03, longitudeDelta: 0.03 };
}

function generateLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 日付チップ・年月日・時分の入力から、実際の帰着日時(Date)を組み立てる。 */
function buildDeadlineDate(
  now: Date,
  dateMode: DateMode,
  yearText: string,
  monthText: string,
  dayText: string,
  hourText: string,
  minuteText: string
): Date {
  const date = new Date(now);
  if (dateMode === 'tomorrow') {
    date.setDate(date.getDate() + 1);
  } else if (dateMode === 'dayAfterTomorrow') {
    date.setDate(date.getDate() + 2);
  } else if (dateMode === 'custom') {
    const year = clampInt(yearText, now.getFullYear(), now.getFullYear() + 1);
    const month = clampInt(monthText, 1, 12);
    const day = clampInt(dayText, 1, 31);
    date.setFullYear(year, month - 1, day);
  }
  date.setHours(clampInt(hourText, 0, MAX_HOUR_PART), clampInt(minuteText, 0, MAX_MINUTE_PART), 0, 0);
  return date;
}

/** ローカルのタイムゾーンオフセット付きISO 8601文字列を作る(例 "2026-09-03T02:00:00+09:00")。新規パッケージなしで実装するための自前フォーマッタ。 */
function toIsoWithOffset(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  const offsetMinutesTotal = -date.getTimezoneOffset();
  const sign = offsetMinutesTotal >= 0 ? '+' : '-';
  const offsetHours = pad(Math.floor(Math.abs(offsetMinutesTotal) / 60));
  const offsetMinutes = pad(Math.abs(offsetMinutesTotal) % 60);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00${sign}${offsetHours}:${offsetMinutes}`
  );
}

function formatDeadlinePreview(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
}

/** 既存のreturnDeadline(ISO)から、日付チップ・年月日・時分の初期値を逆算する(条件確認からの編集時に使う)。 */
function partsFromIso(iso: string | undefined, now: Date) {
  const fallback = {
    dateMode: 'today' as DateMode,
    yearText: String(now.getFullYear()),
    monthText: String(now.getMonth() + 1),
    dayText: String(now.getDate()),
    hourText: '18',
    minuteText: '0',
  };
  if (!iso) {
    return fallback;
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return fallback;
  }
  const oneDayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfTarget - startOfToday) / oneDayMs);
  const dateMode: DateMode = dayDiff === 0 ? 'today' : dayDiff === 1 ? 'tomorrow' : dayDiff === 2 ? 'dayAfterTomorrow' : 'custom';
  return {
    dateMode,
    yearText: String(date.getFullYear()),
    monthText: String(date.getMonth() + 1),
    dayText: String(date.getDate()),
    hourText: String(date.getHours()),
    minuteText: String(date.getMinutes()),
  };
}

export default function ConditionsScreen() {
  const {
    departure,
    conditions: existingConditions,
    planningEntryMode,
    setConditions,
    setRoutes,
    setAiInterpretation,
  } = useDriveFlow();
  // レンダー中のref.current読み取りを避けるため、1回だけ評価したい初期値は
  // useRef(...).currentではなく、useStateの遅延初期化(第一要素のみ使用)で作る。
  const [now] = useState(() => new Date());
  const [initialDeadlineParts] = useState(() => partsFromIso(existingConditions?.returnDeadline, now));
  const [initialCustomTime] = useState(() => minutesToParts(existingConditions?.customAvailableMinutes ?? 120));
  // 「新規開始」か「条件編集」かは、conditionsの有無から推測せず、DriveFlowContextの
  // planningEntryMode(ホームの「今からドライブ」→resetPlanningSession()で'new'、
  // ルート比較の「条件を変える」→beginConditionsEdit()で'edit')だけで判別する。
  const enteredAtConfirmRef = useRef(planningEntryMode === 'edit');
  const jumpedFromConfirmRef = useRef(false);
  const isMountedRef = useRef(true);

  const [step, setStep] = useState<StepId>(planningEntryMode === 'edit' ? 'confirm' : 'mood');
  const [overlay, setOverlay] = useState<Overlay>('none');

  const [moods, setMoods] = useState<Mood[]>(existingConditions?.moods ?? []);
  const [moodNotice, setMoodNotice] = useState<string | null>(null);

  const [availableTime, setAvailableTime] = useState<AvailableTime>(existingConditions?.availableTime ?? '2h');
  const [customDaysText, setCustomDaysText] = useState(String(initialCustomTime.days));
  const [customHoursText, setCustomHoursText] = useState(String(initialCustomTime.hours));
  const [customMinutesText, setCustomMinutesText] = useState(String(initialCustomTime.minutes));

  const [returnTarget, setReturnTarget] = useState<ReturnTarget>(
    existingConditions?.returnTarget ?? 'same-as-departure'
  );
  const [finalDestination, setFinalDestination] = useState<PlaceSelection | null>(
    existingConditions?.finalDestination ?? null
  );

  const [viaPoints, setViaPoints] = useState<ViaPoint[]>(existingConditions?.viaPoints ?? []);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [recentPlaces, setRecentPlaces] = useState<RecentPlace[]>([]);
  const [pendingViaCoordinates, setPendingViaCoordinates] = useState<Coordinates | null>(null);
  const [viaNameText, setViaNameText] = useState('');
  const [saveViaAsPlace, setSaveViaAsPlace] = useState(false);

  const [returnDeadlineMode, setReturnDeadlineMode] = useState<'none' | 'custom'>(
    existingConditions?.returnDeadline ? 'custom' : 'none'
  );
  const [dateMode, setDateMode] = useState<DateMode>(initialDeadlineParts.dateMode);
  const [customYearText, setCustomYearText] = useState(initialDeadlineParts.yearText);
  const [customMonthText, setCustomMonthText] = useState(initialDeadlineParts.monthText);
  const [customDayText, setCustomDayText] = useState(initialDeadlineParts.dayText);
  const [deadlineHourText, setDeadlineHourText] = useState(initialDeadlineParts.hourText);
  const [deadlineMinuteText, setDeadlineMinuteText] = useState(initialDeadlineParts.minuteText);

  const [aiNote, setAiNote] = useState(existingConditions?.aiNote ?? '');

  const [thinkingPhase, setThinkingPhase] = useState<ThinkingPhase>('planning');
  const [thinkingUsesAi, setThinkingUsesAi] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!departure) {
      router.replace('/departure');
    }
  }, [departure]);

  useEffect(() => {
    let active = true;
    Promise.all([getSavedPlaces(), getRecentPlaces()]).then(([saved, recent]) => {
      if (active) {
        setSavedPlaces(saved);
        setRecentPlaces(recent);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (!departure) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0a7ea4" />
        </View>
      </SafeAreaView>
    );
  }

  // --- ステップ移動 -----------------------------------------------------
  const goToStep = (target: StepId, fromConfirm = false) => {
    jumpedFromConfirmRef.current = fromConfirm;
    setStep(target);
  };

  const handleNext = () => {
    if (jumpedFromConfirmRef.current) {
      jumpedFromConfirmRef.current = false;
      setStep('confirm');
      return;
    }
    const index = STEP_ORDER.indexOf(step);
    const next = STEP_ORDER[index + 1];
    setStep(next ?? 'confirm');
  };

  const handleBack = () => {
    const index = STEP_ORDER.indexOf(step);
    if (index > 0) {
      setStep(STEP_ORDER[index - 1]);
      return;
    }
    router.back();
  };

  const handleConfirmBack = () => {
    if (enteredAtConfirmRef.current) {
      router.back();
      return;
    }
    setStep('note');
  };

  // --- 今日の気分 ---------------------------------------------------------
  const handleToggleMood = (mood: Mood) => {
    setMoodNotice(null);
    if (mood === 'omakase') {
      setMoods((current) => (current.includes('omakase') ? [] : ['omakase']));
      return;
    }
    setMoods((current) => {
      const withoutOmakase = current.filter((value) => value !== 'omakase');
      if (withoutOmakase.includes(mood)) {
        return withoutOmakase.filter((value) => value !== mood);
      }
      if (withoutOmakase.length >= MAX_SELECTED_MOODS) {
        setMoodNotice(`今日の気分は最大${MAX_SELECTED_MOODS}つまで選べます。`);
        return withoutOmakase;
      }
      return [...withoutOmakase, mood];
    });
  };

  // --- どれくらい走る? ----------------------------------------------------
  const customTotalMinutes =
    clampInt(customDaysText, 0, MAX_CUSTOM_DAYS) * 1440 +
    clampInt(customHoursText, 0, MAX_HOUR_PART) * 60 +
    clampInt(customMinutesText, 0, MAX_MINUTE_PART);
  const isCustomTimeTooShort = availableTime === 'custom' && customTotalMinutes < MIN_CUSTOM_TOTAL_MINUTES;

  // --- 何時ごろ戻る? ------------------------------------------------------
  const previewDeadlineDate =
    returnDeadlineMode === 'custom'
      ? buildDeadlineDate(now, dateMode, customYearText, customMonthText, customDayText, deadlineHourText, deadlineMinuteText)
      : null;
  const isDeadlineInPast = previewDeadlineDate ? previewDeadlineDate.getTime() <= now.getTime() : false;

  // --- 経由したい場所 ------------------------------------------------------
  const handleDestinationMapConfirm = (coordinates: Coordinates) => {
    setFinalDestination({ label: '指定した場所', coordinates });
    setOverlay('none');
  };

  const handleViaMapConfirm = (coordinates: Coordinates) => {
    setPendingViaCoordinates(coordinates);
    setViaNameText('');
    setSaveViaAsPlace(false);
    setOverlay('via-name');
  };

  const handleConfirmViaName = () => {
    if (!pendingViaCoordinates) {
      return;
    }
    const label = viaNameText.trim().length > 0 ? viaNameText.trim() : '指定した場所';
    const coordinates = pendingViaCoordinates;
    const viaPoint: ViaPoint = { id: generateLocalId('via'), label, coordinates };
    setViaPoints((current) => [...current, viaPoint]);
    void recordRecentPlace({ label, coordinates });
    if (saveViaAsPlace) {
      void addSavedPlace({ name: label, coordinates }).then((saved) => {
        if (saved && isMountedRef.current) {
          setSavedPlaces((current) => [saved, ...current]);
        }
      });
    }
    setPendingViaCoordinates(null);
    setOverlay('none');
  };

  const handleAddViaFromPlace = (place: { label: string; coordinates: Coordinates; category?: string }) => {
    const viaPoint: ViaPoint = {
      id: generateLocalId('via'),
      label: place.label,
      coordinates: place.coordinates,
      category: place.category,
    };
    setViaPoints((current) => [...current, viaPoint]);
    void recordRecentPlace({ label: place.label, coordinates: place.coordinates });
  };

  const handleRemoveViaPoint = (id: string) => {
    setViaPoints((current) => current.filter((point) => point.id !== id));
  };

  // --- 送信 ---------------------------------------------------------------
  const buildConditions = (): DriveConditions => {
    const customAvailableMinutes = customTotalMinutes;
    let returnDeadline: string | undefined;
    if (returnDeadlineMode === 'custom') {
      const date = buildDeadlineDate(
        new Date(),
        dateMode,
        customYearText,
        customMonthText,
        customDayText,
        deadlineHourText,
        deadlineMinuteText
      );
      returnDeadline = toIsoWithOffset(date);
    }

    return {
      availableTime,
      customAvailableMinutes: availableTime === 'custom' ? customAvailableMinutes : undefined,
      moods,
      returnTarget,
      finalDestination: returnTarget === 'different' ? finalDestination ?? undefined : undefined,
      viaPoints,
      returnDeadline,
      detourLevel: deriveDetourLevel(moods),
      aiNote: aiNote.trim().length > 0 ? aiNote.trim() : undefined,
    };
  };

  const handleSubmit = async () => {
    if (submitting) {
      // 連打による二重リクエスト防止(ボタンはこのstepでは既に非表示になるが、念のため)。
      return;
    }
    const nextConditions = buildConditions();
    const willUseAi = shouldRequestAiInterpretation(nextConditions);

    setSubmissionError(null);
    setAiNotice(null);
    setThinkingUsesAi(willUseAi);
    setThinkingPhase(willUseAi ? 'interpreting' : 'planning');
    setSubmitting(true);
    setStep('thinking');
    setConditions(nextConditions);

    try {
      if (willUseAi) {
        // AIには構造化条件と自由記述だけを送る(座標・住所・保存場所・GPS履歴は送らない)。
        // クライアント側では自動リトライしない(サーバー側で既に最大1回リトライ済み)。
        const outcome = await requestAiRoutePreferences(nextConditions);
        if (isMountedRef.current) {
          if (outcome.ok) {
            setAiInterpretation(outcome.result);
            if (outcome.result.fallback) {
              setAiNotice('AIで追加条件を整理できませんでした。入力済みの条件でルートを探します。');
            }
          } else {
            setAiInterpretation(null);
            setAiNotice('AIで追加条件を整理できませんでした。入力済みの条件でルートを探します。');
          }
        }
      } else {
        setAiInterpretation(null);
      }

      if (isMountedRef.current) {
        setThinkingPhase('planning');
      }

      const provider = getRouteProvider();
      const routeResults = await provider.getRoutes({ departure, conditions: nextConditions });
      if (routeResults.length === 0) {
        throw new RoutePlanningError('選んだ条件ではルートを作れません。条件を変更してください。');
      }
      if (isMountedRef.current) {
        setRoutes(routeResults);
        // 「考えています」演出は一時的な遷移状態でしかない。この画面をスタックに
        // 残したままpushすると、ルート比較画面から戻ったときに「考えています」の
        // まま操作不能になってしまうため、replaceでスタックから取り除く。念のため
        // stepも確認画面へ戻しておき、万一この画面が再び表示されても「考えています」
        // が固まって見えたり、待機が勝手に再開したりしないようにする。
        setStep('confirm');
        router.replace('/route-compare');
      }
    } catch (error) {
      if (isMountedRef.current) {
        setRoutes([]);
        setSubmissionError(
          error instanceof RoutePlanningError
            ? error.message
            : 'ルートを作成できませんでした。条件を確認して、もう一度お試しください。'
        );
        setStep('confirm');
      }
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  // --- オーバーレイ(地図ピッカー・場所の名前入力) ---------------------------
  if (overlay === 'destination-map') {
    return (
      <MapPointPicker
        title="最後に行く場所を指定"
        instruction="地図を動かして、中央のピンを最後に向かいたい場所に合わせてください。"
        initialRegion={regionFromCoordinates(finalDestination?.coordinates ?? departure.coordinates)}
        onCancel={() => setOverlay('none')}
        onConfirm={handleDestinationMapConfirm}
      />
    );
  }

  if (overlay === 'via-map') {
    return (
      <MapPointPicker
        title="経由したい場所を指定"
        instruction="地図を動かして、中央のピンを経由したい場所に合わせてください。"
        initialRegion={regionFromCoordinates(departure.coordinates)}
        onCancel={() => setOverlay('none')}
        onConfirm={handleViaMapConfirm}
      />
    );
  }

  if (overlay === 'via-name') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.heading}>この場所の名前(任意)</Text>
            <Text style={styles.subtleText}>あとで見返しやすいよう、名前を付けられます(例: 道の駅)。</Text>
            <TextInput
              style={styles.textField}
              value={viaNameText}
              onChangeText={setViaNameText}
              placeholder="指定した場所"
              placeholderTextColor="#9aa5ab"
            />
            <Pressable
              style={styles.toggleRow}
              onPress={() => setSaveViaAsPlace((value) => !value)}>
              <View style={[styles.checkbox, saveViaAsPlace && styles.checkboxChecked]} />
              <Text style={styles.toggleLabel}>保存済み場所として保存する</Text>
            </Pressable>
            <PrimaryButton label="この内容で追加する" onPress={handleConfirmViaName} />
            <PrimaryButton
              label="キャンセル"
              variant="secondary"
              onPress={() => {
                setPendingViaCoordinates(null);
                setOverlay('none');
              }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // --- 通常のステップ表示 ---------------------------------------------------
  const progressIndex = STEP_ORDER.indexOf(step);
  const showProgress = progressIndex >= 0;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}>
        {showProgress && (
          <WizardProgressHeader
            step={progressIndex + 2}
            total={PROGRESS_TOTAL}
            title={STEP_TITLES[step as Exclude<StepId, 'confirm' | 'thinking'>]}
            onBack={handleBack}
          />
        )}

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 'mood' && (
            <>
              <Text style={styles.subtleText}>気になるものだけ選んでください(選ばなくてもOK)</Text>
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
            </>
          )}

          {step === 'time' && (
            <>
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
                <>
                  <View style={styles.timeInputRow}>
                    <NumberField label="日" value={customDaysText} onChangeText={setCustomDaysText} max={MAX_CUSTOM_DAYS} placeholder="0" />
                    <NumberField label="時間" value={customHoursText} onChangeText={setCustomHoursText} max={MAX_HOUR_PART} placeholder="2" />
                    <NumberField label="分" value={customMinutesText} onChangeText={setCustomMinutesText} max={MAX_MINUTE_PART} placeholder="30" />
                  </View>
                  {isCustomTimeTooShort ? (
                    <Text style={styles.errorText}>
                      15分未満では十分なルートを提案できない場合があります。15分以上に設定してください。
                    </Text>
                  ) : (
                    <Text style={styles.subtleText}>合計 {formatMinutesLabel(customTotalMinutes)}</Text>
                  )}
                </>
              )}
              {availableTime === 'unspecified' && (
                <Text style={styles.subtleText}>時間は決めず、ちょうど良さそうな長さで提案します。</Text>
              )}
            </>
          )}

          {step === 'destination' && (
            <>
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
              {returnTarget === 'different' && (
                <View style={styles.destinationBox}>
                  {finalDestination ? (
                    <>
                      <Text style={styles.subtleText}>選択中: {finalDestination.label}</Text>
                      <PrimaryButton
                        label="場所を選び直す"
                        variant="secondary"
                        onPress={() => setOverlay('destination-map')}
                      />
                    </>
                  ) : (
                    <PrimaryButton label="地図から選ぶ" onPress={() => setOverlay('destination-map')} />
                  )}
                </View>
              )}
            </>
          )}

          {step === 'via' && (
            <>
              {viaPoints.length === 0 ? (
                <Text style={styles.subtleText}>まだ追加していません(なくてもOK)</Text>
              ) : (
                <View style={styles.viaList}>
                  {viaPoints.map((point) => (
                    <View key={point.id} style={styles.viaRow}>
                      <Text style={styles.viaLabel}>{point.label}</Text>
                      <Pressable onPress={() => handleRemoveViaPoint(point.id)} hitSlop={8}>
                        <Text style={styles.confirmEdit}>削除</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <PrimaryButton label="地図から場所を追加" variant="secondary" onPress={() => setOverlay('via-map')} />

              {savedPlaces.length > 0 && (
                <Section title="保存済み場所">
                  <ChipRow>
                    {savedPlaces.map((place) => (
                      <OptionChip
                        key={place.id}
                        label={place.name}
                        selected={false}
                        onPress={() => handleAddViaFromPlace({ label: place.name, coordinates: place.coordinates, category: place.category })}
                      />
                    ))}
                  </ChipRow>
                </Section>
              )}

              {recentPlaces.length > 0 && (
                <Section title="最近使った場所">
                  <ChipRow>
                    {recentPlaces.map((place) => (
                      <OptionChip
                        key={place.id}
                        label={place.label}
                        selected={false}
                        onPress={() => handleAddViaFromPlace({ label: place.label, coordinates: place.coordinates })}
                      />
                    ))}
                  </ChipRow>
                </Section>
              )}
            </>
          )}

          {step === 'deadline' && (
            <>
              <ChipRow>
                <OptionChip label="指定なし" selected={returnDeadlineMode === 'none'} onPress={() => setReturnDeadlineMode('none')} />
                <OptionChip label="日時を指定" selected={returnDeadlineMode === 'custom'} onPress={() => setReturnDeadlineMode('custom')} />
              </ChipRow>
              {returnDeadlineMode === 'custom' && (
                <>
                  <ChipRow>
                    {DATE_MODE_OPTIONS.map((option) => (
                      <OptionChip
                        key={option.value}
                        label={option.label}
                        selected={dateMode === option.value}
                        onPress={() => setDateMode(option.value)}
                      />
                    ))}
                  </ChipRow>
                  {dateMode === 'custom' && (
                    <View style={styles.timeInputRow}>
                      <NumberField label="年" value={customYearText} onChangeText={setCustomYearText} min={now.getFullYear()} max={now.getFullYear() + 1} placeholder={String(now.getFullYear())} width={64} />
                      <NumberField label="月" value={customMonthText} onChangeText={setCustomMonthText} min={1} max={12} placeholder="9" />
                      <NumberField label="日" value={customDayText} onChangeText={setCustomDayText} min={1} max={31} placeholder="3" />
                    </View>
                  )}
                  <View style={styles.timeInputRow}>
                    <NumberField label="時" value={deadlineHourText} onChangeText={setDeadlineHourText} max={MAX_HOUR_PART} placeholder="18" />
                    <NumberField label="分" value={deadlineMinuteText} onChangeText={setDeadlineMinuteText} max={MAX_MINUTE_PART} placeholder="0" />
                  </View>
                  {previewDeadlineDate && (
                    <Text style={isDeadlineInPast ? styles.noticeText : styles.subtleText}>
                      {isDeadlineInPast
                        ? 'その日時はすでに過ぎています。日付か時刻を確認してください。'
                        : `${formatDeadlinePreview(previewDeadlineDate)} に設定します`}
                    </Text>
                  )}
                </>
              )}
            </>
          )}

          {step === 'note' && (
            <>
              <Text style={styles.subtleText}>例: 海沿いを多めにして/高速道路は使いたくない/夜景が見たい</Text>
              <TextInput
                style={styles.noteField}
                value={aiNote}
                onChangeText={setAiNote}
                placeholder="AIに伝えたいことを自由に書いてください(任意)"
                placeholderTextColor="#9aa5ab"
                multiline
                textAlignVertical="top"
              />
            </>
          )}

          {step === 'confirm' && (
            <>
              <View style={styles.confirmHeaderRow}>
                <Pressable onPress={handleConfirmBack} hitSlop={12}>
                  <Text style={styles.backLabel}>戻る</Text>
                </Pressable>
              </View>
              <Text style={styles.heading}>条件を確認</Text>
              <ConfirmRow label="出発" value={departure.label} />
              <ConfirmRow
                label="気分"
                value={moods.length > 0 ? moods.map((mood) => MOOD_LABELS[mood]).join('・') : '指定なし'}
                onEdit={() => goToStep('mood', true)}
              />
              <ConfirmRow
                label="時間"
                value={availableTime === 'custom' ? formatMinutesLabel(customTotalMinutes) : AVAILABLE_TIME_LABELS[availableTime]}
                onEdit={() => goToStep('time', true)}
              />
              <ConfirmRow
                label="最後"
                value={returnTarget === 'same-as-departure' ? '出発地点に戻る' : finalDestination?.label ?? '未選択'}
                onEdit={() => goToStep('destination', true)}
              />
              <ConfirmRow
                label="経由したい場所"
                value={viaPoints.length > 0 ? viaPoints.map((point) => point.label).join('・') : 'なし'}
                onEdit={() => goToStep('via', true)}
              />
              <ConfirmRow
                label="戻る"
                value={
                  returnDeadlineMode === 'none'
                    ? '指定なし'
                    : previewDeadlineDate
                      ? formatDeadlinePreview(previewDeadlineDate)
                      : '指定なし'
                }
                onEdit={() => goToStep('deadline', true)}
              />
              <ConfirmRow
                label="AIへのお願い"
                value={aiNote.trim().length > 0 ? aiNote.trim() : 'なし'}
                onEdit={() => goToStep('note', true)}
              />
              {submissionError && <Text style={styles.errorText}>{submissionError}</Text>}
            </>
          )}

          {step === 'thinking' && (
            <View style={styles.thinkingBox}>
              <ActivityIndicator size="large" color="#0a7ea4" />
              <Text style={styles.heading}>あなたに合うドライブを考えています</Text>
              <View style={styles.thinkingList}>
                {thinkingUsesAi && (
                  <Text
                    style={[
                      styles.thinkingItem,
                      (thinkingPhase === 'interpreting' || thinkingPhase === 'planning') && styles.thinkingItemActive,
                    ]}>
                    {thinkingPhase === 'planning' ? '✓ ' : '・'}
                    あなたの希望を読み取っています
                  </Text>
                )}
                <Text style={[styles.thinkingItem, thinkingPhase === 'planning' && styles.thinkingItemActive]}>
                  ・条件に合うプランを考えています
                </Text>
              </View>
              {aiNotice && <Text style={styles.noticeText}>{aiNotice}</Text>}
            </View>
          )}
        </ScrollView>

        {step !== 'thinking' && (
          <View style={styles.footer}>
            {step === 'confirm' ? (
              <PrimaryButton label="今日のルートを見つける" onPress={handleSubmit} disabled={submitting} />
            ) : (
              <PrimaryButton
                label="次へ"
                onPress={handleNext}
                disabled={
                  (step === 'time' && isCustomTimeTooShort) ||
                  (step === 'destination' && returnTarget === 'different' && !finalDestination)
                }
              />
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function NumberField({
  label,
  value,
  onChangeText,
  min = 0,
  max,
  placeholder,
  width = 56,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  min?: number;
  max: number;
  placeholder: string;
  width?: number;
}) {
  return (
    <View style={styles.timeInputField}>
      <TextInput
        style={[styles.timeInputBox, { width }]}
        value={value}
        onChangeText={(text) => onChangeText(sanitizeDigits(text).slice(0, 4))}
        onBlur={() => onChangeText(String(clampInt(value, min, max)))}
        keyboardType="number-pad"
        placeholder={placeholder}
        placeholderTextColor="#9aa5ab"
      />
      <Text style={styles.timeInputUnit}>{label}</Text>
    </View>
  );
}

function ConfirmRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <View style={styles.confirmRow}>
      <View style={styles.confirmRowText}>
        <Text style={styles.confirmLabel}>{label}</Text>
        <Text style={styles.confirmValue}>{value}</Text>
      </View>
      {onEdit && (
        <Pressable onPress={onEdit} hitSlop={8}>
          <Text style={styles.confirmEdit}>変更</Text>
        </Pressable>
      )}
    </View>
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
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 4,
  },
  subtleText: {
    fontSize: 13,
    color: '#8b959c',
    lineHeight: 19,
  },
  section: {
    marginTop: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#11181C',
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
  timeInputUnit: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334',
  },
  destinationBox: {
    gap: 10,
    marginTop: 4,
  },
  viaList: {
    gap: 8,
    marginBottom: 4,
  },
  viaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  viaLabel: {
    fontSize: 14,
    color: '#11181C',
    fontWeight: '600',
  },
  noteField: {
    minHeight: 140,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 14,
    fontSize: 15,
    color: '#11181C',
    lineHeight: 22,
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#0a7ea4',
    borderColor: '#0a7ea4',
  },
  toggleLabel: {
    fontSize: 14,
    color: '#334',
  },
  confirmHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  backLabel: {
    fontSize: 14,
    color: '#0a7ea4',
    fontWeight: '600',
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#eef2f3',
    backgroundColor: '#fafbfb',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },
  confirmRowText: {
    flex: 1,
    gap: 2,
  },
  confirmLabel: {
    fontSize: 12,
    color: '#8b959c',
    fontWeight: '600',
  },
  confirmValue: {
    fontSize: 15,
    color: '#11181C',
    fontWeight: '600',
  },
  confirmEdit: {
    fontSize: 13,
    color: '#0a7ea4',
    fontWeight: '700',
  },
  thinkingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 20,
  },
  thinkingList: {
    gap: 10,
    alignSelf: 'stretch',
  },
  thinkingItem: {
    fontSize: 14,
    color: '#b7c0c4',
    textAlign: 'center',
  },
  thinkingItemActive: {
    color: '#0a7ea4',
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  noticeText: {
    color: '#7a5b18',
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 13,
    lineHeight: 19,
  },
});
