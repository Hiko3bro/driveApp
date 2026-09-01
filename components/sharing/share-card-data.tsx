import { StyleSheet, Text, View } from 'react-native';

import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '@/components/sharing/card-dimensions';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';
import type { DriveDiaryEntry } from '@/types/drive-diary';

interface ShareCardDataProps {
  entry: DriveDiaryEntry;
}

/** Spotify Wrappedのように、数字・記録を主役にするカード型テンプレート。写真は使わない。 */
export function ShareCardData({ entry }: ShareCardDataProps) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>DRIVE DIARY</Text>
      <Text style={styles.title} numberOfLines={2}>
        {entry.title}
      </Text>

      <View style={styles.heroBlock}>
        <Text style={styles.heroValue}>{formatDistanceKm(entry.distanceKm)}</Text>
        <Text style={styles.heroUnit}>km 走行</Text>
      </View>
      <View style={styles.heroBlock}>
        <Text style={styles.heroValue}>{formatElapsedTime(entry.durationSeconds)}</Text>
        <Text style={styles.heroUnit}>走行時間</Text>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>経由スポット</Text>
          <Text style={styles.metaValue}>{entry.spots.length}件</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>日付</Text>
          <Text style={styles.metaValue}>{entry.date}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>ルート</Text>
          <Text style={styles.metaValue} numberOfLines={1}>
            {entry.route.name}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    borderRadius: 20,
    backgroundColor: '#0a2540',
    padding: 26,
  },
  eyebrow: {
    color: '#7fd4ff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 28,
  },
  heroBlock: {
    marginBottom: 22,
  },
  heroValue: {
    color: '#fff',
    fontSize: 52,
    fontWeight: '900',
    lineHeight: 56,
  },
  heroUnit: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '700',
  },
  metaGrid: {
    marginTop: 'auto',
    gap: 14,
  },
  metaItem: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
    paddingTop: 10,
  },
  metaLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  metaValue: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
