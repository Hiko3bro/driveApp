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

/** "自分で入力"が選ばれたがcustomAvailableMinutesが未設定の場合と、"指定なし"の暫定フォールバック。 */
const DEFAULT_CUSTOM_MINUTES = AVAILABLE_TIME_MINUTES['2h'];

const MIN_ROUTE_BUDGET_MINUTES = 10;

/** 「使える時間」を分数へ変換する。"custom"はcustomAvailableMinutesを使う。 */
function resolveAvailableMinutes(conditions: DriveConditions): number {
  if (conditions.availableTime === 'custom') {
    const custom = conditions.customAvailableMinutes;
    return Number.isFinite(custom) && (custom as number) > 0 ? (custom as number) : DEFAULT_CUSTOM_MINUTES;
  }
  if (conditions.availableTime === 'unspecified') {
    // 「指定なし」は本来AIやルート生成側が適切な時間を提案すべき値だが、
    // 現時点ではAI接続前のため、標準的な時間を仮の予算として使う。
    return DEFAULT_CUSTOM_MINUTES;
  }
  return AVAILABLE_TIME_MINUTES[conditions.availableTime];
}

export type TimeBudgetResult =
  | { ok: true; minutes: number }
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

/** 使える時間と、帰着日時(ISO 8601)までの時間のうち短い方を、有効な時間予算として返す。 */
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

  const effectiveMinutes = Math.min(availableMinutes, deadlineMinutes);
  if (effectiveMinutes < MIN_ROUTE_BUDGET_MINUTES) {
    return {
      ok: false,
      message: '帰着日時までの時間が短すぎます。使える時間か帰着日時を変更してください。',
    };
  }

  return { ok: true, minutes: effectiveMinutes };
}
