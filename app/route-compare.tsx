import { useFocusEffect } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DriveMapView, type DriveMapViewHandle, type MapMarkerSpec } from '@/components/map/drive-map-view';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { DEMO_MAP_REGION } from '@/services/location/coordinates';
import { computeRegionForPath } from '@/services/location/route-map-region';
import type { MapRegion } from '@/types/location';
import type { RouteOption } from '@/types/route';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_MARGIN = 16;
const CARD_WIDTH = SCREEN_WIDTH - CARD_MARGIN * 2 - 24;
const CARD_STRIDE = CARD_WIDTH + 16;
const CAMERA_ANIMATION_MS = 450;

/** 選択中ルートのindexを、範囲外や見つからない場合も安全に0へフォールバックする。 */
function resolveSelectedIndex(routes: RouteOption[], selectedRouteId: string | null): number {
  if (routes.length === 0) {
    return -1;
  }
  const index = routes.findIndex((route) => route.id === selectedRouteId);
  if (index < 0 || index >= routes.length) {
    return 0;
  }
  return index;
}

export default function RouteCompareScreen() {
  const { departure, conditions, routes, selectedRouteId, setSelectedRouteId } = useDriveFlow();

  const scrollRef = useRef<ScrollView>(null);
  const mapRef = useRef<DriveMapViewHandle>(null);
  const isMountedRef = useRef(true);
  const [mapReady, setMapReady] = useState(false);
  const [isNavigatingToSummary, setIsNavigatingToSummary] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // この画面はpushで進んだ先(ルート決定確認画面)から戻ってきても破棄されずに
  // 残るため、再びフォーカスされるたびに「遷移中」フラグを必ず解除しておく。
  useFocusEffect(
    useCallback(() => {
      setIsNavigatingToSummary(false);
    }, [])
  );

  useEffect(() => {
    if (!departure) {
      router.replace('/departure');
      return;
    }
    if (!conditions) {
      router.replace('/conditions');
    }
  }, [departure, conditions]);

  const selectedIndex = resolveSelectedIndex(routes, selectedRouteId);
  const selectedRoute: RouteOption | null = selectedIndex >= 0 ? routes[selectedIndex] : null;

  // マウント時の初期カメラ位置のみを決める(以降の切り替えはanimateToRegionで行うため、
  // ここは意図的に一度だけ計算する)。
  const initialRegion = useMemo<MapRegion>(() => {
    if (routes[0]) {
      return computeRegionForPath(routes[0].path);
    }
    if (departure) {
      return { ...departure.coordinates, latitudeDelta: 0.03, longitudeDelta: 0.03 };
    }
    return DEMO_MAP_REGION;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady || !selectedRoute || !isMountedRef.current) {
      return;
    }
    mapRef.current?.animateToRegion(computeRegionForPath(selectedRoute.path), CAMERA_ANIMATION_MS);
  }, [mapReady, selectedRoute]);

  useEffect(() => {
    if (selectedIndex < 0) {
      return;
    }
    scrollRef.current?.scrollTo({ x: selectedIndex * CARD_STRIDE, animated: true });
  }, [selectedIndex]);

  const handleSelectRoute = useCallback(
    (routeId: string) => {
      if (routeId !== selectedRouteId) {
        setSelectedRouteId(routeId);
      }
    },
    [selectedRouteId, setSelectedRouteId]
  );

  const handleScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (routes.length === 0) {
        return;
      }
      const offsetX = event.nativeEvent.contentOffset.x;
      const rawIndex = Math.round(offsetX / CARD_STRIDE);
      const clampedIndex = Math.min(Math.max(rawIndex, 0), routes.length - 1);
      const nextRoute = routes[clampedIndex];
      if (nextRoute) {
        handleSelectRoute(nextRoute.id);
      }
    },
    [routes, handleSelectRoute]
  );

  const handleDecide = useCallback(() => {
    if (!selectedRoute || isNavigatingToSummary) {
      return;
    }
    setIsNavigatingToSummary(true);
    // ルート決定確認画面(route-summary)へは必ずpushで前進する。
    // router.back()やdismiss系は使わない(過去の画面へ戻す実装は禁止)。
    router.push('/route-summary');
  }, [selectedRoute, isNavigatingToSummary]);

  if (!departure || !conditions) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  if (routes.length === 0 || !selectedRoute) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>提案できるルートがありませんでした</Text>
          <Text style={styles.emptyText}>条件を変えて、もう一度ルートを探してみてください。</Text>
          <PrimaryButton label="条件を入力しなおす" onPress={() => router.replace('/conditions')} />
        </View>
      </SafeAreaView>
    );
  }

  const markers: MapMarkerSpec[] = [
    {
      id: 'departure',
      coordinate: departure.coordinates,
      title: `出発: ${departure.label}`,
      color: '#2e8b57',
    },
    ...selectedRoute.waypoints.map((waypoint, index) => ({
      id: `waypoint-${index}`,
      coordinate: waypoint.coordinates,
      title: waypoint.name,
      color: index === selectedRoute.waypoints.length - 1 ? '#c0392b' : '#0a7ea4',
    })),
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <DriveMapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        markers={markers}
        polyline={selectedRoute.path}
        contentKey={selectedRoute.id}
        onMapReady={() => setMapReady(true)}
      />

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={CARD_STRIDE}
        decelerationRate="fast"
        contentContainerStyle={styles.cardList}
        onMomentumScrollEnd={handleScrollEnd}>
        {routes.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            selected={route.id === selectedRoute.id}
            onPress={() => handleSelectRoute(route.id)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={isNavigatingToSummary ? '確認しています…' : 'このルートにする'}
          onPress={handleDecide}
          disabled={isNavigatingToSummary}
        />
      </View>
    </SafeAreaView>
  );
}

function RouteCard({
  route,
  selected,
  onPress,
}: {
  route: RouteOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.card, selected && styles.cardSelected]}>
      <Text style={styles.cardName}>{route.name}</Text>
      <Text style={styles.cardMeta}>
        {route.distanceKm}km ・ 約{route.durationMinutes}分
      </Text>
      <Text style={styles.cardDescription}>{route.description}</Text>
      <View style={styles.tagRow}>
        {route.tags.map((tag) => (
          <View key={tag} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.cardHighlight}>{route.highlight}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    flex: 1,
    margin: 16,
    marginBottom: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#11181C',
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#5b6770',
    textAlign: 'center',
  },
  cardList: {
    paddingHorizontal: CARD_MARGIN,
    paddingBottom: 4,
    gap: 16,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 16,
  },
  cardSelected: {
    borderColor: '#0a7ea4',
    backgroundColor: '#f2fbfd',
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: '#5b6770',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334',
    marginBottom: 8,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#eef2f3',
  },
  tagText: {
    fontSize: 11,
    color: '#334',
    fontWeight: '600',
  },
  cardHighlight: {
    fontSize: 12,
    color: '#0a7ea4',
    fontWeight: '600',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
