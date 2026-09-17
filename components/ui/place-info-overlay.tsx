import { StyleSheet, Text, View } from 'react-native';

interface PlaceInfoOverlayProps {
  name: string;
  /** 事実ベースの短い説明(1〜2行)。ルート適合性の文はここに含めない(写真上には置かない)。 */
  description: string;
  /** コンパクト表示(今ドラ等)では説明を最大1行までに切り詰める(名前・エリアの優先度を上げる)。 */
  compact?: boolean;
}

/**
 * 写真/プレースホルダーの上に重ねる文字群。場所名(最大2行、最優先)・短い説明を
 * 白文字+text-shadowで表示する。カテゴリはPlacePhotoHero側の小さいbadge(写真左上)で
 * 既に示しているため、ここでは重複させない(Place nameの優先度を上げるための整理)。
 * 追加時間・距離・CTA・警告もここに含めない(写真は「場所の雰囲気を伝える」ことに専念させる)。
 */
export function PlaceInfoOverlay({ name, description, compact }: PlaceInfoOverlayProps) {
  return (
    <View style={styles.container} pointerEvents="none">
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
      {description.length > 0 && (
        <Text style={styles.description} numberOfLines={compact ? 1 : 2}>
          {description}
        </Text>
      )}
    </View>
  );
}

const textShadow = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 3,
};

const styles = StyleSheet.create({
  container: {
    gap: 3,
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    ...textShadow,
  },
  description: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.88)',
    ...textShadow,
  },
});
