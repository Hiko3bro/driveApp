import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import type { RouteOption } from '@/types/route';

function resolveRoute(routes: RouteOption[], selectedRouteId: string | null): RouteOption | null {
  if (routes.length === 0) {
    return null;
  }
  return routes.find((route) => route.id === selectedRouteId) ?? routes[0];
}

export default function RouteSummaryScreen() {
  const { departure, conditions, routes, selectedRouteId } = useDriveFlow();
  const route = resolveRoute(routes, selectedRouteId);

  useEffect(() => {
    if (!departure || !conditions || !route) {
      router.replace('/departure');
    }
  }, [departure, conditions, route]);

  if (!departure || !conditions || !route) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.badge}>ルートを選択しました</Text>
        <Text style={styles.routeName}>{route.name}</Text>
        <Text style={styles.meta}>
          {route.distanceKm}km ・ 約{route.durationMinutes}分
        </Text>

        <View style={styles.tagRow}>
          {route.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ルートの特徴</Text>
          <Text style={styles.description}>{route.description}</Text>
          <Text style={styles.highlight}>{route.highlight}</Text>
        </View>

        <View style={styles.noticeBox}>
          <Text style={styles.noticeText}>
            この先の寄り道スポットの詳細探索や記録機能は準備中です。今回はここまでのルート提案・比較の体験をお試しいただけます。
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="ルート比較に戻る" variant="secondary" onPress={() => router.back()} />
      </View>
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
  },
  badge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0a7ea4',
    marginBottom: 8,
  },
  routeName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 8,
  },
  meta: {
    fontSize: 14,
    color: '#5b6770',
    marginBottom: 12,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  tag: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#eef2f3',
  },
  tagText: {
    fontSize: 12,
    color: '#334',
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    color: '#334',
    marginBottom: 8,
  },
  highlight: {
    fontSize: 13,
    color: '#0a7ea4',
    fontWeight: '600',
  },
  noticeBox: {
    borderRadius: 12,
    backgroundColor: '#f5f6f7',
    padding: 14,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#5b6770',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
