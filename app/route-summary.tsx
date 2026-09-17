import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { formatMinutesLabel, summarizeDriveConditions } from '@/types/drive';
import type { RouteOption } from '@/types/route';

function resolveRoute(routes: RouteOption[], selectedRouteId: string | null): RouteOption | null {
  if (routes.length === 0) {
    return null;
  }
  return routes.find((route) => route.id === selectedRouteId) ?? routes[0];
}

export default function RouteSummaryScreen() {
  const { departure, conditions, routes, selectedRouteId } = useDriveFlow();
  const route = resolveRoute(routes, selectedRouteId);
  const navigationInFlightRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<'nav' | 'spots' | null>(null);

  useFocusEffect(
    useCallback(() => {
      navigationInFlightRef.current = false;
      setPendingAction(null);
    }, [])
  );

  useEffect(() => {
    if (!departure || !conditions || !route) {
      router.replace('/departure');
    }
  }, [departure, conditions, route]);

  if (!departure || !conditions || !route) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const handleStartNavigation = () => {
    if (navigationInFlightRef.current) {
      return;
    }
    navigationInFlightRef.current = true;
    setPendingAction('nav');
    // スポットを追加していないルート確認は、route-plan側でスポット0件として
    // 扱われる(spot-discoveryと同じ決定/ナビ処理を再利用するため)。
    router.push('/route-plan');
  };

  const handleExploreSpots = () => {
    if (navigationInFlightRef.current) {
      return;
    }
    navigationInFlightRef.current = true;
    setPendingAction('spots');
    router.push('/spot-discovery');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.badge}>ルートを選択しました</Text>
        <Text style={styles.routeName}>{route.name}</Text>
        <Text style={styles.meta}>
          {formatDistanceLabel(route.distanceKm)} ・ 約{formatMinutesLabel(route.durationMinutes)}
        </Text>
        <Text style={styles.conditionSummary}>今日の気分: {summarizeDriveConditions(conditions)}</Text>

        <View style={styles.tagRow}>
          {route.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ルートの特徴</Text>
          <Text style={styles.description}>{route.description}</Text>
          <Text style={styles.highlight}>{route.highlight}</Text>
          <Text style={styles.audience}>{route.audience}</Text>
        </View>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>
            気になる場所があれば、周辺スポットから時間内に寄ってみたい場所を最大3件まで選べます(任意)。選ばなくても、このままナビを開始できます。
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label={pendingAction === 'nav' ? 'ルートを準備しています…' : 'このルートでナビ'}
          onPress={handleStartNavigation}
          disabled={pendingAction !== null}
        />
        <PrimaryButton
          label={pendingAction === 'spots' ? 'スポットを準備しています…' : '周辺スポットを探す'}
          variant="secondary"
          onPress={handleExploreSpots}
          disabled={pendingAction !== null}
        />
        <PrimaryButton
          label="ルート比較に戻る"
          variant="secondary"
          onPress={() => router.back()}
          disabled={pendingAction !== null}
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
  content: {
    flexGrow: 1,
    padding: Spacing.xl,
  },
  badge: {
    fontSize: Typography.secondary.fontSize,
    fontWeight: '700',
    color: Colors.accentBlue,
    marginBottom: Spacing.sm,
  },
  routeName: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  meta: {
    fontSize: Typography.body.fontSize,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  conditionSummary: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.xl - 4,
  },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceElevated,
  },
  tagText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  section: {
    marginBottom: Spacing.xl - 4,
  },
  sectionTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: Typography.sectionTitle.fontWeight,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  description: {
    fontSize: Typography.body.fontSize,
    lineHeight: 21,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  highlight: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.accentBlue,
    fontWeight: '600',
    marginBottom: Spacing.sm - 2,
  },
  audience: {
    fontSize: 12,
    color: Colors.textTertiary,
  },
  noticeBox: {
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSubtle,
    padding: Spacing.md + 2,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  footer: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm + 2,
  },
});
