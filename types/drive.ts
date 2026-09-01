export type AvailableTime = '1h' | '2h' | '3h' | 'half-day' | 'custom';

/** 「今日の気分」で選べるドライブの目的・ペース。堅いナビ用語ではなく、行きたい気分を表す。 */
export type Mood =
  | 'scenic'
  | 'coastal'
  | 'mountain'
  | 'nightDrive'
  | 'leisurely'
  | 'detourRich'
  | 'short'
  | 'homeFocused';

export type ReturnTarget = 'same-as-departure' | 'different';

export type DetourLevel = 'few' | 'normal' | 'many';

export interface DriveConditions {
  availableTime: AvailableTime;
  /** availableTimeが"custom"のときに使う分数。それ以外では未使用。 */
  customAvailableMinutes?: number;
  /** 「今日の気分」の選択(複数選択・任意、最大MAX_SELECTED_MOODS件)。 */
  moods: Mood[];
  returnTarget: ReturnTarget;
  /** "HH:mm" 形式。未指定の場合は特に帰着時刻を定めない。 */
  returnDeadline?: string;
  detourLevel: DetourLevel;
}

export const AVAILABLE_TIME_LABELS: Record<AvailableTime, string> = {
  '1h': '1時間くらい',
  '2h': '2時間くらい',
  '3h': '3時間くらい',
  'half-day': '半日',
  custom: '時間を指定',
};

export const MOOD_LABELS: Record<Mood, string> = {
  scenic: '景色重視',
  coastal: '海沿い',
  mountain: '山道',
  nightDrive: '夜ドライブ',
  leisurely: 'のんびり',
  detourRich: '寄り道多め',
  short: '短時間',
  homeFocused: '帰宅時間重視',
};

export const RETURN_TARGET_LABELS: Record<ReturnTarget, string> = {
  'same-as-departure': '出発地点に戻る',
  different: '別の場所',
};

/** 「今日の気分」で同時に選べる上限。多すぎるとルートの方向性が定まらないため。 */
export const MAX_SELECTED_MOODS = 3;

/** 分数を「2時間」「1時間30分」のような読みやすい表記にする。 */
export function formatMinutesLabel(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  if (safeMinutes < 60) {
    return `${safeMinutes}分`;
  }
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}

function formatAvailableTimeLabel(conditions: DriveConditions): string {
  if (conditions.availableTime === 'custom') {
    return conditions.customAvailableMinutes
      ? formatMinutesLabel(conditions.customAvailableMinutes)
      : AVAILABLE_TIME_LABELS.custom;
  }
  return AVAILABLE_TIME_LABELS[conditions.availableTime];
}

/**
 * 選んだ条件を「景色重視・海沿い・2時間くらい」のように、ユーザーが選んだ内容が
 * ひと目で分かる短い文字列にする。ルート比較・ルート決定確認画面で表示する。
 */
export function summarizeDriveConditions(conditions: DriveConditions): string {
  const parts = conditions.moods.map((mood) => MOOD_LABELS[mood]);
  parts.push(formatAvailableTimeLabel(conditions));
  if (conditions.returnDeadline) {
    parts.push(`${conditions.returnDeadline}までに戻る`);
  }
  return parts.join('・');
}
