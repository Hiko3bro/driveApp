import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { getDiaryEntries, saveDiaryEntry } from '@/services/diary/diary-store';
import { isValidCoordinates } from '@/services/location/coordinates';
import type { AiInterpretationResult } from '@/types/ai-route-preferences';
import type { DriveConditions } from '@/types/drive';
import type { DriveDiaryEntry } from '@/types/drive-diary';
import type { DriveRecordingResult } from '@/types/drive-recording';
import type { DepartureSelection } from '@/types/location';
import type { RouteOption } from '@/types/route';
import { MAX_SELECTED_SPOTS, type Spot } from '@/types/spot';

/**
 * 「出発地点選び〜条件入力ウィザード」を新規の質問から始めるか(new)、既存の
 * DriveConditionsを保持したまま条件確認から再開するか(edit)を表す、明示的な状態。
 * conditions.tsxはこれだけを見て開始ステップを決め、「conditionsがnullかどうか」の
 * ような暗黙の推測はしない。
 */
export type PlanningEntryMode = 'new' | 'edit';

interface DriveFlowState {
  departure: DepartureSelection | null;
  conditions: DriveConditions | null;
  planningEntryMode: PlanningEntryMode;
  routes: RouteOption[];
  selectedRouteId: string | null;
  spotRouteId: string | null;
  spots: Spot[];
  selectedSpotId: string | null;
  selectedSpotIds: string[];
  /** 進行中/直近に終了したドライブ記録。1回のドライブ(=1セッション)だけに属する一時状態。 */
  driveRecord: DriveRecordingResult | null;
  /** 作成済みのドライブ日記。セッションをまたいで保持する履歴。将来AsyncStorage等への永続化もそのまま移行できる配列構造にしている。 */
  diaryEntries: DriveDiaryEntry[];
  /** 直近に作成した日記のid。日記作成後の確認画面が参照する、1セッションだけの一時状態。 */
  latestDiaryEntryId: string | null;
  /**
   * AI(Supabase Edge Function ai-route-planning)がaiNoteから解釈した嗜好。
   * 1回の計画セッションだけに属する一時状態で、resetPlanningSession()や
   * beginConditionsEdit()(条件を変える)で必ずクリアする。古いAI結果を
   * 新しいドライブや変更後の条件へ持ち越して再利用しない。
   */
  aiInterpretation: AiInterpretationResult | null;
  /**
   * 現在の計画セッションが旅行プランのどの日に紐づいているか。旅行日から
   * 「ルートを探す」で入った場合のみ設定される。nullなら通常の「今すぐドライブ」。
   * entryIdは、旅行の1日まるごとではなく、しおりタイムラインの特定の区間(車移動)
   * だけにこのセッションのルート結果を紐付けたい場合に設定する(未設定なら従来どおり
   * 1日まるごとの更新)。resetPlanningSession()で必ずクリアする(新規ドライブに前回の
   * 旅行紐付けを持ち越さない)。beginConditionsEdit()(条件を変える)では維持する
   * (同じ旅行日の編集を続けているため)。
   */
  activeTripDay: { tripId: string; dayId: string; entryId?: string } | null;
}

interface DriveFlowContextValue extends DriveFlowState {
  setDeparture: (departure: DepartureSelection) => void;
  setConditions: (conditions: DriveConditions) => void;
  setRoutes: (routes: RouteOption[]) => void;
  setSelectedRouteId: (routeId: string) => void;
  initializeSpotDiscovery: (routeId: string, spots: Spot[]) => void;
  setSelectedSpotId: (routeId: string, spotId: string) => void;
  /** 選択中のスポットを解除する(地図の背景タップ・同じMarker再タップ等から呼ぶ)。 */
  clearSelectedSpotId: (routeId: string) => void;
  setSelectedSpotIds: (routeId: string, spotIds: string[]) => void;
  setDriveRecord: (record: DriveRecordingResult) => void;
  /**
   * 日記をin-memory stateへ即座に反映しつつ、AsyncStorageへの永続化も行い、その
   * 書き込みが完了する(または失敗する)までawaitできるPromiseを返す。呼び出し元
   * (日記作成画面)は、ユーザーが「保存完了」と認識する操作(保存ボタン→確認画面遷移)
   * の前にこれをawaitすることで、書き込み完了前にアプリが終了して保存が失われる
   * リスクを避ける。戻り値がfalseの場合、in-memory stateには反映済みだが端末への
   * 永続化には失敗している(このセッション中は通常どおり使える)。
   */
  addDiaryEntry: (entry: DriveDiaryEntry) => Promise<boolean>;
  /** 日記タブの一覧から既存の日記を開く際に使う。存在しないidは無視する。 */
  selectDiaryEntry: (entryId: string) => void;
  /** AI解釈結果を保存する。nullを渡すとクリアする(呼び出し失敗時・条件変更時など)。 */
  setAiInterpretation: (result: AiInterpretationResult | null) => void;
  /** 旅行日から計画を始める際にセットする。通常の「今すぐドライブ」ではnullのまま。 */
  setActiveTripDay: (value: { tripId: string; dayId: string; entryId?: string } | null) => void;
  /**
   * ホームの「今からドライブ」など、新規にドライブを1回始める入口からだけ呼ぶ。
   * 「1回のドライブ計画・実走・記録」というセッションに属する一時状態(出発地点・
   * 条件・提案ルート・選択中ルート・スポット選択・記録中のドライブ・直近の日記id)を
   * まとめて消し、planningEntryModeを'new'に戻す。自宅・保存済み場所・最近使った場所
   * (expo-secure-store側、このContextの外)、作成済みの日記一覧(diaryEntries)には
   * 一切触れない。
   */
  resetPlanningSession: () => void;
  /**
   * ルート比較画面の「条件を変える」など、既存のDriveConditionsを保持したまま
   * 条件入力ウィザードへ戻る入口から呼ぶ。DriveConditions自体は変更せず
   * planningEntryModeを'edit'にする。ただし過去のAI解釈結果は、変更後の条件と
   * 食い違ったまま使われないよう、ここでクリアする(再度「この条件で探す」を
   * 押した時に必要なら改めて解釈する)。
   */
  beginConditionsEdit: () => void;
  reset: () => void;
}

const emptySpotState = {
  spotRouteId: null,
  spots: [] as Spot[],
  selectedSpotId: null,
  selectedSpotIds: [] as string[],
};

const initialState: DriveFlowState = {
  departure: null,
  conditions: null,
  planningEntryMode: 'new',
  routes: [],
  selectedRouteId: null,
  ...emptySpotState,
  driveRecord: null,
  diaryEntries: [],
  latestDiaryEntryId: null,
  aiInterpretation: null,
  activeTripDay: null,
};

const DriveFlowContext = createContext<DriveFlowContextValue | null>(null);

export function DriveFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DriveFlowState>(initialState);

  // アプリ起動時に、端末へ永続化済みの日記をAsyncStorageから読み込む。
  // 旅行プラン等と異なり、diaryEntriesはホーム/日記タブから常時参照されるため
  // 遅延読み込みではなくProvider起動時に一度だけ読み込む。
  useEffect(() => {
    let cancelled = false;
    void getDiaryEntries().then((entries) => {
      if (cancelled || entries.length === 0) {
        return;
      }
      setState((prev) => (prev.diaryEntries.length > 0 ? prev : { ...prev, diaryEntries: entries }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setDeparture = useCallback((departure: DepartureSelection) => {
    if (!isValidCoordinates(departure.coordinates)) {
      return;
    }
    setState((prev) => ({ ...prev, departure }));
  }, []);

  const setConditions = useCallback((conditions: DriveConditions) => {
    setState((prev) => ({ ...prev, conditions }));
  }, []);

  const setRoutes = useCallback((routes: RouteOption[]) => {
    setState((prev) => ({
      ...prev,
      routes,
      selectedRouteId: routes[0]?.id ?? null,
      ...emptySpotState,
    }));
  }, []);

  const setSelectedRouteId = useCallback((routeId: string) => {
    setState((prev) => {
      if (!prev.routes.some((route) => route.id === routeId)) {
        return prev;
      }
      if (prev.selectedRouteId === routeId) {
        return prev;
      }
      return { ...prev, selectedRouteId: routeId, ...emptySpotState };
    });
  }, []);

  /**
   * カテゴリチップ単位のオンデマンド検索結果を、既存のspotsへ追加(マージ)する。
   * 同じルートに対して複数回呼ばれる想定(カテゴリごとに1回ずつ)のため、
   * 既存のspots・選択中のスポットは消さず、新規分だけをid重複除外のうえ追加する。
   * ルートが切り替わった場合(spotRouteId !== routeId)のみ、初回として置き換える。
   */
  const initializeSpotDiscovery = useCallback((routeId: string, spots: Spot[]) => {
    setState((prev) => {
      if (!prev.routes.some((route) => route.id === routeId)) {
        return prev;
      }

      const validIncoming = spots.filter(
        (spot, index, all) =>
          isValidCoordinates(spot.coordinates) &&
          Number.isFinite(spot.extraMinutes) &&
          spot.extraMinutes >= 0 &&
          Number.isFinite(spot.extraDistanceKm) &&
          spot.extraDistanceKm >= 0 &&
          all.findIndex((candidate) => candidate.id === spot.id) === index
      );

      if (prev.spotRouteId !== routeId) {
        return {
          ...prev,
          spotRouteId: routeId,
          spots: validIncoming,
          selectedSpotId: validIncoming[0]?.id ?? null,
          selectedSpotIds: [],
        };
      }

      const existingIds = new Set(prev.spots.map((spot) => spot.id));
      const mergedSpots = [...prev.spots, ...validIncoming.filter((spot) => !existingIds.has(spot.id))];
      const validIds = new Set(mergedSpots.map((spot) => spot.id));

      const selectedSpotIds = prev.selectedSpotIds
        .filter((id) => validIds.has(id))
        .slice(0, MAX_SELECTED_SPOTS);
      return {
        ...prev,
        spots: mergedSpots,
        selectedSpotId:
          prev.selectedSpotId && validIds.has(prev.selectedSpotId)
            ? prev.selectedSpotId
            : mergedSpots[0]?.id ?? null,
        selectedSpotIds,
      };
    });
  }, []);

  const setSelectedSpotId = useCallback((routeId: string, spotId: string) => {
    setState((prev) => {
      if (prev.spotRouteId !== routeId || !prev.spots.some((spot) => spot.id === spotId)) {
        return prev;
      }
      return prev.selectedSpotId === spotId ? prev : { ...prev, selectedSpotId: spotId };
    });
  }, []);

  const clearSelectedSpotId = useCallback((routeId: string) => {
    setState((prev) => {
      if (prev.spotRouteId !== routeId || prev.selectedSpotId === null) {
        return prev;
      }
      return { ...prev, selectedSpotId: null };
    });
  }, []);

  const setSelectedSpotIds = useCallback((routeId: string, spotIds: string[]) => {
    setState((prev) => {
      if (prev.spotRouteId !== routeId || spotIds.length > MAX_SELECTED_SPOTS) {
        return prev;
      }

      const uniqueIds = [...new Set(spotIds)];
      const knownIds = new Set(prev.spots.map((spot) => spot.id));
      if (uniqueIds.length !== spotIds.length || uniqueIds.some((id) => !knownIds.has(id))) {
        return prev;
      }

      return { ...prev, selectedSpotIds: uniqueIds };
    });
  }, []);

  const setDriveRecord = useCallback((record: DriveRecordingResult) => {
    setState((prev) => ({ ...prev, driveRecord: record }));
  }, []);

  const addDiaryEntry = useCallback(async (entry: DriveDiaryEntry): Promise<boolean> => {
    setState((prev) => {
      // 同じidでの再試行(保存失敗後の再保存操作)でも重複エントリを作らないよう、
      // 既存があれば置き換える(upsert)。
      const index = prev.diaryEntries.findIndex((existing) => existing.id === entry.id);
      const nextDiaryEntries =
        index === -1
          ? [...prev.diaryEntries, entry]
          : prev.diaryEntries.map((existing, i) => (i === index ? entry : existing));
      return { ...prev, diaryEntries: nextDiaryEntries, latestDiaryEntryId: entry.id };
    });
    // AsyncStorageへの書き込みが完了するまで呼び出し元がawaitできるようにする
    // (書き込み完了前に画面遷移・アプリ終了してしまうと保存が失われるため)。
    return saveDiaryEntry(entry);
  }, []);

  const selectDiaryEntry = useCallback((entryId: string) => {
    setState((prev) => (prev.diaryEntries.some((entry) => entry.id === entryId) ? { ...prev, latestDiaryEntryId: entryId } : prev));
  }, []);

  const setAiInterpretation = useCallback((result: AiInterpretationResult | null) => {
    setState((prev) => ({ ...prev, aiInterpretation: result }));
  }, []);

  const setActiveTripDay = useCallback((value: { tripId: string; dayId: string; entryId?: string } | null) => {
    setState((prev) => ({ ...prev, activeTripDay: value }));
  }, []);

  const resetPlanningSession = useCallback(() => {
    setState((prev) => ({
      ...prev,
      departure: null,
      conditions: null,
      planningEntryMode: 'new',
      routes: [],
      selectedRouteId: null,
      ...emptySpotState,
      driveRecord: null,
      latestDiaryEntryId: null,
      aiInterpretation: null,
      activeTripDay: null,
      // diaryEntriesは履歴のため保持する。自宅・保存済み場所・最近使った場所は
      // このContextの外(expo-secure-store)にあるため、そもそもここでは触れない。
    }));
  }, []);

  const beginConditionsEdit = useCallback(() => {
    setState((prev) => ({ ...prev, planningEntryMode: 'edit', aiInterpretation: null }));
  }, []);

  const reset = useCallback(() => {
    setState(initialState);
  }, []);

  const value = useMemo<DriveFlowContextValue>(
    () => ({
      ...state,
      setDeparture,
      setConditions,
      setRoutes,
      setSelectedRouteId,
      initializeSpotDiscovery,
      setSelectedSpotId,
      clearSelectedSpotId,
      setSelectedSpotIds,
      setDriveRecord,
      addDiaryEntry,
      selectDiaryEntry,
      setAiInterpretation,
      setActiveTripDay,
      resetPlanningSession,
      beginConditionsEdit,
      reset,
    }),
    [
      state,
      setDeparture,
      setConditions,
      setRoutes,
      setSelectedRouteId,
      initializeSpotDiscovery,
      setSelectedSpotId,
      clearSelectedSpotId,
      setSelectedSpotIds,
      setDriveRecord,
      addDiaryEntry,
      selectDiaryEntry,
      setAiInterpretation,
      setActiveTripDay,
      resetPlanningSession,
      beginConditionsEdit,
      reset,
    ]
  );

  return <DriveFlowContext.Provider value={value}>{children}</DriveFlowContext.Provider>;
}

export function useDriveFlow(): DriveFlowContextValue {
  const context = useContext(DriveFlowContext);
  if (!context) {
    throw new Error('useDriveFlow must be used within a DriveFlowProvider');
  }
  return context;
}
