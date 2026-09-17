import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDriveFlow } from '@/contexts/drive-flow-context';
import { Colors } from '@/constants/design-tokens';

const ACTIVE_COLOR = Colors.accentBlue;
const INACTIVE_COLOR = Colors.textTertiary;

/**
 * 下部ナビ: ホーム|日記|今ドラ|ドライブ計画|プロフィール。
 * 名称・タブ構成は暫定(今回はビジュアルデザインより機能・導線を優先している)。
 * 「今ドラ」(今から走る)は独自のタブ画面を持たず、タブ押下を横取りして常に新規の
 * planning session(resetPlanningSession)から出発地点選択へ進む(既存の
 * ホーム画面の「今からドライブ」ボタンと同じ導線)。「ドライブ計画」(今度走る)は
 * 旧「旅行プラン」タブと同じ画面群(trips.tsx等)をそのまま指す。既存のウィザード・
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
          title: '今ドラ',
          tabBarLabelStyle: styles.driveLabel,
          tabBarIcon: () => (
            <View style={styles.driveIconWrap}>
              <Ionicons name="car-sport" size={24} color={Colors.onAccent} />
            </View>
          ),
          tabBarAccessibilityLabel: '今ドラ。今からちょっと走るための新しいドライブの計画を始めます',
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
          title: 'ドライブ計画',
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
    backgroundColor: Colors.surface,
    borderTopColor: Colors.divider,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  driveLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
  driveIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accentBlue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -16,
    shadowColor: Colors.accentBlue,
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
});
