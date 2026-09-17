import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DriveMapView, type DriveMapViewHandle, type MapMarkerSpec } from '@/components/map/drive-map-view';
import { LoadingState } from '@/components/ui/loading-state';
import { OptionChip } from '@/components/ui/option-chip';
import { PlaceCandidateCard } from '@/components/ui/place-candidate-card';
import { QuickReplyChip } from '@/components/ui/quick-reply-chip';
import { RouteProposalCard } from '@/components/ui/route-proposal-card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import {
  requestTripChat,
  type DrivePlanChatContext,
  type DrivePlanTheme,
  type NextAction,
  type PlaceSearchCategoryForChat,
  type TripChatClientMessage,
  type TripChatPlanUpdates,
  type TripChatResult,
} from '@/services/ai/trip-chat-client';
import { resolveSeasonHint } from '@/services/date/season';
import { generateDrivePlanId, getDrivePlan, saveDrivePlan } from '@/services/drive-plan/drive-plan-store';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { getHomeLocation } from '@/services/location/home-location-store';
import { computeRegionForPath } from '@/services/location/route-map-region';
import { DEMO_MAP_REGION, haversineDistanceKm } from '@/services/location/coordinates';
import { resolveAreaRadiusMeters } from '@/services/location/prefecture-radius';
import { openGoogleMapsNavigation } from '@/services/navigation/google-maps-navigation';
import { buildRouteOptionsFromDrivePlans } from '@/services/route/drive-plan-mapper';
import { requestDrivePlans, type DrivePlanPreferences } from '@/services/route/drive-route-planner-client';
import { searchNearbyPlaces, searchPlaceByText, type PlaceCandidate } from '@/services/spot/google-places-client';
import { buildPlaceFactDescription, buildRouteFitDescription } from '@/services/spot/place-description';
import { formatMinutesLabel } from '@/types/drive';
import type { Coordinates, PlaceSelection } from '@/types/location';
import type { RouteNearbySuggestion, RouteOption } from '@/types/route';
import type { SavedDrivePlan } from '@/types/drive-plan';

/**
 * ドライブ計画の新しいメインUX: ほぼ1画面のチャットで完結させる
 * (チャット→AIの質問→回答→ルート候補(地図+しおり)→修正相談→保存)。
 * 「今ドラ」と同じ思想(今いる場所・今の気分・今使える時間→今の今ドラ、
 * 今度行く地域・希望・時期→ドライブ計画)で、drive-route-plannerをそのまま
 * ルート生成エンジンとして再利用する。
 *
 * 「AIが勝手にルートを完成させる」のではなく「AIと一緒に候補を見ながら組み立てる」
 * 体験にするため、会話(message)・ルート提案(proposal)・実在スポット候補
 * (placeCandidates)・エラー(error)をすべて同じ時系列(items)の要素として扱う。
 * 新しいアイテムは常に下に追加され、最新のRoute Proposalだけが地図付きで展開
 * 表示され、それ以前はcompact表示になる。実在スポット候補は、AIが検索カテゴリ
 * (nextAction: "search_places")を示した時にだけGoogle Placesへ実際に問い合わせ、
 * ユーザーがカード上で直接選んだものだけをwaypointへ追加してルートを再生成する
 * (AIは実在の場所名を一切見ない・創作しない、実在確認は常にGoogle Places経由)。
 *
 * 実機テストで見つかった状態管理の不具合(ユーザーメッセージの重複追加、
 * 古いrequestの応答が新しい会話状態を上書きする可能性)を踏まえ、
 * 送信経路(手動入力・クイック返信・再試行)をすべて1つのperformChatRequest()に
 * 集約し、useRefによる同期的なロック(sendLockRef)で「1ユーザー操作につき
 * リクエストは常に1つだけ」を構造的に保証している。Reactのstate(sending)は
 * 非同期にしか反映されないため、二重タップ等の競合を防ぐガードとしては
 * 使わず、UIの活性/非活性表示にのみ使う。
 */

const MAX_CLIENT_MESSAGES = 10;
const CAMERA_ANIMATION_MS = 450;
/** 実在スポット候補の検索半径。今ドラのSpot Discoveryと同程度。 */
const PLACE_SEARCH_RADIUS_METERS = 6_000;
const MAX_PLACE_CANDIDATES = 5;
/**
 * 立ち寄りにかかる追加時間の見積もり(既存のservices/spot/google-places-spot-provider.ts
 * のestimateDetourと同じ考え方: 検索centerからの直線距離を往復すると見なす)。実際の
 * 追加時間はGoogle Routesでの実測(選択後のgenerateRoutes)でのみ確定する、という既存の
 * 「カード表示はあくまで見積もり」方針をそのまま踏襲する。
 */
const DETOUR_SPEED_KMH = 25;
const MIN_EXTRA_MINUTES = 3;
/** チャット一覧が下端付近にあるとみなす閾値(px)。ここより下にいる場合だけ自動scrollする。 */
const NEAR_BOTTOM_THRESHOLD = 120;
/**
 * originがplanning area(resolvedPlanningArea)からこの倍率を超えて離れている場合、
 * 自動でルート生成せず「移動も含めるか・現地に着いてから探すか」を確認する
 * (セクション4: 「高知県でドライブ」なのに大阪の自宅からいきなりルートを作らない)。
 */
const AREA_OUTSIDE_CONFIRM_RATIO = 1.5;
const TRAVEL_INCLUDE_REPLY = '移動も含める';
const TRAVEL_LOCAL_REPLY = '現地に着いてから探す';

/** 「温泉」検索をText Search中心にするためのクエリ語彙(セクション7)。実在スポット名ではなく検索語句のハードコード。 */
const ONSEN_TEXT_QUERIES = ['日帰り温泉', '天然温泉 日帰り', '温泉 入浴'];
/** 宿泊専用と思われる施設名を除外する簡易ヒューリスティック(サーバー側plan-builder.tsと同じ考え方)。 */
const LODGING_ONLY_PATTERN = /ヴィラ|villa|一棟貸し|コテージ|貸別荘|ロッジ|ペンション|民宿|hotel|ホテル|旅館|inn\b/i;

/**
 * 「このルートで」「今のルートに」「このコースに」等、明示的に現在選択中のRouteを基準に
 * した追加・調整を求める表現。AIのnextAction判定だけに任せず、これらの表現がある場合は
 * client側でもmodify mode(既存Routeを維持したままの変更)を強制する(セクション39)。
 */
const CURRENT_ROUTE_INTENT_PATTERN = /このルート|今のルート|このコース|今の計画|今のプラン/;

/**
 * 「目的地を◯◯に変更」「◯◯をゴールにしたい」等、principal goal(destinationQuery)を
 * 明示的に変更する表現。これが無い限り、AIがdestinationQueryを返しても単なるOptional Stop
 * 追加(「温泉を追加して」等)として扱い、既存の主目的地を勝手に置き換えない(セクション40)。
 */
const EXPLICIT_DESTINATION_CHANGE_PATTERN = /目的地を|目的地は|ゴールに|ゴールへ|行き先を|行き先は|最後は.*行き|最終目的地/;

const THEME_LABELS: Record<DrivePlanTheme, string> = {
  scenic: '景色',
  coastal: '海沿い',
  mountain: '山道',
  gourmet: 'ご当地グルメ',
  onsen: '温泉',
  history: '歴史',
  market: '市場',
  activity: '体験',
  omakase: 'おまかせ',
};

/** ルート生成中のLoadingStateメッセージ。内部API名は出さず、分かっている範囲の条件(地域・テーマ)だけを反映する。 */
function buildRouteGeneratingMessage(themes: DrivePlanTheme[], areaLabel?: string): string {
  const themeLabel = themes.length > 0 ? THEME_LABELS[themes[0]] : undefined;
  if (themeLabel && areaLabel) {
    return `${areaLabel}で${themeLabel}の候補を探しています`;
  }
  if (themeLabel) {
    return `${themeLabel}の候補を探しています`;
  }
  if (areaLabel) {
    return `${areaLabel}の候補を探しています`;
  }
  return '実在スポットからルートを組み立てています';
}

/**
 * 「ドライブする地域」(areaQuery)を実在確認した結果。labelは表示・ログ用の人間可読な
 * 文字列(Text Searchが返した代表地点の名前、都道府県名そのものとは限らない)。
 * prefectureは、addressComponents由来のcanonicalな都道府県名(例:「和歌山県」)で、
 * Hard Constraint判定(サーバーへ送るareaConstraint.prefecture、destinationQuery等の
 * 解決結果がこの地域内かどうかの検証)に使う主判定値。取得できない場合はnull
 * (=距離ベースの緩い判定へフォールバックする)。
 */
interface ResolvedPlanningArea {
  label: string;
  prefecture: string | null;
  center: Coordinates;
  radiusMeters: number;
}

/**
 * areaQueryをGoogle Places Text Searchで実在確認し、canonicalな都道府県名込みで解決する。
 * 「和歌山方面」のような都道府県名を含まない/部分一致しない言い回しでも、解決した代表地点の
 * addressComponentsからcanonicalなprefectureを取り出すため、半径・Hard Constraintの
 * 判定が正しく機能する(旧実装は生テキストへの部分一致に依存しており、和歌山県で四国・
 * 兵庫県が候補に混入した不具合の一因だった)。見つからない場合はundefined。
 */
async function resolvePlanningArea(query: string): Promise<ResolvedPlanningArea | undefined> {
  const outcome = await searchPlaceByText(query, 1);
  if (!outcome.ok || outcome.places.length === 0) {
    return undefined;
  }
  const place = outcome.places[0];
  return {
    label: place.name,
    prefecture: place.prefecture,
    center: { latitude: place.latitude, longitude: place.longitude },
    radiusMeters: resolveAreaRadiusMeters(query, place.prefecture),
  };
}

const PLACE_SEARCH_CATEGORY_LABELS: Record<PlaceSearchCategoryForChat, string> = {
  restaurant: 'ご飯',
  cafe: 'カフェ',
  scenic: '絶景',
  onsen: '温泉',
  activity: '体験',
  history: '歴史スポット',
  market: '市場',
};

function buildPreferencesFromThemes(themes: DrivePlanTheme[], avoidHighways: boolean): DrivePlanPreferences {
  const preferCoastalRoads = themes.includes('coastal');
  const preferMountainRoads = themes.includes('mountain');
  const preferredScenery: string[] = [];
  if (preferCoastalRoads) preferredScenery.push('ocean');
  if (preferMountainRoads) preferredScenery.push('mountain');

  const desiredStops: string[] = [];
  if (themes.includes('gourmet')) desiredStops.push('restaurant');
  if (themes.includes('onsen')) desiredStops.push('onsen');
  if (themes.includes('history')) desiredStops.push('history');
  if (themes.includes('market')) desiredStops.push('market');
  if (themes.includes('activity')) desiredStops.push('activity');

  return {
    avoidHighways,
    preferScenicRoads: themes.includes('scenic'),
    preferCoastalRoads,
    preferMountainRoads,
    preferredScenery,
    desiredStops,
    drivingStyle: 'balanced',
  };
}

/**
 * AIが今何を聞いていそうかをクライアント側の既知の状態だけから推測し、入力欄のplaceholderへ
 * 反映する(AIスキーマは変更しない、軽量なヒューリスティック)。あくまで見た目のヒントであり、
 * 自由入力はどの状態でも常に可能。
 */
function resolveComposerPlaceholder(input: {
  hasAreaQuery: boolean;
  hasOrigin: boolean;
  hasThemes: boolean;
  hasRouteOptions: boolean;
}): string {
  if (!input.hasAreaQuery && !input.hasOrigin) {
    return '行きたい地域を入力';
  }
  if (!input.hasOrigin) {
    return '出発地点を入力';
  }
  if (!input.hasThemes && !input.hasRouteOptions) {
    return '景色・食事・温泉など希望を入力';
  }
  return 'AIに希望を伝える';
}

function estimateDetour(anchor: Coordinates, spot: Coordinates): { extraDistanceKm: number; extraMinutes: number } {
  const oneWayKm = haversineDistanceKm(anchor, spot);
  const extraDistanceKm = Math.round(oneWayKm * 2 * 10) / 10;
  const extraMinutes = Math.max(MIN_EXTRA_MINUTES, Math.round((extraDistanceKm / DETOUR_SPEED_KMH) * 60));
  return { extraDistanceKm, extraMinutes };
}

/**
 * チャットで生成した1回分のルート提案のスナップショット。会話が進んで新しい提案が
 * 生成されるたびに新しいitemとして追加していき、最新のものだけをMap付きで展開表示し、
 * 過去のものはcompact表示にする。
 */
interface DrivePlanProposal {
  id: string;
  routeOptions: RouteOption[];
  selectedRouteId: string | null;
}

interface PlaceCandidateWithEstimate extends PlaceCandidate {
  extraMinutes: number;
  extraDistanceKm: number;
}

/**
 * ユーザーが候補カードから選んで追加した立ち寄り地点。カテゴリ単位の全削除ではなく
 * 個別idでの削除・並べ替えができるよう、id・カテゴリ・追加順を個別に管理する
 * (セクション8)。userViaPoints(今ドラ側の順序固定の必須経由地点)とは別の概念で、
 * 順序に意味を持たず、サーバー側(plan-builder.ts)で効率の良い順序へ並べ替えてよい。
 */
interface SelectedStop {
  id: string;
  placeId: string;
  category: PlaceSearchCategoryForChat;
  addedOrder: number;
  displayName: string;
  coordinates: Coordinates;
}

/**
 * 選択中Routeが成立するために必須の、サーバーのanchor探索が選んだ地点(名前付き)。
 * getPreservedAnchorsForActiveRoute()参照。selectedStopsとは異なり、ユーザーが個別に
 * 削除/並べ替えできる対象ではない(Hard Themeを成立させている地点のため、Optional Stopの
 * remove/reorder操作の対象外)。
 */
interface NamedAnchor {
  name: string;
  coordinates: Coordinates;
}

/** RouteNearbySuggestion(primaryTypeのみ持つ)から、AIへ渡す安全なカテゴリを推測する(実在typeの分類のみ、架空のデータは作らない)。 */
function guessCategoryFromPrimaryType(primaryType: string | null): PlaceSearchCategoryForChat {
  if (!primaryType) {
    return 'scenic';
  }
  if (primaryType === 'spa' || primaryType === 'public_bath' || primaryType === 'sauna') {
    return 'onsen';
  }
  if (primaryType === 'cafe' || primaryType === 'coffee_shop') {
    return 'cafe';
  }
  if (
    primaryType === 'restaurant' ||
    primaryType.endsWith('_restaurant') ||
    primaryType === 'meal_takeaway' ||
    primaryType === 'diner'
  ) {
    return 'restaurant';
  }
  if (
    ['museum', 'shinto_shrine', 'buddhist_temple', 'castle', 'historical_landmark', 'historical_place', 'monument', 'cultural_landmark'].includes(
      primaryType
    )
  ) {
    return 'history';
  }
  if (primaryType.includes('market')) {
    return 'market';
  }
  return 'scenic';
}

type ChatItem =
  | { kind: 'message'; id: string; role: 'user' | 'assistant'; content: string }
  | { kind: 'proposal'; id: string; proposal: DrivePlanProposal }
  | {
      kind: 'placeCandidates';
      id: string;
      category: PlaceSearchCategoryForChat;
      candidates: PlaceCandidateWithEstimate[];
      /** ユーザーがどれかを選んだ後、その名前を入れて選択済み状態にする。 */
      resolvedName?: string;
    }
  | { kind: 'error'; id: string; message: string; retryable: boolean };

function PastProposalSummary({
  proposal,
  expanded,
  onToggle,
}: {
  proposal: DrivePlanProposal;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.pastProposalBox}>
      <View style={styles.pastProposalHeaderRow}>
        <Text style={styles.pastProposalLabel} numberOfLines={1}>
          前の提案(全{proposal.routeOptions.length}コース)
        </Text>
        <Pressable onPress={onToggle} hitSlop={8} accessibilityRole="button" accessibilityLabel="前の提案を開閉">
          <Text style={styles.pastProposalToggle}>{expanded ? '閉じる' : 'もう一度見る'}</Text>
        </Pressable>
      </View>
      {expanded && (
        <View style={styles.pastProposalDetail}>
          {proposal.routeOptions.map((route) => (
            <Text key={route.id} style={styles.pastProposalRouteLine}>
              {route.name} ・ {formatDistanceLabel(route.distanceKm)} ・ 約{formatMinutesLabel(route.durationMinutes)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function PlaceCandidatesBlock({
  category,
  candidates,
  resolvedName,
  disabled,
  themes,
  onSelect,
}: {
  category: PlaceSearchCategoryForChat;
  candidates: PlaceCandidateWithEstimate[];
  resolvedName?: string;
  disabled: boolean;
  themes: DrivePlanTheme[];
  onSelect: (candidate: PlaceCandidateWithEstimate) => void;
}) {
  const categoryLabel = PLACE_SEARCH_CATEGORY_LABELS[category];
  const routeFitDescription = buildRouteFitDescription({ theme: themes[0] });

  return (
    <View style={styles.placeCandidatesBox}>
      <Text style={styles.placeCandidatesLabel}>
        {resolvedName ? `${categoryLabel}の候補` : `このルートの近くだと、こんな${categoryLabel}が寄りやすそう`}
      </Text>
      {category === 'onsen' && <Text style={styles.placeCandidatesNote}>日帰り利用可否等の利用条件は、公式情報でご確認ください</Text>}
      {candidates.map((candidate, index) => {
        const isResolved = resolvedName === candidate.name;
        const factDescription = buildPlaceFactDescription({
          locality: candidate.locality,
          prefecture: null,
          category,
        });
        return (
          <PlaceCandidateCard
            key={candidate.id}
            placeId={candidate.id}
            name={candidate.name}
            categoryLabel={categoryLabel}
            category={category}
            area={candidate.locality}
            factDescription={factDescription}
            routeFitDescription={routeFitDescription}
            extraMinutes={candidate.extraMinutes}
            extraDistanceKm={candidate.extraDistanceKm}
            photoPriority={index < 3 ? 'high' : 'low'}
            photoRef={candidate.photoRef}
            primaryLabel={resolvedName ? (isResolved ? '選択中' : 'ここに寄る') : 'ここに寄る'}
            primaryDisabled={disabled || Boolean(resolvedName) || isResolved}
            primaryVariant={isResolved ? 'secondary' : 'primary'}
            onPrimaryPress={() => onSelect(candidate)}
          />
        );
      })}
    </View>
  );
}

export default function DrivePlanChatScreen() {
  const { savedPlanId } = useLocalSearchParams<{ savedPlanId?: string }>();

  const [items, setItems] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);

  const [areaQuery, setAreaQuery] = useState<string | undefined>(undefined);
  const [origin, setOrigin] = useState<PlaceSelection | undefined>(undefined);
  const [destination, setDestination] = useState<PlaceSelection | undefined>(undefined);
  const [themes, setThemes] = useState<DrivePlanTheme[]>([]);
  const [timeBudgetMinutes, setTimeBudgetMinutes] = useState<number | undefined>(undefined);
  const [dateText, setDateText] = useState<string | undefined>(undefined);
  const [avoidHighways, setAvoidHighways] = useState(false);

  const [expandedPastProposalId, setExpandedPastProposalId] = useState<string | null>(null);
  const [generatingRoutes, setGeneratingRoutes] = useState(false);
  // 「このルートの近く」「実在スポット候補」から選んで追加した経由地(個別id管理、セクション8)。
  const [selectedStops, setSelectedStops] = useState<SelectedStop[]>([]);
  const [addingSuggestion, setAddingSuggestion] = useState(false);

  // 「ドライブする地域」(areaQuery)を実在確認した代表地点+目安半径(セクション3)。
  const [resolvedPlanningArea, setResolvedPlanningArea] = useState<ResolvedPlanningArea | undefined>(undefined);
  // originがplanning area外の場合の確認待ち状態(セクション4)。nullなら確認待ちではない。
  const [pendingAreaConfirmation, setPendingAreaConfirmation] = useState<{
    areaLabel: string;
    nextOrigin: PlaceSelection;
    nextDestination: PlaceSelection | undefined;
    nextThemes: DrivePlanTheme[];
    nextAvoidHighways: boolean;
    nextTimeBudgetMinutes: number | undefined;
    nextBiasPoint: Coordinates | undefined;
  } | null>(null);
  // 同じorigin・同じareaの組み合わせについて一度確認したら、同じ会話内では再確認しない。
  const confirmedAreaKeyRef = useRef<string | null>(null);
  // applyPlanUpdates内でareaQueryをその場で解決した場合に、その値を記録する。
  // 直後のuseEffect([areaQuery])が同じqueryを二重にText Search解決しないようにする
  // (API呼び出しの無駄を避けるため)。
  const resolvedAreaQueryRef = useRef<string | undefined>(undefined);

  const itemIdRef = useRef(0);
  const proposalIdRef = useRef(0);
  const stopIdRef = useRef(0);
  const stopOrderRef = useRef(0);
  const nextStopId = () => `stop-${stopIdRef.current++}`;
  // このセッション(チャット画面を開いている間)で一度でも提示した実在Place ID。
  // 「別の案見せて」的な再生成で、既出の候補をなるべく避けて多様性を確保するために使う
  // (セクション13・14。表示用stateではないためuseRefで十分)。
  const usedPlaceIdsRef = useRef<Set<string>>(new Set());

  const [existingPlanId, setExistingPlanId] = useState<string | null>(null);
  const [existingCreatedAt, setExistingCreatedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const [homeLocation, setHomeLocation] = useState<PlaceSelection | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const listRef = useRef<FlatList<ChatItem>>(null);
  const mapRef = useRef<DriveMapViewHandle>(null);
  const framedRouteIdRef = useRef<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  // チャット一覧が下端付近にあるかどうか。新しいitem追加時、下端付近にいる場合だけ
  // 自動scrollする(ユーザーが過去のやり取りを読んでいる時に強制的に飛ばさないため)。
  const isNearBottomRef = useRef(true);

  // 送信の直列化・競合防止用。Reactのstate(sending)は再レンダリングまで反映されないため、
  // 二重タップ・クイック返信と送信ボタンの同時押し等を確実にブロックするには使えない。
  const sendLockRef = useRef(false);
  // 最新のリクエストのみを反映するための単調増加シーケンス(直列化されている限り原理上は
  // 常に一致するが、防御的に保持する)。
  const requestSeqRef = useRef(0);
  // 直前に実際に送信したメッセージ配列(user発言を含む)。エラー時の「もう一度試す」で
  // 同じリクエストだけを再送し、ユーザーメッセージを二重追加しないために使う。
  const lastSentMessagesRef = useRef<TripChatClientMessage[] | null>(null);

  const nextItemId = () => `item-${itemIdRef.current++}`;
  const pushItem = (item: ChatItem) => setItems((prev) => [...prev, item]);

  useEffect(() => {
    getHomeLocation().then((coordinates) => {
      if (coordinates) {
        setHomeLocation({ label: '自宅', coordinates });
      }
    });
  }, []);

  useEffect(() => {
    if (!savedPlanId) {
      return;
    }
    getDrivePlan(savedPlanId).then((plan) => {
      if (!plan) {
        return;
      }
      setExistingPlanId(plan.id);
      setExistingCreatedAt(plan.createdAt);
      setAreaQuery(plan.areaName);
      setDateText(plan.dateText);
      setOrigin(plan.origin);
      setDestination(plan.destination);
      const initialItems: ChatItem[] = [];
      if (plan.routeOptions.length > 0) {
        initialItems.push({
          kind: 'proposal',
          id: nextItemId(),
          proposal: {
            id: `proposal-restored-${proposalIdRef.current++}`,
            routeOptions: plan.routeOptions,
            selectedRouteId: plan.selectedRouteId ?? plan.routeOptions[0]?.id ?? null,
          },
        });
      }
      initialItems.push({
        kind: 'message',
        id: nextItemId(),
        role: 'assistant',
        content: plan.conversationSummary
          ? `この計画を読み込みました: ${plan.conversationSummary}`
          : 'この計画を読み込みました。続けて相談できます。',
      });
      setItems(initialItems);
    });
  }, [savedPlanId]);

  // 「高知県でドライブ」のようなareaQueryを実在確認し、代表地点+目安半径を解決する
  // (セクション3: 「ドライブする地域」と「出発地点」の分離)。Google Places側に新しい
  // field(viewport等)を追加せず、都道府県名の静的テーブルで半径を見積もる
  // (料金ティアへの影響ゼロ、厳密な行政界polygonではなく安全な範囲制約でよい)。
  useEffect(() => {
    if (!areaQuery) {
      // 同期的なsetStateはここでは行わない(react-hooks/set-state-in-effect)。
      // resolvedPlanningAreaEffective側でareaQuery未設定時はundefined扱いにする。
      return;
    }
    if (resolvedAreaQueryRef.current === areaQuery) {
      // applyPlanUpdates内で同じqueryを既にその場で解決済み(二重Text Search回避)。
      return;
    }
    let active = true;
    resolvePlanningArea(areaQuery).then((resolved) => {
      if (!active) {
        return;
      }
      resolvedAreaQueryRef.current = areaQuery;
      setResolvedPlanningArea(resolved);
    });
    return () => {
      active = false;
    };
  }, [areaQuery]);

  // areaQueryが未設定(または解除された)場合、前回のarea解決結果を引きずらない
  // (レンダー時点の純粋な導出。effect内での同期的なsetStateは行わない)。
  const resolvedPlanningAreaEffective = areaQuery ? resolvedPlanningArea : undefined;

  const proposalItems = items.filter((item): item is Extract<ChatItem, { kind: 'proposal' }> => item.kind === 'proposal');
  const latestProposalItem = proposalItems.length > 0 ? proposalItems[proposalItems.length - 1] : null;
  const latestProposal = latestProposalItem?.proposal ?? null;
  const routeOptions = latestProposal?.routeOptions ?? [];
  const selectedRouteId = latestProposal?.selectedRouteId ?? null;

  const selectedRoute = routeOptions.find((route) => route.id === selectedRouteId) ?? routeOptions[0] ?? null;

  /**
   * 現在選択中のRouteのwaypoints(出発地点への帰還/目的地の最終エントリを除く)から、
   * サーバー側のSpot Pool/anchor探索が選んだ地点(例:「高津子山展望台」、Hard Theme
   * (山道・海沿い等)を成立させているanchor)だけを取り出す。selectedStops(候補カードから
   * 明示的に選んで追加した地点、こちらは既にoptionalViaPointsとして毎回送られている)と
   * 座標が近い(50m未満)ものは除外し、二重に送らないようにする。Optional Stop追加時に
   * これをoptionalViaPointsへ含めることで、AIのanchor探索をやり直させず、選択済みRouteの
   * 構成を維持したまま1点だけ追加できるようにする(実機で「温泉を追加したら選択していた
   * Routeが失われた」不具合の修正)。
   *
   * 名前(name)も一緒に保持するのは、lockToProvidedStops経由で返る基本ルート
   * (drive-route-plannerのtoBasePlan)がsuggestedPlaceを持たない=anchorの名前を返さない
   * ため。generateRoutes側でこの名前付きanchorをcontext.userViaPointsとしてラベル付けし
   * 直すことで、次のRouteOption.waypointsにもanchorが名前付きで残り続け、さらにもう1件
   * Optional Stopを追加する場合でもこの関数が再度anchorを見つけられる(=chainが途中で
   * 途切れない、自己修復的な設計)。
   */
  const getPreservedAnchorsForActiveRoute = (): NamedAnchor[] => {
    if (!selectedRoute) {
      return [];
    }
    const candidatePoints = selectedRoute.waypoints.slice(0, -1);
    return candidatePoints
      .filter((wp) => !selectedStops.some((stop) => haversineDistanceKm(wp.coordinates, stop.coordinates) < 0.05))
      .map((wp) => ({ name: wp.name, coordinates: wp.coordinates }));
  };

  const updateLatestSelectedRoute = (routeId: string) => {
    if (!latestProposalItem) {
      return;
    }
    const targetId = latestProposalItem.id;
    setItems((prev) =>
      prev.map((item) =>
        item.kind === 'proposal' && item.id === targetId
          ? { ...item, proposal: { ...item.proposal, selectedRouteId: routeId } }
          : item
      )
    );
  };

  // DriveMapViewのinitialRegionはマウント時にしか読まれない(react-native-mapsの
  // 「initial」propの通常のセマンティクス)ため、useMemoで手動メモ化する必要はない
  // (React Compilerの自動最適化に任せる)。
  const mapInitialRegion = (() => {
    if (selectedRoute && selectedRoute.path.length > 0) {
      return computeRegionForPath(selectedRoute.path);
    }
    if (origin) {
      return { ...origin.coordinates, latitudeDelta: 0.2, longitudeDelta: 0.2 };
    }
    return DEMO_MAP_REGION;
  })();

  useEffect(() => {
    if (!mapReady || !selectedRoute) {
      return;
    }
    if (framedRouteIdRef.current === selectedRoute.id) {
      return;
    }
    framedRouteIdRef.current = selectedRoute.id;
    mapRef.current?.animateToRegion(computeRegionForPath(selectedRoute.path), CAMERA_ANIMATION_MS);
  }, [mapReady, selectedRoute]);

  const buildContext = (): DrivePlanChatContext => ({
    areaQuery,
    hasOrigin: Boolean(origin),
    originLabel: origin?.label,
    hasDestination: Boolean(destination),
    destinationLabel: destination?.label,
    hasHomeSaved: Boolean(homeLocation),
    timeBudgetMinutes,
    dateText,
    seasonHint: resolveSeasonHint(new Date()),
    themes,
    hasRouteOptions: routeOptions.length > 0,
    stops: selectedStops.map((stop) => ({
      id: stop.id,
      category: stop.category,
      addedOrder: stop.addedOrder,
      displayName: stop.displayName,
    })),
  });

  const generateRoutes = async (
    nextOrigin: PlaceSelection,
    nextDestination: PlaceSelection | undefined,
    nextThemes: DrivePlanTheme[],
    nextAvoidHighways: boolean,
    nextTimeBudgetMinutes: number | undefined,
    nextBiasPoint?: Coordinates,
    nextOptionalStops: SelectedStop[] = [],
    preserveOptionalOrder = false,
    // 同一ターン内でareaQueryをその場で解決した場合、まだstateに反映されていない
    // (Reactの非同期反映を待たない)最新のplanning areaをここで明示的に渡す。
    // 省略時はrender時点のresolvedPlanningAreaEffectiveを使う(既存の呼び出し元向け)。
    areaOverride: ResolvedPlanningArea | undefined = resolvedPlanningAreaEffective,
    // 現在選択中のRouteを維持したまま1点追加する操作(候補カード選択・modify_routes)でのみ
    // 呼び出し元がgetPreservedAnchorsForActiveRoute()の結果を渡す。「別の案見せて」等の
    // ゼロからの再生成では渡さない(既存の挙動どおりanchor探索をやり直す)。
    preservedAnchors: NamedAnchor[] = [],
    // trueの場合、サーバー側の追加anchor探索(残り時間を埋めるためのSpot Pool/Nearby
    // Search)を行わず、userViaPoints/optionalViaPointsを通る基本ルートだけを返す。
    // 「選択中Routeへ1件だけ追加する」操作(候補カード選択・modify_routes)でのみtrueにする。
    lockToProvidedStops = false
  ) => {
    setGeneratingRoutes(true);
    const preferences = buildPreferencesFromThemes(nextThemes, nextAvoidHighways);
    const outcome = await requestDrivePlans({
      origin: nextOrigin.coordinates,
      destination: nextDestination?.coordinates,
      returnTarget: nextDestination ? 'different' : 'same-as-departure',
      userViaPoints: [],
      availableTimeMinutes: nextTimeBudgetMinutes,
      preferences,
      biasPoint: nextBiasPoint,
      areaConstraint: areaOverride
        ? {
            center: areaOverride.center,
            radiusMeters: areaOverride.radiusMeters,
            label: areaOverride.label,
            prefecture: areaOverride.prefecture ?? undefined,
          }
        : undefined,
      optionalViaPoints: [...preservedAnchors.map((a) => a.coordinates), ...nextOptionalStops.map((stop) => stop.coordinates)],
      preserveOptionalOrder,
      lockToProvidedStops,
      // 「別の案見せて」等の再生成で、既に提示済みの実在候補をなるべく避けて多様性を
      // 確保する(セクション13・14)。完全ランダム化はしない、あくまでソフトな除外。
      excludePlaceIds: [...usedPlaceIdsRef.current],
    });
    if (outcome.ok) {
      const options = buildRouteOptionsFromDrivePlans(outcome.plans, outcome.meta, {
        departureLabel: nextOrigin.label,
        destinationLabel: nextDestination?.label,
        // lockToProvidedStops経由の基本ルートはsuggestedPlaceを持たない(=anchorの名前を
        // 返さない)ため、preservedAnchorsの名前をここで明示的にラベル付けし直す。これにより
        // 次のRouteOption.waypointsにもanchorが名前付きで残り続け、getPreservedAnchors
        // ForActiveRoute()が次回のOptional Stop追加でも同じanchorを見つけられる
        // (「2回目以降の追加でanchorが消える」不具合の修正、自己修復的な設計)。
        userViaPoints: [
          ...preservedAnchors.map((anchor) => ({ label: anchor.name, coordinates: anchor.coordinates })),
          ...nextOptionalStops.map((stop) => ({ label: stop.displayName, coordinates: stop.coordinates })),
        ],
        avoidHighwaysApplied: nextAvoidHighways,
      });
      framedRouteIdRef.current = null;
      // 今回提示した実在候補のPlace IDを記憶し、次回の再生成で既出として避けられるようにする。
      for (const option of options) {
        if (option.suggestedPlace) {
          usedPlaceIdsRef.current.add(option.suggestedPlace.id);
        }
        for (const nearby of option.nearbySuggestions ?? []) {
          usedPlaceIdsRef.current.add(nearby.id);
        }
      }
      if (options.length > 0) {
        const newProposal: DrivePlanProposal = {
          id: `proposal-${proposalIdRef.current++}`,
          routeOptions: options,
          selectedRouteId: options[0]?.id ?? null,
        };
        // 新しい提案はチャット履歴の下に新しいitemとして追加する(既存の提案を上書き
        // しない)。直前まで展開していた過去の提案は自動でcompact表示に戻る
        // (isLatestの判定が新しいproposal itemへ移るため)。
        pushItem({ kind: 'proposal', id: nextItemId(), proposal: newProposal });
        setExpandedPastProposalId(null);
      } else {
        pushItem({
          kind: 'error',
          id: nextItemId(),
          message: '実在する候補を見つけられませんでした。テーマや地域を変えて相談してみてください。',
          retryable: false,
        });
      }
    } else {
      pushItem({ kind: 'error', id: nextItemId(), message: 'ルートを取得できませんでした。もう一度お試しください。', retryable: false });
    }
    setGeneratingRoutes(false);
  };

  const persistPlan = async (
    planOrigin: PlaceSelection,
    planDestination: PlaceSelection | undefined,
    planAreaQuery: string | undefined,
    planDateText: string | undefined,
    planThemes: DrivePlanTheme[],
    now: number
  ) => {
    if (routeOptions.length === 0 || saving) {
      return;
    }
    setSaving(true);
    const chosenRoute = routeOptions.find((route) => route.id === selectedRouteId) ?? routeOptions[0];
    const title = planAreaQuery
      ? `${planAreaQuery}ドライブ`
      : planDestination
        ? `${planOrigin.label} → ${planDestination.label}`
        : `${planOrigin.label}周辺ドライブ`;
    const lastAssistantMessage = [...items]
      .reverse()
      .find((item): item is Extract<ChatItem, { kind: 'message' }> => item.kind === 'message' && item.role === 'assistant');

    const plan: SavedDrivePlan = {
      id: existingPlanId ?? generateDrivePlanId(),
      title,
      areaName: planAreaQuery,
      dateText: planDateText,
      origin: planOrigin,
      destination: planDestination,
      themeSummary: planThemes.map((theme) => THEME_LABELS[theme]),
      routeOptions,
      selectedRouteId: chosenRoute?.id,
      conversationSummary: lastAssistantMessage?.content,
      createdAt: existingCreatedAt ?? now,
      // saveDrivePlan()が保存直前に必ずDate.now()で上書きするため、ここでの値は使われない。
      updatedAt: now,
    };

    const ok = await saveDrivePlan(plan);
    if (ok) {
      setExistingPlanId(plan.id);
      setExistingCreatedAt(plan.createdAt);
      setSavedNotice(true);
    } else {
      pushItem({ kind: 'error', id: nextItemId(), message: '保存できませんでした。もう一度お試しください。', retryable: false });
    }
    setSaving(false);
  };

  /** AIがnextAction: "search_places"を示した時だけ呼ぶ。実在候補をGoogle Placesで検索し、chat itemとして提示する(まだルートへは組み込まない)。 */
  const performPlaceSearch = async (category: PlaceSearchCategoryForChat, searchOrigin: PlaceSelection) => {
    const anchor =
      selectedRoute && selectedRoute.path.length > 0
        ? selectedRoute.path[Math.floor(selectedRoute.path.length / 2)]
        : searchOrigin.coordinates;

    let places: PlaceCandidate[] = [];
    if (category === 'onsen' && resolvedPlanningAreaEffective) {
      // 「温泉」はNearby Searchだけだとvilla等の宿泊専用施設が混じりやすいため、
      // 地域名+「日帰り温泉」等のText Searchを優先し、宿泊専用と思われる施設名を除外する
      // (セクション7)。
      const areaLabel = resolvedPlanningAreaEffective.label;
      const results = await Promise.all(
        ONSEN_TEXT_QUERIES.map((query) =>
          searchPlaceByText(`${areaLabel} ${query}`, MAX_PLACE_CANDIDATES, {
            center: anchor,
            radiusMeters: PLACE_SEARCH_RADIUS_METERS,
          })
        )
      );
      const seen = new Set<string>();
      for (const outcome of results) {
        if (!outcome.ok) {
          continue;
        }
        for (const place of outcome.places) {
          if (seen.has(place.id) || LODGING_ONLY_PATTERN.test(place.name)) {
            continue;
          }
          seen.add(place.id);
          places.push(place);
        }
      }
      places = places.slice(0, MAX_PLACE_CANDIDATES);
    } else {
      const outcome = await searchNearbyPlaces({
        center: anchor,
        radiusMeters: PLACE_SEARCH_RADIUS_METERS,
        category,
        maxResults: MAX_PLACE_CANDIDATES,
      });
      if (outcome.ok) {
        places = outcome.places;
      }
    }

    if (places.length === 0) {
      pushItem({
        kind: 'message',
        id: nextItemId(),
        role: 'assistant',
        content: '近くで実在する候補が見つかりませんでした。エリアや希望を変えて相談してみてください。',
      });
      return;
    }
    const candidates: PlaceCandidateWithEstimate[] = places.map((place) => {
      const { extraMinutes, extraDistanceKm } = estimateDetour(anchor, {
        latitude: place.latitude,
        longitude: place.longitude,
      });
      return { ...place, extraMinutes, extraDistanceKm };
    });
    pushItem({ kind: 'placeCandidates', id: nextItemId(), category, candidates });
  };

  const applyPlanUpdates = async (
    updates: TripChatPlanUpdates,
    nextAction: NextAction,
    placeSearchCategory: PlaceSearchCategoryForChat | undefined,
    now: number
  ) => {
    let nextOrigin = origin;
    let nextDestination = destination;
    const nextAreaQuery = updates.areaQuery ?? areaQuery;
    const nextTimeBudgetMinutes = updates.timeBudgetMinutes ?? timeBudgetMinutes;
    const nextDateText = updates.dateText ?? dateText;
    const nextAvoidHighways = updates.avoidHighways ?? avoidHighways;

    let nextThemes = themes;
    if (updates.addThemes.length > 0 || updates.removeThemes.length > 0) {
      const removed = new Set(updates.removeThemes);
      nextThemes = [...new Set([...themes.filter((theme) => !removed.has(theme)), ...updates.addThemes])];
    }

    // areaQueryが今回のターンで新しく届いた場合は、useEffectの非同期反映を待たず、
    // このターン内でplanning areaを解決する(同じメッセージで地域と目的地を同時に
    // 指定した場合に、destinationQuery/biasAreaQueryの検証が古いareaを見てしまう
    // レースコンディションの修正)。resolvedAreaQueryRefで、この後のuseEffectが
    // 同じqueryを二重解決しないようにする(API呼び出しの無駄を避ける)。
    let nextResolvedPlanningArea = resolvedPlanningAreaEffective;
    if (updates.areaQuery && updates.areaQuery !== areaQuery) {
      nextResolvedPlanningArea = await resolvePlanningArea(updates.areaQuery);
      resolvedAreaQueryRef.current = updates.areaQuery;
      setResolvedPlanningArea(nextResolvedPlanningArea);
    }
    const areaLocationBias = nextResolvedPlanningArea
      ? { center: nextResolvedPlanningArea.center, radiusMeters: nextResolvedPlanningArea.radiusMeters }
      : undefined;

    if (updates.useHomeAsOrigin && homeLocation) {
      nextOrigin = homeLocation;
    } else if (updates.defaultOriginQuery) {
      const placeOutcome = await searchPlaceByText(updates.defaultOriginQuery);
      if (placeOutcome.ok && placeOutcome.places.length > 0) {
        const place = placeOutcome.places[0];
        nextOrigin = { label: place.name, coordinates: { latitude: place.latitude, longitude: place.longitude } };
      }
    }
    if (updates.destinationQuery) {
      const placeOutcome = await searchPlaceByText(updates.destinationQuery, 1, areaLocationBias);
      if (placeOutcome.ok && placeOutcome.places.length > 0) {
        const place = placeOutcome.places[0];
        const mismatchesArea =
          Boolean(nextResolvedPlanningArea?.prefecture) && Boolean(place.prefecture) && place.prefecture !== nextResolvedPlanningArea?.prefecture;
        if (mismatchesArea) {
          // 指定した地域外の場所にText Searchがマッチした場合、架空の代替で埋めず
          // 単に採用しない(Hard Constraint違反の目的地を送らない、セクション4)。
          if (__DEV__) {
            console.warn('[drive-plan-chat] destinationQuery resolved outside planning area, discarding');
          }
        } else {
          nextDestination = { label: place.name, coordinates: { latitude: place.latitude, longitude: place.longitude } };
        }
      }
    }

    // 出発地点・目的地とは別の強い地理的希望(例:「室戸岬の方に行きたい」)は、実在確認
    // してからdrive-route-plannerのbiasPointとして渡す(AIは検索意図の文字列のみ返す)。
    let nextBiasPoint: Coordinates | undefined;
    if (updates.biasAreaQuery) {
      const placeOutcome = await searchPlaceByText(updates.biasAreaQuery, 1, areaLocationBias);
      if (placeOutcome.ok && placeOutcome.places.length > 0) {
        const place = placeOutcome.places[0];
        const mismatchesArea =
          Boolean(nextResolvedPlanningArea?.prefecture) && Boolean(place.prefecture) && place.prefecture !== nextResolvedPlanningArea?.prefecture;
        if (!mismatchesArea) {
          nextBiasPoint = { latitude: place.latitude, longitude: place.longitude };
        } else if (__DEV__) {
          console.warn('[drive-plan-chat] biasAreaQuery resolved outside planning area, discarding');
        }
      }
    }

    // optional stopの差分操作(セクション8・10・11: 状態を失わない、個別id管理)。
    // originまたはareaQueryが実際に変わった場合のみ、新しい計画の開始とみなしてリセットする。
    // それ以外(テーマ追加・時間変更・候補選択後の再生成等)はselectedStopsを維持する。
    let nextStops = selectedStops;
    let preserveOptionalOrderForThisGeneration = false;
    const originChanged = nextOrigin !== undefined && nextOrigin.label !== origin?.label;
    const areaChanged = nextAreaQuery !== areaQuery;
    if (originChanged || areaChanged) {
      nextStops = [];
    } else {
      if (updates.removeStopIds.length > 0) {
        const removeSet = new Set(updates.removeStopIds);
        nextStops = nextStops.filter((stop) => !removeSet.has(stop.id));
      }
      if (updates.reorderStopIds.length > 0) {
        const currentIds = new Set(nextStops.map((stop) => stop.id));
        const isValidPermutation =
          updates.reorderStopIds.length === nextStops.length &&
          new Set(updates.reorderStopIds).size === updates.reorderStopIds.length &&
          updates.reorderStopIds.every((id) => currentIds.has(id));
        if (isValidPermutation) {
          const byId = new Map(nextStops.map((stop) => [stop.id, stop]));
          nextStops = updates.reorderStopIds.map((id) => byId.get(id) as SelectedStop);
          preserveOptionalOrderForThisGeneration = true;
        }
      }
    }
    if (nextStops !== selectedStops) {
      setSelectedStops(nextStops);
    }

    setAreaQuery(nextAreaQuery);
    setOrigin(nextOrigin);
    setDestination(nextDestination);
    setThemes(nextThemes);
    setTimeBudgetMinutes(nextTimeBudgetMinutes);
    setDateText(nextDateText);
    setAvoidHighways(nextAvoidHighways);

    if (nextAction === 'search_places' && placeSearchCategory && nextOrigin) {
      // カテゴリの実在候補を求めているだけなので、まだルートは再生成しない
      // (ユーザーがカードから選んでから初めてwaypointへ加える)。
      await performPlaceSearch(placeSearchCategory, nextOrigin);
      return;
    }

    if ((nextAction === 'generate_routes' || nextAction === 'modify_routes') && nextOrigin) {
      // 「高知県でドライブ」なのに出発地点(自宅)が明らかに範囲外の場合、勝手にルートを
      // 作らず、移動も含めるか・現地に着いてから探すかを確認する(セクション4)。
      // このターン内で解決したnextResolvedPlanningArea(まだstateに反映されていない
      // 可能性がある)を使う(レースコンディション修正)。
      const confirmationKey = nextResolvedPlanningArea
        ? `${nextResolvedPlanningArea.label}|${nextOrigin.label}`
        : null;
      const isOutsideArea =
        nextResolvedPlanningArea !== undefined &&
        haversineDistanceKm(nextOrigin.coordinates, nextResolvedPlanningArea.center) * 1000 >
          nextResolvedPlanningArea.radiusMeters * AREA_OUTSIDE_CONFIRM_RATIO;
      if (isOutsideArea && nextResolvedPlanningArea && confirmedAreaKeyRef.current !== confirmationKey) {
        pushItem({
          kind: 'message',
          id: nextItemId(),
          role: 'assistant',
          content: `自宅から${nextResolvedPlanningArea.label}までの移動も含めますか? それとも${nextResolvedPlanningArea.label}に着いてからのドライブを探しますか?`,
        });
        setQuickReplies([TRAVEL_INCLUDE_REPLY, TRAVEL_LOCAL_REPLY]);
        setPendingAreaConfirmation({
          areaLabel: nextResolvedPlanningArea.label,
          nextOrigin: { label: nextOrigin.label, coordinates: { ...nextOrigin.coordinates } },
          nextDestination: nextDestination ? { label: nextDestination.label, coordinates: { ...nextDestination.coordinates } } : undefined,
          nextThemes,
          nextAvoidHighways,
          nextTimeBudgetMinutes,
          nextBiasPoint,
        });
        return;
      }
      if (confirmationKey) {
        confirmedAreaKeyRef.current = confirmationKey;
      }
      // modify_routes(「候補選択を踏まえた再構成」)かつ、目的地変更・出発地点変更・地域変更を
      // 伴わない場合のみ、選択中Routeのanchorを維持する。generate_routes(「海沿い多めに」等の
      // 条件全体の変更)は従来どおりゼロから作り直す(セクション17〜19)。
      const shouldPreserveActiveRoute =
        nextAction === 'modify_routes' && !updates.destinationQuery && !originChanged && !areaChanged;
      await generateRoutes(
        nextOrigin,
        nextDestination,
        nextThemes,
        nextAvoidHighways,
        nextTimeBudgetMinutes,
        nextBiasPoint,
        nextStops,
        preserveOptionalOrderForThisGeneration,
        nextResolvedPlanningArea,
        shouldPreserveActiveRoute ? getPreservedAnchorsForActiveRoute() : [],
        shouldPreserveActiveRoute
      );
      return;
    }

    if (nextAction === 'save' && nextOrigin && routeOptions.length > 0) {
      await persistPlan(nextOrigin, nextDestination, nextAreaQuery, nextDateText, nextThemes, now);
    }
    // 'ask' / 'chat' はここまでの状態更新だけで、追加のアクションは行わない。
  };

  /** area外confirmationのquick replyへの回答を処理する(AIへは戻さず、クライアントだけで解決する)。 */
  const handleAreaConfirmationReply = async (reply: string) => {
    const pending = pendingAreaConfirmation;
    if (!pending) {
      return;
    }
    setPendingAreaConfirmation(null);
    setQuickReplies([]);
    pushItem({ kind: 'message', id: nextItemId(), role: 'user', content: reply });
    confirmedAreaKeyRef.current = `${pending.areaLabel}|${pending.nextOrigin.label}`;

    let finalOrigin = pending.nextOrigin;
    if (reply === TRAVEL_LOCAL_REPLY) {
      // 自宅座標を無理にoriginとして使わず、現地の実在する代表地点(駅等)を新しいoriginにする。
      const stationOutcome = await searchPlaceByText(`${pending.areaLabel}駅`);
      if (stationOutcome.ok && stationOutcome.places.length > 0) {
        const place = stationOutcome.places[0];
        finalOrigin = { label: place.name, coordinates: { latitude: place.latitude, longitude: place.longitude } };
      } else if (resolvedPlanningAreaEffective) {
        finalOrigin = { label: resolvedPlanningAreaEffective.label, coordinates: resolvedPlanningAreaEffective.center };
      }
      setOrigin(finalOrigin);
      setSelectedStops([]);
    }

    await generateRoutes(
      finalOrigin,
      pending.nextDestination,
      pending.nextThemes,
      pending.nextAvoidHighways,
      pending.nextTimeBudgetMinutes,
      pending.nextBiasPoint,
      reply === TRAVEL_LOCAL_REPLY ? [] : selectedStops
    );
  };

  /**
   * 実際にサーバーへ送るのはここだけ(手動入力・クイック返信・再試行の3経路すべてがここを通る)。
   * requestSeqRefで「自分が最新のリクエストか」を確認してから結果を反映する
   * (sendLockRefによる直列化で通常は競合しないが、防御的な二重チェックとして残す)。
   */
  const performChatRequest = async (trimmedMessages: TripChatClientMessage[], now: number) => {
    lastSentMessagesRef.current = trimmedMessages;
    const mySeq = ++requestSeqRef.current;

    const outcome = await requestTripChat({ messages: trimmedMessages, context: buildContext() });
    if (requestSeqRef.current !== mySeq) {
      // より新しいリクエストが既に発行されている(通常は起こらないが念のため)。この古い応答は捨てる。
      return;
    }

    if (outcome.ok) {
      const result: TripChatResult = outcome.result;
      pushItem({ kind: 'message', id: nextItemId(), role: 'assistant', content: result.assistantMessage });
      setQuickReplies(result.suggestedQuickReplies);

      // AIのnextAction/destinationQuery判定だけに任せず、選択済みRouteがある場合は
      // client側でも「このルートで」等の明示的なmodify意図と、目的地変更の明示表現の
      // 有無をチェックして上書きする(セクション39・40。AIが「温泉追加して」を誤って
      // destinationQueryへ反映した場合でも、主目的地を勝手に置き換えない)。
      const lastUserText = trimmedMessages[trimmedMessages.length - 1]?.content ?? '';
      let effectiveNextAction = result.nextAction;
      let effectivePlanUpdates = result.planUpdates;
      if (selectedRoute && result.nextAction !== 'search_places') {
        if (result.planUpdates.destinationQuery && !EXPLICIT_DESTINATION_CHANGE_PATTERN.test(lastUserText)) {
          effectivePlanUpdates = { ...result.planUpdates, destinationQuery: undefined };
          effectiveNextAction = 'modify_routes';
        } else if (result.nextAction === 'generate_routes' && CURRENT_ROUTE_INTENT_PATTERN.test(lastUserText)) {
          effectiveNextAction = 'modify_routes';
        }
      }

      await applyPlanUpdates(effectivePlanUpdates, effectiveNextAction, result.placeSearchCategory, now);
    } else {
      pushItem({ kind: 'error', id: nextItemId(), message: 'うまく接続できませんでした。', retryable: true });
    }
  };

  const sendMessage = async (text: string, now: number) => {
    const trimmedText = text.trim();
    if (!trimmedText || sendLockRef.current) {
      return;
    }
    sendLockRef.current = true;
    setSending(true);
    setSavedNotice(false);
    // 自由入力で会話を続けた場合、area外confirmationの保留状態は破棄する(古いnextOriginを
    // 使った意図しない再生成を防ぐ)。
    setPendingAreaConfirmation(null);

    pushItem({ kind: 'message', id: nextItemId(), role: 'user', content: trimmedText });
    setDraft('');
    setQuickReplies([]);

    try {
      // 直近のuserメッセージだけをサーバーへ送る文脈として使う(messageアイテムのみ抽出)。
      const messageItems = [...items, { kind: 'message' as const, id: '', role: 'user' as const, content: trimmedText }].filter(
        (item): item is Extract<ChatItem, { kind: 'message' }> => item.kind === 'message'
      );
      const trimmedMessages: TripChatClientMessage[] = messageItems
        .slice(-MAX_CLIENT_MESSAGES)
        .map((item) => ({ role: item.role, content: item.content }));
      await performChatRequest(trimmedMessages, now);
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  /** 直前に失敗したリクエストだけを再送する。ユーザーメッセージは追加しない(二重追加防止)。 */
  const retryLastMessage = async (now: number) => {
    const lastMessages = lastSentMessagesRef.current;
    if (!lastMessages || sendLockRef.current) {
      return;
    }
    sendLockRef.current = true;
    setSending(true);

    try {
      await performChatRequest(lastMessages, now);
    } finally {
      sendLockRef.current = false;
      setSending(false);
    }
  };

  const handleManualSave = (now: number) => {
    if (!origin) {
      return;
    }
    void persistPlan(origin, destination, areaQuery, dateText, themes, now);
  };

  const handleNavigate = () => {
    if (!origin || !selectedRoute) {
      return;
    }
    const allWaypoints = selectedRoute.waypoints.map((wp) => wp.coordinates);
    const destinationCoordinates = allWaypoints[allWaypoints.length - 1] ?? origin.coordinates;
    const throughWaypoints = allWaypoints.slice(0, -1);
    void openGoogleMapsNavigation({
      origin: origin.coordinates,
      waypoints: throughWaypoints,
      destination: destinationCoordinates,
      avoidHighways: selectedRoute.avoidHighwaysApplied,
    });
  };

  const handleAddNearbySuggestion = async (suggestion: RouteNearbySuggestion) => {
    if (!origin || addingSuggestion) {
      return;
    }
    setAddingSuggestion(true);
    const newStop: SelectedStop = {
      id: nextStopId(),
      placeId: suggestion.id,
      category: guessCategoryFromPrimaryType(suggestion.primaryType),
      addedOrder: stopOrderRef.current++,
      displayName: suggestion.name,
      coordinates: suggestion.coordinates,
    };
    const nextStops = [...selectedStops, newStop];
    setSelectedStops(nextStops);
    // 「このルートの近く」からの追加も、選択中のRouteを維持したまま1点足す操作として扱う。
    await generateRoutes(
      origin,
      destination,
      themes,
      avoidHighways,
      timeBudgetMinutes,
      undefined,
      nextStops,
      false,
      resolvedPlanningAreaEffective,
      getPreservedAnchorsForActiveRoute(),
      true
    );
    setAddingSuggestion(false);
  };

  /** placeCandidatesカードで「ここに寄る」を押した時の処理。AIには戻さず、直接waypointへ加えてルートを組み直す。 */
  const handleSelectPlaceCandidate = async (
    itemId: string,
    category: PlaceSearchCategoryForChat,
    candidate: PlaceCandidateWithEstimate
  ) => {
    if (!origin || addingSuggestion) {
      return;
    }
    setAddingSuggestion(true);
    setItems((prev) =>
      prev.map((item) => (item.kind === 'placeCandidates' && item.id === itemId ? { ...item, resolvedName: candidate.name } : item))
    );
    const newStop: SelectedStop = {
      id: nextStopId(),
      placeId: candidate.id,
      category,
      addedOrder: stopOrderRef.current++,
      displayName: candidate.name,
      coordinates: { latitude: candidate.latitude, longitude: candidate.longitude },
    };
    const nextStops = [...selectedStops, newStop];
    setSelectedStops(nextStops);
    // 候補カードからの追加は必ず「選択中のRouteを維持したまま1点足す」操作として扱う
    // (新しいRouteをゼロから作り直さない、実機で「温泉を追加したら選択していたRouteが
    // 失われた」不具合の修正)。
    await generateRoutes(
      origin,
      destination,
      themes,
      avoidHighways,
      timeBudgetMinutes,
      undefined,
      nextStops,
      false,
      resolvedPlanningAreaEffective,
      getPreservedAnchorsForActiveRoute(),
      true
    );
    setAddingSuggestion(false);
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottomRef.current = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
  };

  const composerPlaceholder = resolveComposerPlaceholder({
    hasAreaQuery: Boolean(areaQuery),
    hasOrigin: Boolean(origin),
    hasThemes: themes.length > 0,
    hasRouteOptions: routeOptions.length > 0,
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title="ドライブ計画をAIに相談" onBack={() => router.back()} />

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          onScroll={handleScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (isNearBottomRef.current) {
              listRef.current?.scrollToEnd({ animated: true });
            }
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                どこでドライブを探しますか? 「高知県」「熊本市」のように、行きたい地域を自由に教えてください。
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'message') {
              return (
                <View style={[styles.bubble, item.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
                  <Text style={item.role === 'user' ? styles.bubbleUserText : styles.bubbleAssistantText}>{item.content}</Text>
                </View>
              );
            }

            if (item.kind === 'error') {
              return (
                <View style={styles.errorCard}>
                  <Text style={styles.errorCardText}>{item.message}</Text>
                  {item.retryable && (
                    <Pressable
                      onPress={() => retryLastMessage(Date.now())}
                      disabled={sending}
                      style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                      accessibilityRole="button"
                      accessibilityLabel="もう一度試す">
                      <Text style={styles.retryButtonText}>もう一度試す</Text>
                    </Pressable>
                  )}
                </View>
              );
            }

            if (item.kind === 'placeCandidates') {
              return (
                <PlaceCandidatesBlock
                  category={item.category}
                  candidates={item.candidates}
                  resolvedName={item.resolvedName}
                  disabled={addingSuggestion}
                  themes={themes}
                  onSelect={(candidate) => handleSelectPlaceCandidate(item.id, item.category, candidate)}
                />
              );
            }

            // item.kind === 'proposal'
            const isLatest = latestProposalItem?.id === item.id;
            if (!isLatest) {
              return (
                <PastProposalSummary
                  proposal={item.proposal}
                  expanded={expandedPastProposalId === item.id}
                  onToggle={() => setExpandedPastProposalId((prev) => (prev === item.id ? null : item.id))}
                />
              );
            }

            if (!origin || !selectedRoute) {
              return null;
            }
            return (
              <View style={styles.proposalArea}>
                <DriveMapView
                  ref={mapRef}
                  style={styles.map}
                  initialRegion={mapInitialRegion}
                  markers={buildMarkers(origin, destination, selectedRoute)}
                  polyline={selectedRoute.path}
                  contentKey={selectedRoute.id}
                  onMapReady={() => setMapReady(true)}
                />

                {routeOptions.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.courseRow}>
                    {routeOptions.map((route, index) => (
                      <OptionChip
                        key={route.id}
                        label={route.name || `コース${index + 1}`}
                        selected={route.id === selectedRouteId}
                        onPress={() => updateLatestSelectedRoute(route.id)}
                      />
                    ))}
                  </ScrollView>
                )}

                <RouteProposalCard
                  route={selectedRoute}
                  origin={origin}
                  themeLabels={themes.map((theme) => THEME_LABELS[theme])}
                  saving={saving}
                  saved={savedNotice}
                  onSave={() => handleManualSave(Date.now())}
                  onNavigate={handleNavigate}
                  onAddNearbySuggestion={handleAddNearbySuggestion}
                  addingSuggestion={addingSuggestion}
                />
              </View>
            );
          }}
          ListFooterComponent={
            <View style={styles.footerContent}>
              {sending && <Text style={styles.subtleText}>考えています…</Text>}
              {generatingRoutes && (
                <LoadingState message={buildRouteGeneratingMessage(themes, resolvedPlanningAreaEffective?.label)} />
              )}
            </View>
          }
        />

        {quickReplies.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.quickReplyScroll}
            contentContainerStyle={styles.quickReplyRow}>
            {quickReplies.map((reply, index) => (
              <QuickReplyChip
                key={`${reply}-${index}`}
                label={reply}
                onPress={() => (pendingAreaConfirmation ? handleAreaConfirmationReply(reply) : sendMessage(reply, Date.now()))}
                disabled={sending}
              />
            ))}
          </ScrollView>
        )}

        <View style={styles.inputRow}>
          <TextInput
            ref={inputRef}
            style={styles.textField}
            value={draft}
            onChangeText={setDraft}
            placeholder={composerPlaceholder}
            placeholderTextColor={Colors.textTertiary}
            multiline
            blurOnSubmit={false}
            accessibilityLabel="AIへのメッセージ"
          />
          <Pressable
            onPress={() => sendMessage(draft, Date.now())}
            disabled={sending || draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="送信"
            style={({ pressed }) => [
              styles.sendButton,
              (sending || draft.trim().length === 0) && styles.sendButtonDisabled,
              pressed && styles.sendButtonPressed,
            ]}>
            <Text style={styles.sendButtonText}>{sending ? '…' : '送信'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function buildMarkers(origin: PlaceSelection, destination: PlaceSelection | undefined, route: RouteOption): MapMarkerSpec[] {
  const markers: MapMarkerSpec[] = [{ id: 'origin', coordinate: origin.coordinates, title: `出発: ${origin.label}`, color: Colors.success }];
  route.waypoints.forEach((waypoint, index) => {
    const isLast = index === route.waypoints.length - 1;
    markers.push({
      id: `waypoint-${index}`,
      coordinate: waypoint.coordinates,
      title: waypoint.name,
      color: isLast ? Colors.accentRed : Colors.accentBlue,
    });
  });
  if (destination) {
    markers.push({ id: 'destination', coordinate: destination.coordinates, title: `目的地: ${destination.label}`, color: Colors.accentRed });
  }
  return markers;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  messageList: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    gap: Spacing.sm - 2,
  },
  emptyBox: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSubtle,
    padding: Spacing.lg,
  },
  emptyText: {
    fontSize: Typography.body.fontSize,
    lineHeight: 21,
    color: Colors.textSecondary,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: Radius.lg - 2,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 1,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.accentBlue,
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surfaceElevated,
  },
  bubbleUserText: {
    color: Colors.onAccent,
    fontSize: Typography.body.fontSize,
    lineHeight: 20,
  },
  bubbleAssistantText: {
    color: Colors.textPrimary,
    fontSize: Typography.body.fontSize,
    lineHeight: 20,
  },
  footerContent: {
    gap: Spacing.md,
    paddingTop: Spacing.sm,
  },
  subtleText: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  errorCard: {
    borderRadius: Radius.md,
    backgroundColor: Colors.accentRedMuted,
    borderWidth: 1,
    borderColor: Colors.accentRed,
    padding: Spacing.md,
    gap: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorCardText: {
    flex: 1,
    fontSize: Typography.secondary.fontSize,
    lineHeight: 18,
    color: Colors.accentRed,
  },
  retryButton: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.accentRed,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  retryButtonPressed: {
    opacity: 0.7,
  },
  retryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accentRed,
  },
  pastProposalBox: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSubtle,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  pastProposalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  pastProposalLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  pastProposalToggle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
  pastProposalDetail: {
    gap: 4,
  },
  pastProposalRouteLine: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  placeCandidatesBox: {
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  placeCandidatesLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  placeCandidatesNote: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  placeCandidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    borderRadius: Radius.sm + 2,
    backgroundColor: Colors.surfaceSubtle,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm + 2,
  },
  placeCandidateTextGroup: {
    flex: 1,
    gap: 2,
  },
  placeCandidateName: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  placeCandidateMeta: {
    fontSize: 11,
    color: Colors.textTertiary,
  },
  placeCandidateButton: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentBlue,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  placeCandidateButtonPressed: {
    opacity: 0.8,
  },
  placeCandidateButtonDisabled: {
    opacity: 0.4,
  },
  placeCandidateButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.onAccent,
  },
  placeCandidateSelectedText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.success,
  },
  proposalArea: {
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm + 2,
  },
  map: {
    height: 180,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  courseRow: {
    paddingVertical: 2,
  },
  quickReplyScroll: {
    // 高さを固定し、キーボード開閉でこの行の縦スペースが変化してもchip自体は
    // 伸び縮みしないようにする(実機で確認された「keyboardを閉じるとchipが
    // 縦長の丸ボタンになる」不具合への対処)。
    height: 46,
    flexGrow: 0,
    flexShrink: 0,
  },
  quickReplyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    paddingTop: Spacing.xs,
  },
  textField: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.divider,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg - 2,
    paddingVertical: Spacing.sm + 2,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  sendButton: {
    minWidth: 60,
    minHeight: 46,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg - 2,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonPressed: {
    opacity: 0.85,
  },
  sendButtonText: {
    color: Colors.onAccent,
    fontSize: 15,
    fontWeight: '700',
  },
});
