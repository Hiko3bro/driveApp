import type { DriveRecordingSource, RecordedTrackPoint } from '@/types/drive-recording';
import type { RouteOption } from '@/types/route';
import type { Spot } from '@/types/spot';

export const MAX_DIARY_PHOTOS = 3;

/** 日記に添付する写真1枚。将来の共有機能で再利用しやすいよう、端末上のURIのみを保持する。 */
export interface DiaryPhoto {
  id: string;
  uri: string;
  width: number | null;
  height: number | null;
}

/**
 * ドライブ日記1件分のデータ。将来AsyncStorage等へそのままシリアライズできるプレーンな
 * オブジェクトとして設計している。今後の共有機能では、この構造からphotos・track(GPSルート線)・
 * distanceKm・durationSeconds・titleをそのまま再利用する想定。
 */
export interface DriveDiaryEntry {
  id: string;
  title: string;
  memo: string;
  /** "YYYY-MM-DD" 形式。 */
  date: string;
  distanceKm: number;
  durationSeconds: number;
  route: RouteOption;
  spots: Spot[];
  photos: DiaryPhoto[];
  /** 記録した生のGPS座標配列。表示・共有用の加工は行わない。 */
  track: RecordedTrackPoint[];
  recordingSource: DriveRecordingSource;
  createdAt: number;
}
