import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceKm, formatDistanceLabel, formatElapsedTime } from '@/services/location/format-drive-stats';
import { formatMinutesLabel } from '@/types/drive';

export default function DriveDiaryConfirmScreen() {
  const { diaryEntries, latestDiaryEntryId } = useDriveFlow();
  const entry = useMemo(
    () => diaryEntries.find((candidate) => candidate.id === latestDiaryEntryId) ?? null,
    [diaryEntries, latestDiaryEntryId]
  );

  useEffect(() => {
    if (!entry) {
      router.dismissTo('/');
    }
  }, [entry]);

  if (!entry) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.badge}>日記を保存しました</Text>
        <Text style={styles.title}>{entry.title}</Text>
        <Text style={styles.date}>{entry.date}</Text>

        {entry.memo.length > 0 && <Text style={styles.memo}>{entry.memo}</Text>}

        <View style={styles.statsCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行距離</Text>
            <Text style={styles.statValue}>{formatDistanceKm(entry.distanceKm)} km</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行時間</Text>
            <Text style={styles.statValue}>{formatElapsedTime(entry.durationSeconds)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>選択したルート</Text>
          <Text style={styles.sectionBody}>
            {entry.route.name} ・ {formatDistanceLabel(entry.route.distanceKm)} ・ 約{formatMinutesLabel(entry.route.durationMinutes)}
            (ルート予定)
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>経由したスポット</Text>
          {entry.spots.length > 0 ? (
            entry.spots.map((spot, index) => (
              <Text key={spot.id} style={styles.sectionBody}>
                {index + 1}. {spot.name}({spot.category})
              </Text>
            ))
          ) : (
            <Text style={styles.sectionBody}>経由地は追加されていません。</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>写真</Text>
          {entry.photos.length > 0 ? (
            <View style={styles.photoRow}>
              {entry.photos.map((photo) => (
                <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photoThumb} />
              ))}
            </View>
          ) : (
            <Text style={styles.sectionBody}>写真は追加されていません。</Text>
          )}
        </View>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeTitle}>次に実装予定の機能</Text>
          <Text style={styles.noticeText}>
            Instagram専用連携・投稿機能・「みんなのドライブ」は今回のスコープ外で、まだ実装していません。
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="共有する" onPress={() => router.push('/drive-diary-share')} />
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
    marginBottom: Spacing.xs,
  },
  date: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
  memo: {
    fontSize: Typography.body.fontSize,
    lineHeight: 21,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
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
    marginBottom: Spacing.sm,
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
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm + 2,
  },
  photoThumb: {
    width: 96,
    height: 96,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
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
