import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';

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
            {route.name} ・ {route.distanceKm}km ・ 約{route.durationMinutes}分(ルート予定)
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
    marginBottom: 12,
  },
  demoBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#fff5d6',
    marginBottom: 12,
  },
  demoBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#7a5b18',
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
    marginBottom: 10,
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
  statValueSmall: {
    fontSize: 13,
    fontWeight: '700',
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
