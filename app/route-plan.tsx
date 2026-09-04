import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { isValidCoordinates } from '@/services/location/coordinates';
import { calculateSpotRoutePlan, SpotRoutePlanError } from '@/services/spot/spot-route-plan';
import type { RouteOption } from '@/types/route';
import type { Spot, SpotRoutePlan } from '@/types/spot';

// route-planでのDriveMapView(react-native-maps)マウントがiOS + Expo Goで
// ネイティブクラッシュを引き起こすことが確認されている(既知の問題、docs/PROGRESS.md参照)。
// Development Buildでの再現状況を確認できるまで、地図は表示せずプレースホルダーに
// とどめる。地図以外(ルート情報・選択スポット・決定操作)は通常どおり動作する。

function resolveRoute(routes: RouteOption[], selectedRouteId: string | null): RouteOption | null {
  if (routes.length === 0) {
    return null;
  }
  return routes.find((route) => route.id === selectedRouteId) ?? routes[0];
}

function resolveSpotsByIds(spots: Spot[], spotIds: string[]): Spot[] {
  const spotById = new Map(spots.map((spot) => [spot.id, spot]));
  return spotIds.flatMap((id) => {
    const spot = spotById.get(id);
    return spot ? [spot] : [];
  });
}

export default function RoutePlanScreen() {
  const { departure, conditions, routes, selectedRouteId, spots, selectedSpotIds } =
    useDriveFlow();
  const route = useMemo(() => resolveRoute(routes, selectedRouteId), [routes, selectedRouteId]);
  const selectedSpots = useMemo(
    () => resolveSpotsByIds(spots, selectedSpotIds),
    [spots, selectedSpotIds]
  );
  const decisionInFlightRef = useRef(false);
  const [isDeciding, setIsDeciding] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // スポット探索は任意のため、spot-discoveryを経由せずスポット0件でこの画面に
  // 直接来た場合も許可する(spotRouteId・selectedSpotIdsはルート選択時にリセットされる
  // ため、spot-discovery未経由なら自然にselectedSpots.length === 0になる)。
  const plan = useMemo<SpotRoutePlan | null>(() => {
    if (!route || !conditions || selectedSpots.length !== selectedSpotIds.length) {
      return null;
    }
    try {
      return calculateSpotRoutePlan(route, selectedSpots, conditions);
    } catch {
      return null;
    }
  }, [route, conditions, selectedSpots, selectedSpotIds.length]);

  // MapView/Marker/Polylineへ渡す直前の最終チェック。ここまでの計算過程は既に
  // 座標を検証しているはずだが、万一不正値が紛れ込んでもネイティブ地図へは渡さず、
  // クラッシュではなくエラー表示でユーザーに知らせる。
  const mapDataError = useMemo(() => {
    if (!departure || !plan) {
      return null;
    }
    if (!isValidCoordinates(departure.coordinates)) {
      return '出発地点の位置情報を確認できませんでした。出発地点を選び直してください。';
    }
    if (plan.path.length < 2 || !plan.path.every(isValidCoordinates)) {
      return '更新後のルート情報を確認できませんでした。寄るところを選び直してください。';
    }
    if (selectedSpots.some((spot) => !isValidCoordinates(spot.coordinates))) {
      return '寄るところの位置情報を確認できませんでした。寄るところを選び直してください。';
    }
    return null;
  }, [departure, plan, selectedSpots]);

  useFocusEffect(
    useCallback(() => {
      decisionInFlightRef.current = false;
      setIsDeciding(false);
    }, [])
  );

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
      return;
    }
    if (!plan) {
      router.replace('/route-summary');
    }
  }, [departure, conditions, route, plan]);

  if (!departure || !conditions || !route || !plan) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  // スポットを追加せず直接ナビへ進んできた場合は「戻ってスポットを選び直す」が
  // 成立しないため、spot-discoveryへ探しに行く導線に出し分ける。
  const hasSpots = selectedSpots.length > 0;
  const secondarySpotLabel = hasSpots ? 'スポットを選び直す' : '周辺スポットを見る';
  const handleSecondarySpotAction = () => {
    if (hasSpots) {
      router.back();
    } else {
      router.push('/spot-discovery');
    }
  };

  if (mapDataError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>ルートを表示できませんでした</Text>
          <Text style={styles.statusText}>{mapDataError}</Text>
          <PrimaryButton
            label={secondarySpotLabel}
            onPress={handleSecondarySpotAction}
            style={styles.fullWidth}
          />
        </View>
      </SafeAreaView>
    );
  }

  const handleDecide = () => {
    if (decisionInFlightRef.current) {
      return;
    }
    decisionInFlightRef.current = true;
    setIsDeciding(true);
    setDecisionError(null);

    try {
      const latestPlan = calculateSpotRoutePlan(route, selectedSpots, conditions);
      if (!latestPlan.isWithinBudget) {
        setDecisionError(
          latestPlan.budgetMessage ?? '選んだ条件の時間内に収まりません。寄るところを選び直してください。'
        );
        return;
      }
      setCompleted(true);
    } catch (error: unknown) {
      setDecisionError(
        error instanceof SpotRoutePlanError
          ? error.message
          : 'ルート内容を決定できませんでした。もう一度お試しください。'
      );
    } finally {
      decisionInFlightRef.current = false;
      setIsDeciding(false);
    }
  };

  if (completed) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.completedContent}>
          <Text style={styles.completedBadge}>ルート内容を決定しました</Text>
          <Text style={styles.completedTitle}>{route.name}</Text>
          <Text style={styles.completedMeta}>
            {hasSpots ? `寄るところ ${selectedSpots.length}件 ・ ` : ''}
            {plan.distanceKm}km ・ 約{plan.durationMinutes}分
          </Text>
          <View style={styles.completedNotice}>
            <Text style={styles.completedNoticeTitle}>次に実装予定の機能</Text>
            <Text style={styles.completedNoticeText}>
              次はGoogleマップでのナビ連携を実装予定です。現在はモックルートの確認までで、外部アプリは開きません。
            </Text>
          </View>
          <Text style={styles.reviewPolicy}>
            実在スポットへ接続した将来版では、評価・口コミをアプリ内で模倣せず、Googleマップで確認できる導線を提供します。
          </Text>
          <PrimaryButton
            label="ドライブを開始"
            onPress={() => router.push('/drive-recording')}
            style={styles.fullWidth}
          />
          <PrimaryButton
            label={secondarySpotLabel}
            variant="secondary"
            onPress={handleSecondarySpotAction}
            style={styles.fullWidth}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={[styles.map, styles.mapDisabledPlaceholder]}>
        <Text style={styles.mapDisabledText}>地図表示は一時的に無効化しています</Text>
        <Text style={styles.mapDisabledSubText}>
          iOS(Expo Go)でのクラッシュ調査中のため、Development Buildでの確認後に再度有効化予定です。
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.routeName}>{route.name}</Text>
        <Text style={styles.meta}>
          {hasSpots ? '更新後' : 'ルート情報'}: {plan.distanceKm}km ・ 約{plan.durationMinutes}分
        </Text>

        <View style={[styles.budgetBox, !plan.isWithinBudget && styles.budgetBoxError]}>
          <Text style={[styles.budgetText, !plan.isWithinBudget && styles.budgetTextError]}>
            {plan.isWithinBudget && plan.timeBudgetMinutes !== null
              ? `時間予算 ${plan.timeBudgetMinutes}分以内に収まっています`
              : plan.budgetMessage ?? '時間予算を確認できませんでした。'}
          </Text>
        </View>

        {hasSpots && (
          <>
            <Text style={styles.sectionTitle}>寄るところ</Text>
            {selectedSpots.map((spot, index) => (
              <View key={spot.id} style={styles.stopRow}>
                <View style={styles.stopOrder}>
                  <Text style={styles.stopOrderText}>{index + 1}</Text>
                </View>
                <View style={styles.stopContent}>
                  <Text style={styles.stopName}>{spot.name}</Text>
                  <Text style={styles.stopMeta}>
                    {spot.category} ・ 寄ると約{spot.extraMinutes}分 ・ モック
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {decisionError && <Text style={styles.errorText}>{decisionError}</Text>}
        <PrimaryButton
          label={isDeciding ? '内容を確認しています…' : 'この内容で決定'}
          onPress={handleDecide}
          disabled={isDeciding || !plan.isWithinBudget}
        />
        <PrimaryButton
          label={secondarySpotLabel}
          variant="secondary"
          onPress={handleSecondarySpotAction}
          disabled={isDeciding}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    flex: 1,
    minHeight: 210,
    margin: 16,
    marginBottom: 8,
  },
  mapDisabledPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eef1f3',
    borderRadius: 12,
  },
  mapDisabledText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5b6770',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  mapDisabledSubText: {
    fontSize: 11,
    lineHeight: 16,
    color: '#8b959c',
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 6,
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
  content: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  routeName: {
    fontSize: 20,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 4,
  },
  meta: {
    fontSize: 14,
    color: '#5b6770',
    marginBottom: 10,
  },
  budgetBox: {
    borderRadius: 10,
    backgroundColor: '#e7f6ed',
    padding: 10,
    marginBottom: 14,
  },
  budgetBoxError: {
    backgroundColor: '#fff0ed',
  },
  budgetText: {
    color: '#26734d',
    fontSize: 12,
    fontWeight: '700',
  },
  budgetTextError: {
    color: '#c0392b',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 8,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 9,
  },
  stopOrder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e8562f',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  stopOrderText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  stopContent: {
    flex: 1,
  },
  stopName: {
    color: '#11181C',
    fontSize: 14,
    fontWeight: '700',
  },
  stopMeta: {
    color: '#5b6770',
    fontSize: 11,
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    gap: 10,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  completedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  completedBadge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#26734d',
    marginBottom: 8,
  },
  completedTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#11181C',
    textAlign: 'center',
    marginBottom: 8,
  },
  completedMeta: {
    fontSize: 14,
    color: '#5b6770',
    textAlign: 'center',
    marginBottom: 22,
  },
  completedNotice: {
    width: '100%',
    borderRadius: 14,
    backgroundColor: '#eef7fa',
    padding: 16,
    marginBottom: 14,
  },
  completedNoticeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0a7ea4',
    marginBottom: 6,
  },
  completedNoticeText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334',
  },
  reviewPolicy: {
    fontSize: 11,
    lineHeight: 17,
    color: '#5b6770',
    textAlign: 'center',
    marginBottom: 22,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
