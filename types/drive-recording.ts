import type { Coordinates } from '@/types/location';
import type { RouteOption } from '@/types/route';
import type { Spot } from '@/types/spot';

/** 記録された座標が実GPSか、GPSが使えない環境向けのデモ走行かを示す。 */
export type DriveRecordingSource = 'gps' | 'demo';

/**
 * 記録した生の走行座標1点。共有画像等の表示用データへ加工する前の記録データ本体であり、
 * 将来のプライバシーマスク(開始・終了地点付近の非表示)は表示側で別途適用する想定のため、
 * ここでは加工せずそのまま保持する。
 */
export interface RecordedTrackPoint {
  coordinates: Coordinates;
  recordedAt: number;
}

/** ドライブ記録終了時点のスナップショット。次の日記作成機能から利用する。 */
export interface DriveRecordingResult {
  route: RouteOption;
  spots: Spot[];
  track: RecordedTrackPoint[];
  distanceKm: number;
  durationSeconds: number;
  startedAt: number;
  endedAt: number;
  source: DriveRecordingSource;
}
