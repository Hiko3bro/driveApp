import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/primary-button';
import { Colors, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { formatDistanceLabel } from '@/services/location/format-drive-stats';
import { formatMinutesLabel } from '@/types/drive';
import type { PlaceSelection } from '@/types/location';
import type { RouteNearbySuggestion, RouteOption } from '@/types/route';

interface RouteProposalCardProps {
  route: RouteOption;
  origin: PlaceSelection;
  /** チャットで確定しているテーマの日本語ラベル(例: ["景色","海沿い"])。捏造せず、実際にユーザーが選んだ/伝えたテーマのみ。 */
  themeLabels: string[];
  saving: boolean;
  saved: boolean;
  onSave: () => void;
  onNavigate: () => void;
  /** このスポットを経由地に加えて再計算する(ルート自体は変えるほどではないが実在する近くの候補)。 */
  onAddNearbySuggestion?: (suggestion: RouteNearbySuggestion) => void;
  /** 再計算中は追加ボタンを一時的に無効化する。 */
  addingSuggestion?: boolean;
}

/**
 * ルート提案カード。表示するのはすべて実データのみ:
 * - 距離・所要時間はGoogle Routesの実測値(drive-route-planner経由)
 * - 主要スポットはGoogle Placesで実在確認済みのsuggestedPlaceのみ
 * - highlightはdrive-plan-mapper.tsが実データ(waypoints/suggestedPlace)から組み立てた
 *   説明文で、AIが自由に生成した「おすすめ理由」ではない(見出しも「AIのおすすめ」ではなく
 *   「このルートについて」とし、Google Routes自体が景観を保証しているかのような誤解を避ける)
 * 星評価・口コミ件数・架空の写真等、実際に取得していない情報は一切表示しない。
 */
export function RouteProposalCard({
  route,
  origin,
  themeLabels,
  saving,
  saved,
  onSave,
  onNavigate,
  onAddNearbySuggestion,
  addingSuggestion,
}: RouteProposalCardProps) {
  const mainStops = route.waypoints.slice(0, -1);
  const MAX_VISIBLE_STOPS = 3;
  const visibleStops = mainStops.slice(0, MAX_VISIBLE_STOPS);
  const remainingStopCount = mainStops.length - visibleStops.length;
  // 情報密度を下げるため、経由地は最大3件までを表示し、残りは「ほか◯件」の1行にまとめる
  // (実際の経由順序・件数自体は変更しない、表示だけの省略)。
  const routePoints = [origin.label, ...visibleStops.map((wp) => wp.name)];

  return (
    <View style={styles.card}>
      {themeLabels.length > 0 && (
        <View style={styles.tagRow}>
          {themeLabels.map((label) => (
            <View key={label} style={styles.themeTag}>
              <Text style={styles.themeTagText}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.name} numberOfLines={2}>
        {route.name}
      </Text>

      <View style={styles.metricsRow}>
        <Text style={styles.metricLargeValue}>約{formatMinutesLabel(route.durationMinutes)}</Text>
        <View style={styles.metricDivider} />
        <Text style={styles.metricSecondaryValue}>{formatDistanceLabel(route.distanceKm)}</Text>
      </View>

      <View style={styles.pointList}>
        {routePoints.map((point, index) => {
          const isLastRow = index === routePoints.length - 1 && remainingStopCount === 0;
          return (
            <View key={`${point}-${index}`} style={styles.pointRow}>
              <View style={styles.pointDotColumn}>
                <View style={[styles.pointDot, index === 0 && styles.pointDotStart]} />
                {!isLastRow && <View style={styles.pointConnector} />}
              </View>
              <Text style={styles.pointText} numberOfLines={1}>
                {point}
              </Text>
            </View>
          );
        })}
        {remainingStopCount > 0 && (
          <View style={styles.pointRow}>
            <View style={styles.pointDotColumn} />
            <Text style={styles.pointMoreText}>ほか{remainingStopCount}件</Text>
          </View>
        )}
      </View>

      {route.highlight && (
        <View style={styles.highlightBox}>
          <Ionicons name="sparkles-outline" size={14} color={Colors.accentBlue} />
          <Text style={styles.highlightText} numberOfLines={2}>
            {route.highlight}
          </Text>
        </View>
      )}

      {route.warning && <Text style={styles.warningText}>{route.warning}</Text>}

      {route.nearbySuggestions && route.nearbySuggestions.length > 0 && (
        <View style={styles.nearbyBox}>
          <Text style={styles.nearbyLabel}>このルートの近く</Text>
          {route.nearbySuggestions.map((suggestion) => (
            <View key={suggestion.id} style={styles.nearbyRow}>
              <View style={styles.nearbyTextGroup}>
                <Text style={styles.nearbyName} numberOfLines={1}>
                  {suggestion.name}
                </Text>
                <Text style={styles.nearbyAdded}>+{suggestion.addedMinutes}分</Text>
              </View>
              {onAddNearbySuggestion && (
                <Pressable
                  onPress={() => onAddNearbySuggestion(suggestion)}
                  disabled={addingSuggestion}
                  style={({ pressed }) => [
                    styles.nearbyAddButton,
                    pressed && !addingSuggestion && styles.nearbyAddButtonPressed,
                    addingSuggestion && styles.nearbyAddButtonDisabled,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${suggestion.name}を追加して再計算`}>
                  <Text style={styles.nearbyAddButtonText}>追加して再計算</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}

      <View style={styles.ctaColumn}>
        <PrimaryButton label="ナビする" variant="primary" onPress={onNavigate} />
        <PrimaryButton
          label={saved ? '保存しました' : saving ? '保存しています…' : 'この計画を保存'}
          variant="secondary"
          disabled={saving}
          onPress={onSave}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  themeTag: {
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentBlueMuted,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  themeTagText: {
    fontSize: Typography.caption.fontSize,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
  name: {
    fontSize: Typography.cardTitle.fontSize + 2,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.md,
  },
  metricLargeValue: {
    fontSize: Typography.metricLarge.fontSize,
    fontWeight: Typography.metricLarge.fontWeight,
    color: Colors.textPrimary,
  },
  metricDivider: {
    width: 1,
    height: 16,
    backgroundColor: Colors.divider,
  },
  metricSecondaryValue: {
    fontSize: Typography.body.fontSize,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  pointList: {
    gap: 0,
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 24,
  },
  pointDotColumn: {
    width: 16,
    alignItems: 'center',
  },
  pointDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textTertiary,
    marginTop: 4,
  },
  pointDotStart: {
    backgroundColor: Colors.accentBlue,
  },
  pointConnector: {
    width: 1,
    flex: 1,
    minHeight: 12,
    backgroundColor: Colors.divider,
  },
  pointText: {
    flex: 1,
    fontSize: Typography.secondary.fontSize,
    color: Colors.textPrimary,
    paddingLeft: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  pointMoreText: {
    flex: 1,
    fontSize: Typography.caption.fontSize,
    color: Colors.textTertiary,
    paddingLeft: Spacing.sm,
  },
  highlightBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xs,
    borderRadius: Radius.md,
    backgroundColor: Colors.accentBlueMuted,
    padding: Spacing.md,
  },
  highlightText: {
    flex: 1,
    fontSize: Typography.secondary.fontSize,
    lineHeight: Typography.secondary.lineHeight,
    color: Colors.textPrimary,
  },
  warningText: {
    fontSize: Typography.caption.fontSize,
    lineHeight: 18,
    color: Colors.warning,
  },
  nearbyBox: {
    gap: Spacing.xs,
  },
  nearbyLabel: {
    fontSize: Typography.caption.fontSize,
    fontWeight: '700',
    color: Colors.textTertiary,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceSubtle,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  nearbyTextGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.xs,
  },
  nearbyName: {
    fontSize: Typography.secondary.fontSize,
    fontWeight: '600',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  nearbyAdded: {
    fontSize: Typography.caption.fontSize,
    color: Colors.textTertiary,
  },
  nearbyAddButton: {
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.accentBlue,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  nearbyAddButtonPressed: {
    opacity: 0.7,
  },
  nearbyAddButtonDisabled: {
    opacity: 0.4,
  },
  nearbyAddButtonText: {
    fontSize: Typography.caption.fontSize,
    fontWeight: '700',
    color: Colors.accentBlue,
  },
  ctaColumn: {
    gap: Spacing.sm,
  },
});
