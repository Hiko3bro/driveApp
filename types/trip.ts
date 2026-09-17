import type { AiRoutePreferences } from '@/types/ai-route-preferences';
import type { PlaceSelection, ViaPoint } from '@/types/location';
import type { RouteOption } from '@/types/route';
import type { SpotCategory } from '@/types/spot';

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
  /**
   * しおり形式のタイムライン(縦に並ぶ1日の予定)。未設定は「まだしおりを作っていない日」を表し、
   * 旧来の「1日まるごとConditions入力→Route決定」フロー(trip-day-detail.tsx)は
   * このフィールドが無くても引き続き動作する。
   */
  timeline?: TripTimelineEntry[];
}

/** 旅行の区間ごとの移動手段。電車/飛行機の時刻表APIは今回導入しないため、時刻は目安扱いになる。 */
export type TransportMode = 'walk' | 'bike' | 'car' | 'train' | 'plane' | 'other';

/**
 * タイムラインの1エントリが持つ時刻の表現。旅行は予定通り進まない前提のため、
 * 「午前」「昼頃」のような曖昧な時間帯も、時刻未指定も、そのまま表せるようにする。
 */
export interface TripTimeHint {
  kind: 'vague' | 'exact' | 'unspecified';
  /** kind === 'vague' の場合の表示ラベル(例: '午前' '昼頃' '夕方')。 */
  vagueLabel?: string;
  /** kind === 'exact' の場合の時刻("HH:mm")。 */
  exactTime?: string;
  /** trueの場合、UIで「目安」「候補」であることを明示する。 */
  isEstimate?: boolean;
}

/**
 * 旅行のしおりを構成する1日の予定(縦に並ぶタイムラインの1項目)。
 * 場所を持つ場合は実在確認済みのPlaceSelectionのみを入れる(AIが未確認のまま
 * 場所を創作してこのフィールドへ入れることは禁止)。
 */
export interface TripTimelineEntry {
  id: string;
  /** 並び順(小さいほど先)。ユーザーの並べ替えで更新する。 */
  order: number;
  title: string;
  note?: string;
  timeHint?: TripTimeHint;
  place?: PlaceSelection;
  /** 直前のエントリからこの区間へ移動する際の移動手段。 */
  transportMode?: TransportMode;
  /** transportMode === 'car' の場合、day.generatedRoutes内の対応するRouteOption.idを参照する。 */
  routeOptionId?: string;
  /** ユーザーがまだ確定していない、AIからの提案由来のエントリかどうか。 */
  isAiSuggested?: boolean;
}

/**
 * 旅行前日/当日などの通知設定を、将来追加するためのデータモデル上の置き場所。
 * 100 Program版では配信ロジック(expo-notifications連携等)は実装しない。
 */
export interface TripNotificationSettings {
  enabled: boolean;
  triggers: string[];
}

/**
 * ドライブ計画の中で「気になる」として貯めた場所。Day/タイムラインへ強制的に
 * 分類しない、目的地未定のままでも増やせる置き場所。実在確認済みの場所のみ。
 */
export interface TripSavedPlace {
  id: string;
  place: PlaceSelection;
  category?: SpotCategory;
  /** AIのおすすめ理由、またはユーザーが書いたメモ。実データ(name/coordinates)とは明確に区別して表示すること。 */
  note?: string;
  /** AIとの相談から見つけて保存したものかどうか(手動追加ならfalse/undefined)。 */
  isAiSuggested?: boolean;
  savedAt: number;
}

/** A→B区間探索で見つかった1候補(基本ルート自身も候補として含む、その場合addedMinutesはundefined)。 */
export interface TripDriveSegmentCandidate {
  route: RouteOption;
  addedMinutes?: number;
}

/**
 * 「スポットAからスポットBへ移動する間に何か面白いところない?」という区間探索の結果。
 * 旅行全体の日程とは独立して保存でき、後から見返せる。
 */
export interface TripDriveSegment {
  id: string;
  fromPlace: PlaceSelection;
  toPlace: PlaceSelection;
  categoryLabel?: SpotCategory;
  /** ユーザーが許容する追加時間(分)の目安。未設定は「気にしない」。 */
  maxDetourMinutes?: number;
  candidates: TripDriveSegmentCandidate[];
  selectedRouteId?: string;
  createdAt: number;
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
  /** trip-create時に入力した自由記述(例: 「大阪から高知へ2泊3日…」)。以後のAI相談の文脈として使う。 */
  initialWish?: string;
  /** 走る土地・地域の名前(例: "高知")。AIへの文脈・画面見出しに使う。実座標ではない。 */
  areaName?: string;
  /** ドライブ計画全体の出発地点(地図で選んだ実座標)。未設定でも計画自体は進められる。 */
  departurePlace?: PlaceSelection;
  /** ドライブ計画全体の目的地(同上)。 */
  destinationPlace?: PlaceSelection;
  /** 「気になる場所」として貯めたスポット。Day/タイムラインへは強制的に分類しない。 */
  savedPlaces?: TripSavedPlace[];
  /** A→B区間探索の結果の保存先。 */
  driveSegments?: TripDriveSegment[];
  /** 将来の通知機能用の置き場所。今回は未使用。 */
  notificationSettings?: TripNotificationSettings;
}
