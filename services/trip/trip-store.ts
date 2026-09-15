import AsyncStorage from '@react-native-async-storage/async-storage';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { DriveConditions } from '@/types/drive';
import { TRIP_SCHEMA_VERSION, type Trip, type TripDay } from '@/types/trip';

/**
 * 旅行プランのローカル永続化。installId等の秘密/小データはexpo-secure-store、
 * 旅行・ルートといった大きめの非秘密データはAsyncStorageという役割分担にする
 * (SecureStoreを大きなJSON保存へ無理に流用しない)。APIキー等のSecretはこの
 * storageには一切保存しない(Trip型自体にそのようなフィールドが存在しない)。
 */
const STORAGE_KEY = 'drive-discovery.trips.v1';

interface TripStorageSchema {
  version: number;
  trips: Trip[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 保存済みJSONを無条件に信頼しない。壊れたデータでアプリをクラッシュさせず、安全に無視する。 */
function isValidTripDay(value: unknown): value is TripDay {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.date === 'string' &&
    Array.isArray(value.mustVisitPlaces) &&
    Array.isArray(value.generatedRoutes)
  );
}

function isValidTrip(value: unknown): value is Trip {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    Array.isArray(value.days) &&
    value.days.every(isValidTripDay)
  );
}

function isValidSchema(value: unknown): value is TripStorageSchema {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.version === 'number' && Array.isArray(value.trips) && value.trips.every(isValidTrip);
}

async function readSchema(): Promise<TripStorageSchema> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: TRIP_SCHEMA_VERSION, trips: [] };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSchema(parsed) || parsed.version !== TRIP_SCHEMA_VERSION) {
      // 将来のバージョン移行はここに追加する。現時点では、形式が違う/壊れている
      // データは復元を試みず、安全に「旅行なし」として扱う(クラッシュさせない)。
      return { version: TRIP_SCHEMA_VERSION, trips: [] };
    }
    return parsed;
  } catch {
    return { version: TRIP_SCHEMA_VERSION, trips: [] };
  }
}

async function writeSchema(schema: TripStorageSchema): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    return true;
  } catch {
    return false;
  }
}

/** 保存済みの旅行を新しい順(startDate降順)で返す。 */
export async function getTrips(): Promise<Trip[]> {
  const schema = await readSchema();
  return [...schema.trips].sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export async function getTrip(tripId: string): Promise<Trip | null> {
  const schema = await readSchema();
  return schema.trips.find((trip) => trip.id === tripId) ?? null;
}

/** 既存idなら上書き、無ければ追加する(upsert)。 */
export async function saveTrip(trip: Trip): Promise<boolean> {
  const schema = await readSchema();
  const index = schema.trips.findIndex((existing) => existing.id === trip.id);
  const nextTrips = [...schema.trips];
  if (index === -1) {
    nextTrips.push(trip);
  } else {
    nextTrips[index] = trip;
  }
  return writeSchema({ version: TRIP_SCHEMA_VERSION, trips: nextTrips });
}

export async function deleteTrip(tripId: string): Promise<boolean> {
  const schema = await readSchema();
  const nextTrips = schema.trips.filter((trip) => trip.id !== tripId);
  return writeSchema({ version: TRIP_SCHEMA_VERSION, trips: nextTrips });
}

/** 指定した日だけを更新し、trip.updatedAtを更新して保存する。旅行が無い/日が無い場合はnull。 */
export async function updateTripDay(
  tripId: string,
  dayId: string,
  patch: Partial<TripDay>
): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const dayIndex = trip.days.findIndex((day) => day.id === dayId);
  if (dayIndex === -1) {
    return null;
  }
  const nextDays = [...trip.days];
  nextDays[dayIndex] = { ...nextDays[dayIndex], ...patch };
  const nextTrip: Trip = { ...trip, days: nextDays, updatedAt: Date.now() };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "YYYY-MM-DD" をUTC正午のDateへ変換する(タイムゾーンによる日付ズレを避けるための固定時刻)。 */
function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class TripDateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripDateRangeError';
  }
}

/**
 * 旅行名・日程からTrip(1日ごとのDay1/Day2/...を自動生成)を組み立てる純粋関数。
 * 架空の場所は一切設定しない(startLocation/endLocation/mustVisitPlacesは空のまま)。
 * 実際の保存はsaveTrip()を別途呼ぶこと。
 */
export function buildTripFromDateRange(title: string, startDate: string, endDate: string): Trip {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end) {
    throw new TripDateRangeError('日付を確認できませんでした。日付を選び直してください。');
  }
  if (end.getTime() < start.getTime()) {
    throw new TripDateRangeError('終了日は開始日より後の日付にしてください。');
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const dayCount = Math.round((end.getTime() - start.getTime()) / oneDayMs) + 1;
  const MAX_TRIP_DAYS = 30;
  if (dayCount > MAX_TRIP_DAYS) {
    throw new TripDateRangeError(`旅行日数は最大${MAX_TRIP_DAYS}日までにしてください。`);
  }

  const days: TripDay[] = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start.getTime() + index * oneDayMs);
    return {
      id: generateId('day'),
      date: formatDateOnly(date),
      mustVisitPlaces: [],
      generatedRoutes: [],
    };
  });

  const now = Date.now();
  return {
    id: generateId('trip'),
    title: title.trim().length > 0 ? title.trim() : '旅行プラン',
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    days,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 旅行日の保存済みフィールドから、既存の条件入力ウィザード(app/conditions.tsx)が
 * そのまま使えるDriveConditionsを組み立てる。旅行専用の別の条件表現は作らない。
 * moodsは旅行日には保存していないため常に空配列(ウィザード側で毎回選び直す)。
 */
export function buildDriveConditionsFromDay(day: TripDay): DriveConditions {
  return {
    availableTime: day.availableTimeMinutes ? 'custom' : 'unspecified',
    customAvailableMinutes: day.availableTimeMinutes,
    moods: [],
    returnTarget: day.endLocation ? 'different' : 'same-as-departure',
    finalDestination: day.endLocation,
    viaPoints: day.mustVisitPlaces,
    returnDeadline: undefined,
    detourLevel: 'normal',
    aiNote: day.aiNote,
  };
}

/** その日のstartLocationが未設定の場合に地図の初期表示として使える、直前の実在座標(前日の終了地点等)を探す。 */
export function resolvePreviousDayAnchor(trip: Trip, dayId: string) {
  const dayIndex = trip.days.findIndex((day) => day.id === dayId);
  if (dayIndex <= 0) {
    return null;
  }
  for (let i = dayIndex - 1; i >= 0; i -= 1) {
    const candidate = trip.days[i].endLocation ?? trip.days[i].startLocation;
    if (candidate && isValidCoordinates(candidate.coordinates)) {
      return candidate;
    }
  }
  return null;
}
