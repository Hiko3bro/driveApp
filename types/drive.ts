export type AvailableTime = '1h' | '2h' | '3h' | 'half-day';

export type Mood = 'view' | 'sea' | 'mountain' | 'cafe' | 'nightview' | 'hidden' | 'omakase';

export type ReturnTarget = 'same-as-departure' | 'different';

export type DetourLevel = 'few' | 'normal' | 'many';

export interface DriveConditions {
  availableTime: AvailableTime;
  mood: Mood;
  returnTarget: ReturnTarget;
  /** "HH:mm" 形式。未指定の場合は特に帰着時刻を定めない。 */
  returnDeadline?: string;
  detourLevel: DetourLevel;
}

export const AVAILABLE_TIME_LABELS: Record<AvailableTime, string> = {
  '1h': '1時間',
  '2h': '2時間',
  '3h': '3時間',
  'half-day': '半日',
};

export const MOOD_LABELS: Record<Mood, string> = {
  view: '絶景',
  sea: '海',
  mountain: '山',
  cafe: 'カフェ',
  nightview: '夜景',
  hidden: '穴場',
  omakase: 'おまかせ',
};

export const RETURN_TARGET_LABELS: Record<ReturnTarget, string> = {
  'same-as-departure': '出発地点に戻る',
  different: '別の場所',
};

export const DETOUR_LEVEL_LABELS: Record<DetourLevel, string> = {
  few: '少なめ',
  normal: '普通',
  many: '多め',
};
