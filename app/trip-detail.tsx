import { useFocusEffect } from 'expo-router/react-navigation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { SelectionCard } from '@/components/ui/selection-card';
import { deleteTrip, getTrip } from '@/services/trip/trip-store';
import { formatMinutesLabel } from '@/types/drive';
import type { Trip, TripDay } from '@/types/trip';

function summarizeDay(day: TripDay): string {
  const parts: string[] = [];
  if (day.startLocation) {
    parts.push(`${day.startLocation.label}発`);
  }
  if (day.endLocation) {
    parts.push(`${day.endLocation.label}着`);
  } else if (day.startLocation) {
    parts.push('出発地点に戻る');
  }
  if (day.availableTimeMinutes) {
    parts.push(formatMinutesLabel(day.availableTimeMinutes));
  }
  if (day.mustVisitPlaces.length > 0) {
    parts.push(`必ず寄りたい場所 ${day.mustVisitPlaces.length}か所`);
  }
  if (day.selectedRouteId) {
    parts.push('ルート決定済み');
  }
  return parts.length > 0 ? parts.join(' ・ ') : 'まだ条件を入力していません';
}

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (!tripId) {
        setLoaded(true);
        return;
      }
      getTrip(tripId).then((loadedTrip) => {
        if (active) {
          setTrip(loadedTrip);
          setLoaded(true);
        }
      });
      return () => {
        active = false;
      };
    }, [tripId])
  );

  const handleDelete = () => {
    if (!trip) {
      return;
    }
    Alert.alert('旅行プランを削除しますか?', `「${trip.title}」を削除すると元に戻せません。`, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: () => {
          deleteTrip(trip.id).then(() => router.back());
        },
      },
    ]);
  };

  if (loaded && !trip) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>旅行プランが見つかりませんでした</Text>
          <PrimaryButton label="旅行プラン一覧に戻る" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{trip.title}</Text>
        <Text style={styles.dates}>
          {trip.startDate} 〜 {trip.endDate} ・ {trip.days.length}日間
        </Text>

        <View style={styles.section}>
          {trip.days.map((day, index) => (
            <SelectionCard
              key={day.id}
              title={`${index + 1}日目 ・ ${day.date}`}
              subtitle={summarizeDay(day)}
              onPress={() =>
                router.push({ pathname: '/trip-day-detail', params: { tripId: trip.id, dayId: day.id } })
              }
            />
          ))}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="この旅行プランを削除" variant="secondary" onPress={handleDelete} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
    textAlign: 'center',
  },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 4,
  },
  dates: {
    fontSize: 13,
    color: '#5b6770',
    marginBottom: 20,
  },
  section: {
    gap: 4,
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
