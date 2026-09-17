import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { PrimaryButton } from '@/components/ui/primary-button';
import { RoutePreviewStrip } from '@/components/ui/route-preview-strip';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { deleteDrivePlan, getDrivePlans } from '@/services/drive-plan/drive-plan-store';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { formatMinutesLabel } from '@/types/drive';
import type { SavedDrivePlan } from '@/types/drive-plan';

/**
 * ドライブ計画タブ。「新しくAIと相談する」+保存済みSavedDrivePlanのカード一覧、
 * という2つの導線が自然に分かる構成にする(ユーザー要望のFigma参考: カード中心・
 * 見返したくなる一覧)。カードをタップすると同じdrive-plan-chat.tsxを
 * savedPlanId付きで開き、保存内容を復元した状態でAIと相談を再開できる。
 *
 * 旧Trip/TripDayベースの画面(trip-create.tsx等)はこの画面からの導線を持たない
 * legacyとして残るのみで、削除はしていない。
 */
export default function TripsTabScreen() {
  const [plans, setPlans] = useState<SavedDrivePlan[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    getDrivePlans().then((loadedPlans) => {
      setPlans(loadedPlans);
      setLoaded(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const handleDelete = (plan: SavedDrivePlan) => {
    // 誤操作防止のため、削除前に必ず確認する。
    Alert.alert('このドライブ計画を削除しますか?', `「${plan.title}」を削除すると元に戻せません。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          deleteDrivePlan(plan.id).then(reload);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>ドライブ計画</Text>
        <Text style={styles.subtitle}>知らない土地で何を発見できるか、AIとチャットで相談しながら見つけます。</Text>
        <PrimaryButton label="新しくAIと相談する" onPress={() => router.push('/drive-plan-chat')} />

        {loaded && plans.length === 0 && (
          <EmptyState
            icon="map-outline"
            message={'まだ保存したドライブ計画がありません\n行きたい地域をAIに伝えると、実在するドライブコースを一緒に探していけます'}
          />
        )}

        {plans.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>保存済みプラン</Text>
            {plans.map((plan) => (
              <DrivePlanCard key={plan.id} plan={plan} onDelete={() => handleDelete(plan)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DrivePlanCard({ plan, onDelete }: { plan: SavedDrivePlan; onDelete: () => void }) {
  const selectedRoute = plan.routeOptions.find((route) => route.id === plan.selectedRouteId) ?? plan.routeOptions[0];
  const stops = selectedRoute
    ? [plan.origin.label, ...selectedRoute.waypoints.map((wp) => wp.name), ...(plan.destination ? [plan.destination.label] : [])]
    : [plan.origin.label, ...(plan.destination ? [plan.destination.label] : [])];

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push({ pathname: '/drive-plan-chat', params: { savedPlanId: plan.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${plan.title}を開く`}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle}>{plan.title}</Text>
          <Text style={styles.cardMeta}>
            {plan.areaName ?? plan.origin.label}
            {plan.dateText ? ` ・ ${plan.dateText}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={onDelete}
          hitSlop={8}
          style={styles.deleteButton}
          accessibilityRole="button"
          accessibilityLabel={`${plan.title}を削除`}>
          <Ionicons name="trash-outline" size={16} color={Colors.accentRed} />
        </Pressable>
      </View>

      {plan.themeSummary.length > 0 && (
        <View style={styles.themeRow}>
          {plan.themeSummary.map((theme) => (
            <View key={theme} style={styles.themeChip}>
              <Text style={styles.themeChipText}>{theme}</Text>
            </View>
          ))}
        </View>
      )}

      {selectedRoute && (
        <Text style={styles.routeMeta}>
          {formatDistanceLabel(selectedRoute.distanceKm)} ・ {formatMinutesLabel(selectedRoute.durationMinutes)}
          {selectedRoute.suggestedPlace ? ` ・ ${selectedRoute.suggestedPlace.name}` : ''}
        </Text>
      )}

      <RoutePreviewStrip stops={stops} />

      <View style={styles.cardFooterRow}>
        <Text style={styles.cardFooterText}>続きをAIと相談する</Text>
        <Ionicons name="chevron-forward" size={14} color={Colors.accentBlue} />
      </View>
    </Pressable>
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
    paddingTop: Spacing.md,
    gap: Spacing.md + 2,
  },
  title: {
    fontSize: Typography.screenTitle.fontSize - 6,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    lineHeight: 19,
    marginBottom: Spacing.xs + 2,
  },
  section: {
    gap: Spacing.sm + 2,
  },
  sectionTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: Typography.sectionTitle.fontWeight,
    color: Colors.textPrimary,
  },
  card: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    gap: Spacing.sm + 2,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  cardHeaderText: {
    flex: 1,
    gap: Spacing.xs,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cardMeta: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
  },
  deleteButton: {
    minWidth: 44,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  themeChip: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentBlueMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  themeChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.accentBlue,
  },
  routeMeta: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    marginTop: 2,
  },
  cardFooterText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.accentBlue,
  },
});
