import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { SharePoint } from '@/services/sharing/share-route';

interface RouteLineProps {
  points: SharePoint[];
  width: number;
  height: number;
  color?: string;
  thickness?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * 地図タイルを使わず、正規化済みの相対座標(SharePoint)だけから
 * Nike Run Clubのような「ルート線だけ」のグラフィックを描画する。
 * react-native-svgを追加せず、区間ごとに回転させた細いViewを並べて線を表現する。
 */
export function RouteLine({ points, width, height, color = '#ffffff', thickness = 3, style }: RouteLineProps) {
  if (width <= 0 || height <= 0 || points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return (
      <View style={[{ width, height }, style]} pointerEvents="none">
        <Dot point={points[0]} width={width} height={height} size={thickness * 2} color={color} />
      </View>
    );
  }

  const segments = points.slice(1).map((to, index) => {
    const from = points[index];
    const x1 = from.x * width;
    const y1 = from.y * height;
    const x2 = to.x * width;
    const y2 = to.y * height;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

    return (
      <View
        key={index}
        style={[
          styles.segment,
          {
            left: x1,
            top: y1 - thickness / 2,
            width: length,
            height: thickness,
            borderRadius: thickness / 2,
            backgroundColor: color,
            transform: [{ rotate: `${angleDeg}deg` }],
            transformOrigin: '0% 50%',
          },
        ]}
      />
    );
  });

  return (
    <View style={[{ width, height }, style]} pointerEvents="none">
      {segments}
      <Dot point={points[0]} width={width} height={height} size={thickness * 2} color={color} />
      <Dot point={points[points.length - 1]} width={width} height={height} size={thickness * 2.8} color={color} />
    </View>
  );
}

function Dot({
  point,
  width,
  height,
  size,
  color,
}: {
  point: SharePoint;
  width: number;
  height: number;
  size: number;
  color: string;
}) {
  return (
    <View
      style={[
        styles.dot,
        {
          left: point.x * width - size / 2,
          top: point.y * height - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  segment: {
    position: 'absolute',
  },
  dot: {
    position: 'absolute',
  },
});
