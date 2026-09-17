import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceKm, formatDistanceLabel, formatElapsedTime } from '@/services/location/format-drive-stats';
import { formatMinutesLabel } from '@/types/drive';

export default function DriveSummaryScreen() {
  const { driveRecord } = useDriveFlow();

  useEffect(() => {
    if (!driveRecord) {
      router.dismissTo('/');
    }
  }, [driveRecord]);

  if (!driveRecord) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const { route, spots, track, distanceKm, durationSeconds, source } = driveRecord;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.badge}>記録が完了しました</Text>
        <Text style={styles.title}>{route.name}</Text>

        {source === 'demo' && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>デモ走行モードで記録しました</Text>
          </View>
        )}

        <View style={styles.statsCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行時間</Text>
            <Text style={styles.statValue}>{formatElapsedTime(durationSeconds)}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行距離</Text>
            <Text style={styles.statValue}>{formatDistanceKm(distanceKm)} km</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>記録した座標</Text>
            <Text style={styles.statValueSmall}>{track.length}件</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>選択したルート</Text>
          <Text style={styles.sectionBody}>
            {route.name} ・ {formatDistanceLabel(route.distanceKm)} ・ 約{formatMinutesLabel(route.durationMinutes)}(ルート予定)
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>経由したスポット</Text>
          {spots.length > 0 ? (
            spots.map((spot, index) => (
              <Text key={spot.id} style={styles.sectionBody}>
                {index + 1}. {spot.name}({spot.category})
              </Text>
            ))
          ) : (
            <Text style={styles.sectionBody}>経由地は追加されていません。</Text>
          )}
        </View>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>次に実装予定の機能</Text>
          <Text style={styles.noticeText}>
            共有画像の生成・SNS共有は今回のスコープ外で、まだ実装していません。
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="日記を作成" onPress={() => router.push('/drive-diary-create')} />
        <PrimaryButton label="ホームに戻る" variant="secondary" onPress={() => router.dismissTo('/')} />
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
    color: Colors.success,
    marginBottom: Spacing.sm,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  demoBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.warningMuted,
    marginBottom: Spacing.md,
  },
  demoBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.warning,
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
    fontSize: Typography.secondary.fontSize,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  section: {
    marginBottom: Spacing.lg + 2,
  },
  sectionTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: Typography.sectionTitle.fontWeight,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  sectionBody: {
    fontSize: Typography.secondary.fontSize,
    lineHeight: 20,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  noticeBox: {
    borderRadius: Radius.md + 2,
    backgroundColor: Colors.accentBlueMuted,
    padding: Spacing.lg,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accentBlue,
    marginBottom: Spacing.sm - 2,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 19,
    color: Colors.textSecondary,
  },
  footer: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.sm + 2,
  },
});
