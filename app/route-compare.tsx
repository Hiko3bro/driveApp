import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router/react-navigation';
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
import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { DEMO_MAP_REGION } from '@/services/location/coordinates';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { computeRegionForPath } from '@/services/location/route-map-region';
import { formatMinutesLabel, summarizeDriveConditions } from '@/types/drive';
import type { MapRegion } from '@/types/location';
import type { RouteOption } from '@/types/route';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CARD_MARGIN = 16;
// 隣のCardが少し見えることで横スワイプ可能だと分かるよう、画面幅の85〜90%程度に収める。
const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.86);
const CARD_GAP = 14;
const CARD_STRIDE = CARD_WIDTH + CARD_GAP;
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
  const { departure, conditions, routes, selectedRouteId, setSelectedRouteId, beginConditionsEdit } =
    useDriveFlow();

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
        <View style={styles.emptyStateWrap}>
          <EmptyState
            icon="map-outline"
            message={'提案できるルートがありませんでした\n条件を変えて、もう一度ルートを探してみてください'}
            actionLabel="条件を入力しなおす"
            onAction={() => {
              beginConditionsEdit();
              router.push('/conditions');
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  const markers: MapMarkerSpec[] = [
    {
      id: 'departure',
      coordinate: departure.coordinates,
      title: `出発: ${departure.label}`,
      color: Colors.success,
    },
    ...selectedRoute.waypoints.map((waypoint, index) => ({
      id: `waypoint-${index}`,
      coordinate: waypoint.coordinates,
      title: waypoint.name,
      color: index === selectedRoute.waypoints.length - 1 ? Colors.accentRed : Colors.accentBlue,
    })),
  ];

  const conditionSummary = summarizeDriveConditions(conditions);

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {conditionSummary.length > 0 && (
        <View style={styles.conditionSummaryBox}>
          <Text style={styles.conditionSummaryText}>今日の気分: {conditionSummary}</Text>
        </View>
      )}

      {selectedRoute.targetDurationMinutes !== undefined ? (
        <Text style={styles.targetDurationText}>
          目安{formatMinutesLabel(selectedRoute.targetDurationMinutes)} / 約{formatMinutesLabel(selectedRoute.durationMinutes)}
        </Text>
      ) : conditions.availableTime === 'unspecified' ? (
        <Text style={styles.targetDurationText}>
          時間指定なし ・ 約{formatMinutesLabel(selectedRoute.durationMinutes)}
        </Text>
      ) : null}

      {selectedRoute.warning && <Text style={styles.warningText}>{selectedRoute.warning}</Text>}

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
        <PrimaryButton
          label="条件を変える"
          variant="secondary"
          onPress={() => {
            // 既存のDriveConditionsは変更せず、「編集で入った」ことだけを明示する。
            beginConditionsEdit();
            router.push('/conditions');
          }}
          style={styles.changeConditionsButton}
        />
      </View>
    </SafeAreaView>
  );
}

const MAX_CARD_STOPS = 3;

function RouteCard({
  route,
  selected,
  onPress,
}: {
  route: RouteOption;
  selected: boolean;
  onPress: () => void;
}) {
  const themeTag = route.tags[0];
  const stops = route.waypoints.slice(0, MAX_CARD_STOPS).map((wp) => wp.name);
  const remainingStopCount = route.waypoints.length - stops.length;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${route.name}を選ぶ`}
      accessibilityState={{ selected }}
      style={[styles.card, selected && styles.cardSelected]}>
      {selected && (
        <View style={styles.selectedBadge}>
          <Ionicons name="checkmark" size={13} color={Colors.onAccent} />
        </View>
      )}

      {themeTag && (
        <View style={styles.themeTag}>
          <Text style={styles.themeTagText}>{themeTag}</Text>
        </View>
      )}

      <Text style={styles.cardName} numberOfLines={2}>
        {route.name}
      </Text>

      <View style={styles.metricsRow}>
        <Text style={styles.metricLargeValue}>約{formatMinutesLabel(route.durationMinutes)}</Text>
        <View style={styles.metricDivider} />
        <Text style={styles.metricSecondaryValue}>{formatDistanceLabel(route.distanceKm)}</Text>
      </View>

      {stops.length > 0 && (
        <Text style={styles.stopsText} numberOfLines={1}>
          {stops.join(' → ')}
          {remainingStopCount > 0 ? ` ・ ほか${remainingStopCount}件` : ''}
        </Text>
      )}

      {route.highlight && (
        <Text style={styles.cardHighlight} numberOfLines={2}>
          {route.highlight}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  conditionSummaryBox: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  conditionSummaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  targetDurationText: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
    fontSize: 12,
    color: Colors.textTertiary,
  },
  // 「目安時間より短め」等、blockingではない注意書きは大きな赤boxではなく、caption程度の
  // 目立たない1行にとどめる(セクション43。実際に予算超過を伝える文言自体はサーバー側で
  // 変わらないが、UI上の強さだけを下げる)。
  warningText: {
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textTertiary,
  },
  map: {
    flex: 1,
    margin: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  emptyStateWrap: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  cardList: {
    paddingHorizontal: CARD_MARGIN,
    paddingBottom: Spacing.xs,
    gap: CARD_GAP,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: Radius.xl,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  cardSelected: {
    borderColor: Colors.accentBlue,
  },
  selectedBadge: {
    position: 'absolute',
    top: Spacing.sm + 2,
    right: Spacing.sm + 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeTag: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentBlueMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  themeTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
  cardName: {
    fontSize: Typography.cardTitle.fontSize,
    fontWeight: Typography.cardTitle.fontWeight,
    color: Colors.textPrimary,
    paddingRight: 28,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm + 2,
  },
  metricLargeValue: {
    fontSize: Typography.metricLarge.fontSize,
    fontWeight: Typography.metricLarge.fontWeight,
    color: Colors.textPrimary,
  },
  metricDivider: {
    width: 1,
    height: 14,
    backgroundColor: Colors.divider,
  },
  metricSecondaryValue: {
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  stopsText: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs + 2,
  },
  tag: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceElevated,
  },
  tagText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  cardHighlight: {
    fontSize: Typography.secondary.fontSize,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  footer: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm + 2,
  },
  changeConditionsButton: {
    marginTop: 0,
  },
});
