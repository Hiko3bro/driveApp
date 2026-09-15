import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { DriveFlowProvider } from '@/contexts/drive-flow-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <DriveFlowProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
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
          <Stack.Screen name="trip-day-detail" options={{ title: 'この日の予定' }} />
        </Stack>
      </DriveFlowProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
