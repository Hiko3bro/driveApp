import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';
import { pickDiaryPhotos } from '@/services/media/photo-picker';
import { MAX_DIARY_PHOTOS, type DiaryPhoto, type DriveDiaryEntry } from '@/types/drive-diary';

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).getTime());
}

function createDiaryEntryId(): string {
  return `diary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DriveDiaryCreateScreen() {
  const { driveRecord, addDiaryEntry } = useDriveFlow();

  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [date, setDate] = useState(() => toDateInputValue(driveRecord?.endedAt ?? Date.now()));
  const [photos, setPhotos] = useState<DiaryPhoto[]>([]);
  const [isPickingPhotos, setIsPickingPhotos] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingInFlightRef = useRef(false);

  useEffect(() => {
    if (!driveRecord) {
      router.dismissTo('/');
    }
  }, [driveRecord]);

  const remainingPhotoSlots = MAX_DIARY_PHOTOS - photos.length;

  const spotsSummary = useMemo(() => driveRecord?.spots ?? [], [driveRecord]);

  if (!driveRecord) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const handlePickPhotos = async () => {
    if (isPickingPhotos || remainingPhotoSlots <= 0) {
      return;
    }
    setIsPickingPhotos(true);
    setPhotoNotice(null);
    try {
      const result = await pickDiaryPhotos(remainingPhotoSlots);
      if (result.status === 'picked') {
        setPhotos((prev) => [...prev, ...result.photos].slice(0, MAX_DIARY_PHOTOS));
      } else if (result.status === 'denied') {
        setPhotoNotice(
          '写真ライブラリへのアクセスが許可されていません。設定から許可するか、写真なしで日記を作成できます。'
        );
      } else if (result.status === 'unavailable') {
        setPhotoNotice('この環境では写真選択を利用できません。写真なしで日記を作成できます。');
      }
    } finally {
      setIsPickingPhotos(false);
    }
  };

  const handleRemovePhoto = (photoId: string) => {
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
  };

  const handleSave = () => {
    if (savingInFlightRef.current) {
      return;
    }

    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) {
      setSaveError('タイトルを入力してください。');
      return;
    }
    if (!isValidDateInput(date)) {
      setSaveError('日付は YYYY-MM-DD の形式で入力してください。');
      return;
    }

    savingInFlightRef.current = true;
    setSaveError(null);

    const entry: DriveDiaryEntry = {
      id: createDiaryEntryId(),
      title: trimmedTitle,
      memo: memo.trim(),
      date,
      distanceKm: driveRecord.distanceKm,
      durationSeconds: driveRecord.durationSeconds,
      route: driveRecord.route,
      spots: driveRecord.spots,
      photos,
      track: driveRecord.track,
      recordingSource: driveRecord.source,
      createdAt: Date.now(),
    };

    addDiaryEntry(entry);
    router.replace('/drive-diary-confirm');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>タイトル</Text>
        <TextInput
          style={styles.input}
          placeholder="例: 海沿いのドライブ"
          placeholderTextColor="#9aa5ab"
          value={title}
          onChangeText={setTitle}
          maxLength={60}
        />

        <Text style={styles.sectionTitle}>ひとことメモ</Text>
        <TextInput
          style={[styles.input, styles.memoInput]}
          placeholder="今日のドライブの感想など"
          placeholderTextColor="#9aa5ab"
          value={memo}
          onChangeText={setMemo}
          multiline
          maxLength={500}
        />

        <Text style={styles.sectionTitle}>日付</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#9aa5ab"
          value={date}
          onChangeText={setDate}
          maxLength={10}
          keyboardType="numbers-and-punctuation"
        />

        <View style={styles.statsCard}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行距離</Text>
            <Text style={styles.statValue}>{formatDistanceKm(driveRecord.distanceKm)} km</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>走行時間</Text>
            <Text style={styles.statValue}>{formatElapsedTime(driveRecord.durationSeconds)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>選択したルート</Text>
        <Text style={styles.readonlyText}>
          {driveRecord.route.name} ・ {driveRecord.route.distanceKm}km ・ 約
          {driveRecord.route.durationMinutes}分(ルート予定)
        </Text>

        <Text style={styles.sectionTitle}>経由したスポット</Text>
        {spotsSummary.length > 0 ? (
          spotsSummary.map((spot, index) => (
            <Text key={spot.id} style={styles.readonlyText}>
              {index + 1}. {spot.name}({spot.category})
            </Text>
          ))
        ) : (
          <Text style={styles.readonlyText}>経由地は追加されていません。</Text>
        )}

        <Text style={styles.sectionTitle}>写真(最大{MAX_DIARY_PHOTOS}枚)</Text>
        {photos.length > 0 && (
          <View style={styles.photoRow}>
            {photos.map((photo) => (
              <View key={photo.id} style={styles.photoThumbWrapper}>
                <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                <Pressable
                  onPress={() => handleRemovePhoto(photo.id)}
                  style={styles.photoRemoveButton}
                  hitSlop={8}>
                  <Text style={styles.photoRemoveButtonText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {photoNotice && <Text style={styles.photoNoticeText}>{photoNotice}</Text>}
        <PrimaryButton
          label={
            isPickingPhotos
              ? '写真を確認しています…'
              : remainingPhotoSlots > 0
                ? '写真を選ぶ'
                : `写真は最大${MAX_DIARY_PHOTOS}枚です`
          }
          variant="secondary"
          onPress={handlePickPhotos}
          disabled={isPickingPhotos || remainingPhotoSlots <= 0}
          style={styles.photoPickButton}
        />
      </ScrollView>

      <View style={styles.footer}>
        {saveError && <Text style={styles.errorText}>{saveError}</Text>}
        <PrimaryButton label="日記を保存" onPress={handleSave} />
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
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 8,
    marginTop: 18,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7dee0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#11181C',
    backgroundColor: '#fff',
  },
  memoInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  statsCard: {
    borderRadius: 16,
    backgroundColor: '#f5f6f7',
    padding: 16,
    marginTop: 18,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 13,
    color: '#5b6770',
    fontWeight: '600',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#11181C',
  },
  readonlyText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334',
    marginBottom: 4,
  },
  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 10,
  },
  photoThumbWrapper: {
    width: 88,
    height: 88,
  },
  photoThumb: {
    width: 88,
    height: 88,
    borderRadius: 12,
    backgroundColor: '#eef2f3',
  },
  photoRemoveButton: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#11181C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  photoNoticeText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7a5b18',
    marginBottom: 10,
  },
  photoPickButton: {
    alignSelf: 'flex-start',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    gap: 10,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
