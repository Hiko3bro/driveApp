/**
 * drive-route-planner Edge Functionが受け取る最小の入力の型と実行時検証。
 * 緯度経度以外の個人情報(住所・保存済み場所名・GPS履歴等)はそもそも
 * この型に存在しない。preferencesはai-route-planningが返すAiRoutePreferencesの
 * サブセットで、この値をOpenAIへ送る処理はここには一切存在しない
 * (Places/Routesの検索条件としてのみ使う)。
 */

export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/**
 * ユーザー指定経由地点の安全な上限。候補地点を最大1件追加してもGoogle Routes側の
 * 上限(google-routes/route-types.ts の MAX_INTERMEDIATES = 10)に収まるよう、
 * 9件までに制限する(9 + 候補1件 = 10)。
 */
export const MAX_USER_VIA_POINTS = 9;

/** ai-route-planningのMIN/MAX_AVAILABLE_TIME_MINUTESと同じ範囲。 */
export const MIN_AVAILABLE_TIME_MINUTES = 15;
export const MAX_AVAILABLE_TIME_MINUTES = 7 * 24 * 60;

export const RETURN_TARGET_OPTIONS = ["same-as-departure", "different"] as const;
export type ReturnTarget = (typeof RETURN_TARGET_OPTIONS)[number];

export const PREFERRED_SCENERY_OPTIONS = ["ocean", "mountain", "night_view", "city", "nature"] as const;
export const DESIRED_STOP_OPTIONS = ["restaurant", "cafe", "scenic", "onsen", "activity"] as const;
export const DRIVING_STYLE_OPTIONS = ["relaxed", "balanced", "driving_focused"] as const;

export type PreferredScenery = (typeof PREFERRED_SCENERY_OPTIONS)[number];
export type DesiredStop = (typeof DESIRED_STOP_OPTIONS)[number];
export type DrivingStyle = (typeof DRIVING_STYLE_OPTIONS)[number];

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface DrivePreferences {
  avoidHighways: boolean;
  preferScenicRoads: boolean;
  preferCoastalRoads: boolean;
  preferMountainRoads: boolean;
  preferredScenery: PreferredScenery[];
  desiredStops: DesiredStop[];
  drivingStyle: DrivingStyle;
}

export interface DrivePlanRequest {
  origin: LatLng;
  /** returnTarget === "different" のときのみ必須。"same-as-departure" のときは省略必須。 */
  destination?: LatLng;
  /** ユーザーが確定的に指定した経由地点。順序を含め、この配列は書き換えない。 */
  userViaPoints: LatLng[];
  returnTarget: ReturnTarget;
  availableTimeMinutes: number;
  preferences: DrivePreferences;
}

export type ValidationResult =
  | { ok: true; data: DrivePlanRequest }
  | { ok: false; reason: string };

const ALLOWED_REQUEST_KEYS = new Set([
  "origin",
  "destination",
  "userViaPoints",
  "returnTarget",
  "availableTimeMinutes",
  "preferences",
]);
const ALLOWED_LATLNG_KEYS = new Set(["latitude", "longitude"]);
const ALLOWED_PREFERENCES_KEYS = new Set([
  "avoidHighways",
  "preferScenicRoads",
  "preferCoastalRoads",
  "preferMountainRoads",
  "preferredScenery",
  "desiredStops",
  "drivingStyle",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateLatLng(value: unknown): LatLng | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_LATLNG_KEYS.has(key))) {
    return null;
  }
  const { latitude, longitude } = record;
  if (!isFiniteNumber(latitude) || latitude < MIN_LATITUDE || latitude > MAX_LATITUDE) {
    return null;
  }
  if (!isFiniteNumber(longitude) || longitude < MIN_LONGITUDE || longitude > MAX_LONGITUDE) {
    return null;
  }
  return { latitude, longitude };
}

function isStringArrayOf<T extends string>(value: unknown, allowed: readonly T[]): value is T[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && (allowed as readonly string[]).includes(item))
  );
}

function validatePreferences(value: unknown): DrivePreferences | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_PREFERENCES_KEYS.has(key))) {
    return null;
  }

  const booleanKeys = ["avoidHighways", "preferScenicRoads", "preferCoastalRoads", "preferMountainRoads"] as const;
  for (const key of booleanKeys) {
    if (typeof record[key] !== "boolean") {
      return null;
    }
  }
  if (!isStringArrayOf(record.preferredScenery, PREFERRED_SCENERY_OPTIONS)) {
    return null;
  }
  if (!isStringArrayOf(record.desiredStops, DESIRED_STOP_OPTIONS)) {
    return null;
  }
  if (
    typeof record.drivingStyle !== "string" ||
    !(DRIVING_STYLE_OPTIONS as readonly string[]).includes(record.drivingStyle)
  ) {
    return null;
  }

  return {
    avoidHighways: record.avoidHighways as boolean,
    preferScenicRoads: record.preferScenicRoads as boolean,
    preferCoastalRoads: record.preferCoastalRoads as boolean,
    preferMountainRoads: record.preferMountainRoads as boolean,
    preferredScenery: record.preferredScenery as PreferredScenery[],
    desiredStops: record.desiredStops as DesiredStop[],
    drivingStyle: record.drivingStyle as DrivingStyle,
  };
}

/** 想定外フィールド・不正な緯度経度・範囲外の値のいずれも、例外を投げず拒否する。 */
export function validateDrivePlanRequest(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).every((key) => ALLOWED_REQUEST_KEYS.has(key))) {
    return { ok: false, reason: "unexpected field present" };
  }

  const origin = validateLatLng(record.origin);
  if (!origin) {
    return { ok: false, reason: "invalid origin" };
  }

  if (
    typeof record.returnTarget !== "string" ||
    !(RETURN_TARGET_OPTIONS as readonly string[]).includes(record.returnTarget)
  ) {
    return { ok: false, reason: "invalid returnTarget" };
  }
  const returnTarget = record.returnTarget as ReturnTarget;

  let destination: LatLng | undefined;
  if (returnTarget === "different") {
    const validated = validateLatLng(record.destination);
    if (!validated) {
      return { ok: false, reason: "destination required for different returnTarget" };
    }
    destination = validated;
  } else if (record.destination !== undefined) {
    return { ok: false, reason: "destination must be omitted for same-as-departure" };
  }

  if (!Array.isArray(record.userViaPoints) || record.userViaPoints.length > MAX_USER_VIA_POINTS) {
    return { ok: false, reason: "invalid userViaPoints" };
  }
  const userViaPoints: LatLng[] = [];
  for (const item of record.userViaPoints) {
    const point = validateLatLng(item);
    if (!point) {
      return { ok: false, reason: "invalid via point" };
    }
    userViaPoints.push(point);
  }

  if (
    typeof record.availableTimeMinutes !== "number" ||
    !Number.isInteger(record.availableTimeMinutes) ||
    record.availableTimeMinutes < MIN_AVAILABLE_TIME_MINUTES ||
    record.availableTimeMinutes > MAX_AVAILABLE_TIME_MINUTES
  ) {
    return { ok: false, reason: "invalid availableTimeMinutes" };
  }

  const preferences = validatePreferences(record.preferences);
  if (!preferences) {
    return { ok: false, reason: "invalid preferences" };
  }

  return {
    ok: true,
    data: {
      origin,
      destination,
      userViaPoints,
      returnTarget,
      availableTimeMinutes: record.availableTimeMinutes,
      preferences,
    },
  };
}
