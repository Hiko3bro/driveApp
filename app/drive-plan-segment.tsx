import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OptionChip } from '@/components/ui/option-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { buildRouteOptionsFromDrivePlans } from '@/services/route/drive-plan-mapper';
import { requestDrivePlans, type DrivePlanPreferences } from '@/services/route/drive-route-planner-client';
import type { PlaceSearchCategory } from '@/services/spot/google-places-client';
import { addDriveSegment, getTrip } from '@/services/trip/trip-store';
import type { PlaceSelection } from '@/types/location';
import type { RouteOption } from '@/types/route';
import type { Trip, TripDriveSegmentCandidate } from '@/types/trip';

/**
 * 「スポットAからスポットBへ移動する間に何か面白いところない?」という区間探索。
 * 既存のdrive-route-planner(時間指定なし+目的地ありパス=基本ルート+corridor anchorの
 * addedMinutes候補、前回実装)をそのまま呼び出す。新規サーバーロジックは無い。
 * 「+30分まで/+1時間まで/気にしない」という上限は、返ってきた候補のaddedMinutesを
 * クライアント側でフィルタするだけで実現し、検索ロジック自体は変更していない。
 * 地図は表示しない(既知のiOS Expo Go + DriveMapViewクラッシュの回避方針を踏襲)。
 */

interface CandidatePoint {
  key: string;
  label: string;
  place: PlaceSelection;
}

const CATEGORY_OPTIONS: { label: string; value: PlaceSearchCategory }[] = [
  { label: '絶景', value: 'scenic' },
  { label: 'ご当地グルメ', value: 'restaurant' },
  { label: '温泉', value: 'onsen' },
  { label: '歴史', value: 'history' },
  { label: 'カフェ', value: 'cafe' },
];

const DETOUR_CAP_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: '+30分まで', value: 30 },
  { label: '+1時間まで', value: 60 },
  { label: '気にしない', value: undefined },
];

function buildCandidatePoints(trip: Trip): CandidatePoint[] {
  const points: CandidatePoint[] = [];
  if (trip.departurePlace) {
    points.push({ key: 'departure', label: `出発地点: ${trip.departurePlace.label}`, place: trip.departurePlace });
  }
  if (trip.destinationPlace) {
    points.push({ key: 'destination', label: `目的地: ${trip.destinationPlace.label}`, place: trip.destinationPlace });
  }
  for (const saved of trip.savedPlaces ?? []) {
    points.push({ key: `saved-${saved.id}`, label: saved.place.label, place: saved.place });
  }
  return points;
}

interface ResultCandidate {
  route: RouteOption;
  addedMinutes?: number;
}

export default function DrivePlanSegmentScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fromKey, setFromKey] = useState<string | null>(null);
  const [toKey, setToKey] = useState<string | null>(null);
  const [category, setCategory] = useState<PlaceSearchCategory>('scenic');
  const [detourCap, setDetourCap] = useState<number | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultCandidate[] | null>(null);
  const [savedRouteIds, setSavedRouteIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    (async () => {
      const loadedTrip = tripId ? await getTrip(tripId) : null;
      if (active) {
        setTrip(loadedTrip);
        setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [tripId]);

  const candidatePoints = useMemo(() => (trip ? buildCandidatePoints(trip) : []), [trip]);
  const fromPoint = candidatePoints.find((point) => point.key === fromKey) ?? null;
  const toPoint = candidatePoints.find((point) => point.key === toKey) ?? null;

  if (loaded && !trip) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centerContent}>
          <Text style={styles.errorTitle}>ドライブ計画が見つかりませんでした</Text>
          <PrimaryButton label="戻る" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }
  if (!trip) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const handleSearch = async () => {
    if (!fromPoint || !toPoint || searching) {
      return;
    }
    setSearching(true);
    setError(null);
    setResults(null);
    setSavedRouteIds(new Set());

    const preferences: DrivePlanPreferences = {
      avoidHighways: false,
      preferScenicRoads: category === 'scenic',
      preferCoastalRoads: false,
      preferMountainRoads: false,
      preferredScenery: [],
      desiredStops: [category],
      drivingStyle: 'balanced',
    };

    const outcome = await requestDrivePlans({
      origin: fromPoint.place.coordinates,
      destination: toPoint.place.coordinates,
      returnTarget: 'different',
      userViaPoints: [],
      availableTimeMinutes: undefined,
      preferences,
    });

    if (!outcome.ok) {
      setError('区間のルートを取得できませんでした。もう一度お試しください。');
      setSearching(false);
      return;
    }

    const routes = buildRouteOptionsFromDrivePlans(outcome.plans, outcome.meta, {
      departureLabel: fromPoint.label,
      destinationLabel: toPoint.label,
      userViaPoints: [],
      avoidHighwaysApplied: false,
    });

    if (routes.length === 0) {
      setError('区間のルートを確認できませんでした。もう一度お試しください。');
      setSearching(false);
      return;
    }

    const baseDuration = routes[0].durationMinutes;
    const candidates: ResultCandidate[] = routes.map((route, index) => ({
      route,
      addedMinutes: index === 0 ? undefined : route.durationMinutes - baseDuration,
    }));
    const filtered = candidates.filter(
      (candidate) => candidate.addedMinutes === undefined || detourCap === undefined || candidate.addedMinutes <= detourCap
    );

    setResults(filtered);
    setSearching(false);
  };

  const handleSaveCandidate = async (candidate: ResultCandidate) => {
    if (!results || !fromPoint || !toPoint) {
      return;
    }
    const segmentCandidates: TripDriveSegmentCandidate[] = results.map((item) => ({
      route: item.route,
      addedMinutes: item.addedMinutes,
    }));
    const nextTrip = await addDriveSegment(trip.id, {
      fromPlace: fromPoint.place,
      toPlace: toPoint.place,
      maxDetourMinutes: detourCap,
      candidates: segmentCandidates,
      selectedRouteId: candidate.route.id,
    });
    if (nextTrip) {
      setTrip(nextTrip);
      setSavedRouteIds((prev) => new Set(prev).add(candidate.route.id));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>区間のドライブを探す</Text>
        <Text style={styles.subtleText}>2つの場所を選ぶと、その間で寄り道できそうな実在スポットを探します。</Text>

        <Text style={styles.label}>出発スポット</Text>
        <View style={styles.chipRow}>
          {candidatePoints.map((point) => (
            <OptionChip key={point.key} label={point.label} selected={fromKey === point.key} onPress={() => setFromKey(point.key)} />
          ))}
        </View>

        <Text style={styles.label}>目的スポット</Text>
        <View style={styles.chipRow}>
          {candidatePoints
            .filter((point) => point.key !== fromKey)
            .map((point) => (
              <OptionChip key={point.key} label={point.label} selected={toKey === point.key} onPress={() => setToKey(point.key)} />
            ))}
        </View>

        <Text style={styles.label}>寄り道の希望</Text>
        <View style={styles.chipRow}>
          {CATEGORY_OPTIONS.map((option) => (
            <OptionChip
              key={option.value}
              label={option.label}
              selected={category === option.value}
              onPress={() => setCategory(option.value)}
            />
          ))}
        </View>

        <Text style={styles.label}>追加時間の目安</Text>
        <View style={styles.chipRow}>
          {DETOUR_CAP_OPTIONS.map((option) => (
            <OptionChip
              key={option.label}
              label={option.label}
              selected={detourCap === option.value}
              onPress={() => setDetourCap(option.value)}
            />
          ))}
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <PrimaryButton
          label={searching ? '探しています…' : 'この区間を探す'}
          onPress={handleSearch}
          disabled={searching || !fromPoint || !toPoint}
        />

        {results && (
          <View style={styles.resultsBox}>
            {results.map((candidate, index) => {
              const saved = savedRouteIds.has(candidate.route.id);
              return (
                <View key={candidate.route.id} style={styles.resultCard}>
                  <Text style={styles.resultName}>{index === 0 ? 'そのまま行く' : candidate.route.name}</Text>
                  <Text style={styles.resultMeta}>
                    {candidate.route.distanceKm}km ・ 約{candidate.route.durationMinutes}分
                    {candidate.addedMinutes !== undefined ? ` ・ +${Math.round(candidate.addedMinutes)}分` : ''}
                  </Text>
                  {candidate.route.warning && <Text style={styles.resultWarning}>{candidate.route.warning}</Text>}
                  <PrimaryButton
                    label={saved ? '保存しました' : 'この案を保存する'}
                    variant={saved ? 'secondary' : 'primary'}
                    disabled={saved}
                    onPress={() => handleSaveCandidate(candidate)}
                    style={styles.resultButton}
                  />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
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
    padding: 20,
    gap: 10,
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#11181C',
  },
  subtleText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#8b959c',
    marginBottom: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#11181C',
    marginTop: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    lineHeight: 17,
  },
  resultsBox: {
    gap: 12,
    marginTop: 10,
  },
  resultCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 14,
    gap: 6,
  },
  resultName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
  },
  resultMeta: {
    fontSize: 13,
    color: '#5b6770',
  },
  resultWarning: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7a5b18',
  },
  resultButton: {
    marginTop: 4,
  },
});
