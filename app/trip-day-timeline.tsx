import { useFocusEffect } from 'expo-router/react-navigation';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { OptionChip } from '@/components/ui/option-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import {
  buildDriveConditionsFromDay,
  getTrip,
  removeTimelineEntry,
  reorderTimelineEntries,
  appendTimelineEntries,
} from '@/services/trip/trip-store';
import type { Trip, TripDay, TripTimelineEntry, TripTimeHint, TransportMode } from '@/types/trip';

const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  walk: '徒歩',
  bike: '自転車',
  car: '車',
  train: '電車',
  plane: '飛行機',
  other: 'その他',
};
const TRANSPORT_MODE_OPTIONS: TransportMode[] = ['walk', 'bike', 'car', 'train', 'plane', 'other'];

function formatTimeHint(hint?: TripTimeHint): string {
  if (!hint || hint.kind === 'unspecified') {
    return '時間未定';
  }
  if (hint.kind === 'vague') {
    return hint.vagueLabel && hint.vagueLabel.length > 0 ? hint.vagueLabel : '時間未定';
  }
  if (hint.kind === 'exact' && hint.exactTime) {
    return hint.isEstimate ? `${hint.exactTime}頃(目安)` : hint.exactTime;
  }
  return '時間未定';
}

function sortedTimeline(day: TripDay | undefined): TripTimelineEntry[] {
  return [...(day?.timeline ?? [])].sort((a, b) => a.order - b.order);
}

export default function TripDayTimelineScreen() {
  const { tripId, dayId } = useLocalSearchParams<{ tripId: string; dayId: string }>();
  const { resetPlanningSession, setActiveTripDay, setConditions, setDeparture } = useDriveFlow();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTransportMode, setNewTransportMode] = useState<TransportMode | null>(null);
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

  const day = trip?.days.find((candidate) => candidate.id === dayId);
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

  const entries = sortedTimeline(day);

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= entries.length || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const nextOrderIds = entries.map((entry) => entry.id);
    [nextOrderIds[index], nextOrderIds[targetIndex]] = [nextOrderIds[targetIndex], nextOrderIds[index]];
    const nextTrip = await reorderTimelineEntries(trip.id, day.id, nextOrderIds);
    if (nextTrip) {
      setTrip(nextTrip);
    } else {
      setError('並べ替えを保存できませんでした。もう一度お試しください。');
    }
    setBusy(false);
  };

  const handleDelete = (entry: TripTimelineEntry) => {
    Alert.alert('この予定を削除しますか?', entry.title, [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '削除する',
        style: 'destructive',
        onPress: async () => {
          const nextTrip = await removeTimelineEntry(trip.id, day.id, entry.id);
          if (nextTrip) {
            setTrip(nextTrip);
          } else {
            setError('削除できませんでした。もう一度お試しください。');
          }
        },
      },
    ]);
  };

  const handleAddManualEntry = async () => {
    const title = newTitle.trim();
    if (title.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const nextTrip = await appendTimelineEntries(trip.id, day.id, [
      {
        title,
        transportMode: newTransportMode ?? undefined,
        timeHint: { kind: 'unspecified' },
      },
    ]);
    if (nextTrip) {
      setTrip(nextTrip);
      setNewTitle('');
      setNewTransportMode(null);
    } else {
      setError('予定を追加できませんでした。もう一度お試しください。');
    }
    setBusy(false);
  };

  const handleFindRouteForEntry = (entry: TripTimelineEntry) => {
    resetPlanningSession();
    setActiveTripDay({ tripId: trip.id, dayId: day.id, entryId: entry.id });
    setConditions(buildDriveConditionsFromDay(day));
    if (day.startLocation) {
      setDeparture({ source: 'custom', coordinates: day.startLocation.coordinates, label: day.startLocation.label });
      router.push('/conditions');
    } else {
      router.push('/departure');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.badge}>{dayIndex + 1}日目</Text>
        <Text style={styles.title}>{day.date}</Text>
        <Text style={styles.subtleText}>
          時間は目安です。予定通りに進まなくても大丈夫、あとから並べ替えたり調整したりできます。
        </Text>

        {entries.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>まだ予定がありません。AIに相談するか、下から追加してください。</Text>
          </View>
        ) : (
          <View style={styles.timeline}>
            {entries.map((entry, index) => (
              <View key={entry.id} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={styles.timelineDot} />
                  {index < entries.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineCard}>
                  <Text style={styles.timelineTime}>{formatTimeHint(entry.timeHint)}</Text>
                  <Text style={styles.timelineEntryTitle}>{entry.title}</Text>
                  {entry.transportMode && (
                    <Text style={styles.timelineTransport}>{TRANSPORT_MODE_LABELS[entry.transportMode]}で移動</Text>
                  )}
                  {entry.note && <Text style={styles.timelineNote}>{entry.note}</Text>}
                  {entry.isAiSuggested && <Text style={styles.aiSuggestedBadge}>AIの提案</Text>}

                  <View style={styles.timelineActionsRow}>
                    <PrimaryButton
                      label="↑"
                      variant="secondary"
                      onPress={() => handleMove(index, -1)}
                      disabled={busy || index === 0}
                      style={styles.smallButton}
                    />
                    <PrimaryButton
                      label="↓"
                      variant="secondary"
                      onPress={() => handleMove(index, 1)}
                      disabled={busy || index === entries.length - 1}
                      style={styles.smallButton}
                    />
                    {entry.transportMode === 'car' && (
                      <PrimaryButton
                        label={entry.routeOptionId ? 'ルートを見直す' : 'ルートを探す'}
                        variant="secondary"
                        onPress={() => handleFindRouteForEntry(entry)}
                        style={styles.smallButton}
                      />
                    )}
                    <PrimaryButton
                      label="削除"
                      variant="secondary"
                      onPress={() => handleDelete(entry)}
                      style={styles.smallButton}
                    />
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.addBox}>
          <Text style={styles.sectionTitle}>予定を追加</Text>
          <TextInput
            style={styles.textField}
            value={newTitle}
            onChangeText={setNewTitle}
            placeholder="例: 高知城を見学"
            placeholderTextColor="#9aa5ab"
            accessibilityLabel="予定のタイトル"
          />
          <View style={styles.chipRow}>
            {TRANSPORT_MODE_OPTIONS.map((mode) => (
              <OptionChip
                key={mode}
                label={TRANSPORT_MODE_LABELS[mode]}
                selected={newTransportMode === mode}
                onPress={() => setNewTransportMode((current) => (current === mode ? null : mode))}
              />
            ))}
          </View>
          <PrimaryButton
            label="この予定を追加"
            onPress={handleAddManualEntry}
            disabled={busy || newTitle.trim().length === 0}
          />
        </View>

        <PrimaryButton label="従来の方法(条件から探す)で設定する" variant="secondary" onPress={() => router.push({ pathname: '/trip-day-detail', params: { tripId: trip.id, dayId: day.id } })} />
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton
          label="AIへの相談はドライブ計画のホームから"
          variant="secondary"
          onPress={() => router.push({ pathname: '/trip-detail', params: { tripId: trip.id } })}
        />
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
  },
  subtleText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#8b959c',
  },
  emptyBox: {
    borderRadius: 14,
    backgroundColor: '#f5f6f7',
    padding: 16,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5b6770',
    textAlign: 'center',
  },
  timeline: {
    gap: 0,
  },
  timelineRow: {
    flexDirection: 'row',
  },
  timelineRail: {
    width: 20,
    alignItems: 'center',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#0a7ea4',
    marginTop: 6,
  },
  timelineLine: {
    flex: 1,
    width: 2,
    backgroundColor: '#d7dee0',
    marginVertical: 2,
  },
  timelineCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 14,
    marginBottom: 14,
    marginLeft: 8,
  },
  timelineTime: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8b959c',
    marginBottom: 2,
  },
  timelineEntryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 2,
  },
  timelineTransport: {
    fontSize: 12,
    color: '#0a7ea4',
    fontWeight: '600',
  },
  timelineNote: {
    fontSize: 12,
    lineHeight: 17,
    color: '#5b6770',
    marginTop: 4,
  },
  aiSuggestedBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7a5b18',
    backgroundColor: '#fff5d6',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  timelineActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  smallButton: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    lineHeight: 17,
  },
  addBox: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#11181C',
  },
  textField: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#d7dee0',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#11181C',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
  },
});
