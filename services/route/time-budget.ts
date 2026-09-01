import type { DriveConditions } from '@/types/drive';

const AVAILABLE_TIME_MINUTES: Record<Exclude<DriveConditions['availableTime'], 'custom'>, number> = {
  '1h': 60,
  '2h': 120,
  '3h': 180,
  'half-day': 360,
};

/** "時間を指定"が選ばれたがcustomAvailableMinutesが未設定の場合の安全なフォールバック。 */
const DEFAULT_CUSTOM_MINUTES = AVAILABLE_TIME_MINUTES['2h'];

const MIN_ROUTE_BUDGET_MINUTES = 10;

/** 「使える時間」を分数へ変換する。"custom"はcustomAvailableMinutesを使う。 */
function resolveAvailableMinutes(conditions: DriveConditions): number {
  if (conditions.availableTime === 'custom') {
    const custom = conditions.customAvailableMinutes;
    return Number.isFinite(custom) && (custom as number) > 0 ? (custom as number) : DEFAULT_CUSTOM_MINUTES;
  }
  return AVAILABLE_TIME_MINUTES[conditions.availableTime];
}

export type TimeBudgetResult =
  | { ok: true; minutes: number }
  | { ok: false; message: string };

/**
 * 「次に訪れるその時刻」のDateを作る。今日の日付にHH:mmを設定し、それが現在日時以下
 * (=すでにその時刻を過ぎている)なら翌日の同時刻とみなす。これにより、日付をまたぐ
 * 帰着時刻(例: 現在23:10に対する00:30)を「今日の過ぎた時刻」ではなく「翌日の時刻」
 * として正しく扱える。resolveEffectiveTimeBudgetでの実際のチェックと、条件入力画面
 * での表示とで、この関数だけを共通の判定基準として使う。
 */
function resolveNextDeadline(deadline: string, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(deadline);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }

  const deadlineAt = new Date(now);
  deadlineAt.setHours(hours, minutes, 0, 0);
  if (deadlineAt.getTime() <= now.getTime()) {
    deadlineAt.setDate(deadlineAt.getDate() + 1);
  }
  return deadlineAt;
}

function minutesUntilDeadline(deadline: string, now: Date): number | null {
  const deadlineAt = resolveNextDeadline(deadline, now);
  if (!deadlineAt) {
    return null;
  }
  return Math.floor((deadlineAt.getTime() - now.getTime()) / 60_000);
}

/** 使える時間と、次に訪れる帰着時刻までの時間のうち短い方を、有効な時間予算として返す。 */
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
    return { ok: false, message: '帰着時刻を確認できませんでした。時刻を選び直してください。' };
  }

  const effectiveMinutes = Math.min(availableMinutes, deadlineMinutes);
  if (effectiveMinutes < MIN_ROUTE_BUDGET_MINUTES) {
    return {
      ok: false,
      message: '帰着時刻までの時間が短すぎます。使える時間か帰着時刻を変更してください。',
    };
  }

  return { ok: true, minutes: effectiveMinutes };
}
