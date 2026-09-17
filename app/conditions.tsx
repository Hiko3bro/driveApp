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
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { requestAiRoutePreferences, shouldRequestAiInterpretation } from '@/services/ai/route-planning-client';
import { addSavedPlace, getSavedPlaces } from '@/services/location/saved-places-store';
import { searchPlaceByText } from '@/services/spot/google-places-client';
import { getRecentPlaces, recordRecentPlace } from '@/services/location/recent-places-store';
import { RoutePlanningError } from '@/services/route';
import { buildRouteOptionsFromDrivePlans } from '@/services/route/drive-plan-mapper';
import {
  requestDrivePlans,
  toDrivePlanPreferences,
  type DrivePlanPreferences,
} from '@/services/route/drive-route-planner-client';
import { resolveEffectiveTimeBudget } from '@/services/route/time-budget';
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
import type { RouteOption } from '@/types/route';

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

/** drive-route-planner側のMIN_AVAILABLE_TIME_MINUTESと合わせる。これ未満では実ルート提案自体を呼ばない。 */
const MIN_DRIVE_PLAN_MINUTES = 15;

/**
 * おまかせ目的地候補について、実測ルート時間が目標時間に対してこの比率未満なら、
 * 単独ゴールとして採用しない(例: 120分指定で60分未満のgoalは近すぎるため除外)。
 * 「AIのテーマ一致だけで採用せず、実測時間で見て目標時間に適した候補だけを昇格させる」
 * という方針(実機で「地魚酒場」が近すぎるまま採用された不具合への対処)。
 */
const MIN_OMAKASE_GOAL_DURATION_RATIO = 0.5;

/** AIに追加条件を伝えていない/AI結果が無い場合に使う、中立なデフォルト値。 */
const DEFAULT_DRIVE_PLAN_PREFERENCES: DrivePlanPreferences = {
  avoidHighways: false,
  preferScenicRoads: false,
  preferCoastalRoads: false,
  preferMountainRoads: false,
  preferredScenery: [],
  desiredStops: [],
  drivingStyle: 'balanced',
};

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
          <ActivityIndicator size="large" color={Colors.accentBlue} />
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
    // 条件を変えて再送信するたびに、古い提案ルートを必ず無効化する(前回の候補を
    // 引きずったまま新しい結果に見せかけない)。
    setRoutes([]);

    try {
      // 「2時間」等の選択・帰着日時から、実際に使える時間予算(分)を確定する。
      // これをdrive-route-plannerへ渡し、時間予算を考慮したルート選定に実際に使う
      // (これまでのようにorigin→destinationだけをGoogle Routesへ送って終わりにはしない)。
      const timeBudget = resolveEffectiveTimeBudget(nextConditions);
      if (!timeBudget.ok) {
        throw new RoutePlanningError(timeBudget.message);
      }
      // timeBudget.minutesがundefinedは「時間指定なし」を意味し、下限チェックの対象外。
      if (timeBudget.minutes !== undefined && timeBudget.minutes < MIN_DRIVE_PLAN_MINUTES) {
        throw new RoutePlanningError(
          '選んだ時間・帰着日時では、実際のルートを作成するには短すぎます。時間か帰着日時を変更してください。'
        );
      }

      let planPreferences: DrivePlanPreferences = DEFAULT_DRIVE_PLAN_PREFERENCES;
      let biasPoint: Coordinates | undefined;
      // 「おまかせ」の場合、AIは性格の異なる最大3件の検索意図(例:「夜景スポット」
      // 「高原の展望台」「温泉」)を返す。「AIが1件だけ勝手に決める」のではなく、
      // 実在確認できた候補をすべてrequestDrivePlansへ個別に渡し、体験の異なる
      // 複数のゴールへの実ルートをそのままルート比較画面(既存の3案比較UI)で
      // 選べるようにする(新しい選択専用画面は今回追加しない)。
      const aiSuggestedDestinationCandidates: PlaceSelection[] = [];
      // 「夜景スポット」等の一般的な語句が出発地点から無関係に離れた場所へマッチしない
      // よう、Text Search全般に出発地点周辺への重み付けをかける(架空の座標を作るのではなく、
      // 実在検索の「優先範囲」を絞るだけ)。
      const textSearchBias = { center: departure.coordinates, radiusMeters: 50_000 };

      if (willUseAi) {
        // AIには構造化条件と自由記述だけを送る(座標・住所・保存場所・GPS履歴は送らない)。
        // クライアント側では自動リトライしない(サーバー側で既に最大1回リトライ済み)。
        const outcome = await requestAiRoutePreferences(nextConditions);
        if (isMountedRef.current) {
          if (outcome.ok) {
            setAiInterpretation(outcome.result);
            planPreferences = toDrivePlanPreferences(outcome.result.preferences);
            if (outcome.result.fallback) {
              setAiNotice('AIで追加条件を整理できませんでした。入力済みの条件でルートを探します。');
            }
            // 「生駒を走りたい」等の強い地理的希望をAIが検索意図(地名)として返した場合、
            // AIが座標を創作することはないため、ここでGoogle Places Text Search経由で
            // 実在確認してからbiasPointとして使う(見つからなくても致命的エラーにはせず、
            // biasPoint無しで通常どおり続行する)。
            const requestedAreaQuery = outcome.result.preferences.requestedAreaQuery;
            if (requestedAreaQuery) {
              const placeOutcome = await searchPlaceByText(requestedAreaQuery, 1, textSearchBias);
              if (isMountedRef.current && placeOutcome.ok && placeOutcome.places.length > 0) {
                const place = placeOutcome.places[0];
                biasPoint = { latitude: place.latitude, longitude: place.longitude };
              }
              if (__DEV__) {
                // 調査用。地名文字列・座標は出さない(見つかったかどうかのみ)。
                console.log('[conditions] requestedAreaQuery resolution', { resolved: Boolean(biasPoint) });
              }
            }
            // 最終地点「おまかせ」の場合、AIが考えた最大3件の「立ち寄り先のタイプ」の
            // 検索語句を、それぞれGoogle Placesで実在確認する(AIは具体的な店舗・施設名を
            // 創作しない)。1件も見つからなければ致命的エラーにはせず、通常のループ
            // (出発地点に戻る)へ安全にフォールバックする。
            if (nextConditions.returnTarget === 'ai-suggested') {
              const goalQueries = [
                outcome.result.preferences.suggestedGoalQuery,
                outcome.result.preferences.suggestedGoalQueryAlt1,
                outcome.result.preferences.suggestedGoalQueryAlt2,
              ].filter((query): query is string => Boolean(query));

              for (const query of goalQueries) {
                const goalOutcome = await searchPlaceByText(query, 1, textSearchBias);
                if (!isMountedRef.current || !goalOutcome.ok || goalOutcome.places.length === 0) {
                  continue;
                }
                const place = goalOutcome.places[0];
                // 既に採用した候補と同一の実在地点(名前)なら重複させない。
                if (!aiSuggestedDestinationCandidates.some((candidate) => candidate.label === place.name)) {
                  aiSuggestedDestinationCandidates.push({
                    label: place.name,
                    coordinates: { latitude: place.latitude, longitude: place.longitude },
                  });
                }
              }
              if (__DEV__) {
                // 調査用。地名文字列・座標は出さない(件数のみ)。
                console.log('[conditions] suggestedGoalQuery resolution', {
                  candidateCount: aiSuggestedDestinationCandidates.length,
                });
              }
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

      // 目的地あり/なしのどちらも、Supabase Edge Function(drive-route-planner)経由で
      // 実座標・実道路のドライブプランを取得する(mockへは通常フローで一切フォールバック
      // しない)。座標はplanning session内の実データ(出発地点・実際に選んだ目的地・
      // 実際に追加した経由地点)のみを送り、新しく座標を捏造しない。ユーザーが指定した
      // viaPointsは常にそのまま渡し、削除・並べ替え・候補地点との置き換えは行わない。
      let finalDestination: PlaceSelection | undefined = nextConditions.finalDestination;
      let routeOptions: RouteOption[] = [];
      let overBudgetForLog = false;
      let searchRoundsForLog: number | undefined;

      if (!finalDestination && aiSuggestedDestinationCandidates.length > 0) {
        // 「おまかせ」: 実在確認できた候補ごとに個別にルートを実測し、体験の異なる
        // 複数のゴールを、既存のルート比較画面(3案比較UI)でそのまま選べるようにする
        // (新しい選択専用画面は今回追加しない)。1件の候補が失敗しても他の候補は
        // 引き続き試す(致命的エラーにはしない)。
        for (let i = 0; i < aiSuggestedDestinationCandidates.length; i++) {
          const candidate = aiSuggestedDestinationCandidates[i];
          const candidateOutcome = await requestDrivePlans({
            origin: departure.coordinates,
            destination: candidate.coordinates,
            userViaPoints: nextConditions.viaPoints.map((point) => point.coordinates),
            returnTarget: 'different',
            availableTimeMinutes: timeBudget.minutes,
            preferences: planPreferences,
            biasPoint,
          });
          if (!candidateOutcome.ok || candidateOutcome.plans.length === 0) {
            continue;
          }
          // テーマ一致だけで採用せず、実測時間が目標時間に対して近すぎるゴールは
          // 単独候補として採用しない(セクション2: 「地魚酒場」が近すぎるまま採用された不具合)。
          if (timeBudget.minutes !== undefined) {
            const candidateDurationMinutes = candidateOutcome.plans[0].durationSeconds / 60;
            if (candidateDurationMinutes / timeBudget.minutes < MIN_OMAKASE_GOAL_DURATION_RATIO) {
              continue;
            }
          }
          // 候補ごとに最良の1件(先頭)だけを採用する(同じ候補内でのバリエーションより、
          // 候補間の違い= ゴール自体の違いを優先するため)。
          const candidateOptions = buildRouteOptionsFromDrivePlans([candidateOutcome.plans[0]], candidateOutcome.meta, {
            departureLabel: departure.label,
            destinationLabel: candidate.label,
            userViaPoints: nextConditions.viaPoints.map((point) => ({ label: point.label, coordinates: point.coordinates })),
            avoidHighwaysApplied: planPreferences.avoidHighways,
          });
          for (const option of candidateOptions) {
            routeOptions.push({ ...option, id: `omakase-${i}-${option.id}`, name: candidate.label });
          }
          overBudgetForLog = overBudgetForLog || candidateOutcome.meta.overBudget;
        }
        if (routeOptions.length > 0) {
          // 代表としてログ・エラーメッセージ用に1件目を入れておく(実際の目的地は
          // ルートごとに異なる)。
          finalDestination = aiSuggestedDestinationCandidates[0];
        }
      }

      if (routeOptions.length === 0) {
        // 通常の単一目的地(指定なし=出発地点に戻るループ/別の場所/おまかせが1件も
        // 解決できなかった場合はここへ安全にフォールバックする)。
        const planOutcome = await requestDrivePlans({
          origin: departure.coordinates,
          destination: finalDestination?.coordinates,
          userViaPoints: nextConditions.viaPoints.map((point) => point.coordinates),
          returnTarget: finalDestination ? 'different' : 'same-as-departure',
          availableTimeMinutes: timeBudget.minutes,
          preferences: planPreferences,
          biasPoint,
        });

        if (!planOutcome.ok) {
          // 実APIの失敗時に、架空のmock routeを「本物のルート」として黙って表示しない。
          throw new RoutePlanningError('ルートを取得できませんでした。もう一度お試しください。');
        }

        routeOptions = buildRouteOptionsFromDrivePlans(planOutcome.plans, planOutcome.meta, {
          departureLabel: departure.label,
          destinationLabel: finalDestination?.label,
          userViaPoints: nextConditions.viaPoints.map((point) => ({
            label: point.label,
            coordinates: point.coordinates,
          })),
          avoidHighwaysApplied: planPreferences.avoidHighways,
        });
        overBudgetForLog = planOutcome.meta.overBudget;
        searchRoundsForLog = planOutcome.meta.searchRoundsUsed;
      }

      if (routeOptions.length === 0) {
        throw new RoutePlanningError(
          finalDestination
            ? '選んだ条件ではルートを作れませんでした。条件を変更してください。'
            : '周辺で提案できるドライブプランが見つかりませんでした。条件を変更してください。'
        );
      }

      if (__DEV__) {
        // 調査用。緯度経度・場所名・aiNote・APIキー・installIdは出さない。
        const inIdealTimeBandCount = routeOptions.filter((route) => {
          if (route.targetDurationMinutes === undefined) {
            return false;
          }
          const ratio = route.durationMinutes / route.targetDurationMinutes;
          return ratio >= 0.85 && ratio <= 1.1;
        }).length;
        console.log('[conditions] drive plan result', {
          hasDestination: Boolean(finalDestination),
          isOmakaseMultiGoal: aiSuggestedDestinationCandidates.length > 0 && !nextConditions.finalDestination,
          userViaPointCount: nextConditions.viaPoints.length,
          planCount: routeOptions.length,
          usedSuggestedPlace: routeOptions.some((route) => Boolean(route.suggestedPlace)),
          routeSources: routeOptions.map((route) => route.source),
          overBudget: overBudgetForLog,
          searchRoundsUsed: searchRoundsForLog,
          inIdealTimeBandCount,
          durationMinutesList: routeOptions.map((route) => route.durationMinutes),
          biasApplied: Boolean(biasPoint),
          nearbySuggestionCounts: routeOptions.map((route) => route.nearbySuggestions?.length ?? 0),
        });
      }

      if (isMountedRef.current) {
        setRoutes(routeOptions);
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
              placeholderTextColor={Colors.textTertiary}
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
              {returnTarget === 'ai-suggested' && (
                <Text style={styles.subtleText}>
                  気分・時間・季節から、AIが実在するゴールを1つ提案します(架空の場所は作りません)。
                </Text>
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
                placeholderTextColor={Colors.textTertiary}
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
                value={
                  returnTarget === 'same-as-departure'
                    ? '出発地点に戻る'
                    : returnTarget === 'ai-suggested'
                      ? 'おまかせ(AIが提案)'
                      : (finalDestination?.label ?? '未選択')
                }
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
              <ActivityIndicator size="large" color={Colors.accentBlue} />
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
                  ・ルートを探しています
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
        placeholderTextColor={Colors.textTertiary}
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
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontSize: Typography.screenTitle.fontSize - 8,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  subtleText: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    lineHeight: 19,
  },
  section: {
    marginTop: Spacing.sm,
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: Typography.sectionTitle.fontWeight,
    color: Colors.textPrimary,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  timeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.xs,
  },
  timeInputField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  timeInputBox: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    fontSize: 16,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  timeInputUnit: {
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  destinationBox: {
    gap: Spacing.sm + 2,
    marginTop: Spacing.xs,
  },
  viaList: {
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  viaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg - 2,
  },
  viaLabel: {
    fontSize: Typography.body.fontSize,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  noteField: {
    minHeight: 140,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    padding: Spacing.lg - 2,
    fontSize: 15,
    color: Colors.textPrimary,
    lineHeight: 22,
  },
  textField: {
    minHeight: 48,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg - 2,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
    marginTop: Spacing.xs,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm - 2,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
  },
  checkboxChecked: {
    backgroundColor: Colors.accentBlue,
    borderColor: Colors.accentBlue,
  },
  toggleLabel: {
    fontSize: Typography.body.fontSize,
    color: Colors.textSecondary,
  },
  confirmHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  backLabel: {
    fontSize: Typography.body.fontSize,
    color: Colors.accentBlue,
    fontWeight: '600',
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surfaceSubtle,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg - 2,
    gap: Spacing.sm,
  },
  confirmRowText: {
    flex: 1,
    gap: 2,
  },
  confirmLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  confirmValue: {
    fontSize: 15,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  confirmEdit: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.accentBlue,
    fontWeight: '700',
  },
  thinkingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: Spacing.xl - 4,
  },
  thinkingList: {
    gap: Spacing.sm + 2,
    alignSelf: 'stretch',
  },
  thinkingItem: {
    fontSize: Typography.body.fontSize,
    color: Colors.textTertiary,
    textAlign: 'center',
  },
  thinkingItemActive: {
    color: Colors.accentBlue,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  noticeText: {
    color: Colors.warning,
    fontSize: 12,
    lineHeight: 17,
  },
  errorText: {
    color: Colors.accentRed,
    fontSize: Typography.secondary.fontSize,
    lineHeight: 19,
  },
});
