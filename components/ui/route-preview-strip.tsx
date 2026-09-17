import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/design-tokens';

interface RoutePreviewStripProps {
  /** 出発地点から到着地点までの停車地名(出発地点そのものを含む)。 */
  stops: string[];
}

/**
 * 保存済みドライブ計画のカード用の軽量なルート視覚化。
 * route-plan.tsxで確認済みの既知の問題(iOS + Expo GoでのDriveMapViewネイティブ
 * クラッシュ、docs/DECISIONS.md参照)を踏まえ、多数のカードを同時に並べる
 * 一覧画面では地図(react-native-maps)を一切使わず、View/StyleSheetのみの
 * ドット+接続線で「経路の形」を表す。
 */
export function RoutePreviewStrip({ stops }: RoutePreviewStripProps) {
  if (stops.length === 0) {
    return null;
  }

  return (
    <View style={styles.row}>
      {stops.map((stop, index) => {
        const isFirst = index === 0;
        const isLast = index === stops.length - 1;
        return (
          <View key={`${stop}-${index}`} style={styles.stopGroup}>
            <View style={styles.dotColumn}>
              <View style={[styles.dot, isFirst && styles.dotStart, isLast && !isFirst && styles.dotEnd]} />
              {!isLast && <View style={styles.line} />}
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {stop}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const DOT_SIZE = 8;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 4,
    rowGap: 6,
  },
  stopGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dotColumn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: Colors.accentBlue,
  },
  dotStart: {
    backgroundColor: Colors.success,
  },
  dotEnd: {
    backgroundColor: Colors.accentRed,
  },
  line: {
    width: 14,
    height: 2,
    backgroundColor: Colors.divider,
    marginHorizontal: 3,
  },
  label: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginLeft: 4,
    marginRight: 6,
    maxWidth: 90,
  },
});
