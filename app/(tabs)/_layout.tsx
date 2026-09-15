import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDriveFlow } from '@/contexts/drive-flow-context';

const ACTIVE_COLOR = '#0a7ea4';
const INACTIVE_COLOR = '#8b959c';

/**
 * 下部ナビ: ホーム|日記|今すぐドライブ|旅行プラン|プロフィール。
 * 「今すぐドライブ」は独自のタブ画面を持たず、タブ押下を横取りして常に新規の
 * planning session(resetPlanningSession)から出発地点選択へ進む(既存の
 * ホーム画面の「今からドライブ」ボタンと同じ導線)。既存のウィザード・
 * ルート比較・記録・日記作成等の画面は、このTabsの外側(ルートのStack)に
 * そのまま残しており、タブ内に無理に押し込んでいない。
 */
export default function TabsLayout() {
  const { resetPlanningSession } = useDriveFlow();
  const insets = useSafeAreaInsets();

  const handleStartDrive = () => {
    resetPlanningSession();
    router.push('/departure');
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
        tabBarLabelStyle: styles.label,
        tabBarStyle: [styles.tabBar, { height: 56 + insets.bottom, paddingBottom: Math.max(insets.bottom, 8) }],
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'ホーム',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="diary"
        options={{
          title: '日記',
          tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="drive"
        options={{
          title: '今すぐドライブ',
          tabBarLabelStyle: styles.driveLabel,
          tabBarIcon: () => (
            <View style={styles.driveIconWrap}>
              <Ionicons name="car-sport" size={26} color="#fff" />
            </View>
          ),
          tabBarAccessibilityLabel: '今すぐドライブ。新しいドライブの計画を始めます',
        }}
        listeners={{
          tabPress: (event) => {
            event.preventDefault();
            handleStartDrive();
          },
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: '旅行プラン',
          tabBarIcon: ({ color, size }) => <Ionicons name="map-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'プロフィール',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    paddingTop: 6,
    borderTopColor: '#e5e9ea',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  driveLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0a7ea4',
  },
  driveIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
    shadowColor: '#0a7ea4',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
