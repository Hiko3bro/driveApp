import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { formatMinutesLabel } from '@/types/drive';
import type { DriveDiaryEntry } from '@/types/drive-diary';

/**
 * 保存済み日記の一覧タブ。既存の日記データモデル(DriveDiaryEntry、
 * DriveFlowContext.diaryEntries)はそのまま再利用し、作り直さない。
 * タップするとselectDiaryEntry()で「表示対象」を指定してから、既存の
 * 詳細表示ロジックを再利用した/diary-detailへ進む。
 */
export default function DiaryTabScreen() {
  const { diaryEntries, selectDiaryEntry } = useDriveFlow();
  const sortedEntries = [...diaryEntries].sort((a, b) => b.createdAt - a.createdAt);

  const handleOpen = (entryId: string) => {
    selectDiaryEntry(entryId);
    router.push('/diary-detail');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>日記</Text>
        {sortedEntries.length === 0 ? (
          <EmptyState
            icon="book-outline"
            message={'まだドライブ記録がありません\nドライブを記録して日記を作成すると、ここに残ります'}
          />
        ) : (
          <View style={styles.list}>
            {sortedEntries.map((entry) => (
              <DiaryCard key={entry.id} entry={entry} onPress={() => handleOpen(entry.id)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DiaryCard({ entry, onPress }: { entry: DriveDiaryEntry; onPress: () => void }) {
  const coverPhoto = entry.photos[0];
  const durationMinutes = Math.round(entry.durationSeconds / 60);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}。${entry.date}の日記を開く`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.thumbnail}>
        {coverPhoto ? (
          <Image source={{ uri: coverPhoto.uri }} style={styles.thumbnailImage} contentFit="cover" />
        ) : (
          <Ionicons name="map-outline" size={22} color={Colors.textTertiary} />
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardDate}>{entry.date}</Text>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {entry.title}
        </Text>
        <Text style={styles.cardMeta} numberOfLines={1}>
          {entry.route.name} ・ {formatDistanceLabel(entry.distanceKm)} ・ {formatMinutesLabel(durationMinutes)}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textTertiary} />
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
  },
  title: {
    fontSize: Typography.screenTitle.fontSize - 6,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
  },
  list: {
    gap: Spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
  },
  cardPressed: {
    opacity: 0.85,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardDate: {
    fontSize: Typography.caption.fontSize,
    color: Colors.textTertiary,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: Typography.cardTitle.fontSize,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  cardMeta: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textSecondary,
  },
});
