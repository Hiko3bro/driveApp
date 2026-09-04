import type { PlaceSelection, ViaPoint } from '@/types/location';

export type AvailableTime = '1h' | '2h' | '3h' | 'half-day' | 'day' | 'custom' | 'unspecified';

/** 「今日の気分」で選べるドライブの目的・ペース。堅いナビ用語ではなく、行きたい気分を表す。 */
export type Mood =
  | 'scenic'
  | 'coastal'
  | 'mountain'
  | 'nightDrive'
  | 'leisurely'
  | 'detourRich'
  | 'driveFocused'
  | 'omakase';

export type ReturnTarget = 'same-as-departure' | 'different';

export type DetourLevel = 'few' | 'normal' | 'many';

export interface DriveConditions {
  availableTime: AvailableTime;
  /** availableTimeが"custom"のときに使う分数。それ以外では未使用。 */
  customAvailableMinutes?: number;
  /** 「今日の気分」の選択(複数選択・任意、最大MAX_SELECTED_MOODS件)。"omakase"は他と排他。 */
  moods: Mood[];
  returnTarget: ReturnTarget;
  /** returnTargetが"different"の時に地図で選んだ実際の目的地。未選択時は演出用の仮の到着地点を使う。 */
  finalDestination?: PlaceSelection;
  /** ユーザーが実際に立ち寄りたいと指定した場所(AIへの候補ではなく、優先度の高い確定希望)。 */
  viaPoints: ViaPoint[];
  /** ISO 8601形式(例 "2026-09-03T02:00:00+09:00")。未指定の場合は特に帰着日時を定めない。 */
  returnDeadline?: string;
  detourLevel: DetourLevel;
  /** 「AIに追加で伝えたいこと」の自由記述。 */
  aiNote?: string;
}

export const AVAILABLE_TIME_LABELS: Record<AvailableTime, string> = {
  '1h': '1時間',
  '2h': '2時間',
  '3h': '3時間',
  'half-day': '半日',
  day: '1日',
  custom: '自分で入力',
  unspecified: '指定なし',
};

export const MOOD_LABELS: Record<Mood, string> = {
  scenic: '景色重視',
  coastal: '海沿い',
  mountain: '山道',
  nightDrive: '夜ドライブ',
  leisurely: 'のんびり',
  detourRich: '寄り道多め',
  driveFocused: 'とにかく走りたい',
  omakase: 'おまかせ',
};

export const RETURN_TARGET_LABELS: Record<ReturnTarget, string> = {
  'same-as-departure': '出発地点に戻る',
  different: '別の場所',
};

/** 「今日の気分」で同時に選べる上限。多すぎるとルートの方向性が定まらないため。"omakase"選択時は他を解除するため実質1件。 */
export const MAX_SELECTED_MOODS = 3;

/** 「今日の気分」から、既存の寄り道量ロジック(DetourLevel)へ変換する。 */
export function deriveDetourLevel(moods: Mood[]): DetourLevel {
  return moods.includes('detourRich') ? 'many' : 'normal';
}

/** 分数を「2時間」「1時間30分」「1日3時間」のような読みやすい表記にする。 */
export function formatMinutesLabel(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const rest = safeMinutes % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}日`);
  }
  if (hours > 0) {
    parts.push(`${hours}時間`);
  }
  if (rest > 0 || parts.length === 0) {
    parts.push(`${rest}分`);
  }
  return parts.join('');
}

function formatAvailableTimeLabel(conditions: DriveConditions): string {
  if (conditions.availableTime === 'custom') {
    return conditions.customAvailableMinutes
      ? formatMinutesLabel(conditions.customAvailableMinutes)
      : AVAILABLE_TIME_LABELS.custom;
  }
  return AVAILABLE_TIME_LABELS[conditions.availableTime];
}

/** ISO 8601の帰着日時を「9/3 1:30」のような短い表記にする。不正な値はnullを返す。 */
function formatReturnDeadlineLabel(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${minutes}`;
}

/**
 * 選んだ条件を「景色重視・海沿い・2時間」のように、ユーザーが選んだ内容が
 * ひと目で分かる短い文字列にする。ルート比較・ルート決定確認画面で表示する。
 * AIへの自由記述(aiNote)は長くなりうるため、この一覧要約には含めない。
 */
export function summarizeDriveConditions(conditions: DriveConditions): string {
  const parts = conditions.moods.map((mood) => MOOD_LABELS[mood]);
  parts.push(formatAvailableTimeLabel(conditions));

  if (conditions.returnTarget === 'different' && conditions.finalDestination) {
    parts.push(`${conditions.finalDestination.label}へ`);
  }

  if (conditions.viaPoints.length > 0) {
    const [first] = conditions.viaPoints;
    parts.push(
      conditions.viaPoints.length > 1
        ? `${first.label}など${conditions.viaPoints.length}か所経由`
        : `${first.label}経由`
    );
  }

  if (conditions.returnDeadline) {
    const label = formatReturnDeadlineLabel(conditions.returnDeadline);
    if (label) {
      parts.push(`${label}まで`);
    }
  }

  return parts.join('・');
}
