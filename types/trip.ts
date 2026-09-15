import type { AiRoutePreferences } from '@/types/ai-route-preferences';
import type { PlaceSelection, ViaPoint } from '@/types/location';
import type { RouteOption } from '@/types/route';

/** ローカル保存するJSON構造のバージョン。将来形式を変える際はここを上げ、旧データは安全に無視する。 */
export const TRIP_SCHEMA_VERSION = 1;

/**
 * 旅行の1日分。既存のDriveConditions/RouteOption/AiRoutePreferencesと同じ型を
 * 再利用し、旅行専用の新しいルート生成・条件表現は作らない。
 */
export interface TripDay {
  id: string;
  /** "YYYY-MM-DD" 形式。 */
  date: string;
  /** その日の出発地点。未設定ならまだ選んでいない。 */
  startLocation?: PlaceSelection;
  /** その日の終了地点(「別の場所」を選んだ場合のみ)。未設定は出発地点に戻る想定。 */
  endLocation?: PlaceSelection;
  /** 使える時間(分)。既存のDriveConditionsのcustomAvailableMinutesと同じ意味。 */
  availableTimeMinutes?: number;
  /** 必ず寄りたい場所(既存のViaPointをそのまま再利用、実在の座標のみ)。 */
  mustVisitPlaces: ViaPoint[];
  /** 「AIに追加で伝えたいこと」の自由記述。 */
  aiNote?: string;
  /** 直近にAIが解釈した嗜好のスナップショット(参考情報。次回入力の初期値ではない)。 */
  preferences?: AiRoutePreferences;
  /** drive-route-plannerが返した実ルート候補(1〜3件)。 */
  generatedRoutes: RouteOption[];
  /** generatedRoutesの中から決定したルートのid。 */
  selectedRouteId?: string;
}

export interface Trip {
  id: string;
  title: string;
  /** "YYYY-MM-DD" 形式。 */
  startDate: string;
  /** "YYYY-MM-DD" 形式。 */
  endDate: string;
  days: TripDay[];
  createdAt: number;
  updatedAt: number;
}
