import { Image, StyleSheet, Text, View } from 'react-native';

import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '@/components/sharing/card-dimensions';
import { RouteLine } from '@/components/sharing/route-line';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';
import type { SharePoint } from '@/services/sharing/share-route';
import type { DriveDiaryEntry } from '@/types/drive-diary';

const MINI_ROUTE_SIZE = 84;

interface ShareCardMemoryProps {
  entry: DriveDiaryEntry;
  sharePoints: SharePoint[];
}

/** 写真・タイトル・メモを主役にし、隅に小さなGPSルート線を添えるテンプレート。 */
export function ShareCardMemory({ entry, sharePoints }: ShareCardMemoryProps) {
  const photos = entry.photos.slice(0, 3);

  return (
    <View style={styles.card}>
      <View style={styles.photoRow}>
        {photos.length > 0 ? (
          photos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
          ))
        ) : (
          <View style={[styles.photo, styles.photoFallback]} />
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>
        {entry.memo.length > 0 && (
          <Text style={styles.memo} numberOfLines={4}>
            {entry.memo}
          </Text>
        )}

        <View style={styles.statRow}>
          <Text style={styles.date}>{entry.date}</Text>
          <Text style={styles.stat}>{formatDistanceKm(entry.distanceKm)} km</Text>
          <Text style={styles.stat}>{formatElapsedTime(entry.durationSeconds)}</Text>
        </View>
      </View>

      <View style={styles.miniRouteBox}>
        <RouteLine points={sharePoints} width={MINI_ROUTE_SIZE} height={MINI_ROUTE_SIZE} color="#0a7ea4" thickness={2} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    borderRadius: 20,
    backgroundColor: '#fff',
    padding: 18,
    overflow: 'hidden',
  },
  photoRow: {
    flexDirection: 'row',
    gap: 8,
    height: SHARE_CARD_HEIGHT * 0.42,
    marginBottom: 18,
  },
  photo: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#eef2f3',
  },
  photoFallback: {
    backgroundColor: '#eef2f3',
  },
  body: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#11181C',
    marginBottom: 8,
  },
  memo: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334',
    marginBottom: 14,
  },
  statRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 'auto',
  },
  date: {
    fontSize: 12,
    color: '#5b6770',
    fontWeight: '700',
  },
  stat: {
    fontSize: 12,
    color: '#11181C',
    fontWeight: '800',
  },
  miniRouteBox: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: MINI_ROUTE_SIZE,
    height: MINI_ROUTE_SIZE,
    borderRadius: 12,
    backgroundColor: 'rgba(10,126,164,0.08)',
    overflow: 'hidden',
  },
});
