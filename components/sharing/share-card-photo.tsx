import { Image, StyleSheet, Text, View } from 'react-native';

import { SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from '@/components/sharing/card-dimensions';
import { RouteLine } from '@/components/sharing/route-line';
import { formatDistanceKm, formatElapsedTime } from '@/services/location/format-drive-stats';
import type { SharePoint } from '@/services/sharing/share-route';
import type { DriveDiaryEntry } from '@/types/drive-diary';

interface ShareCardPhotoProps {
  entry: DriveDiaryEntry;
  sharePoints: SharePoint[];
}

/** Nike Run Clubのように、写真を全面背景にしてGPSルート線を重ねるテンプレート。 */
export function ShareCardPhoto({ entry, sharePoints }: ShareCardPhotoProps) {
  const photo = entry.photos[0] ?? null;

  return (
    <View style={styles.card}>
      {photo ? (
        <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="cover" />
      ) : (
        <View style={styles.photoFallback} />
      )}

      <RouteLine
        points={sharePoints}
        width={SHARE_CARD_WIDTH}
        height={SHARE_CARD_HEIGHT}
        color="rgba(255,255,255,0.92)"
        thickness={3}
        style={styles.routeLayer}
      />

      <View style={styles.scrim} />

      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
        </Text>
        <Text style={styles.date}>{entry.date}</Text>
        <View style={styles.statRow}>
          <Text style={styles.statValue}>{formatDistanceKm(entry.distanceKm)} km</Text>
          <Text style={styles.statValue}>{formatElapsedTime(entry.durationSeconds)}</Text>
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
    overflow: 'hidden',
    backgroundColor: '#1b2733',
  },
  photo: {
    ...StyleSheet.absoluteFill,
  },
  photoFallback: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#1b2733',
  },
  routeLayer: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SHARE_CARD_HEIGHT * 0.34,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  content: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 20,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  date: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
  },
  statRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statValue: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
