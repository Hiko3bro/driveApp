import type { PlaceSelection } from '@/types/location';
import type { RouteOption } from '@/types/route';

/** ローカル保存するJSON構造のバージョン。将来形式を変える際はここを上げ、旧データは安全に無視する。 */
export const DRIVE_PLAN_SCHEMA_VERSION = 1;

/**
 * ドライブ計画(「今ドラの、未来・旅先版」)の保存形式。旧Trip/TripDayの複雑な
 * 構造には合わせず、チャットで組み立てたドライブコースをそのまま保存できる
 * シンプルな型にしている。RouteOptionは今ドラ・drive-route-plannerが返す既存の
 * 型をそのまま再利用する(旅行専用の新しいルート表現は作らない)。
 */
export interface SavedDrivePlan {
  id: string;
  title: string;
  /** 走る土地・地域の名前(例: "高知")。実座標ではない。 */
  areaName?: string;
  /** 予定日・時期の自由文(例: "9月20日" "来週末")。厳密なISO日付は要求しない。 */
  dateText?: string;
  /** 実在確認済みの出発地点。 */
  origin: PlaceSelection;
  /** 実在確認済みの目的地(任意、無ければ出発地点へ戻るループ)。 */
  destination?: PlaceSelection;
  /** チャットで確定したテーマの短い要約(例: ["景色","ご当地グルメ"])。表示用。 */
  themeSummary: string[];
  /** drive-route-plannerが返した実ルート候補(1〜3件)。 */
  routeOptions: RouteOption[];
  /** routeOptionsの中から選んだ(保存時点で表示していた)ルートのid。 */
  selectedRouteId?: string;
  /** AIとの相談内容の短い要約(表示用の参考情報)。 */
  conversationSummary?: string;
  createdAt: number;
  updatedAt: number;
}
