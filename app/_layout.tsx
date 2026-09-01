import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
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
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="departure" options={{ title: '出発地点を選ぶ' }} />
          <Stack.Screen name="conditions" options={{ title: 'ドライブ条件を入力' }} />
          <Stack.Screen name="route-compare" options={{ title: 'ルートを比較する' }} />
          <Stack.Screen name="route-summary" options={{ title: 'ルート決定' }} />
          <Stack.Screen name="spot-discovery" options={{ title: '周辺スポットを探す' }} />
          <Stack.Screen name="route-plan" options={{ title: 'ルート確認' }} />
          <Stack.Screen name="drive-recording" options={{ title: 'ドライブ記録', headerBackVisible: false }} />
          <Stack.Screen name="drive-summary" options={{ title: '記録結果確認' }} />
          <Stack.Screen name="drive-diary-create" options={{ title: '日記作成' }} />
          <Stack.Screen name="drive-diary-confirm" options={{ title: '日記確認' }} />
        </Stack>
      </DriveFlowProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
