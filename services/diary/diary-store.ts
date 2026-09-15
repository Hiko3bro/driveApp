import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DriveDiaryEntry } from '@/types/drive-diary';

/**
 * ドライブ日記のローカル永続化。旅行プラン(services/trip/trip-store.ts)と同じ
 * パターン(schema version付きJSON, 壊れたデータは安全に無視)をAsyncStorageに
 * 保存する。APIキー等のSecretはDriveDiaryEntry型に存在しないため、ここにも
 * 保存されない。
 */
const STORAGE_KEY = 'drive-discovery.diary.v1';
const DIARY_SCHEMA_VERSION = 1;

interface DiaryStorageSchema {
  version: number;
  entries: DriveDiaryEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 保存済みJSONを無条件に信頼しない。壊れたデータでアプリをクラッシュさせず、安全に無視する。 */
function isValidDiaryEntry(value: unknown): value is DriveDiaryEntry {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.memo === 'string' &&
    typeof value.date === 'string' &&
    typeof value.distanceKm === 'number' &&
    typeof value.durationSeconds === 'number' &&
    isPlainObject(value.route) &&
    Array.isArray(value.spots) &&
    Array.isArray(value.photos) &&
    Array.isArray(value.track) &&
    (value.recordingSource === 'gps' || value.recordingSource === 'demo') &&
    typeof value.createdAt === 'number'
  );
}

function isValidSchema(value: unknown): value is DiaryStorageSchema {
  if (!isPlainObject(value)) {
    return false;
  }
  return typeof value.version === 'number' && Array.isArray(value.entries) && value.entries.every(isValidDiaryEntry);
}

async function readSchema(): Promise<DiaryStorageSchema> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { version: DIARY_SCHEMA_VERSION, entries: [] };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSchema(parsed) || parsed.version !== DIARY_SCHEMA_VERSION) {
      // 将来のバージョン移行はここに追加する。現時点では、形式が違う/壊れている
      // データは復元を試みず、安全に「日記なし」として扱う(クラッシュさせない)。
      return { version: DIARY_SCHEMA_VERSION, entries: [] };
    }
    return parsed;
  } catch {
    return { version: DIARY_SCHEMA_VERSION, entries: [] };
  }
}

async function writeSchema(schema: DiaryStorageSchema): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(schema));
    return true;
  } catch {
    return false;
  }
}

/** 保存済みの日記を新しい順(createdAt降順)で返す。 */
export async function getDiaryEntries(): Promise<DriveDiaryEntry[]> {
  const schema = await readSchema();
  return [...schema.entries].sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDiaryEntry(entryId: string): Promise<DriveDiaryEntry | null> {
  const schema = await readSchema();
  return schema.entries.find((entry) => entry.id === entryId) ?? null;
}

/** 既存idなら上書き、無ければ追加する(upsert)。 */
export async function saveDiaryEntry(entry: DriveDiaryEntry): Promise<boolean> {
  const schema = await readSchema();
  const index = schema.entries.findIndex((existing) => existing.id === entry.id);
  const nextEntries = [...schema.entries];
  if (index === -1) {
    nextEntries.push(entry);
  } else {
    nextEntries[index] = entry;
  }
  return writeSchema({ version: DIARY_SCHEMA_VERSION, entries: nextEntries });
}

export async function deleteDiaryEntry(entryId: string): Promise<boolean> {
  const schema = await readSchema();
  const nextEntries = schema.entries.filter((entry) => entry.id !== entryId);
  return writeSchema({ version: DIARY_SCHEMA_VERSION, entries: nextEntries });
}
