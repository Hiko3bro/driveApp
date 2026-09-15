import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SelectionCard } from '@/components/ui/selection-card';
import { useDriveFlow } from '@/contexts/drive-flow-context';

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
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>まだ日記がありません</Text>
            <Text style={styles.emptyText}>
              ドライブを記録して日記を作成すると、ここに一覧で表示されます。
            </Text>
          </View>
        ) : (
          sortedEntries.map((entry) => (
            <SelectionCard
              key={entry.id}
              title={entry.title}
              subtitle={`${entry.date} ・ ${entry.distanceKm}km ・ ${entry.route.name}`}
              onPress={() => handleOpen(entry.id)}
            />
          ))
        )}
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
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 20,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
  },
  emptyText: {
    fontSize: 13,
    color: '#8b959c',
    textAlign: 'center',
    lineHeight: 19,
  },
});
