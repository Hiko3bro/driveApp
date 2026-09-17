import { DarkTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { Colors, Typography } from '@/constants/design-tokens';
import { DriveFlowProvider } from '@/contexts/drive-flow-context';

/**
 * アプリ全体を固定darkにする(OSのlight/dark自動切替は今回導入しない、
 * constants/design-tokens.ts参照)。まだVisualを作り直していないネイティブヘッダーの
 * 画面も、React NavigationのDarkThemeとscreenOptionsのdarkトークンに揃えることで、
 * 濃色チャット/Homeとの明暗の食い違いが起きないようにしている。
 *
 * headerBackButtonDisplayMode: 'minimal' は、戻るボタンのlabelとして前の画面の
 * routeID(例:「(tabs)」という内部routing名)がそのまま表示されてしまう不具合を
 * 構造的に防ぐ(labelを一切出さず、chevronアイコンのみにする)。個々の画面で
 * headerBackTitleを設定して回るのではなく、ここで一括対応する。
 */
export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <DriveFlowProvider>
        <Stack
          screenOptions={{
            headerBackButtonDisplayMode: 'minimal',
            headerTintColor: Colors.accentBlue,
            headerStyle: { backgroundColor: Colors.background },
            headerTitleStyle: { color: Colors.textPrimary, fontSize: Typography.cardTitle.fontSize, fontWeight: Typography.cardTitle.fontWeight },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: Colors.background },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'ホーム' }} />
          <Stack.Screen name="departure" options={{ title: '出発地点を選ぶ' }} />
          <Stack.Screen name="conditions" options={{ headerShown: false }} />
          <Stack.Screen name="route-compare" options={{ title: 'ルートを比較する' }} />
          <Stack.Screen name="route-summary" options={{ title: 'ルート決定' }} />
          <Stack.Screen name="spot-discovery" options={{ title: '周辺スポットを探す' }} />
          <Stack.Screen name="route-plan" options={{ title: 'ルート確認' }} />
          <Stack.Screen name="drive-recording" options={{ title: 'ドライブ記録', headerBackVisible: false }} />
          <Stack.Screen name="drive-summary" options={{ title: '記録結果確認' }} />
          <Stack.Screen name="drive-diary-create" options={{ title: '日記作成' }} />
          <Stack.Screen name="drive-diary-confirm" options={{ title: '日記確認' }} />
          <Stack.Screen name="drive-diary-share" options={{ title: '共有する' }} />
          <Stack.Screen name="diary-detail" options={{ title: '日記' }} />
          <Stack.Screen name="trip-create" options={{ title: '旅行プランを作る' }} />
          <Stack.Screen name="trip-detail" options={{ title: '旅行プラン' }} />
          <Stack.Screen name="trip-day-detail" options={{ title: 'この日の予定(従来の方法)' }} />
          <Stack.Screen name="trip-day-timeline" options={{ title: 'この日のしおり' }} />
          <Stack.Screen name="trip-spot-consult" options={{ title: 'スポットの候補' }} />
          <Stack.Screen name="drive-plan-segment" options={{ title: '区間のドライブを探す' }} />
          <Stack.Screen name="drive-plan-chat" options={{ headerShown: false }} />
        </Stack>
      </DriveFlowProvider>
      <StatusBar style="light" />
    </ThemeProvider>
  );
}
