import AsyncStorage from '@react-native-async-storage/async-storage';

import { isValidCoordinates } from '@/services/location/coordinates';
import type { DriveConditions } from '@/types/drive';
import type { PlaceSelection } from '@/types/location';
import {
  TRIP_SCHEMA_VERSION,
  type Trip,
  type TripDay,
  type TripDriveSegment,
  type TripSavedPlace,
  type TripTimelineEntry,
} from '@/types/trip';
import type { RouteOption } from '@/types/route';

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

/** 新しいタイムラインエントリに、既存の最大orderの続きから連番のorderを振る。 */
function nextOrderAfter(entries: TripTimelineEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.order), -1) + 1;
}

async function getTimelineOrThrow(tripId: string, dayId: string): Promise<{ trip: Trip; day: TripDay } | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const day = trip.days.find((candidate) => candidate.id === dayId);
  if (!day) {
    return null;
  }
  return { trip, day };
}

/**
 * タイムラインへ1件以上のエントリを追加する(AIからの提案をユーザーが「追加する」で
 * 確定した時、またはGoogle Placesで確認済みのスポットを予定へ追加する時に使う)。
 * idが未設定のエントリにはここでidを振る。既存のエントリはそのまま残す(全面上書きしない)。
 */
export async function appendTimelineEntries(
  tripId: string,
  dayId: string,
  entries: Array<Omit<TripTimelineEntry, 'id' | 'order'> & { id?: string; order?: number }>
): Promise<Trip | null> {
  const found = await getTimelineOrThrow(tripId, dayId);
  if (!found) {
    return null;
  }
  const existing = found.day.timeline ?? [];
  let order = nextOrderAfter(existing);
  const appended: TripTimelineEntry[] = entries.map((entry) => ({
    ...entry,
    id: entry.id ?? generateId('entry'),
    order: entry.order ?? order++,
  }));
  return updateTripDay(tripId, dayId, { timeline: [...existing, ...appended] });
}

/** タイムラインエントリの並び順を、渡されたid順に更新する。含まれないidのエントリは末尾に維持する。 */
export async function reorderTimelineEntries(
  tripId: string,
  dayId: string,
  orderedIds: string[]
): Promise<Trip | null> {
  const found = await getTimelineOrThrow(tripId, dayId);
  if (!found) {
    return null;
  }
  const existing = found.day.timeline ?? [];
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const reordered: TripTimelineEntry[] = [];
  orderedIds.forEach((id, index) => {
    const entry = byId.get(id);
    if (entry) {
      reordered.push({ ...entry, order: index });
      byId.delete(id);
    }
  });
  let order = reordered.length;
  const remaining = existing.filter((entry) => byId.has(entry.id)).map((entry) => ({ ...entry, order: order++ }));
  return updateTripDay(tripId, dayId, { timeline: [...reordered, ...remaining] });
}

export async function removeTimelineEntry(tripId: string, dayId: string, entryId: string): Promise<Trip | null> {
  const found = await getTimelineOrThrow(tripId, dayId);
  if (!found) {
    return null;
  }
  const existing = found.day.timeline ?? [];
  return updateTripDay(tripId, dayId, { timeline: existing.filter((entry) => entry.id !== entryId) });
}

export async function updateTimelineEntry(
  tripId: string,
  dayId: string,
  entryId: string,
  patch: Partial<TripTimelineEntry>
): Promise<Trip | null> {
  const found = await getTimelineOrThrow(tripId, dayId);
  if (!found) {
    return null;
  }
  const existing = found.day.timeline ?? [];
  if (!existing.some((entry) => entry.id === entryId)) {
    return null;
  }
  const nextTimeline = existing.map((entry) => (entry.id === entryId ? { ...entry, ...patch, id: entry.id } : entry));
  return updateTripDay(tripId, dayId, { timeline: nextTimeline });
}

/**
 * 「今すぐドライブ」の既存ウィザード(departure→conditions→route-compare→route-plan)を
 * 1区間だけの車移動として使った結果を、その1エントリだけへ紐付ける。他のエントリ・
 * day全体のgeneratedRoutes/selectedRouteIdには触れない(1日まるごと上書きしない)。
 */
export async function attachRouteToTimelineEntry(
  tripId: string,
  dayId: string,
  entryId: string,
  route: RouteOption
): Promise<Trip | null> {
  const found = await getTimelineOrThrow(tripId, dayId);
  if (!found) {
    return null;
  }
  const existing = found.day.timeline ?? [];
  if (!existing.some((entry) => entry.id === entryId)) {
    return null;
  }
  const nextTimeline = existing.map((entry) =>
    entry.id === entryId ? { ...entry, routeOptionId: route.id, transportMode: 'car' as const } : entry
  );
  const generatedRoutes = [...found.day.generatedRoutes.filter((existingRoute) => existingRoute.id !== route.id), route];
  return updateTripDay(tripId, dayId, { timeline: nextTimeline, generatedRoutes });
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

const MAX_TRIP_DAYS = 30;

/**
 * 旅行名・日程からTripを組み立てる純粋関数。以前はDay1/Day2/...を自動生成していたが、
 * 「最初からDay1/2/3を大量に作らない」方針への変更にともない、days: []
 * (日程未分割)で作成するよう変更した。日程分けは、ユーザーが明示的に望んだ時だけ
 * addDraftDays()で後から追加する。架空の場所は一切設定しない。
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
  if (dayCount > MAX_TRIP_DAYS) {
    throw new TripDateRangeError(`日数は最大${MAX_TRIP_DAYS}日までにしてください。`);
  }

  const now = Date.now();
  return {
    id: generateId('trip'),
    title: title.trim().length > 0 ? title.trim() : 'ドライブ計画',
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
    days: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 日程が未分割(trip.days.length === 0)のTripへ、startDate起点でdayCount日ぶんの
 * 空のTripDayを追加する(endDateを超える場合はendDateまでで打ち切る)。
 * 既にDayが存在するTripへ呼んでも何もしない(既存の1日ごとのデータを勝手に
 * 作り直さない安全策。日程を作り直したい場合はユーザーが旅行を作り直すこと)。
 */
export async function addDraftDays(tripId: string, dayCount: number): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip || trip.days.length > 0) {
    return null;
  }
  const start = parseDateOnly(trip.startDate);
  const end = parseDateOnly(trip.endDate);
  if (!start || !end) {
    return null;
  }
  const oneDayMs = 24 * 60 * 60 * 1000;
  const maxDayCount = Math.round((end.getTime() - start.getTime()) / oneDayMs) + 1;
  const clampedCount = Math.min(Math.max(1, Math.round(dayCount)), maxDayCount, MAX_TRIP_DAYS);

  const days: TripDay[] = Array.from({ length: clampedCount }, (_, index) => {
    const date = new Date(start.getTime() + index * oneDayMs);
    return {
      id: generateId('day'),
      date: formatDateOnly(date),
      mustVisitPlaces: [],
      generatedRoutes: [],
    };
  });

  const nextTrip: Trip = { ...trip, days, updatedAt: Date.now() };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
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

// ===== ドライブ計画: 出発地点・目的地 ==========================================

export async function setDeparturePlace(tripId: string, place: PlaceSelection | undefined): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const nextTrip: Trip = { ...trip, departurePlace: place, updatedAt: Date.now() };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
}

export async function setDestinationPlace(tripId: string, place: PlaceSelection | undefined): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const nextTrip: Trip = { ...trip, destinationPlace: place, updatedAt: Date.now() };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
}

// ===== ドライブ計画: 気になる場所 ==============================================

/**
 * 「気になる場所」として1件保存する。Day/タイムラインへは一切分類しない
 * (Trip.savedPlacesへ追加するだけ)。実在確認済みの場所のみを渡すこと。
 */
export async function addSavedPlace(
  tripId: string,
  entry: Omit<TripSavedPlace, 'id' | 'savedAt'>
): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const existing = trip.savedPlaces ?? [];
  const savedPlace: TripSavedPlace = { ...entry, id: generateId('saved'), savedAt: Date.now() };
  const nextTrip: Trip = { ...trip, savedPlaces: [...existing, savedPlace], updatedAt: Date.now() };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
}

export async function removeSavedPlace(tripId: string, savedPlaceId: string): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const existing = trip.savedPlaces ?? [];
  const nextTrip: Trip = {
    ...trip,
    savedPlaces: existing.filter((place) => place.id !== savedPlaceId),
    updatedAt: Date.now(),
  };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
}

// ===== ドライブ計画: A→B区間探索の保存 ==========================================

export async function addDriveSegment(
  tripId: string,
  entry: Omit<TripDriveSegment, 'id' | 'createdAt'>
): Promise<Trip | null> {
  const trip = await getTrip(tripId);
  if (!trip) {
    return null;
  }
  const existing = trip.driveSegments ?? [];
  const segment: TripDriveSegment = { ...entry, id: generateId('segment'), createdAt: Date.now() };
  const nextTrip: Trip = { ...trip, driveSegments: [...existing, segment], updatedAt: Date.now() };
  const ok = await saveTrip(nextTrip);
  return ok ? nextTrip : null;
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
