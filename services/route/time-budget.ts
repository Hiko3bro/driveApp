import type { AvailableTime, DriveConditions } from '@/types/drive';

const AVAILABLE_TIME_MINUTES: Record<AvailableTime, number> = {
  '1h': 60,
  '2h': 120,
  '3h': 180,
  'half-day': 360,
};

const MIN_ROUTE_BUDGET_MINUTES = 10;

export type TimeBudgetResult =
  | { ok: true; minutes: number }
  | { ok: false; message: string };

function minutesUntilDeadline(deadline: string, now: Date): number | null {
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
  return Math.floor((deadlineAt.getTime() - now.getTime()) / 60_000);
}

/** 使える時間と当日の帰着期限のうち短い方を、有効な時間予算として返す。 */
export function resolveEffectiveTimeBudget(
  conditions: DriveConditions,
  now = new Date()
): TimeBudgetResult {
  const availableMinutes = AVAILABLE_TIME_MINUTES[conditions.availableTime];
  const deadline = conditions.returnDeadline;
  if (!deadline) {
    return { ok: true, minutes: availableMinutes };
  }

  const deadlineMinutes = minutesUntilDeadline(deadline, now);
  if (deadlineMinutes === null) {
    return { ok: false, message: '帰着時刻を確認できませんでした。時刻を選び直してください。' };
  }
  if (deadlineMinutes <= 0) {
    return { ok: false, message: '選択した帰着時刻はすでに過ぎています。条件を変更してください。' };
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
