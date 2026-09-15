import { useFocusEffect } from 'expo-router/react-navigation';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { deleteTrip, getTrips } from '@/services/trip/trip-store';
import type { Trip } from '@/types/trip';

function todayDateOnly(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function TripsTabScreen() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    getTrips().then((loadedTrips) => {
      setTrips(loadedTrips);
      setLoaded(true);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const today = todayDateOnly();
  const upcomingTrips = trips.filter((trip) => trip.endDate >= today);
  const pastTrips = trips.filter((trip) => trip.endDate < today);

  const handleDelete = (trip: Trip) => {
    // 誤操作防止のため、削除前に必ず確認する。
    Alert.alert('旅行プランを削除しますか?', `「${trip.title}」を削除すると元に戻せません。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          deleteTrip(trip.id).then(reload);
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>旅行プラン</Text>
        <PrimaryButton label="新しい旅行プランを作る" onPress={() => router.push('/trip-create')} />

        {loaded && trips.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>まだ旅行プランがありません</Text>
            <Text style={styles.emptyText}>
              旅行名と日程を入れると、日ごとにドライブを計画できます。
            </Text>
          </View>
        )}

        {upcomingTrips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>今後の旅行</Text>
            {upcomingTrips.map((trip) => (
              <TripRow key={trip.id} trip={trip} onDelete={() => handleDelete(trip)} />
            ))}
          </View>
        )}

        {pastTrips.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>過去の旅行</Text>
            {pastTrips.map((trip) => (
              <TripRow key={trip.id} trip={trip} onDelete={() => handleDelete(trip)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function TripRow({ trip, onDelete }: { trip: Trip; onDelete: () => void }) {
  return (
    <View style={styles.tripRow}>
      <Pressable
        style={styles.tripRowMain}
        onPress={() => router.push({ pathname: '/trip-detail', params: { tripId: trip.id } })}
        accessibilityRole="button"
        accessibilityLabel={`${trip.title}を開く`}>
        <Text style={styles.tripTitle}>{trip.title}</Text>
        <Text style={styles.tripDates}>
          {trip.startDate} 〜 {trip.endDate} ・ {trip.days.length}日間
        </Text>
      </Pressable>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        style={styles.deleteButton}
        accessibilityRole="button"
        accessibilityLabel={`${trip.title}を削除`}>
        <Text style={styles.deleteLabel}>削除</Text>
      </Pressable>
    </View>
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
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
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
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    paddingVertical: 4,
    paddingRight: 8,
  },
  tripRowMain: {
    flex: 1,
    padding: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  tripTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 4,
  },
  tripDates: {
    fontSize: 13,
    color: '#5b6770',
  },
  deleteButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#c0392b',
  },
});
