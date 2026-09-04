import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { SelectionCard } from '@/components/ui/selection-card';
import { useDriveFlow } from '@/contexts/drive-flow-context';

export default function HomeScreen() {
  const { resetPlanningSession } = useDriveFlow();

  const handleStartNewDrive = () => {
    // 前回のドライブで入力した条件・提案ルートが残ったまま条件確認画面へ
    // 飛んでしまわないよう、新規開始の入口では必ず計画状態をリセットしてから進む。
    resetPlanningSession();
    router.push('/departure');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.appName}>ドライブ発見</Text>
          <Text style={styles.tagline}>
            行き先を決めるためだけのアプリではなく、{'\n'}
            何気ない時間や移動を、新しい発見と思い出に変えるアプリです。
          </Text>
          <Text style={styles.subTagline}>
            土地勘のない旅行先でも、使える時間やレンタカーの返却時刻から、
            景色の良い道・穴場・寄り道を含むドライブルートを見つけられます。
          </Text>
        </View>

        <View style={styles.actions}>
          <PrimaryButton label="今からドライブ" onPress={handleStartNewDrive} />

          <SelectionCard
            title="旅行先で探す"
            subtitle="準備中：旅行先の滞在時間に合わせた提案を予定しています"
            onPress={() => {}}
            disabled
          />
          <SelectionCard
            title="みんなのドライブ"
            subtitle="準備中：他のユーザーが見つけたルートの共有を予定しています"
            onPress={() => {}}
            disabled
          />
          <SelectionCard
            title="記録を見る"
            subtitle="準備中：これまでのドライブの記録を振り返れるようにする予定です"
            onPress={() => {}}
            disabled
          />
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
    paddingTop: 32,
  },
  header: {
    marginBottom: 32,
  },
  appName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 12,
  },
  tagline: {
    fontSize: 16,
    lineHeight: 24,
    color: '#243036',
    marginBottom: 12,
  },
  subTagline: {
    fontSize: 14,
    lineHeight: 21,
    color: '#5b6770',
  },
  actions: {
    gap: 4,
  },
});
