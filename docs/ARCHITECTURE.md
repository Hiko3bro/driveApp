# アーキテクチャ方針

## 現在のExpo構成

- Expo SDK 54 / React Native 0.81 / TypeScript
- [expo-router](https://docs.expo.dev/router/introduction/) によるファイルベースルーティング(`app/` ディレクトリ)
- ホーム→出発地点選択→条件入力→ルート比較→ルート決定確認の縦断機能を実装済み

### 主要ディレクトリ

| ディレクトリ | 役割 |
| --- | --- |
| `app/` | 画面・ルーティング(expo-router、スタックナビゲーション) |
| `components/` | 共通UIコンポーネント(`components/map/` はネイティブ/Webでファイルを分けた地図表示、`components/ui/` は汎用パーツ) |
| `contexts/` | 画面をまたいだアプリ内状態(出発地点・ドライブ条件・提案ルートなど) |
| `services/` | 外部依存(地図/位置情報/ルート検索/住所検索)をUIから分離する層。座標検証・端末内保存・時間予算付きモックルート生成もここで扱う |
| `types/` | ドメインの型定義(位置情報・ドライブ条件・ルート) |
| `constants/` | テーマなどの定数 |
| `hooks/` | カスタムフック |
| `assets/` | 画像などの静的アセット |
| `docs/` | プロダクト・設計・進捗ドキュメント |

## 現時点での方針

- **有料の外部API(Google Routes API, Google Places API, Supabase, AI API等)は現時点では導入しない**
- まずは無料の範囲・モックデータ・ローカル状態管理で機能の骨組みと体験を検証する

## 将来の拡張を見据えた方針

有料APIやバックエンドを後から追加しやすくするため、以下の方針を意識する。

- 外部API通信はUI/画面ロジックから分離した層(`services/`)にまとめ、実装の差し替えを容易にする
- 環境変数(APIキー等)は `.env.example` にキー名のみを定義し、実際の値はコミットしない([AGENTS.md](../AGENTS.md) 参照)
- **Google Routes / Google Places** を導入する際は、料金・呼び出し回数を抑える設計(結果のキャッシュ、呼び出しタイミングの制御など)を先に検討する
- **Supabase** を導入する際は、認証・データ永続化を段階的に追加できるよう、それまではローカルの状態管理で完結させる
- **AI API**(推薦・要約など)を導入する際は、既存のUI/ロジックと疎結合になるようインターフェースを設計し、AI呼び出しなしでも動作を確認できる状態を保つ

### 実装済みの差し替え口(RouteProvider / GeocodingProvider)

最初の縦断機能(ホーム→出発地点選択→ドライブ条件入力→ルート比較)で、以下の差し替え可能な層を実装済み。

- `services/route/route-provider.ts` … ルート提案取得のinterface(`RouteProvider`)
  - `services/route/mock-route-provider.ts` … 現在使用しているモック実装(`MockRouteProvider`)
  - `services/route/google-routes-provider.ts` … 将来Google Routes APIに接続する際の実装先(現時点では未実装のスタブ)
  - `services/route/index.ts` の `getRouteProvider()` で、実際に使うProviderを1箇所で切り替える
- `services/geocoding/geocoding-provider.ts` … 住所検索取得のinterface(`GeocodingProvider`)
  - `services/geocoding/mock-geocoding-provider.ts` … 現在使用しているモック実装(常に検索結果なしを返す)
  - `services/geocoding/index.ts` の `getGeocodingProvider()` で切り替える
- 地図表示は `components/map/drive-map-view.tsx`(ネイティブ)と `drive-map-view.web.tsx`(Web)にファイルを分け、react-native-mapsがWeb未対応であることを吸収している(詳細は [docs/DECISIONS.md](./DECISIONS.md))
- 地図ピッカーの確定座標は `onRegionChangeComplete` のReact stateだけに依存せず、確定時に `DriveMapViewHandle.getCenter()` からネイティブカメラ中心を取得する。Web版は取得不能を示す `null` を返す
- `services/location/coordinates.ts` で座標・MapRegionを検証し、MapViewへ渡すMarker・Polyline・カメラ値を防御する。モック生成座標だけは緯度のclampと経度のwrapを行う
- 現在地取得と地図確定は、画面フォーカスとリクエストIDの両方を確認し、画面離脱後のstate更新・遅延遷移を行わない
- モックルートは「使える時間」と当日の「帰着時刻」までの短い方を有効予算とし、完成経路を評価しながら各区間の縮尺を決める

## 現時点で使わないもの

- 有料の外部API全般(Google Routes, Google Places, その他地図/検索API)
- バックエンドサーバー・データベース(Supabaseを含む)
- AI API(推薦・生成等)
- ネイティブビルド固有の設定変更(必要になるまでデフォルトを維持)
