import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { OptionChip } from '@/components/ui/option-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { DEMO_MAP_REGION, isValidMapRegion } from '@/services/location/coordinates';
import { computeRegionForPath } from '@/services/location/route-map-region';
import { getSpotProvider, SpotDiscoveryError } from '@/services/spot';
import { calculateSpotRoutePlan, SpotRoutePlanError } from '@/services/spot/spot-route-plan';
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
    setSelectedSpotIds,
  } = useDriveFlow();
  const route = useMemo(() => resolveRoute(routes, selectedRouteId), [routes, selectedRouteId]);
  const provider = useMemo(() => getSpotProvider(), []);
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.max(260, screenWidth - CARD_MARGIN * 2 - 20);
  const cardStride = cardWidth + CARD_GAP;

  const mapRef = useRef<DriveMapViewHandle>(null);
  const cardScrollRef = useRef<ScrollView>(null);
  const isFocusedRef = useRef(false);
  const requestIdRef = useRef(0);
  const navigationInFlightRef = useRef(false);
  const framedKeyRef = useRef<string | null>(null);
  // ユーザーが手動で操作した後も含め、地図に今表示されているregion(ズーム量含む)を保持する。
  // マーカー/カード選択時はこれを使い、全体表示へ戻さずズームを維持したまま選択地点へ寄せる。
  const currentRegionRef = useRef<MapRegion | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [selectedCategory, setSelectedCategory] = useState<SpotBrowseFilter>('おすすめ');

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

  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      navigationInFlightRef.current = false;
      setIsNavigating(false);

      if (!route) {
        return () => {
          isFocusedRef.current = false;
          requestIdRef.current += 1;
        };
      }

      if (spotRouteId === route.id && spots.length > 0) {
        setLoading(false);
        setLoadError(null);
        return () => {
          isFocusedRef.current = false;
          requestIdRef.current += 1;
        };
      }

      // 再試行の世代もrequest IDへ含め、古い完了結果と明確に区別する。
      const requestId = requestIdRef.current + 1 + reloadVersion;
      requestIdRef.current = requestId;
      setLoading(true);
      setLoadError(null);

      void provider
        .getSpots({ route })
        .then((foundSpots) => {
          const active = isFocusedRef.current && requestIdRef.current === requestId;
          if (!active) {
            return;
          }
          if (foundSpots.length === 0) {
            throw new SpotDiscoveryError(
              'ルート周辺に提案できるスポットがありませんでした。別のルートを選んでください。'
            );
          }
          initializeSpotDiscovery(route.id, foundSpots);
          setSelectedCategory('おすすめ');
          setLoading(false);
        })
        .catch((error: unknown) => {
          const active = isFocusedRef.current && requestIdRef.current === requestId;
          if (!active) {
            return;
          }
          setLoadError(
            error instanceof SpotDiscoveryError
              ? error.message
              : 'スポットを準備できませんでした。もう一度お試しください。'
          );
          setLoading(false);
        });

      return () => {
        isFocusedRef.current = false;
        requestIdRef.current += 1;
      };
    }, [route, spotRouteId, spots.length, provider, initializeSpotDiscovery, reloadVersion])
  );

  const availableSpots = useMemo(
    () => (route && spotRouteId === route.id ? spots : []),
    [route, spotRouteId, spots]
  );
  const activeSelectedSpotIds = useMemo(
    () => (route && spotRouteId === route.id ? selectedSpotIds : []),
    [route, spotRouteId, selectedSpotIds]
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
        const nextPlan = calculateSpotRoutePlan(route, nextSpots, conditions);
        if (!isAdded && !nextPlan.isWithinBudget) {
          setSelectionError(
            nextPlan.budgetMessage ?? '選んだ条件の時間内に収まりません。別のスポットを選んでください。'
          );
          return;
        }
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
      const latestPlan = calculateSpotRoutePlan(route, latestStops, conditions);
      if (!latestPlan.isWithinBudget) {
        setSelectionError(
          latestPlan.budgetMessage ?? '選んだ条件の時間内に収まりません。寄るところを見直してください。'
        );
        return;
      }
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
          <ActivityIndicator size="large" color="#0a7ea4" />
          <Text style={styles.statusText}>ルート周辺のスポットを準備しています…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError || availableSpots.length === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>スポットを表示できませんでした</Text>
          <Text style={styles.statusText}>
            {loadError ?? '別のルートを選ぶか、もう一度お試しください。'}
          </Text>
          <PrimaryButton label="もう一度試す" onPress={() => setReloadVersion((value) => value + 1)} />
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
      color: '#2e8b57',
    },
    ...route.waypoints.map((waypoint, index) => ({
      id: `route-waypoint-${index}`,
      coordinate: waypoint.coordinates,
      title: waypoint.name,
      color: '#718096',
    })),
  ];
  const spotMarkers: MapMarkerSpec[] = categorizedSpots.map((spot) => {
    const order = selectedOrderById.get(spot.id);
    return {
      id: spot.id,
      coordinate: spot.coordinates,
      title: order ? `${order}. ${spot.name}` : spot.name,
      description: `${spot.category}・寄ると約${spot.extraMinutes}分・モック`,
      color: selectedSpot && spot.id === selectedSpot.id ? '#e8562f' : order ? '#2e8b57' : '#0a7ea4',
      onPress: () => handleSelectSpot(spot.id, true),
    };
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.mapHeader}>
        <Text style={styles.routeLabel}>{route.name}</Text>
        <Text style={styles.mockNotice}>表示中のスポットはすべて架空のモックデータです</Text>
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
            onPress={() => setSelectedCategory(filter)}
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
      />

      {categorizedSpots.length === 0 ? (
        <View style={styles.emptyCategoryBox}>
          <Text style={styles.emptyCategoryText}>
            このカテゴリで寄れそうな場所は見つかりませんでした。他のカテゴリも見てみてください。
          </Text>
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
          {categorizedSpots.map((spot) => {
            const order = selectedOrderById.get(spot.id);
            return (
              <SpotCard
                key={spot.id}
                spot={spot}
                selected={selectedSpot !== null && spot.id === selectedSpot.id}
                selectedOrder={order}
                width={cardWidth}
                onSelect={() => handleSelectSpot(spot.id, false)}
                onToggle={() => handleToggleStop(spot.id)}
              />
            );
          })}
        </ScrollView>
      )}

      <View style={styles.policyNotice}>
        <Text style={styles.policyText}>
          Googleの評価・口コミは表示していません。将来は実在スポットに接続後、「Googleマップで評価・口コミを見る」導線を追加する予定です。
        </Text>
      </View>

      <View style={styles.footer}>
        {selectionError && <Text style={styles.errorText}>{selectionError}</Text>}
        <Text style={styles.planSummary}>
          寄るところ {activeSelectedSpotIds.length}/{MAX_SELECTED_SPOTS}
          {currentPlan ? ` ・ ${currentPlan.distanceKm}km ・ 約${currentPlan.durationMinutes}分` : ''}
        </Text>
        <PrimaryButton
          label={isNavigating ? 'ルートを確認しています…' : '寄り道を確認する'}
          onPress={handleReviewRoute}
          disabled={
            isNavigating ||
            activeSelectedSpotIds.length === 0 ||
            !currentPlan ||
            !currentPlan.isWithinBudget
          }
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
  onSelect,
  onToggle,
}: {
  spot: Spot;
  selected: boolean;
  selectedOrder: number | undefined;
  width: number;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <View style={[styles.card, { width }, selected && styles.cardSelected]}>
      <Pressable onPress={onSelect}>
        <View style={styles.badgeRow}>
          <Text style={styles.categoryBadge}>{spot.category}</Text>
          <Text style={styles.mockBadge}>モック</Text>
          {selectedOrder && <Text style={styles.orderBadge}>寄るところ {selectedOrder}</Text>}
        </View>
        <Text style={styles.spotName}>{spot.name}</Text>
        <Text style={styles.extraTime}>寄ると約{spot.extraMinutes}分</Text>
        <Text style={styles.description}>{spot.description}</Text>
        <Text style={styles.recommendation}>おすすめ理由: {spot.recommendation}</Text>
      </Pressable>
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
    backgroundColor: '#fff',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#11181C',
    textAlign: 'center',
  },
  statusText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5b6770',
    textAlign: 'center',
  },
  mapHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 2,
  },
  routeLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#11181C',
  },
  mockNotice: {
    fontSize: 11,
    color: '#7a5b18',
  },
  categoryRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  emptyCategoryBox: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    backgroundColor: '#f5f6f7',
    padding: 16,
  },
  emptyCategoryText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5b6770',
    textAlign: 'center',
  },
  map: {
    flex: 1,
    minHeight: 180,
    margin: 16,
    marginVertical: 8,
  },
  cardList: {
    paddingHorizontal: CARD_MARGIN,
    gap: CARD_GAP,
    paddingVertical: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 14,
    justifyContent: 'space-between',
  },
  cardSelected: {
    borderColor: '#0a7ea4',
    backgroundColor: '#f2fbfd',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 7,
  },
  categoryBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0a7ea4',
    backgroundColor: '#e7f7fa',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  mockBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7a5b18',
    backgroundColor: '#fff5d6',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  orderBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#26734d',
    backgroundColor: '#e7f6ed',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  spotName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 3,
  },
  extraTime: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e8562f',
    marginBottom: 6,
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
    color: '#334',
    marginBottom: 5,
  },
  recommendation: {
    fontSize: 11,
    lineHeight: 16,
    color: '#5b6770',
  },
  cardButton: {
    minHeight: 44,
    marginTop: 10,
  },
  policyNotice: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: '#f5f6f7',
    padding: 9,
  },
  policyText: {
    fontSize: 10,
    lineHeight: 15,
    color: '#5b6770',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
  planSummary: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334',
    textAlign: 'center',
    marginBottom: 6,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginBottom: 6,
  },
});
