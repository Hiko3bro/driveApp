import { useFocusEffect } from 'expo-router/react-navigation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { buildDriveConditionsFromDay, getTrip } from '@/services/trip/trip-store';
import { formatMinutesLabel } from '@/types/drive';
import type { Trip, TripDay } from '@/types/trip';

export default function TripDayDetailScreen() {
  const { tripId, dayId } = useLocalSearchParams<{ tripId: string; dayId: string }>();
  const { resetPlanningSession, beginConditionsEdit, setActiveTripDay, setConditions, setDeparture, setRoutes, setSelectedRouteId } =
    useDriveFlow();
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

  const day: TripDay | undefined = trip?.days.find((candidate) => candidate.id === dayId);
  const dayIndex = trip?.days.findIndex((candidate) => candidate.id === dayId) ?? -1;

  if (loaded && (!trip || !day)) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>この日の情報が見つかりませんでした</Text>
          <PrimaryButton label="旅行プランに戻る" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip || !day) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const hasDecidedRoute = Boolean(day.selectedRouteId) && day.generatedRoutes.length > 0;
  const selectedRoute = day.generatedRoutes.find((route) => route.id === day.selectedRouteId);

  const seedTripDayContext = () => {
    resetPlanningSession();
    setActiveTripDay({ tripId: trip.id, dayId: day.id });
    setConditions(buildDriveConditionsFromDay(day));
    if (day.startLocation) {
      setDeparture({ source: 'custom', coordinates: day.startLocation.coordinates, label: day.startLocation.label });
    }
  };

  const handleStartFresh = () => {
    seedTripDayContext();
    router.push(day.startLocation ? '/conditions' : '/departure');
  };

  const handleEditConditions = () => {
    seedTripDayContext();
    beginConditionsEdit();
    router.push(day.startLocation ? '/conditions' : '/departure');
  };

  const handleViewDecidedRoute = () => {
    if (!day.selectedRouteId) {
      return;
    }
    seedTripDayContext();
    setRoutes(day.generatedRoutes);
    setSelectedRouteId(day.selectedRouteId);
    router.push('/route-compare');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.badge}>{dayIndex + 1}日目</Text>
        <Text style={styles.title}>{day.date}</Text>

        <View style={styles.card}>
          <Row label="出発地点" value={day.startLocation?.label ?? '未設定'} />
          <Row label="その日の終了地点" value={day.endLocation?.label ?? '出発地点に戻る予定'} />
          <Row
            label="使える時間"
            value={day.availableTimeMinutes ? formatMinutesLabel(day.availableTimeMinutes) : '未設定'}
          />
          <Row
            label="必ず寄りたい場所"
            value={day.mustVisitPlaces.length > 0 ? day.mustVisitPlaces.map((point) => point.label).join('・') : 'なし'}
          />
          <Row label="AIへの希望" value={day.aiNote && day.aiNote.length > 0 ? day.aiNote : 'なし'} />
        </View>

        {hasDecidedRoute && selectedRoute && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>決定済みルート</Text>
            <Text style={styles.routeName}>{selectedRoute.name}</Text>
            <Text style={styles.routeMeta}>
              {selectedRoute.distanceKm}km ・ 約{selectedRoute.durationMinutes}分
            </Text>
            {selectedRoute.warning && <Text style={styles.warningText}>{selectedRoute.warning}</Text>}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {hasDecidedRoute ? (
          <>
            <PrimaryButton label="決定済みルートを見る" onPress={handleViewDecidedRoute} />
            <PrimaryButton label="条件を変えて探し直す" variant="secondary" onPress={handleEditConditions} />
          </>
        ) : (
          <PrimaryButton label="この日のルートを探す" onPress={handleStartFresh} />
        )}
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
    gap: 16,
  },
  badge: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0a7ea4',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 8,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 10,
  },
  row: {
    gap: 2,
  },
  rowLabel: {
    fontSize: 12,
    color: '#8b959c',
    fontWeight: '600',
  },
  rowValue: {
    fontSize: 15,
    color: '#11181C',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8b959c',
  },
  routeName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
  },
  routeMeta: {
    fontSize: 13,
    color: '#5b6770',
  },
  warningText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#c0392b',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    gap: 10,
  },
});
