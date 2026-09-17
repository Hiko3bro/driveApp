import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionCard } from '@/components/ui/action-card';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { getDrivePlans } from '@/services/drive-plan/drive-plan-store';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import type { SavedDrivePlan } from '@/types/drive-plan';

const MAX_PREVIEW_ITEMS = 2;

export default function HomeScreen() {
  const { resetPlanningSession, diaryEntries, selectDiaryEntry } = useDriveFlow();
  const [drivePlans, setDrivePlans] = useState<SavedDrivePlan[]>([]);

  // タブへ戻るたびに最新のドライブ計画一覧を読み直す(ドライブ計画タブで作成・削除した内容を反映する)。
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getDrivePlans().then((loaded) => {
        if (active) {
          setDrivePlans(loaded);
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
  const recentDrivePlans = drivePlans.slice(0, MAX_PREVIEW_ITEMS);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.hero}>今日はどこへ走る?</Text>
          <Text style={styles.tagline}>何気ない時間や移動を、新しい発見と思い出に変えるアプリです。</Text>
        </View>

        <ActionCard
          icon="car-sport"
          title="今ドラ"
          description="今から走る。出発地点を選ぶところから、すぐに始められます"
          onPress={handleStartNewDrive}
          large
        />

        <View style={styles.gap} />

        <ActionCard
          icon="map-outline"
          title="ドライブ計画"
          description="今度走る・旅先で探す。AIと相談しながら気になる場所を見つけられます"
          onPress={() => router.push('/trips')}
        />

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
              <ActionCard
                key={entry.id}
                icon="book-outline"
                title={entry.title}
                description={`${entry.date} ・ ${formatDistanceLabel(entry.distanceKm)}`}
                onPress={() => handleOpenDiaryEntry(entry.id)}
              />
            ))}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>保存中のドライブ計画</Text>
            {drivePlans.length > 0 && (
              <Pressable
                onPress={() => router.push('/trips')}
                accessibilityRole="button"
                accessibilityLabel="ドライブ計画をすべて見る"
                hitSlop={8}>
                <Text style={styles.sectionLink}>すべて見る</Text>
              </Pressable>
            )}
          </View>
          {recentDrivePlans.length > 0 ? (
            recentDrivePlans.map((plan) => (
              <ActionCard
                key={plan.id}
                icon="navigate-outline"
                title={plan.title}
                description={`${plan.areaName ? `${plan.areaName} ・ ` : ''}${plan.dateText ?? '時期未定'}`}
                onPress={() => router.push({ pathname: '/drive-plan-chat', params: { savedPlanId: plan.id } })}
              />
            ))
          ) : (
            <Text style={styles.emptyHint}>まだドライブ計画がありません</Text>
          )}
        </View>
      </ScrollView>
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
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  header: {
    marginBottom: Spacing.sm,
  },
  hero: {
    fontSize: Typography.screenTitle.fontSize,
    fontWeight: Typography.screenTitle.fontWeight,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  tagline: {
    fontSize: Typography.body.fontSize,
    lineHeight: Typography.body.lineHeight,
    color: Colors.textSecondary,
  },
  gap: {
    height: Spacing.sm,
  },
  section: {
    marginTop: Spacing.xl,
    gap: Spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: Typography.sectionTitle.fontSize,
    fontWeight: Typography.sectionTitle.fontWeight,
    color: Colors.textPrimary,
  },
  sectionLink: {
    fontSize: Typography.secondary.fontSize,
    fontWeight: '600',
    color: Colors.accentBlue,
  },
  emptyHint: {
    fontSize: Typography.secondary.fontSize,
    color: Colors.textTertiary,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surfaceSubtle,
    padding: Spacing.lg,
  },
});
