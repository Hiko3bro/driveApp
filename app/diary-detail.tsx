import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';

/**
 * 日記タブの一覧から、任意の過去の日記を見るための画面。既存の
 * drive-diary-confirm.tsx(記録直後の確認)とは表示目的が異なるため
 * (「保存しました」という文言が過去日記には合わない)、別画面として新設した。
 * データモデル(DriveDiaryEntry)・selectDiaryEntry()による「表示対象」の
 * 指定方法は既存のまま再利用しており、日記データ自体は作り直していない。
 */
export default function DiaryDetailScreen() {
  const { diaryEntries, latestDiaryEntryId } = useDriveFlow();
  const entry = useMemo(
    () => diaryEntries.find((candidate) => candidate.id === latestDiaryEntryId) ?? null,
    [diaryEntries, latestDiaryEntryId]
  );

  useEffect(() => {
    if (!entry) {
      router.back();
    }
  }, [entry]);

  if (!entry) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
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
            {entry.route.name} ・ {entry.route.distanceKm}km ・ 約{entry.route.durationMinutes}分
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
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="共有する" onPress={() => router.push('/drive-diary-share')} />
        <PrimaryButton label="日記一覧に戻る" variant="secondary" onPress={() => router.back()} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 4,
  },
  date: {
    fontSize: 13,
    color: '#5b6770',
    marginBottom: 12,
  },
  memo: {
    fontSize: 14,
    lineHeight: 21,
    color: '#334',
    marginBottom: 16,
  },
  statsCard: {
    borderRadius: 16,
    backgroundColor: '#f5f6f7',
    padding: 16,
    marginBottom: 20,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 13,
    color: '#5b6770',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#11181C',
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334',
    marginBottom: 4,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoThumb: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: '#eef2f3',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    gap: 10,
  },
});
