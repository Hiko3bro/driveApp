import type { RouteProvider, RouteSearchParams } from '@/services/route/route-provider';
import type { RouteOption } from '@/types/route';

/**
 * 将来、有料のGoogle Routes APIへ差し替えるための置き場所。
 *
 * 現時点ではAPIキーを追加していないため未実装。導入する際は、
 * ここでGoogle Routes APIを呼び出し、レスポンスをRouteOption[]へ
 * 変換する処理を実装し、services/route/index.ts の切り替えを行う。
 */
export class GoogleRoutesProvider implements RouteProvider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRoutes(params: RouteSearchParams): Promise<RouteOption[]> {
    throw new Error(
      'GoogleRoutesProvider is not implemented yet. Use MockRouteProvider until a paid Google Routes API key is introduced.'
    );
  }
}
