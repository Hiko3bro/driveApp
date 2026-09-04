import { router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';

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
            {entry.route.name} ・ {entry.route.distanceKm}km ・ 約{entry.route.durationMinutes}分
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
    backgroundColor: '#fff',
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  badge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#26734d',
    marginBottom: 8,
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
  noticeBox: {
    borderRadius: 14,
    backgroundColor: '#eef7fa',
    padding: 16,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0a7ea4',
    marginBottom: 6,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 19,
    color: '#334',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    gap: 10,
  },
});
