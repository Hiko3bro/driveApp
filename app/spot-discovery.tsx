import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DriveMapView, type DriveMapViewHandle, type MapMarkerSpec } from '@/components/map/drive-map-view';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { OptionChip } from '@/components/ui/option-chip';
import { PlaceActionButtons } from '@/components/ui/place-action-buttons';
import { PlacePhotoHero } from '@/components/ui/place-photo-hero';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { DEMO_MAP_REGION, isValidMapRegion } from '@/services/location/coordinates';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { buildGoogleMapsPlaceUrl, buildWebSearchUrl, openExternalUrl } from '@/services/navigation/google-maps-view';
import { computeRegionForPath } from '@/services/location/route-map-region';
import {
  getSpotProvider,
  resolvePreferredSpotCategory,
  SPOT_CATEGORY_TO_PLACE_CATEGORY,
  SpotDiscoveryError,
  type PlaceSearchCategory,
} from '@/services/spot';
import { calculateSpotRoutePlan, SpotRoutePlanError } from '@/services/spot/spot-route-plan';
import { formatMinutesLabel } from '@/types/drive';
import type { MapRegion } from '@/types/location';
import type { RouteOption } from '@/types/route';
import {
  MAX_SELECTED_SPOTS,
  SPOT_BROWSE_FILTERS,
  type Spot,
  type SpotBrowseFilter,
  type SpotRoutePlan,
} from '@/types/spot';

const CARD_MARGIN = 16;
const CARD_GAP = 12;
const CAMERA_ANIMATION_MS = 450;

function resolveRoute(routes: RouteOption[], selectedRouteId: string | null): RouteOption | null {
  if (routes.length === 0) {
    return null;
  }
  return routes.find((route) => route.id === selectedRouteId) ?? routes[0];
}

function resolveSpotIndex(spots: Spot[], selectedSpotId: string | null): number {
  if (spots.length === 0) {
    return -1;
  }
  const index = spots.findIndex((spot) => spot.id === selectedSpotId);
  return index >= 0 && index < spots.length ? index : 0;
}

function resolveSpotsByIds(spots: Spot[], spotIds: string[]): Spot[] {
  const spotById = new Map(spots.map((spot) => [spot.id, spot]));
  return spotIds.flatMap((id) => {
    const spot = spotById.get(id);
    return spot ? [spot] : [];
  });
}

export default function SpotDiscoveryScreen() {
  const {
    departure,
    conditions,
    routes,
    selectedRouteId,
    spotRouteId,
    spots,
    selectedSpotId,
    selectedSpotIds,
    initializeSpotDiscovery,
    setSelectedSpotId,
    clearSelectedSpotId,
    setSelectedSpotIds,
    aiInterpretation,
  } = useDriveFlow();
  const route = useMemo(() => resolveRoute(routes, selectedRouteId), [routes, selectedRouteId]);
  const provider = useMemo(() => getSpotProvider(), []);
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.max(260, screenWidth - CARD_MARGIN * 2 - 20);
  const cardStride = cardWidth + CARD_GAP;

  const mapRef = useRef<DriveMapViewHandle>(null);
  const cardScrollRef = useRef<ScrollView>(null);
  const isFocusedRef = useRef(false);
  const navigationInFlightRef = useRef(false);
  const framedKeyRef = useRef<string | null>(null);
  // ユーザーが手動で操作した後も含め、地図に今表示されているregion(ズーム量含む)を保持する。
  // マーカー/カード選択時はこれを使い、全体表示へ戻さずズームを維持したまま選択地点へ寄せる。
  const currentRegionRef = useRef<MapRegion | null>(null);
  // カテゴリはオンデマンド取得(タップされたときだけGoogle Placesへ問い合わせる)。
  // 取得済み/取得中のGoogleカテゴリをルート単位で管理し、同じカテゴリを重複取得しない。
  const fetchedCategoriesRef = useRef<Set<PlaceSearchCategory>>(new Set());
  const inFlightCategoriesRef = useRef<Set<PlaceSearchCategory>>(new Set());
  const currentRouteIdRef = useRef<string | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<SpotBrowseFilter>('おすすめ');
  // 現在オンデマンドで取得中のGoogleカテゴリ(1件のみ追跡、UIの簡易インジケーター用)。
  const [pendingCategory, setPendingCategory] = useState<PlaceSearchCategory | null>(null);
  // 直近のオンデマンド取得(初回以外)が失敗した場合のメッセージ。画面全体は止めない。
  const [categoryFetchError, setCategoryFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!departure) {
      router.replace('/departure');
      return;
    }
    if (!conditions) {
      router.replace('/conditions');
      return;
    }
    if (!route) {
      router.replace('/route-compare');
    }
  }, [departure, conditions, route]);

  const availableSpots = useMemo(
    () => (route && spotRouteId === route.id ? spots : []),
    [route, spotRouteId, spots]
  );
  const activeSelectedSpotIds = useMemo(
    () => (route && spotRouteId === route.id ? selectedSpotIds : []),
    [route, spotRouteId, selectedSpotIds]
  );

  // ルートが切り替わったら、カテゴリごとの取得済み/取得中の記録をリセットする。
  useEffect(() => {
    if (route && currentRouteIdRef.current !== route.id) {
      currentRouteIdRef.current = route.id;
      fetchedCategoriesRef.current = new Set();
      inFlightCategoriesRef.current = new Set();
      setPendingCategory(null);
      setCategoryFetchError(null);
      setLoadError(null);
    }
  }, [route]);

  // 「おすすめ」チップはAI解釈の希望から優先カテゴリを導く。それ以外のチップは
  // Google Places側のcategory enumへそのままmappingする。
  const resolveGoogleCategory = useCallback(
    (filter: SpotBrowseFilter): PlaceSearchCategory =>
      filter === 'おすすめ'
        ? resolvePreferredSpotCategory(aiInterpretation?.preferences)
        : // SPOT_BROWSE_FILTERSは今すぐドライブ側の5カテゴリだけを含むため、このキャストは安全
          // (ドライブ計画専用に追加した'歴史'/'市場'はこの画面のチップには出てこない)。
          (SPOT_CATEGORY_TO_PLACE_CATEGORY[filter] as PlaceSearchCategory),
    [aiInterpretation]
  );

  // カテゴリチップがタップされた時点で、まだ取得していないカテゴリだけをオンデマンドで
  // Google Placesへ問い合わせる(空状態のまま放置しない)。取得結果はinitializeSpotDiscovery
  // が既存のspotsへマージするため、他カテゴリの選択状態は失われない。
  const ensureCategoryLoaded = useCallback(
    (filter: SpotBrowseFilter) => {
      if (!route) {
        return;
      }
      const category = resolveGoogleCategory(filter);
      if (fetchedCategoriesRef.current.has(category) || inFlightCategoriesRef.current.has(category)) {
        return;
      }
      inFlightCategoriesRef.current.add(category);

      const routeId = route.id;
      // このルートでまだ何も取得できていない(=画面が空)場合だけ、全画面の読み込み表示にする。
      const isFirstFetch = fetchedCategoriesRef.current.size === 0 && availableSpots.length === 0;
      if (isFirstFetch) {
        setLoading(true);
        setLoadError(null);
      } else {
        setPendingCategory(category);
        setCategoryFetchError(null);
      }

      void provider
        .getSpots({ route, category })
        .then((foundSpots) => {
          if (!isFocusedRef.current || currentRouteIdRef.current !== routeId) {
            return;
          }
          fetchedCategoriesRef.current.add(category);
          initializeSpotDiscovery(routeId, foundSpots);
          if (isFirstFetch) {
            setLoading(false);
          }
          setPendingCategory((current) => (current === category ? null : current));
        })
        .catch((error: unknown) => {
          if (!isFocusedRef.current || currentRouteIdRef.current !== routeId) {
            return;
          }
          const message =
            error instanceof SpotDiscoveryError
              ? error.message
              : 'スポットを準備できませんでした。もう一度お試しください。';
          if (isFirstFetch) {
            setLoadError(message);
            setLoading(false);
          } else {
            setCategoryFetchError(message);
          }
          setPendingCategory((current) => (current === category ? null : current));
        })
        .finally(() => {
          inFlightCategoriesRef.current.delete(category);
        });
    },
    [route, provider, initializeSpotDiscovery, resolveGoogleCategory, availableSpots.length]
  );

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      navigationInFlightRef.current = false;
      setIsNavigating(false);

      if (route) {
        ensureCategoryLoaded(selectedCategory);
      }

      return () => {
        isFocusedRef.current = false;
      };
    }, [route, ensureCategoryLoaded, selectedCategory])
  );
  // 「おすすめ」は絞り込まず、全カテゴリのスポットをそのまま表示する。
  const categorizedSpots = useMemo(
    () =>
      selectedCategory === 'おすすめ'
        ? availableSpots
        : availableSpots.filter((spot) => spot.category === selectedCategory),
    [availableSpots, selectedCategory]
  );
  const selectedIndex = resolveSpotIndex(categorizedSpots, selectedSpotId);
  const selectedSpot = selectedIndex >= 0 ? categorizedSpots[selectedIndex] : null;
  const selectedStops = useMemo(
    () => resolveSpotsByIds(availableSpots, activeSelectedSpotIds),
    [availableSpots, activeSelectedSpotIds]
  );

  const currentPlan = useMemo<SpotRoutePlan | null>(() => {
    if (!route || !conditions || selectedStops.length !== activeSelectedSpotIds.length) {
      return null;
    }
    try {
      return calculateSpotRoutePlan(route, selectedStops, conditions);
    } catch {
      return null;
    }
  }, [route, conditions, selectedStops, activeSelectedSpotIds.length]);

  const initialRegion = useMemo<MapRegion>(
    () => (route ? computeRegionForPath(route.path) : DEMO_MAP_REGION),
    [route]
  );

  useEffect(() => {
    if (!mapReady || !route || categorizedSpots.length === 0 || !isFocusedRef.current) {
      return;
    }
    // ルート・カテゴリの組み合わせごとに一度だけカメラを合わせ、
    // ユーザーが手動でパンした後は上書きしないようにする。
    const framingKey = `${route.id}:${selectedCategory}`;
    if (framedKeyRef.current === framingKey) {
      return;
    }
    framedKeyRef.current = framingKey;
    mapRef.current?.animateToRegion(
      computeRegionForPath([...route.path, ...categorizedSpots.map((spot) => spot.coordinates)]),
      CAMERA_ANIMATION_MS
    );
  }, [mapReady, route, categorizedSpots, selectedCategory]);

  useEffect(() => {
    cardScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [selectedCategory]);

  // 初回表示・カテゴリ切り替え時の全体表示(animateToRegionの結果含む)や
  // ユーザーの手動パン・ズームの結果を継続して記録する。マーカー/カード選択時は
  // このregionのズーム量(latitudeDelta/longitudeDelta)だけを引き継ぎ、
  // 全体表示へ戻すfitToCoordinates相当の処理を再発火させないようにする。
  const handleRegionChangeComplete = useCallback((region: MapRegion) => {
    if (isValidMapRegion(region)) {
      currentRegionRef.current = region;
    }
  }, []);

  const handleSelectSpot = useCallback(
    (spotId: string, scrollToCard: boolean) => {
      if (!route || spotRouteId !== route.id) {
        return;
      }
      const index = categorizedSpots.findIndex((spot) => spot.id === spotId);
      if (index < 0 || index >= categorizedSpots.length) {
        setSelectionError('選択したスポットを確認できませんでした。もう一度選んでください。');
        return;
      }

      const spot = categorizedSpots[index];
      setSelectedSpotId(route.id, spot.id);
      setSelectionError(null);
      if (scrollToCard) {
        cardScrollRef.current?.scrollTo({ x: index * cardStride, animated: true });
      }
      if (mapReady && isFocusedRef.current) {
        // 全体を収める計算(computeRegionForPath)はここでは使わない。現在のズーム量を
        // 保ったまま選択スポットへ軽くセンタリングするだけにとどめ、手動ズームを壊さない。
        const zoomRegion = currentRegionRef.current;
        const nextRegion: MapRegion = zoomRegion
          ? {
              latitude: spot.coordinates.latitude,
              longitude: spot.coordinates.longitude,
              latitudeDelta: zoomRegion.latitudeDelta,
              longitudeDelta: zoomRegion.longitudeDelta,
            }
          : computeRegionForPath([...route.path, spot.coordinates]);
        mapRef.current?.animateToRegion(nextRegion, CAMERA_ANIMATION_MS);
      }
    },
    [
      route,
      spotRouteId,
      categorizedSpots,
      setSelectedSpotId,
      cardStride,
      mapReady,
    ]
  );

  const handleDeselectSpot = useCallback(() => {
    if (!route || spotRouteId !== route.id) {
      return;
    }
    clearSelectedSpotId(route.id);
  }, [route, spotRouteId, clearSelectedSpotId]);

  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (categorizedSpots.length === 0 || !Number.isFinite(event.nativeEvent.contentOffset.x)) {
        return;
      }
      const rawIndex = Math.round(event.nativeEvent.contentOffset.x / cardStride);
      const index = Math.min(Math.max(rawIndex, 0), categorizedSpots.length - 1);
      const spot = categorizedSpots[index];
      if (spot) {
        handleSelectSpot(spot.id, false);
      }
    },
    [categorizedSpots, cardStride, handleSelectSpot]
  );

  const handleToggleStop = useCallback(
    (spotId: string) => {
      if (!route || !conditions || spotRouteId !== route.id) {
        return;
      }
      const spot = availableSpots.find((candidate) => candidate.id === spotId);
      if (!spot) {
        setSelectionError('スポット情報を確認できませんでした。もう一度選んでください。');
        return;
      }

      const isAdded = activeSelectedSpotIds.includes(spotId);
      if (!isAdded && activeSelectedSpotIds.length >= MAX_SELECTED_SPOTS) {
        setSelectionError(`寄るところは最大${MAX_SELECTED_SPOTS}件まで選べます。`);
        return;
      }

      const nextIds = isAdded
        ? activeSelectedSpotIds.filter((id) => id !== spotId)
        : [...activeSelectedSpotIds, spotId];
      const nextSpots = resolveSpotsByIds(availableSpots, nextIds);
      if (nextSpots.length !== nextIds.length) {
        setSelectionError('寄るところを更新できませんでした。もう一度選び直してください。');
        return;
      }

      try {
        // 時間予算超過(isWithinBudget === false)は非ブロッキングの警告として表示するだけで、
        // 寄るところの追加・削除自体は妨げない(実際の所要時間はroute-plan.tsxで
        // Google Routesにより再計算される)。
        const nextPlan = calculateSpotRoutePlan(route, nextSpots, conditions);
        setSelectedSpotIds(route.id, nextIds);
        setSelectionError(nextPlan.isWithinBudget ? null : nextPlan.budgetMessage);
      } catch (error: unknown) {
        setSelectionError(
          error instanceof SpotRoutePlanError
            ? error.message
            : '寄るところを更新できませんでした。もう一度お試しください。'
        );
      }
    },
    [
      route,
      conditions,
      spotRouteId,
      availableSpots,
      activeSelectedSpotIds,
      setSelectedSpotIds,
    ]
  );

  const handleReviewRoute = useCallback(() => {
    if (
      !route ||
      !conditions ||
      navigationInFlightRef.current ||
      activeSelectedSpotIds.length === 0
    ) {
      return;
    }

    const latestStops = resolveSpotsByIds(availableSpots, activeSelectedSpotIds);
    if (latestStops.length !== activeSelectedSpotIds.length) {
      setSelectionError('選んだ寄るところを確認できませんでした。もう一度選び直してください。');
      return;
    }

    try {
      // 時間予算超過は非ブロッキングの警告(route-plan.tsx側で表示)として扱い、
      // ここでは寄るところの構成に問題がないか(重複・座標不正等)だけを確認する。
      calculateSpotRoutePlan(route, latestStops, conditions);
    } catch (error: unknown) {
      setSelectionError(
        error instanceof SpotRoutePlanError
          ? error.message
          : '更新後のルートを確認できませんでした。もう一度お試しください。'
      );
      return;
    }

    navigationInFlightRef.current = true;
    setIsNavigating(true);
    router.push('/route-plan');
  }, [route, conditions, activeSelectedSpotIds, availableSpots]);

  if (!departure || !conditions || !route) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <LoadingState message="ルート周辺のスポットを探しています" />
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <EmptyState
            icon="alert-circle-outline"
            message={loadError}
            actionLabel="もう一度試す"
            onAction={() => ensureCategoryLoaded(selectedCategory)}
          />
          <PrimaryButton label="ルート確認に戻る" variant="secondary" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const selectedOrderById = new Map(activeSelectedSpotIds.map((id, index) => [id, index + 1]));
  const routeMarkers: MapMarkerSpec[] = [
    {
      id: 'departure',
      coordinate: departure.coordinates,
      title: `出発: ${departure.label}`,
      color: Colors.success,
    },
    ...route.waypoints.map((waypoint, index) => ({
      id: `route-waypoint-${index}`,
      coordinate: waypoint.coordinates,
      title: waypoint.name,
      color: Colors.textTertiary,
    })),
  ];
  const spotMarkers: MapMarkerSpec[] = categorizedSpots.map((spot) => {
    const order = selectedOrderById.get(spot.id);
    const isSelected = selectedSpot !== null && spot.id === selectedSpot.id;
    return {
      id: spot.id,
      coordinate: spot.coordinates,
      title: order ? `${order}. ${spot.name}` : spot.name,
      description: `${spot.category}・寄ると約${spot.extraMinutes}分${spot.isMock ? '・モック' : ''}`,
      color: isSelected ? Colors.accentRed : order ? Colors.success : Colors.accentBlue,
      // 選択中のMarkerを常に最前面へ。近距離のMarker同士が重なっても選択中のものを操作しやすくする。
      zIndex: isSelected ? 10 : order ? 5 : 1,
      // 選択中の同じMarkerを再タップした場合は選択解除、それ以外は選択/切り替え。
      onPress: () => (isSelected ? handleDeselectSpot() : handleSelectSpot(spot.id, true)),
    };
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.mapHeader}>
        <Text style={styles.routeLabel}>{route.name}</Text>
        {categorizedSpots.some((spot) => spot.isMock) && (
          <Text style={styles.mockNotice}>表示中のスポットにはテスト用のモックデータが含まれています</Text>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRow}>
        {SPOT_BROWSE_FILTERS.map((filter) => (
          <OptionChip
            key={filter}
            label={filter}
            selected={selectedCategory === filter}
            onPress={() => {
              setSelectedCategory(filter);
              ensureCategoryLoaded(filter);
            }}
          />
        ))}
      </ScrollView>

      <DriveMapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        markers={[...routeMarkers, ...spotMarkers]}
        polyline={route.path}
        contentKey={`spot-${route.id}-${selectedCategory}`}
        onMapReady={() => setMapReady(true)}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPress={handleDeselectSpot}
      />

      {categorizedSpots.length === 0 ? (
        <View style={styles.emptyCategoryBox}>
          {pendingCategory !== null && pendingCategory === resolveGoogleCategory(selectedCategory) ? (
            <LoadingState message="このカテゴリのスポットを探しています" />
          ) : categoryFetchError ? (
            <EmptyState
              icon="alert-circle-outline"
              message={categoryFetchError}
              actionLabel="もう一度試す"
              onAction={() => ensureCategoryLoaded(selectedCategory)}
            />
          ) : (
            <EmptyState
              icon="compass-outline"
              message="このカテゴリで寄れそうな場所は見つかりませんでした。他のカテゴリも見てみてください。"
            />
          )}
        </View>
      ) : (
        <ScrollView
          ref={cardScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardStride}
          decelerationRate="fast"
          contentContainerStyle={styles.cardList}
          onMomentumScrollEnd={handleScrollEnd}>
          {categorizedSpots.map((spot, index) => {
            const order = selectedOrderById.get(spot.id);
            return (
              <SpotCard
                key={spot.id}
                spot={spot}
                selected={selectedSpot !== null && spot.id === selectedSpot.id}
                selectedOrder={order}
                width={cardWidth}
                // 1画面1枚のpaging carouselのため、実際に見えているのは常に1枚(+前後の
                // スワイプ先候補)だけ。この2件だけをPhoto fetch対象にし、それ以外の
                // カテゴリ内の残り候補はスクロールで近づくまでfetchしない(真のlazy load、
                // 実機で「カテゴリを開いた瞬間に全候補分fetchされる」不具合の修正)。
                visible={Math.abs(index - selectedIndex) <= 1}
                photoPriority={index === selectedIndex ? 'high' : 'low'}
                onSelect={() => handleSelectSpot(spot.id, false)}
                onToggle={() => handleToggleStop(spot.id)}
              />
            );
          })}
        </ScrollView>
      )}

      <View style={styles.policyNotice}>
        <Text style={styles.policyText}>
          Googleの評価・口コミは表示していません。ナビ開始後、Googleマップ側で評価・口コミをご確認ください。
        </Text>
      </View>

      <View style={styles.footer}>
        {selectionError && <Text style={styles.errorText}>{selectionError}</Text>}
        <Text style={styles.planSummary}>
          寄るところ {activeSelectedSpotIds.length}/{MAX_SELECTED_SPOTS}
          {currentPlan ? ` ・ ${formatDistanceLabel(currentPlan.distanceKm)} ・ 約${formatMinutesLabel(currentPlan.durationMinutes)}` : ''}
        </Text>
        <PrimaryButton
          label={isNavigating ? 'ルートを確認しています…' : '寄り道を確認する'}
          onPress={handleReviewRoute}
          disabled={isNavigating || activeSelectedSpotIds.length === 0 || !currentPlan}
        />
      </View>
    </SafeAreaView>
  );
}

function SpotCard({
  spot,
  selected,
  selectedOrder,
  width,
  visible,
  photoPriority,
  onSelect,
  onToggle,
}: {
  spot: Spot;
  selected: boolean;
  selectedOrder: number | undefined;
  width: number;
  visible: boolean;
  photoPriority: 'high' | 'low';
  onSelect: () => void;
  onToggle: () => void;
}) {
  // 写真上(PlacePhotoHero)にcategory badge・Place名・短い説明を既に表示しているため、
  // 写真下では重複させず、素早く選べるために最も重要な追加時間・距離・CTAだけを見せる
  // (実機で「写真上下で名前・説明が二重表示され、追加時間が埋もれる」不具合の修正)。
  // 写真が無いmockデータのみ、下側にフォールバックの説明を表示する。
  return (
    <View style={[styles.card, { width }, selected && styles.cardSelected]}>
      <Pressable onPress={onSelect}>
        {!spot.isMock && (
          <PlacePhotoHero
            placeId={spot.id}
            name={spot.name}
            categoryLabel={spot.category}
            category={SPOT_CATEGORY_TO_PLACE_CATEGORY[spot.category]}
            description={spot.description}
            photoRef={spot.photoRef}
            visible={visible}
            priority={photoPriority}
            compact
          />
        )}
        {spot.isMock ? (
          <>
            <View style={styles.badgeRow}>
              <Text style={styles.categoryBadge}>{spot.category}</Text>
              <Text style={styles.mockBadge}>モック</Text>
              {selectedOrder && <Text style={styles.orderBadge}>寄るところ {selectedOrder}</Text>}
            </View>
            <Text style={styles.spotName}>{spot.name}</Text>
            <Text style={styles.extraTime}>寄ると約{spot.extraMinutes}分</Text>
            <Text style={styles.description}>{spot.description}</Text>
            <Text style={styles.recommendation}>{spot.recommendation}</Text>
          </>
        ) : (
          <View style={styles.leanInfoRow}>
            {selectedOrder && (
              <View style={styles.badgeRow}>
                <Text style={styles.orderBadge}>寄るところ {selectedOrder}</Text>
              </View>
            )}
            <Text style={styles.extraTime}>
              寄ると約{spot.extraMinutes}分{spot.extraDistanceKm ? `(往復約${spot.extraDistanceKm}km)` : ''}
            </Text>
          </View>
        )}
      </Pressable>
      <PlaceActionButtons
        compact
        primaryLabel=""
        onPrimaryPress={() => {}}
        placeName={spot.name}
        onGoogleMapsPress={() => {
          void openExternalUrl(buildGoogleMapsPlaceUrl({ name: spot.name, placeId: spot.id }));
        }}
        onWebPress={() => {
          void openExternalUrl(buildWebSearchUrl({ name: spot.name }));
        }}
      />
      <PrimaryButton
        label={selectedOrder ? '行くのをやめる' : 'ここ寄ってみる'}
        variant={selectedOrder ? 'secondary' : 'primary'}
        onPress={onToggle}
        style={styles.cardButton}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.lg,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  statusText: {
    fontSize: Typography.body.fontSize,
    lineHeight: 21,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  mapHeader: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: 2,
  },
  routeLabel: {
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  mockNotice: {
    fontSize: 11,
    color: Colors.warning,
  },
  categoryRow: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  emptyCategoryBox: {
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSubtle,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.sm + 2,
  },
  emptyCategoryText: {
    fontSize: Typography.secondary.fontSize,
    lineHeight: 19,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  map: {
    flex: 1,
    // 実機の小さい画面(iPhone SE等)でCard+注意文+footerと縦に競合し、footerが画面外へ
    // 押し出されて見えなくなる/詰まって見える不具合があったため、地図の最小高さを縮小して
    // 下側の要素に確実にスペースを譲る(セクション21)。
    minHeight: 130,
    margin: Spacing.lg,
    marginVertical: Spacing.sm,
  },
  cardList: {
    paddingHorizontal: CARD_MARGIN,
    gap: CARD_GAP,
    paddingVertical: 4,
  },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    padding: Spacing.md + 2,
    justifyContent: 'space-between',
  },
  cardSelected: {
    borderWidth: 1.5,
    borderColor: Colors.accentBlue,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs + 2,
    marginBottom: Spacing.sm - 1,
  },
  categoryBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accentBlue,
    backgroundColor: Colors.accentBlueMuted,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
  },
  mockBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.warning,
    backgroundColor: Colors.warningMuted,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
  },
  orderBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.success,
    backgroundColor: Colors.successMuted,
    borderRadius: Radius.pill,
    paddingVertical: 3,
    paddingHorizontal: Spacing.sm,
  },
  spotName: {
    fontSize: 17,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 3,
  },
  extraTime: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accentBlue,
    marginBottom: Spacing.sm - 2,
  },
  leanInfoRow: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textSecondary,
    marginBottom: 5,
  },
  recommendation: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textSecondary,
  },
  cardButton: {
    minHeight: 44,
    marginTop: Spacing.sm + 2,
  },
  policyNotice: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
    borderRadius: Radius.sm + 2,
    backgroundColor: Colors.surfaceSubtle,
    padding: Spacing.sm + 1,
  },
  policyText: {
    fontSize: 10,
    lineHeight: 15,
    color: Colors.textSecondary,
  },
  footer: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  planSummary: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.sm - 2,
  },
  errorText: {
    color: Colors.accentRed,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: Spacing.sm - 2,
  },
});
