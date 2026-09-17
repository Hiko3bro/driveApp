import { useFocusEffect } from 'expo-router/react-navigation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MapPointPicker } from '@/components/location/map-point-picker';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SelectionCard } from '@/components/ui/selection-card';
import { DEMO_MAP_REGION } from '@/services/location/coordinates';
import {
  addDraftDays,
  deleteTrip,
  getTrip,
  removeSavedPlace,
  setDeparturePlace,
  setDestinationPlace,
} from '@/services/trip/trip-store';
import type { Coordinates } from '@/types/location';
import type { Trip, TripDay } from '@/types/trip';

/** ドライブ計画の日程は明示的に「分ける」まで大量に作らないため、押されたら
 * 日程全体(startDate〜endDate)ぶんを一度に作る。実際の日数はtrip-store側で
 * 日付範囲・上限にクランプされるため、ここでは大きめの値を渡すだけでよい。 */
const DRAFT_DAY_COUNT_SENTINEL = 999;

function summarizeDay(day: TripDay): string {
  const timeline = day.timeline ?? [];
  if (timeline.length > 0) {
    const preview = [...timeline]
      .sort((a, b) => a.order - b.order)
      .slice(0, 3)
      .map((entry) => entry.title)
      .join(' → ');
    return timeline.length > 3 ? `${preview} …ほか${timeline.length - 3}件` : preview;
  }
  return day.selectedRouteId ? 'ルート決定済み' : 'まだ予定がありません';
}

type Overlay = 'none' | 'departure-map' | 'destination-map';

export default function TripDetailScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    Alert.alert('このドライブ計画を削除しますか?', `「${trip.title}」を削除すると元に戻せません。`, [
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

  const handleConfirmDeparture = async (coordinates: Coordinates) => {
    if (!trip) {
      return;
    }
    setOverlay('none');
    const nextTrip = await setDeparturePlace(trip.id, { label: '指定した出発地点', coordinates });
    if (nextTrip) {
      setTrip(nextTrip);
    } else {
      setError('出発地点を保存できませんでした。もう一度お試しください。');
    }
  };

  const handleConfirmDestination = async (coordinates: Coordinates) => {
    if (!trip) {
      return;
    }
    setOverlay('none');
    const nextTrip = await setDestinationPlace(trip.id, { label: '指定した目的地', coordinates });
    if (nextTrip) {
      setTrip(nextTrip);
    } else {
      setError('目的地を保存できませんでした。もう一度お試しください。');
    }
  };

  const handleRemoveSavedPlace = async (savedPlaceId: string) => {
    if (!trip) {
      return;
    }
    const nextTrip = await removeSavedPlace(trip.id, savedPlaceId);
    if (nextTrip) {
      setTrip(nextTrip);
    }
  };

  const handleCreateDraftDays = async () => {
    if (!trip || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const nextTrip = await addDraftDays(trip.id, DRAFT_DAY_COUNT_SENTINEL);
    if (nextTrip) {
      setTrip(nextTrip);
    } else {
      setError('日程を作れませんでした。もう一度お試しください。');
    }
    setBusy(false);
  };

  if (loaded && !trip) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>ドライブ計画が見つかりませんでした</Text>
          <PrimaryButton label="一覧に戻る" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  if (!trip) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  if (overlay === 'departure-map') {
    return (
      <MapPointPicker
        title="出発地点を地図で選ぶ"
        instruction="地図を動かして、出発地点にしたい場所を中央に合わせてください。"
        initialRegion={trip.departurePlace ? { ...trip.departurePlace.coordinates, latitudeDelta: 0.05, longitudeDelta: 0.05 } : DEMO_MAP_REGION}
        onCancel={() => setOverlay('none')}
        onConfirm={handleConfirmDeparture}
      />
    );
  }
  if (overlay === 'destination-map') {
    return (
      <MapPointPicker
        title="目的地を地図で選ぶ"
        instruction="地図を動かして、目的地にしたい場所を中央に合わせてください。"
        initialRegion={trip.destinationPlace ? { ...trip.destinationPlace.coordinates, latitudeDelta: 0.05, longitudeDelta: 0.05 } : DEMO_MAP_REGION}
        onCancel={() => setOverlay('none')}
        onConfirm={handleConfirmDestination}
      />
    );
  }

  const savedPlaces = trip.savedPlaces ?? [];
  const anchorCount = (trip.departurePlace ? 1 : 0) + (trip.destinationPlace ? 1 : 0) + savedPlaces.length;
  const canSearchSegment = anchorCount >= 2;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{trip.title}</Text>
        <Text style={styles.dates}>
          {trip.areaName ? `${trip.areaName} ・ ` : ''}
          {trip.startDate} 〜 {trip.endDate}
        </Text>

        <View style={styles.placeRow}>
          <View style={styles.placeRowText}>
            <Text style={styles.placeRowLabel}>出発地点</Text>
            <Text style={styles.placeRowValue}>{trip.departurePlace?.label ?? '未設定'}</Text>
          </View>
          <PrimaryButton
            label={trip.departurePlace ? '変更' : '地図で設定'}
            variant="secondary"
            onPress={() => setOverlay('departure-map')}
            style={styles.placeRowButton}
          />
        </View>
        <View style={styles.placeRow}>
          <View style={styles.placeRowText}>
            <Text style={styles.placeRowLabel}>目的地</Text>
            <Text style={styles.placeRowValue}>{trip.destinationPlace?.label ?? '未設定'}</Text>
          </View>
          <PrimaryButton
            label={trip.destinationPlace ? '変更' : '地図で設定'}
            variant="secondary"
            onPress={() => setOverlay('destination-map')}
            style={styles.placeRowButton}
          />
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <PrimaryButton
          label="AIに相談する(新しいドライブ計画画面へ)"
          onPress={() => router.push('/drive-plan-chat')}
          style={styles.aiButton}
        />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>気になる場所</Text>
          {savedPlaces.length === 0 ? (
            <Text style={styles.emptyText}>まだありません。AIに相談して見つかった場所を保存してみてください。</Text>
          ) : (
            savedPlaces.map((place) => (
              <View key={place.id} style={styles.savedPlaceCard}>
                <View style={styles.savedPlaceHeader}>
                  {place.category && <Text style={styles.savedPlaceCategory}>{place.category}</Text>}
                  <Text style={styles.savedPlaceName}>{place.place.label}</Text>
                </View>
                {place.note && <Text style={styles.savedPlaceNote}>{place.note}</Text>}
                <PrimaryButton
                  label="削除"
                  variant="secondary"
                  onPress={() => handleRemoveSavedPlace(place.id)}
                  style={styles.savedPlaceRemoveButton}
                />
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <PrimaryButton
            label="区間のドライブを探す"
            variant="secondary"
            disabled={!canSearchSegment}
            onPress={() => router.push({ pathname: '/drive-plan-segment', params: { tripId: trip.id } })}
          />
          {!canSearchSegment && (
            <Text style={styles.hintText}>出発地点・目的地・気になる場所をあわせて2つ以上見つけると使えます。</Text>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.sectionTitleMuted}>日程で管理する(任意)</Text>
          {trip.days.length === 0 ? (
            <>
              <Text style={styles.hintText}>
                候補が固まってきたら、日程(Day1・Day2…)に分けて1日ごとの予定を組み立てられます。
              </Text>
              <PrimaryButton
                label={busy ? '作成しています…' : '日程に分けてみる'}
                variant="secondary"
                onPress={handleCreateDraftDays}
                disabled={busy}
              />
            </>
          ) : (
            trip.days.map((day, index) => (
              <SelectionCard
                key={day.id}
                title={`${index + 1}日目 ・ ${day.date}`}
                subtitle={summarizeDay(day)}
                onPress={() =>
                  router.push({ pathname: '/trip-day-timeline', params: { tripId: trip.id, dayId: day.id } })
                }
              />
            ))
          )}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label="このドライブ計画を削除" variant="secondary" onPress={handleDelete} />
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
    gap: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 2,
  },
  dates: {
    fontSize: 13,
    color: '#5b6770',
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 12,
    gap: 10,
  },
  placeRowText: {
    flex: 1,
  },
  placeRowLabel: {
    fontSize: 11,
    color: '#8b959c',
    fontWeight: '600',
  },
  placeRowValue: {
    fontSize: 15,
    color: '#11181C',
    fontWeight: '600',
  },
  placeRowButton: {
    minHeight: 40,
    paddingHorizontal: 14,
  },
  aiButton: {
    marginTop: 4,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#11181C',
  },
  sectionTitleMuted: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8b959c',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#8b959c',
  },
  hintText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#8b959c',
  },
  savedPlaceCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 14,
    gap: 6,
  },
  savedPlaceHeader: {
    gap: 3,
  },
  savedPlaceCategory: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0a7ea4',
  },
  savedPlaceName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
  },
  savedPlaceNote: {
    fontSize: 12,
    lineHeight: 18,
    color: '#5b6770',
    fontStyle: 'italic',
  },
  savedPlaceRemoveButton: {
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: 12,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#eef2f3',
    marginVertical: 4,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
