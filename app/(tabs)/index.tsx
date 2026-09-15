import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { SelectionCard } from '@/components/ui/selection-card';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { getTrips } from '@/services/trip/trip-store';
import type { Trip } from '@/types/trip';

const MAX_PREVIEW_ITEMS = 2;

export default function HomeScreen() {
  const { resetPlanningSession, diaryEntries, selectDiaryEntry } = useDriveFlow();
  const [trips, setTrips] = useState<Trip[]>([]);

  // タブへ戻るたびに最新の旅行一覧を読み直す(旅行プランタブで作成・削除した内容を反映する)。
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getTrips().then((loaded) => {
        if (active) {
          setTrips(loaded);
        }
      });
      return () => {
        active = false;
      };
    }, [])
  );

  const handleStartNewDrive = () => {
    // 前回のドライブで入力した条件・提案ルートが残ったまま条件確認画面へ
    // 飛んでしまわないよう、新規開始の入口では必ず計画状態をリセットしてから進む。
    resetPlanningSession();
    router.push('/departure');
  };

  const handleOpenDiaryEntry = (entryId: string) => {
    selectDiaryEntry(entryId);
    router.push('/diary-detail');
  };

  const recentDiaryEntries = [...diaryEntries].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PREVIEW_ITEMS);
  const upcomingTrips = trips.slice(0, MAX_PREVIEW_ITEMS);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.appName}>ドライブ発見</Text>
          <Text style={styles.tagline}>何気ない時間や移動を、新しい発見と思い出に変えるアプリです。</Text>
        </View>

        <PrimaryButton label="今からドライブ" onPress={handleStartNewDrive} />
        <Text style={styles.mainCtaHint}>出発地点を選ぶところから、すぐに始められます</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>旅行のドライブを計画</Text>
          <SelectionCard
            title="旅行プランを作る・開く"
            subtitle="複数日の旅行を、1日ごとに出発地点・寄りたい場所・使える時間から計画できます"
            onPress={() => router.push('/trips')}
          />
        </View>

        {recentDiaryEntries.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>最近の日記</Text>
              <Pressable
                onPress={() => router.push('/diary')}
                accessibilityRole="button"
                accessibilityLabel="日記をすべて見る"
                hitSlop={8}>
                <Text style={styles.sectionLink}>すべて見る</Text>
              </Pressable>
            </View>
            {recentDiaryEntries.map((entry) => (
              <SelectionCard
                key={entry.id}
                title={entry.title}
                subtitle={`${entry.date} ・ ${entry.distanceKm}km`}
                onPress={() => handleOpenDiaryEntry(entry.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>保存中の旅行プラン</Text>
            {trips.length > 0 && (
              <Pressable
                onPress={() => router.push('/trips')}
                accessibilityRole="button"
                accessibilityLabel="旅行プランをすべて見る"
                hitSlop={8}>
                <Text style={styles.sectionLink}>すべて見る</Text>
              </Pressable>
            )}
          </View>
          {upcomingTrips.length > 0 ? (
            upcomingTrips.map((trip) => (
              <SelectionCard
                key={trip.id}
                title={trip.title}
                subtitle={`${trip.startDate} 〜 ${trip.endDate} ・ ${trip.days.length}日間`}
                onPress={() => router.push({ pathname: '/trip-detail', params: { tripId: trip.id } })}
              />
            ))
          ) : (
            <Text style={styles.emptyHint}>まだ旅行プランがありません</Text>
          )}
        </View>
      </ScrollView>
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
    paddingTop: 20,
    gap: 4,
  },
  header: {
    marginBottom: 20,
  },
  appName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5b6770',
  },
  mainCtaHint: {
    fontSize: 12,
    color: '#8b959c',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  section: {
    marginTop: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 10,
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0a7ea4',
  },
  emptyHint: {
    fontSize: 13,
    color: '#8b959c',
  },
});
