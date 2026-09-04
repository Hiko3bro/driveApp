import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ShareCardData } from '@/components/sharing/share-card-data';
import { ShareCardMemory } from '@/components/sharing/share-card-memory';
import { ShareCardPhoto } from '@/components/sharing/share-card-photo';
import { OptionChip } from '@/components/ui/option-chip';
import { PrimaryButton } from '@/components/ui/primary-button';
import { useDriveFlow } from '@/contexts/drive-flow-context';
import { shareCardView } from '@/services/sharing/share-image';
import { projectTrackToSharePoints } from '@/services/sharing/share-route';
import { SHARE_TEMPLATE_IDS, SHARE_TEMPLATE_LABELS, type ShareTemplateId } from '@/types/drive-sharing';

export default function DriveDiaryShareScreen() {
  const { diaryEntries, latestDiaryEntryId } = useDriveFlow();
  const entry = useMemo(
    () => diaryEntries.find((candidate) => candidate.id === latestDiaryEntryId) ?? null,
    [diaryEntries, latestDiaryEntryId]
  );

  const [template, setTemplate] = useState<ShareTemplateId>('photo');
  const [isSharing, setIsSharing] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const shareInFlightRef = useRef(false);
  const cardWrapperRef = useRef<View>(null);

  const sharePoints = useMemo(() => (entry ? projectTrackToSharePoints(entry.track) : []), [entry]);

  useEffect(() => {
    if (!entry) {
      router.dismissTo('/');
    }
  }, [entry]);

  if (!entry) {
    return <SafeAreaView style={styles.safeArea} />;
  }

  const handleShare = async () => {
    if (shareInFlightRef.current) {
      return;
    }
    shareInFlightRef.current = true;
    setIsSharing(true);
    setShareNotice(null);

    const result = await shareCardView(cardWrapperRef, entry.title);
    if (result.status === 'unavailable') {
      setShareNotice('この端末では共有機能を利用できません。');
    } else if (result.status === 'error') {
      setShareNotice('共有画像を準備できませんでした。もう一度お試しください。');
    }

    shareInFlightRef.current = false;
    setIsSharing(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>テンプレートを選ぶ</Text>
        <View style={styles.chipRow}>
          {SHARE_TEMPLATE_IDS.map((id) => (
            <OptionChip
              key={id}
              label={SHARE_TEMPLATE_LABELS[id]}
              selected={template === id}
              onPress={() => setTemplate(id)}
            />
          ))}
        </View>

        <Text style={styles.sectionTitle}>プレビュー</Text>
        <View style={styles.previewArea}>
          <View ref={cardWrapperRef} collapsable={false}>
            {template === 'photo' && <ShareCardPhoto entry={entry} sharePoints={sharePoints} />}
            {template === 'data' && <ShareCardData entry={entry} />}
            {template === 'memory' && <ShareCardMemory entry={entry} sharePoints={sharePoints} />}
          </View>
        </View>

        <Text style={styles.privacyNote}>
          共有画像に緯度経度や住所などの正確な位置情報は文字として表示していません。ルート線は開始・終了地点付近を一部間引いた表示用の線で、地図の上に重ねたものではありません。
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {shareNotice && <Text style={styles.errorText}>{shareNotice}</Text>}
        <PrimaryButton
          label={isSharing ? '画像を準備しています…' : '共有する'}
          onPress={handleShare}
          disabled={isSharing}
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
  content: {
    flexGrow: 1,
    padding: 20,
    alignItems: 'center',
  },
  sectionTitle: {
    alignSelf: 'flex-start',
    fontSize: 14,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 8,
    marginTop: 10,
  },
  chipRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    flexWrap: 'wrap',
  },
  previewArea: {
    marginTop: 4,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  privacyNote: {
    fontSize: 11,
    lineHeight: 17,
    color: '#5b6770',
    textAlign: 'center',
    paddingHorizontal: 8,
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
