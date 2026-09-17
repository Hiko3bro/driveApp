import type { DriveConditions } from '@/types/drive';

const AVAILABLE_TIME_MINUTES: Record<
  Exclude<DriveConditions['availableTime'], 'custom' | 'unspecified'>,
  number
> = {
  '1h': 60,
  '2h': 120,
  '3h': 180,
  'half-day': 360,
  day: 1440,
};

/** "自分で入力"が選ばれたがcustomAvailableMinutesが未設定の場合のフォールバックにのみ使う。 */
const DEFAULT_CUSTOM_MINUTES = AVAILABLE_TIME_MINUTES['2h'];

const MIN_ROUTE_BUDGET_MINUTES = 10;

/**
 * 「使える時間」を分数へ変換する。"custom"はcustomAvailableMinutesを使う。
 * "unspecified"(時間指定なし)の場合はundefinedを返す。ユーザーが指定していない値を
 * 「2時間希望」であるかのように扱ってはならない(UI側では「時間指定なし」「時間はおまかせ」
 * として表示・送信する)。
 */
export function resolveAvailableMinutes(conditions: DriveConditions): number | undefined {
  if (conditions.availableTime === 'custom') {
    const custom = conditions.customAvailableMinutes;
    return Number.isFinite(custom) && (custom as number) > 0 ? (custom as number) : DEFAULT_CUSTOM_MINUTES;
  }
  if (conditions.availableTime === 'unspecified') {
    return undefined;
  }
  return AVAILABLE_TIME_MINUTES[conditions.availableTime];
}

export type TimeBudgetResult =
  | { ok: true; minutes: number | undefined }
  | { ok: false; message: string };

/** ISO 8601形式の帰着日時文字列をDateへ変換する。不正な文字列はnullを返す。 */
function parseReturnDeadline(deadline: string): Date | null {
  const date = new Date(deadline);
  return Number.isFinite(date.getTime()) ? date : null;
}

function minutesUntilDeadline(deadline: string, now: Date): number | null {
  const deadlineAt = parseReturnDeadline(deadline);
  if (!deadlineAt) {
    return null;
  }
  return Math.floor((deadlineAt.getTime() - now.getTime()) / 60_000);
}

/**
 * 使える時間と、帰着日時(ISO 8601)までの時間のうち短い方を、有効な時間予算として返す。
 * 使える時間・帰着日時のどちらも未指定なら、minutes: undefined(=時間指定なし)を返す。
 * 帰着日時だけが指定されている場合は、それ自体が実質的な制約になるため、帰着日時までの
 * 時間をそのまま有効予算として使う。
 */
export function resolveEffectiveTimeBudget(
  conditions: DriveConditions,
  now = new Date()
): TimeBudgetResult {
  const availableMinutes = resolveAvailableMinutes(conditions);
  const deadline = conditions.returnDeadline;
  if (!deadline) {
    return { ok: true, minutes: availableMinutes };
  }

  const deadlineMinutes = minutesUntilDeadline(deadline, now);
  if (deadlineMinutes === null) {
    return { ok: false, message: '帰着日時を確認できませんでした。日時を選び直してください。' };
  }
  if (deadlineMinutes <= 0) {
    return { ok: false, message: '選択した帰着日時はすでに過ぎています。日時を変更してください。' };
  }

  const effectiveMinutes =
    availableMinutes === undefined ? deadlineMinutes : Math.min(availableMinutes, deadlineMinutes);
  if (effectiveMinutes < MIN_ROUTE_BUDGET_MINUTES) {
    return {
      ok: false,
      message: '帰着日時までの時間が短すぎます。使える時間か帰着日時を変更してください。',
    };
  }

  return { ok: true, minutes: effectiveMinutes };
}
