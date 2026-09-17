import AsyncStorage from '@react-native-async-storage/async-storage';

import { DRIVE_PLAN_SCHEMA_VERSION, type SavedDrivePlan } from '@/types/drive-plan';

/**
 * ドライブ計画(SavedDrivePlan)のローカル永続化。services/trip/trip-store.tsと
 * 同じ安全なパターン(壊れたJSONは安全に「保存なし」として扱い、クラッシュしない)を
 * 踏襲する。旧Trip/TripDayとは完全に独立したストレージキーを使う。
 */
const STORAGE_KEY = 'drive-discovery.driveplans.v1';

interface DrivePlanStorageSchema {
  version: number;
  plans: SavedDrivePlan[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 保存済みJSONを無条件に信頼しない。壊れたデータでアプリをクラッシュさせず、安全に無視する。 */
function isValidSavedDrivePlan(value: unknown): value is SavedDrivePlan {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    isPlainObject(value.origin) &&
    Array.isArray(value.themeSummary) &&
    Array.isArray(value.routeOptions) &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

function isValidSchema(value: unknown): value is DrivePlanStorageSchema {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.version === 'number' && Array.isArray(value.plans) && value.plans.every(isValidSavedDrivePlan);
}

async function readSchema(): Promise<DrivePlanStorageSchema> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: DRIVE_PLAN_SCHEMA_VERSION, plans: [] };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSchema(parsed) || parsed.version !== DRIVE_PLAN_SCHEMA_VERSION) {
      // 将来のバージョン移行はここに追加する。現時点では、形式が違う/壊れている
      // データは復元を試みず、安全に「保存なし」として扱う(クラッシュさせない)。
      return { version: DRIVE_PLAN_SCHEMA_VERSION, plans: [] };
    }
    return parsed;
  } catch {
    return { version: DRIVE_PLAN_SCHEMA_VERSION, plans: [] };
  }
}

async function writeSchema(schema: DrivePlanStorageSchema): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    return true;
  } catch {
    return false;
  }
}

/** 保存済みのドライブ計画を新しい順(updatedAt降順)で返す。 */
export async function getDrivePlans(): Promise<SavedDrivePlan[]> {
  const schema = await readSchema();
  return [...schema.plans].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDrivePlan(id: string): Promise<SavedDrivePlan | null> {
  const schema = await readSchema();
  return schema.plans.find((plan) => plan.id === id) ?? null;
}

/** 既存idなら上書き(updatedAtを更新)、無ければ追加する(upsert)。 */
export async function saveDrivePlan(plan: SavedDrivePlan): Promise<boolean> {
  const schema = await readSchema();
  const index = schema.plans.findIndex((existing) => existing.id === plan.id);
  const nextPlan: SavedDrivePlan = { ...plan, updatedAt: Date.now() };
  const nextPlans = [...schema.plans];
  if (index === -1) {
    nextPlans.push(nextPlan);
  } else {
    nextPlans[index] = nextPlan;
  }
  return writeSchema({ version: DRIVE_PLAN_SCHEMA_VERSION, plans: nextPlans });
}

export async function deleteDrivePlan(id: string): Promise<boolean> {
  const schema = await readSchema();
  const nextPlans = schema.plans.filter((plan) => plan.id !== id);
  return writeSchema({ version: DRIVE_PLAN_SCHEMA_VERSION, plans: nextPlans });
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新規保存用のidを1つ発行する(saveDrivePlanは新規/更新の両方をupsertで扱うため、呼び出し元が先にidを決める)。 */
export function generateDrivePlanId(): string {
  return generateId('driveplan');
}
