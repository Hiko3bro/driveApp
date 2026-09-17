import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { isValidCoordinates } from '@/services/location/coordinates';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { openGoogleMapsNavigation } from '@/services/navigation/google-maps-navigation';
import { resolveAvailableMinutes } from '@/services/route/time-budget';
import { recalculateSpotRouteWithGoogleRoutes } from '@/services/spot/spot-route-recalculation';
import { calculateSpotRoutePlan, SpotRoutePlanError } from '@/services/spot/spot-route-plan';
import { attachRouteToTimelineEntry, updateTripDay } from '@/services/trip/trip-store';
import { formatMinutesLabel } from '@/types/drive';
import type { Coordinates } from '@/types/location';
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
  const { departure, conditions, routes, selectedRouteId, spots, selectedSpotIds, activeTripDay } =
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
  const [isOpeningNav, setIsOpeningNav] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  // Google Routesによる実道路の再計算結果(選択スポットがある場合のみ)。
  const [recalculatedPlan, setRecalculatedPlan] = useState<SpotRoutePlan | null>(null);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const recalcRequestRef = useRef(0);

  // Google Mapsへ渡す最終目的地は、drive-route-plannerが実測に使ったのと同じ地点
  // (「別の場所」を指定していればその実座標、それ以外は出発地点=ループ)。Hooksの
  // 呼び出し順を保つため、早期returnより前(departure/conditionsがnullの可能性がある
  // 時点)でuseMemo化しておく。
  const finalDestinationCoords = useMemo<Coordinates | null>(() => {
    if (!departure) {
      return null;
    }
    return conditions?.returnTarget === 'different' && conditions.finalDestination
      ? conditions.finalDestination.coordinates
      : departure.coordinates;
  }, [departure, conditions]);

  // スポット探索は任意のため、spot-discoveryを経由せずスポット0件でこの画面に
  // 直接来た場合も許可する(spotRouteId・selectedSpotIdsはルート選択時にリセットされる
  // ため、spot-discovery未経由なら自然にselectedSpots.length === 0になる)。
  // Google Routesの応答が届くまでの初期値・フォールバック用に、Haversineの見積もりも
  // 引き続き同期的に計算しておく。
  const estimatedPlan = useMemo<SpotRoutePlan | null>(() => {
    if (!route || !conditions || selectedSpots.length !== selectedSpotIds.length) {
      return null;
    }
    try {
      return calculateSpotRoutePlan(route, selectedSpots, conditions);
    } catch {
      return null;
    }
  }, [route, conditions, selectedSpots, selectedSpotIds.length]);

  // 選択スポットを追加した時点(=この画面に到達した時点)で、既存のdeploy済み
  // google-routes Edge Functionを使い、origin → userViaPoints → suggestedPlace →
  // selectedSpots → destination(ループならorigin)の順で実際の道路ルートを再計算する。
  // 失敗してもHaversineの見積もり(estimatedPlan)を使い続け、画面は止めない
  // (mockへのフォールバックではなく、既存の実座標ベースの見積もりへの後退)。
  // useFocusEffect(useEffectではなく)を使うのは、この画面へフォーカスが戻るたびに
  // 最新の選択スポットで再計算し直すためと、他画面(spot-discovery.tsx)と同じ
  // 「フォーカス中の非同期取得」パターンに揃えるため。
  useFocusEffect(
    useCallback(() => {
      if (!route || !conditions || !departure || !finalDestinationCoords || selectedSpots.length === 0) {
        setRecalculatedPlan(null);
        setRecalcError(null);
        setIsRecalculating(false);
        return;
      }
      if (selectedSpots.length !== selectedSpotIds.length) {
        setRecalculatedPlan(null);
        setRecalcError(null);
        setIsRecalculating(false);
        return;
      }

      let cancelled = false;
      const requestId = recalcRequestRef.current + 1;
      recalcRequestRef.current = requestId;
      // 選択スポットが変わった時点で、古い選択に対する実測値をplanに残したまま
      // 見せ続けないよう、いったんクリアする(新しい実測が届くまではHaversineの
      // 見積もり(estimatedPlan)へ一時的に後退する)。
      setRecalculatedPlan(null);
      setIsRecalculating(true);
      setRecalcError(null);

      void recalculateSpotRouteWithGoogleRoutes({
        route,
        spots: selectedSpots,
        conditions,
        origin: departure.coordinates,
        destination: finalDestinationCoords,
      }).then((outcome) => {
        if (cancelled || recalcRequestRef.current !== requestId) {
          return;
        }
        setIsRecalculating(false);
        if (outcome.ok) {
          setRecalculatedPlan(outcome.plan);
          setRecalcError(null);
        } else {
          setRecalculatedPlan(null);
          setRecalcError('実際の道路距離・時間を計算できませんでした。目安の数値を表示しています。');
        }
      });

      return () => {
        cancelled = true;
      };
    }, [route, conditions, departure, finalDestinationCoords, selectedSpots, selectedSpotIds.length])
  );

  // 実測(Google Routes)が得られていればそれを、無ければHaversineの見積もりを使う。
  // 以降の画面全体(距離・時間・Polyline・決定・ナビ)はこのplanだけを参照する。
  const plan = recalculatedPlan ?? estimatedPlan;

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

  if (!departure || !conditions || !route || !plan || !finalDestinationCoords) {
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

  // origin → userViaPoints → suggestedPlace → (寄り道スポット探索で後から追加したスポット)
  // → destination(または出発地点)の順を維持する。suggestedPlaceはOrchestratorが
  // 実際にGoogle Routesの計算へ使ったのと同じ座標(route.suggestedPlace.coordinates)。
  // services/spot/spot-route-recalculation.tsが実道路の再計算に使うwaypoint順と必ず一致させる。
  const navWaypoints: Coordinates[] = [
    ...conditions.viaPoints.map((point) => point.coordinates),
    ...(route.suggestedPlace ? [route.suggestedPlace.coordinates] : []),
    ...selectedSpots.map((spot) => spot.coordinates),
  ];

  // 時間超過は警告のみ(ナビ・決定操作をブロックしない)。planが実測(Google Routes)か
  // 見積もり(Haversine)かに関わらず、plan.budgetMessageが「この寄り道をすると
  // 目安時間を約○分超えそうです」のような非ブロッキングの文言を持つ。
  const showTimeOverageWarning = !plan.isWithinBudget && Boolean(plan.budgetMessage);

  const handleOpenGoogleMapsNav = async () => {
    if (isOpeningNav) {
      return;
    }
    setIsOpeningNav(true);
    setNavError(null);
    try {
      const result = await openGoogleMapsNavigation({
        origin: departure.coordinates,
        waypoints: navWaypoints,
        destination: finalDestinationCoords,
        avoidHighways: route.avoidHighwaysApplied,
      });
      if (!result.ok) {
        setNavError('Google Mapsを開けませんでした。もう一度お試しください。');
      }
    } finally {
      setIsOpeningNav(false);
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
      // 時間超過(isWithinBudget === false)は警告扱いとし、決定操作はブロックしない
      // (ルート自体はGoogle Routesの実測に基づいており、超過を理由にユーザーの選択を
      // 拒否しない)。calculateSpotRoutePlan自体が投げる検証エラー(スポットの重複等)
      // のみを引き続きブロック対象として扱う。
      calculateSpotRoutePlan(route, selectedSpots, conditions);
      setCompleted(true);

      // 旅行日から始めた計画セッションなら、決定したルートをその日へ保存する
      // (旅行専用の別ルートエンジンは使わず、既存のdrive-route-plannerの結果をそのまま保存)。
      if (activeTripDay?.entryId) {
        // しおりタイムラインの特定区間(車移動)だけに紐付ける。他のエントリや
        // day全体のgeneratedRoutes/selectedRouteIdは上書きしない。
        void attachRouteToTimelineEntry(activeTripDay.tripId, activeTripDay.dayId, activeTripDay.entryId, route);
      } else if (activeTripDay) {
        void updateTripDay(activeTripDay.tripId, activeTripDay.dayId, {
          startLocation: { label: departure.label, coordinates: departure.coordinates },
          endLocation: conditions.returnTarget === 'different' ? conditions.finalDestination : undefined,
          availableTimeMinutes: resolveAvailableMinutes(conditions),
          mustVisitPlaces: conditions.viaPoints,
          aiNote: conditions.aiNote,
          generatedRoutes: routes,
          selectedRouteId: route.id,
        });
      }
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
            {formatDistanceLabel(plan.distanceKm)} ・ 約{formatMinutesLabel(plan.durationMinutes)}
          </Text>
          {showTimeOverageWarning && (
            <View style={styles.timeOverageWarningBox}>
              <Text style={styles.timeOverageWarningText}>
                {plan.budgetMessage} 時間に余裕をもって出発してください。
              </Text>
            </View>
          )}
          <View style={styles.completedNotice}>
            <Text style={styles.completedNoticeTitle}>ナビの選び方</Text>
            <Text style={styles.completedNoticeText}>
              「Google Mapsでナビする」は外部のGoogle Mapsアプリ(無ければブラウザ)でturn-by-turnの音声案内を使えます。
              「アプリ内で記録」は、この画面のまま位置情報を記録しながらドライブする、これまでの機能です。どちらか一方だけを選ぶ必要はなく、Google
              Mapsでナビしながらアプリ内記録を開始することもできます。
            </Text>
          </View>
          {navError && <Text style={styles.errorText}>{navError}</Text>}
          <PrimaryButton
            label={isOpeningNav ? 'Google Mapsを開いています…' : 'Google Mapsでナビする'}
            onPress={handleOpenGoogleMapsNav}
            disabled={isOpeningNav}
            style={styles.fullWidth}
          />
          <PrimaryButton
            label="アプリ内で記録"
            variant="secondary"
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
          {hasSpots ? '更新後' : 'ルート情報'}: {formatDistanceLabel(plan.distanceKm)} ・ 約{formatMinutesLabel(plan.durationMinutes)}
        </Text>
        {hasSpots && isRecalculating && (
          <Text style={styles.recalcNoticeText}>実際の道路距離・時間を計算しています…</Text>
        )}
        {hasSpots && !isRecalculating && recalcError && (
          <Text style={styles.recalcNoticeText}>{recalcError}</Text>
        )}

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
                    {spot.category} ・ 寄ると約{spot.extraMinutes}分{spot.isMock ? ' ・ モック' : ''}
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
          disabled={isDeciding}
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
    backgroundColor: Colors.background,
  },
  map: {
    flex: 1,
    minHeight: 210,
    margin: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  mapDisabledPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: Radius.md,
  },
  mapDisabledText: {
    fontSize: Typography.secondary.fontSize,
    fontWeight: '700',
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
  },
  mapDisabledSubText: {
    fontSize: 11,
    lineHeight: 16,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.xl,
    marginTop: Spacing.xs + 2,
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
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  routeName: {
    fontSize: Typography.screenTitle.fontSize - 8,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  meta: {
    fontSize: Typography.body.fontSize,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm + 2,
  },
  recalcNoticeText: {
    fontSize: 12,
    color: Colors.warning,
    marginBottom: Spacing.sm + 2,
  },
  budgetBox: {
    borderRadius: Radius.sm + 2,
    backgroundColor: Colors.successMuted,
    padding: Spacing.sm + 2,
    marginBottom: Spacing.lg - 2,
  },
  budgetBoxError: {
    backgroundColor: Colors.accentRedMuted,
  },
  budgetText: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '700',
  },
  budgetTextError: {
    color: Colors.accentRed,
  },
  sectionTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: Typography.sectionTitle.fontWeight,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm + 1,
  },
  stopOrder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm + 2,
  },
  stopOrderText: {
    color: Colors.onAccent,
    fontSize: 12,
    fontWeight: '800',
  },
  stopContent: {
    flex: 1,
  },
  stopName: {
    color: Colors.textPrimary,
    fontSize: Typography.body.fontSize,
    fontWeight: '700',
  },
  stopMeta: {
    color: Colors.textSecondary,
    fontSize: 11,
  },
  footer: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm + 2,
  },
  errorText: {
    color: Colors.accentRed,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  completedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  completedBadge: {
    fontSize: Typography.secondary.fontSize,
    fontWeight: '700',
    color: Colors.success,
    marginBottom: Spacing.sm,
  },
  completedTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  completedMeta: {
    fontSize: Typography.body.fontSize,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl - 2,
  },
  timeOverageWarningBox: {
    width: '100%',
    borderRadius: Radius.sm + 2,
    backgroundColor: Colors.accentRedMuted,
    padding: Spacing.md,
    marginBottom: Spacing.lg - 2,
  },
  timeOverageWarningText: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.accentRed,
    textAlign: 'center',
  },
  completedNotice: {
    width: '100%',
    borderRadius: Radius.lg - 2,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    marginBottom: Spacing.lg - 2,
  },
  completedNoticeTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: '700',
    color: Colors.accentBlue,
    marginBottom: Spacing.xs + 2,
  },
  completedNoticeText: {
    fontSize: Typography.secondary.fontSize,
    lineHeight: 20,
    color: Colors.textSecondary,
  },
  reviewPolicy: {
    fontSize: 11,
    lineHeight: 17,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl - 2,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
