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

/**
 * optionalViaPoints(ドライブ計画チャットで候補カードから選んで追加した地点)の安全な上限。
 * userViaPoints + optionalViaPointsの合計が、候補地点(最大2件、coastal corridor時)を
 * 加えてもGoogle Routes側の上限(MAX_INTERMEDIATES = 10)に収まるよう、8件までに制限する。
 */
export const MAX_OPTIONAL_VIA_POINTS = 4;
/** MAX_USER_VIA_POINTSと同じ値にし、userViaPointsのみを使う既存(今ドラ)フローの上限を一切変えない。 */
export const MAX_COMBINED_VIA_POINTS = 9;

/** ai-route-planningのMIN/MAX_AVAILABLE_TIME_MINUTESと同じ範囲。 */
export const MIN_AVAILABLE_TIME_MINUTES = 15;
export const MAX_AVAILABLE_TIME_MINUTES = 7 * 24 * 60;

export const RETURN_TARGET_OPTIONS = ["same-as-departure", "different"] as const;
export type ReturnTarget = (typeof RETURN_TARGET_OPTIONS)[number];

export const PREFERRED_SCENERY_OPTIONS = ["ocean", "mountain", "night_view", "city", "nature"] as const;
/**
 * "history"/"market"は、ドライブ計画のA→B区間探索がGoogle Places側の拡張カテゴリ
 * (supabase/functions/google-places/place-types.ts参照)を指定できるようにするための追加。
 * ai-route-planning側のDESIRED_STOP_OPTIONS(今ドラのAI解釈用、5値のまま)とは別物で、
 * 今ドラのAIはこの2値を出力できない(今ドラの挙動に影響しない)。
 */
export const DESIRED_STOP_OPTIONS = ["restaurant", "cafe", "scenic", "onsen", "activity", "history", "market"] as const;
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
  /** ユーザーが「使える時間」を指定した場合のみ渡される。未指定はundefined(架空の既定値を持たない)。 */
  availableTimeMinutes?: number;
  preferences: DrivePreferences;
  /**
   * 「生駒を走りたい」のような強い地理的希望が自由文にあった場合、呼び出し元
   * (Expoクライアント)がGoogle Places Text Search等で実在確認した後の座標のみを渡す。
   * AIがこの座標を創作することは無い(AIは検索意図の文字列だけを返し、実座標解決は
   * 常にGoogle Places側で行う、という既存Security Policyを維持)。
   * 指定された場合、候補探索のanchorをこの地点の方向へ強く偏らせる(plan-builder.ts参照)。
   */
  biasPoint?: LatLng;
  /**
   * 「高知県でドライブ」のような、出発地点とは別の強い地域制約(ドライブ計画チャットの
   * planningAreaQueryを解決した代表地点)。指定された場合、候補探索・anchor生成を
   * この範囲内へ強く制約する(厳密な行政界polygonではなく、代表地点からの距離による
   * 安全な範囲制約)。呼び出し元(Expoクライアント)が実在確認した座標のみを渡す。
   * labelは表示・ログ用の人間可読な文字列(例:「和歌山駅」等、都道府県名とは限らない)。
   * prefectureは、クライアントがGoogle Places(addressComponents)から取り出したcanonicalな
   * 都道府県名(例:「和歌山県」)。指定されている場合、Hard Constraintの主判定は
   * candidate.prefectureとのprefectureの厳密一致になり、labelのあいまい一致には頼らない
   * (和歌山県で四国・兵庫県が候補に混入した不具合の修正、plan-builder.ts参照)。
   */
  areaConstraint?: { center: LatLng; radiusMeters: number; label?: string; prefecture?: string };
  /**
   * ユーザーが「候補カードから選んで追加した」立ち寄り地点(ドライブ計画チャット限定)。
   * userViaPointsとは異なり、順序に意味を持たない(追加した順=訪問順とは限らない)ため、
   * plan-builder.ts側で効率の良い順序へ並べ替えてよい(orderWaypointsForEfficiency参照)。
   * 必ず経由するという点ではuserViaPointsと同じ(候補として無視してよい訳ではない)。
   */
  optionalViaPoints?: LatLng[];
  /**
   * trueの場合、optionalViaPointsの並べ替えを行わず、渡された順序をそのまま使う
   * (ユーザーが「温泉は最後に」等、明示的に順序を指定した直後の再生成でのみ使う)。
   */
  preserveOptionalOrder?: boolean;
  /**
   * 「別の案見せて」等の再生成時に、クライアントが既に提示済みの実在Place IDを渡す。
   * Spot Pool・corridor候補選定の際、既出の候補を優先的に避けて多様性を確保するために使う
   * (完全ランダム化はしない、あくまで「既出を避ける」ソフトな除外)。
   */
  excludePlaceIds?: string[];
  /**
   * trueの場合、userViaPoints/optionalViaPointsを通る基本ルートだけを返し、残り時間を
   * 埋めるための追加anchor探索(Spot Pool/Nearby Search)を一切行わない。既に選択済みの
   * Routeへ、ユーザーが選んだ1件のOptional Stopだけを追加する操作(ドライブ計画チャットの
   * 候補カード選択・modify_routes)専用のフラグで、「条件を変えてゼロから探し直す」
   * generate_routesでは使わない。falseまたは未指定時は既存どおりの探索を行う。
   */
  lockToProvidedStops?: boolean;
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
  "biasPoint",
  "areaConstraint",
  "optionalViaPoints",
  "preserveOptionalOrder",
  "excludePlaceIds",
  "lockToProvidedStops",
]);
const ALLOWED_LATLNG_KEYS = new Set(["latitude", "longitude"]);
const ALLOWED_AREA_CONSTRAINT_KEYS = new Set(["center", "radiusMeters", "label", "prefecture"]);
export const MIN_AREA_CONSTRAINT_RADIUS_METERS = 5_000;
export const MAX_AREA_CONSTRAINT_RADIUS_METERS = 300_000;
export const MAX_AREA_LABEL_LENGTH = 40;
export const MAX_AREA_PREFECTURE_LENGTH = 10;
export const MAX_EXCLUDE_PLACE_IDS = 40;
/** Google Place ID(New)の実在フォーマットの緩い検証。英数字・アンダースコア・ハイフンのみ、妥当な長さ。 */
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
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

  // availableTimeMinutesは未指定(=時間指定なし)を許容する。指定されている場合のみ範囲検証する。
  let availableTimeMinutes: number | undefined;
  if (record.availableTimeMinutes !== undefined) {
    if (
      typeof record.availableTimeMinutes !== "number" ||
      !Number.isInteger(record.availableTimeMinutes) ||
      record.availableTimeMinutes < MIN_AVAILABLE_TIME_MINUTES ||
      record.availableTimeMinutes > MAX_AVAILABLE_TIME_MINUTES
    ) {
      return { ok: false, reason: "invalid availableTimeMinutes" };
    }
    availableTimeMinutes = record.availableTimeMinutes;
  }

  const preferences = validatePreferences(record.preferences);
  if (!preferences) {
    return { ok: false, reason: "invalid preferences" };
  }

  let biasPoint: LatLng | undefined;
  if (record.biasPoint !== undefined) {
    const validated = validateLatLng(record.biasPoint);
    if (!validated) {
      return { ok: false, reason: "invalid biasPoint" };
    }
    biasPoint = validated;
  }

  let areaConstraint: { center: LatLng; radiusMeters: number; label?: string; prefecture?: string } | undefined;
  if (record.areaConstraint !== undefined) {
    if (typeof record.areaConstraint !== "object" || record.areaConstraint === null || Array.isArray(record.areaConstraint)) {
      return { ok: false, reason: "invalid areaConstraint" };
    }
    const areaRecord = record.areaConstraint as Record<string, unknown>;
    if (!Object.keys(areaRecord).every((key) => ALLOWED_AREA_CONSTRAINT_KEYS.has(key))) {
      return { ok: false, reason: "invalid areaConstraint" };
    }
    const center = validateLatLng(areaRecord.center);
    if (!center) {
      return { ok: false, reason: "invalid areaConstraint" };
    }
    if (
      typeof areaRecord.radiusMeters !== "number" ||
      !Number.isFinite(areaRecord.radiusMeters) ||
      areaRecord.radiusMeters < MIN_AREA_CONSTRAINT_RADIUS_METERS ||
      areaRecord.radiusMeters > MAX_AREA_CONSTRAINT_RADIUS_METERS
    ) {
      return { ok: false, reason: "invalid areaConstraint" };
    }
    let label: string | undefined;
    if (areaRecord.label !== undefined) {
      if (typeof areaRecord.label !== "string" || areaRecord.label.length === 0 || areaRecord.label.length > MAX_AREA_LABEL_LENGTH) {
        return { ok: false, reason: "invalid areaConstraint label" };
      }
      label = areaRecord.label;
    }
    let prefecture: string | undefined;
    if (areaRecord.prefecture !== undefined) {
      if (
        typeof areaRecord.prefecture !== "string" ||
        areaRecord.prefecture.length === 0 ||
        areaRecord.prefecture.length > MAX_AREA_PREFECTURE_LENGTH
      ) {
        return { ok: false, reason: "invalid areaConstraint prefecture" };
      }
      prefecture = areaRecord.prefecture;
    }
    areaConstraint = { center, radiusMeters: areaRecord.radiusMeters, label, prefecture };
  }

  let optionalViaPoints: LatLng[] = [];
  if (record.optionalViaPoints !== undefined) {
    if (!Array.isArray(record.optionalViaPoints) || record.optionalViaPoints.length > MAX_OPTIONAL_VIA_POINTS) {
      return { ok: false, reason: "invalid optionalViaPoints" };
    }
    for (const item of record.optionalViaPoints) {
      const point = validateLatLng(item);
      if (!point) {
        return { ok: false, reason: "invalid optional via point" };
      }
      optionalViaPoints.push(point);
    }
  }
  if (userViaPoints.length + optionalViaPoints.length > MAX_COMBINED_VIA_POINTS) {
    return { ok: false, reason: "too many via points" };
  }

  let preserveOptionalOrder = false;
  if (record.preserveOptionalOrder !== undefined) {
    if (typeof record.preserveOptionalOrder !== "boolean") {
      return { ok: false, reason: "invalid preserveOptionalOrder" };
    }
    preserveOptionalOrder = record.preserveOptionalOrder;
  }

  let excludePlaceIds: string[] = [];
  if (record.excludePlaceIds !== undefined) {
    if (!Array.isArray(record.excludePlaceIds) || record.excludePlaceIds.length > MAX_EXCLUDE_PLACE_IDS) {
      return { ok: false, reason: "invalid excludePlaceIds" };
    }
    for (const item of record.excludePlaceIds) {
      if (typeof item !== "string" || !PLACE_ID_PATTERN.test(item)) {
        return { ok: false, reason: "invalid exclude place id" };
      }
      excludePlaceIds.push(item);
    }
  }

  let lockToProvidedStops = false;
  if (record.lockToProvidedStops !== undefined) {
    if (typeof record.lockToProvidedStops !== "boolean") {
      return { ok: false, reason: "invalid lockToProvidedStops" };
    }
    lockToProvidedStops = record.lockToProvidedStops;
  }

  return {
    ok: true,
    data: {
      origin,
      destination,
      userViaPoints,
      returnTarget,
      availableTimeMinutes,
      preferences,
      biasPoint,
      areaConstraint,
      optionalViaPoints,
      preserveOptionalOrder,
      excludePlaceIds,
      lockToProvidedStops,
    },
  };
}
