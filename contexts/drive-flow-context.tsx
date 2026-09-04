import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { isValidCoordinates } from '@/services/location/coordinates';
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
}

interface DriveFlowContextValue extends DriveFlowState {
  setDeparture: (departure: DepartureSelection) => void;
  setConditions: (conditions: DriveConditions) => void;
  setRoutes: (routes: RouteOption[]) => void;
  setSelectedRouteId: (routeId: string) => void;
  initializeSpotDiscovery: (routeId: string, spots: Spot[]) => void;
  setSelectedSpotId: (routeId: string, spotId: string) => void;
  setSelectedSpotIds: (routeId: string, spotIds: string[]) => void;
  setDriveRecord: (record: DriveRecordingResult) => void;
  addDiaryEntry: (entry: DriveDiaryEntry) => void;
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
   * 条件入力ウィザードへ戻る入口から呼ぶ。データは一切変更せず、
   * planningEntryModeだけを'edit'にする。
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
};

const DriveFlowContext = createContext<DriveFlowContextValue | null>(null);

export function DriveFlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DriveFlowState>(initialState);

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

  const initializeSpotDiscovery = useCallback((routeId: string, spots: Spot[]) => {
    setState((prev) => {
      if (!prev.routes.some((route) => route.id === routeId)) {
        return prev;
      }

      const uniqueSpots = spots.filter(
        (spot, index, all) =>
          spot.isMock &&
          isValidCoordinates(spot.coordinates) &&
          Number.isFinite(spot.extraMinutes) &&
          spot.extraMinutes >= 0 &&
          Number.isFinite(spot.extraDistanceKm) &&
          spot.extraDistanceKm >= 0 &&
          all.findIndex((candidate) => candidate.id === spot.id) === index
      );
      const validIds = new Set(uniqueSpots.map((spot) => spot.id));

      if (prev.spotRouteId !== routeId) {
        return {
          ...prev,
          spotRouteId: routeId,
          spots: uniqueSpots,
          selectedSpotId: uniqueSpots[0]?.id ?? null,
          selectedSpotIds: [],
        };
      }

      const selectedSpotIds = prev.selectedSpotIds
        .filter((id) => validIds.has(id))
        .slice(0, MAX_SELECTED_SPOTS);
      return {
        ...prev,
        spots: uniqueSpots,
        selectedSpotId:
          prev.selectedSpotId && validIds.has(prev.selectedSpotId)
            ? prev.selectedSpotId
            : uniqueSpots[0]?.id ?? null,
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

  const addDiaryEntry = useCallback((entry: DriveDiaryEntry) => {
    setState((prev) => ({
      ...prev,
      diaryEntries: [...prev.diaryEntries, entry],
      latestDiaryEntryId: entry.id,
    }));
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
      // diaryEntriesは履歴のため保持する。自宅・保存済み場所・最近使った場所は
      // このContextの外(expo-secure-store)にあるため、そもそもここでは触れない。
    }));
  }, []);

  const beginConditionsEdit = useCallback(() => {
    setState((prev) => ({ ...prev, planningEntryMode: 'edit' }));
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
      setSelectedSpotIds,
      setDriveRecord,
      addDiaryEntry,
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
      setSelectedSpotIds,
      setDriveRecord,
      addDiaryEntry,
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
