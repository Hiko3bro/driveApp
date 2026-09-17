import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/design-tokens';
import { useDriveFlow } from '@/contexts/drive-flow-context';

/**
 * 「今すぐドライブ」タブは(tabs)/_layout.tsxのtabPressで横取りし、通常はこの画面は
 * 表示されない。タブ長押し・直接のディープリンク等で万一ここへ来た場合の
 * フォールバックとして、同じ導線(新規planning session→出発地点選択)へ進める。
 */
export default function DriveTabFallbackScreen() {
  const { resetPlanningSession } = useDriveFlow();

  useEffect(() => {
    resetPlanningSession();
    router.replace('/departure');
  }, [resetPlanningSession]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centerContent}>
        <ActivityIndicator size="large" color={Colors.accentBlue} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
