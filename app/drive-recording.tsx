import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { useDriveRecording } from '@/hooks/use-drive-recording';
import { formatDistanceKm, formatDistanceLabel, formatElapsedTime } from '@/services/location/format-drive-stats';
import { formatMinutesLabel } from '@/types/drive';
import type { RouteOption } from '@/types/route';
import type { Spot } from '@/types/spot';

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

const STATUS_LABEL: Record<'idle' | 'recording' | 'stopped', string> = {
  idle: '記録前',
  recording: '記録中',
  stopped: '記録終了',
};

export default function DriveRecordingScreen() {
  const { departure, conditions, routes, selectedRouteId, spots, selectedSpotIds, setDriveRecord } =
    useDriveFlow();
  const route = useMemo(() => resolveRoute(routes, selectedRouteId), [routes, selectedRouteId]);
  const selectedSpots = useMemo(
    () => resolveSpotsByIds(spots, selectedSpotIds),
    [spots, selectedSpotIds]
  );
  const demoPath = useMemo(() => route?.path ?? [], [route]);

  const recording = useDriveRecording({ demoPath });
  const finishInFlightRef = useRef(false);
  const [finishError, setFinishError] = useState<string | null>(null);

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

  if (!departure || !conditions || !route) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const handleStart = () => {
    setFinishError(null);
    void recording.start();
  };

  const handleFinish = () => {
    if (finishInFlightRef.current) {
      return;
    }
    finishInFlightRef.current = true;

    const result = recording.stop();
    if (!result || result.track.length === 0) {
      setFinishError('記録内容を確認できませんでした。記録を開始し直してください。');
      finishInFlightRef.current = false;
      return;
    }

    setDriveRecord({
      route,
      spots: selectedSpots,
      track: result.track,
      distanceKm: result.distanceKm,
      durationSeconds: result.durationSeconds,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
      source: result.source,
    });
    router.replace('/drive-summary');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.routeName}>{route.name}</Text>
        <Text style={styles.meta}>
          {selectedSpots.length > 0 ? `経由地 ${selectedSpots.length}件 ・ ` : ''}
          {formatDistanceLabel(route.distanceKm)} ・ 約{formatMinutesLabel(route.durationMinutes)}(ルート予定)
        </Text>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusBadge,
              recording.status === 'recording' && styles.statusBadgeRecording,
              recording.status === 'stopped' && styles.statusBadgeStopped,
            ]}>
            <Text style={styles.statusBadgeText}>{STATUS_LABEL[recording.status]}</Text>
          </View>
          {recording.source === 'demo' && (
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>デモ走行モード</Text>
            </View>
          )}
        </View>

        {recording.notice && <Text style={styles.noticeText}>{recording.notice}</Text>}

        <View style={styles.statsCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>経過時間</Text>
            <Text style={styles.statValue}>{formatElapsedTime(recording.elapsedSeconds)}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行距離</Text>
            <Text style={styles.statValue}>{formatDistanceKm(recording.distanceKm)} km</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>現在地</Text>
            <Text style={styles.statValueSmall}>
              {recording.currentLocation
                ? `緯度 ${recording.currentLocation.latitude.toFixed(5)} / 経度 ${recording.currentLocation.longitude.toFixed(5)}`
                : recording.status === 'idle'
                  ? '記録を開始すると表示されます'
                  : '取得中…'}
            </Text>
          </View>
        </View>

        {selectedSpots.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>経由予定のスポット</Text>
            {selectedSpots.map((spot, index) => (
              <Text key={spot.id} style={styles.spotItem}>
                {index + 1}. {spot.name}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {finishError && <Text style={styles.errorText}>{finishError}</Text>}
        {recording.status !== 'recording' ? (
          <PrimaryButton
            label="記録を開始"
            onPress={handleStart}
            disabled={recording.status === 'stopped'}
          />
        ) : (
          <PrimaryButton label="ドライブを終了" onPress={handleFinish} />
        )}
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
    padding: Spacing.lg + 4,
  },
  routeName: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  meta: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg - 2,
  },
  statusRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.sm + 2,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceElevated,
  },
  statusBadgeRecording: {
    backgroundColor: Colors.successMuted,
  },
  statusBadgeStopped: {
    backgroundColor: Colors.accentBlueMuted,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  demoBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.warningMuted,
  },
  demoBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.warning,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: Colors.warning,
    marginBottom: Spacing.md,
  },
  statsCard: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    marginBottom: Spacing.xl - 4,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm + 2,
  },
  statLabel: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statValueSmall: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
  },
  section: {
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  spotItem: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
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
});
