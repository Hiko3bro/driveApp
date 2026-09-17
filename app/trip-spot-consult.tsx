import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { searchNearbyPlaces, type PlaceCandidate, type PlaceSearchCategory } from '@/services/spot/google-places-client';
import { CATEGORY_TO_SPOT_CATEGORY } from '@/services/spot/google-places-spot-provider';
import { addSavedPlace, appendTimelineEntries, getTrip, resolvePreviousDayAnchor } from '@/services/trip/trip-store';
import type { PlaceSelection } from '@/types/location';

// 実機で確認済みの既知の問題(route-planでのDriveMapViewマウントによるiOS + Expo Go
// ネイティブクラッシュ、docs/DECISIONS.md参照)を踏まえ、この画面でも地図は表示せず
// カード一覧のみにとどめる(drive-recording.tsxと同じ回避方針)。地図表示は
// Development Buildでの既知の問題再現状況を確認した後に改めて検討する。

const SEARCH_RADIUS_METERS = 6_000;
const MAX_RESULTS = 8;

type LoadState = 'loading' | 'no_anchor' | 'error' | 'ready';

/**
 * Google Placesの実在候補をカードで表示し、
 * - dayId有り: 旧来の「旅行の1日のタイムラインへ追加」(trip-day-timeline.tsxから到達、後方互換)
 * - dayId無し: 「ドライブ計画の気になる場所として保存」(旧trip-detail.tsx経路。
 *   新しいメインUX(drive-plan-chat.tsx)はGoogle Places Text Search経由で直接
 *   実座標を解決するため、この画面は経由しない)
 * のどちらでも使える汎用画面。
 */
export default function TripSpotConsultScreen() {
  const { tripId, dayId, category, areaHint, note } = useLocalSearchParams<{
    tripId: string;
    dayId?: string;
    category: PlaceSearchCategory;
    areaHint?: string;
    note?: string;
  }>();

  const [state, setState] = useState<LoadState>('loading');
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [anchorLabel, setAnchorLabel] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!tripId || !category) {
        setState('error');
        return;
      }
      const trip = await getTrip(tripId);
      if (!active) {
        return;
      }
      if (!trip) {
        setState('error');
        return;
      }

      // 実座標はGoogle Placesの検索centerとしてのみ使う。AIへは送らない(既存のSecurity Policyを維持)。
      let anchor: PlaceSelection | null = null;
      if (dayId) {
        const day = trip.days.find((candidateDay) => candidateDay.id === dayId);
        if (!day) {
          setState('error');
          return;
        }
        anchor = day.startLocation ?? day.endLocation ?? resolvePreviousDayAnchor(trip, dayId);
      } else {
        anchor = trip.departurePlace ?? trip.destinationPlace ?? trip.savedPlaces?.[0]?.place ?? null;
      }
      if (!anchor) {
        setState('no_anchor');
        return;
      }
      setAnchorLabel(anchor.label);

      const outcome = await searchNearbyPlaces({
        center: anchor.coordinates,
        radiusMeters: SEARCH_RADIUS_METERS,
        category,
        maxResults: MAX_RESULTS,
      });
      if (!active) {
        return;
      }
      if (!outcome.ok) {
        setState('error');
        return;
      }
      setCandidates(outcome.places);
      setState('ready');
    })();
    return () => {
      active = false;
    };
  }, [tripId, dayId, category]);

  const handleAdd = async (candidate: PlaceCandidate) => {
    if (!tripId || busyId) {
      return;
    }
    setBusyId(candidate.id);
    const place: PlaceSelection = {
      label: candidate.name,
      coordinates: { latitude: candidate.latitude, longitude: candidate.longitude },
    };
    const ok = dayId
      ? await appendTimelineEntries(tripId, dayId, [{ title: candidate.name, place, timeHint: { kind: 'unspecified' } }])
      : await addSavedPlace(tripId, {
          place,
          category: category ? CATEGORY_TO_SPOT_CATEGORY[category] : undefined,
          note: note || undefined,
          isAiSuggested: Boolean(note || areaHint),
        });
    if (ok) {
      setAddedIds((prev) => new Set(prev).add(candidate.id));
    }
    setBusyId(null);
  };

  const addLabel = dayId ? '予定に追加' : '気になる場所に保存';
  const addedLabel = dayId ? '予定に追加しました' : '保存しました';

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{category ? CATEGORY_TO_SPOT_CATEGORY[category] : ''}の候補</Text>
        {areaHint && <Text style={styles.subtleText}>AIが提案したエリアの手がかり: {areaHint}</Text>}
        {note && (
          <View style={styles.aiNoteBox}>
            <Text style={styles.aiNoteLabel}>AIのコメント(参考情報です)</Text>
            <Text style={styles.aiNoteText}>{note}</Text>
          </View>
        )}
        {anchorLabel && <Text style={styles.subtleText}>{anchorLabel}の周辺から探しています。</Text>}

        {state === 'loading' && (
          <View style={styles.centerContent}>
            <ActivityIndicator color="#0a7ea4" />
            <Text style={styles.statusText}>周辺のスポットを探しています…</Text>
          </View>
        )}

        {state === 'no_anchor' && (
          <View style={styles.centerContent}>
            <Text style={styles.statusText}>
              {dayId
                ? 'この日にはまだ場所の情報がありません。出発地点などを先に設定すると、周辺のスポットを探せます。'
                : 'まだ場所の手がかりがありません。出発地点・目的地・気になる場所のいずれかを先に設定すると、周辺のスポットを探せます。'}
            </Text>
          </View>
        )}

        {state === 'error' && (
          <View style={styles.centerContent}>
            <Text style={styles.statusText}>スポットを取得できませんでした。もう一度お試しください。</Text>
          </View>
        )}

        {state === 'ready' && candidates.length === 0 && (
          <View style={styles.centerContent}>
            <Text style={styles.statusText}>周辺で見つかりませんでした。エリアを変えてAIに相談してみてください。</Text>
          </View>
        )}

        {state === 'ready' &&
          candidates.map((candidate) => {
            const added = addedIds.has(candidate.id);
            return (
              <View key={candidate.id} style={styles.card}>
                <Text style={styles.cardName}>{candidate.name}</Text>
                <Text style={styles.cardMeta}>Google Placesで確認された実在の場所です。</Text>
                <PrimaryButton
                  label={added ? addedLabel : addLabel}
                  variant={added ? 'secondary' : 'primary'}
                  disabled={added || busyId === candidate.id}
                  onPress={() => handleAdd(candidate)}
                  style={styles.cardButton}
                />
              </View>
            );
          })}
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="戻る" variant="secondary" onPress={() => router.back()} />
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
    padding: 20,
    gap: 12,
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
  },
  aiNoteBox: {
    borderRadius: 12,
    backgroundColor: '#f2fbfd',
    padding: 12,
  },
  aiNoteLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0a7ea4',
    marginBottom: 3,
  },
  aiNoteText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334',
    fontStyle: 'italic',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  statusText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5b6770',
    textAlign: 'center',
  },
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 14,
    gap: 8,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
  },
  cardMeta: {
    fontSize: 11,
    color: '#5b6770',
  },
  cardButton: {
    marginTop: 4,
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
