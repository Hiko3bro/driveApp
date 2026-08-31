# 進捗記録

作業日ごとの進捗をここに記録します。**新しいエントリはファイルの先頭(このテンプレートの直後)に追加してください。**

## テンプレート

```
## YYYY-MM-DD
### 完了したこと
-

### 確認したこと
-

### 未完了
-

### 次にやること
-
```

---

## 2026-08-31(3)

`feature/spot-discovery` ブランチで、スポット探索を必須工程から任意工程へ変更した(commit・pushは未実施)。

### 完了したこと

- ルート決定確認画面(`app/route-summary.tsx`)に「このルートでナビ」ボタンを追加し、スポットを1件も追加せずに直接ルート確認画面(`app/route-plan.tsx`)へ進めるようにした。「周辺スポットを探す」(旧「このルート周辺のスポットを探す」)ボタンは既存どおり残し、2択で選べるようにした
- `app/route-plan.tsx`を、spot-discoveryを経由していない(スポット0件の)状態でも表示・決定できるように変更
  - `plan`算出・画面遷移ガードから「spot-discoveryを経由していること」「スポット1件以上」という必須条件を削除。座標検証・時間予算チェック(`isValidCoordinates`、`calculateSpotRoutePlan`)は変更していない
  - スポットが0件の場合は「追加した経由地」欄を非表示にし、案内文言(「更新後」→「ルート情報」、経由地件数の表示)を出し分け
  - スポットが0件の場合、「スポットを選び直す」ボタンを「周辺スポットを見る」(`/spot-discovery`へ)に出し分け(スポットがある場合は従来どおり`router.back()`)
  - 決定/ナビ処理(`handleDecide`・決定後の完了画面)は新規実装せず、スポット0件〜3件の両方で同じコードパスをそのまま再利用した(Google Mapsへの実連携は現状未実装のため、完了画面の「次はGoogleマップでのナビ連携を実装予定です」という表示もそのまま維持)
- `app/_layout.tsx`の`route-plan`画面タイトルを、直接ナビ・スポット追加後の両方に合う「ルート確認」に変更
- `spot-discovery.tsx`・`route-compare.tsx`・現在地/自宅/指定場所まわりのコードは変更していない

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- 大きな変更にあたるため、実装前にCLAUDE.mdのルールに従い方針(画面タイトル名・スポット0件時のボタン文言)をユーザーに確認し、合意のうえで実装した

### 未完了

- 実機(Expo Go)での通し確認: ルート比較→ルート選択→「このルートでナビ」→決定→完了画面、および→「周辺スポットを探す」→スポット追加(0件・1件以上)→「この内容で決定」→完了画面の両経路
- `route-plan`の地図表示は既知の問題(2026-08-31(2)参照)によりプレースホルダーのまま。Development Buildでの再確認は引き続き未着手
- 記録・日記・共有機能、Google Mapsへの実ナビ連携は今回スコープ外で未着手

### 次にやること

- 実機(Expo Go)で上記2経路を再確認する
- Development Buildを作成し、`route-plan`の地図クラッシュがExpo Go固有か再確認する
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-08-31(2)

`feature/spot-discovery` ブランチで、スポット追加後のルート確認画面(`app/route-plan.tsx`)がiPhone + Expo Goでクラッシュする問題を切り分け、地図表示を一時的に無効化して回避した(commit・pushは未実施)。

### 完了したこと

- iPhone + Expo Goで「スポットを経由地に追加」→「追加後のルートを確認」を押すとExpo Goごと終了する不具合を、`DriveMapView`(react-native-maps)を段階的にマウント/無効化しながら切り分けた
  - `DriveMapView`を完全にマウントしない状態にするとクラッシュしないことを確認
  - Marker・Polyline・fitToCoordinates・animateToRegion・カメラ操作・選択スポットのマーカーをすべて外し、固定の安全な`DEMO_MAP_REGION`だけを使ったMapView本体だけの最小構成に戻しても、`route-plan`へ遷移した瞬間にクラッシュが再現することを確認
  - 前画面(`spot-discovery`)のMapViewが表示されたまま`route-plan`へ`push`することによる、画面遷移中の複数MapView同時マウントを疑い、`InteractionManager.runAfterInteractions()`によるMapViewの遅延マウントも試したが、クラッシュは解消しなかった
  - 上記により、座標・Marker・Polyline・遷移タイミングではなく、**route-planでMapView(react-native-maps)をマウントすること自体がiOS(Expo Go)側のネイティブクラッシュ条件になっている**と判断した
- 上記の切り分け結果を踏まえ、`app/route-plan.tsx`の地図表示を当面プレースホルダー(「地図表示は一時的に無効化しています」という案内文)に戻し、診断のために追加していたステージ切り替え・遅延マウント等の一時コードは整理して削除した
  - ルート情報(距離・所要時間・時間予算内かどうか)、追加した経由地一覧、「この内容で決定」「スポットを選び直す」ボタン、画面遷移は従来どおり動作する
  - ネイティブ地図へ渡す直前の座標検証(`isValidCoordinates`によるチェックとエラー表示)はそのまま維持した
  - `react-native-maps`を使う他画面(`departure.tsx`, `route-compare.tsx`, `spot-discovery.tsx`)は変更していない

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- コード上、`spot-discovery → route-plan`だけが「地図を持つ画面から地図を持つ画面へpushする」唯一の遷移であることを確認(他の画面遷移は地図あり↔地図なしの組み合わせのみ)。`spot-discovery`側は`isFocusedRef`でフォーカス喪失後の`animateToRegion`呼び出しを既に抑止しており、カメラ操作の継続が原因ではないことをコードで確認済み

### 未完了

- **既知の問題**: `route-plan`でのMapView(react-native-maps)マウントによるiOS + Expo Goのネイティブクラッシュ。原因はExpo Go固有の制約(同時に複数のネイティブMapViewインスタンスが有効になることによるものなど)か、react-native-mapsと現在のExpo SDKの組み合わせ自体の問題かは未特定。**Development Buildを作成して再現するかどうかを確認する予定**
- `route-plan`の地図表示(出発地点・経由スポットのマーカー、Polylineを含む本来の表示)は上記確認が取れるまでプレースホルダーのまま

### 次にやること

- Development Buildを作成し、`route-plan`でのMapViewマウントがExpo Go固有の問題か、Development Buildでも再現するかを確認する
- Development Buildで問題が解消していれば、`route-plan`のプレースホルダーを元のDriveMapView表示(Marker・Polyline・選択スポット反映)へ戻す
- Development Buildでも再現する場合は、react-native-mapsのバージョンやExpo SDKとの組み合わせ、複数MapView同時マウントの回避策(前画面のMapViewをアンマウントしてから遷移する等)を追加調査する

---

## 2026-08-31

iOSのExpo Go実機でコアルート探索フローを再確認し、現在のリリース・検証対象をiOSへ明確化した。

### 完了したこと

- iOS実機で、自宅の変更と変更後座標の保存、地図操作時の安定性、指定場所の選択、提案ルートの切り替え、「このルートにする」からルート決定確認画面への遷移を確認
- 現在のリリース目標をiOS TestFlightとし、iOSを正式な実機検証対象とする方針をREADMEと設計判断記録へ反映
- Android対応可能なReact Native / Expoの構造は維持しつつ、Androidは将来対応予定・実機未検証・現時点では動作保証対象外であることを明記

### 確認したこと

- iOS Expo Go実機の主要操作で、今回報告対象のクラッシュや遷移不具合が再発しないこと
- commit前のブランチ、差分、秘密情報、位置情報、一時ファイル、型、lintを最終確認する

### 未完了

- iOS TestFlight配布用ビルドとTestFlight上での動作確認
- 地図中心取得中・自宅保存中のiOS戻る操作、および日付変更線をまたぐルート表示の追加実機確認
- Android実機での動作確認と正式対応

### 次にやること

- featureブランチのレビュー後、Pull Request経由でmainへの反映を判断する
- iOS TestFlight向けのビルド設定・配布手順を確認する

---

## 2026-08-30(6)

再レビューで見つかった2件だけを、`feature/core-route-discovery-flow`ブランチ上で追加修正した(commit・pushは未実施、実機再確認待ち)。

### 完了したこと

- 自宅の地図中心取得中・SecureStore保存中はReact Navigationの`usePreventRemove`で現在ルートの削除を防止。ヘッダー戻る、iOS戻るジェスチャー、Android端末戻る、`pop/reset`等で離脱しようとした場合は、処理完了まで待つよう日本語で案内する
- ルート比較のカメラ範囲計算を純粋関数へ分離。経度を円周上に並べ、最大の空白区間を除いた最小弧から中心と幅を計算することで、`179.9`と`-179.9`を約0.2度の範囲として扱う
- 空配列・無効座標のみはデモ地域、単一点は最小deltaへ安全にフォールバックし、カメラ中心の経度を`[-180, 180)`へ正規化。緯度・経度deltaにも上限を設けた

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metro起動、SSRバンドル、Webバンドルの成功を確認して停止(初回は実行環境のネットワーク制約で失敗したため、許可後に再実行)

### 未完了

- Expo Go実機で、中心取得中・自宅保存中の各ネイティブ戻る操作と、保存成功・失敗後の戻る操作を再確認する
- 日付変更線をまたぐ経路の実機地図表示を再確認する

### 次にやること

- READMEの実機確認手順に沿ってiOS/Androidで再確認する

---

## 2026-08-30(5)

実機で継続していた自宅変更問題とコードレビュー6件の関連指摘を、`feature/core-route-discovery-flow`ブランチ上で修正した(commit・pushは未実施、実機再確認待ち)。

### 完了したこと

- 自宅・指定場所の確定時に`DriveMapViewHandle.getCenter()`からネイティブカメラ中心を取得し、同じ座標オブジェクトをSecureStore・`homeLocation`・DriveFlowContextへ渡す共通処理に変更
- `onMapReady`前、中心取得中、自宅保存中の確定操作と連打を防止。Web版は`getCenter()`が安全に`null`を返し、日本語の再試行案内へ遷移する
- 座標の有限性と緯度`[-90, 90]`・経度`[-180, 180]`を共通検証し、不正なMarker・Polyline・カメラ値をネイティブ地図へ渡さない防御を追加
- モック生成座標の緯度を範囲内へ収め、経度を`[-180, 180)`へ正規化
- 自宅保存は保存中の戻るボタンを無効化し、画面フォーカスとピッカーセッションIDが無効になった処理の結果・遷移を破棄。`savingHome`は`finally`とフォーカス終了処理で解除
- 現在地取得は画面フォーカスとリクエストIDを確認し、取得中に画面を離れた後の`departure`更新と`/conditions`遷移を抑止
- 有効時間予算を`min(availableTime, returnDeadlineまでの残り時間)`で計算し、往路・寄り道・帰路を含む完成経路が予算内になる縮尺を二分探索する方式へ変更
- 期限超過、残り時間不足、不正座標、生成不能時に、条件画面または地図ピッカーで日本語の再選択案内を表示
- 東京駅の正確なfallbackを削除し、実在の目印を意図しない丸めたデモ地域へ変更

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metro起動とWebバンドルを確認

### 未完了

- Expo Go実機で、自宅変更後の再表示、指定場所、保存中の戻る、現在地取得中の画面離脱を再確認する
- 実時計刻を使う帰着期限について、期限直前・日付境界のUXは今後のプロダクト要件に合わせて再検討する

### 次にやること

- READMEの実機確認手順に沿ってiOS/Androidで再確認し、問題がなければユーザー判断でcommit・push・PR作成へ進む

---

## 2026-08-30(4)

Expo Goでの2回目の実機確認で見つかった4件の不具合を、`feature/core-route-discovery-flow` ブランチ上で修正した(commit・pushは未実施、実機での再確認待ち)。前回(2026-08-30(3))の修正のうち「3つ目のルートのクラッシュ」「条件入力画面から戻ると無限ローディング」の2件は実機で解消を確認済み。

### 完了したこと

- **出発地点選択画面の地図ピッカーで発生していたクラッシュを修正**: 「自宅を変更」「指定した場所」のどちらも、地図の中心座標(`pickedRegion`)を`onRegionChangeComplete`で更新し、それを地図の`initialRegion`にそのまま書き戻していたため、ユーザーが地図を操作するたびに地図コンポーネント側の初期カメラ位置が変化する形になり、ユーザー操作によるカメラ制御とアプリ側の再設定が競合していた。`pickerRegion`(地図を開いた瞬間だけ決める、以後変更しない初期位置)と`pickedCenter`(パン操作の結果を保持するだけの値)に分離し、`initialRegion`は固定、確定操作時のみ`pickedCenter`を参照するように修正
- **緯度・経度が有限数であることを確認するガードを追加**: `onRegionChangeComplete`から渡された値をそのまま信用せず、`Number.isFinite`でチェックしてから状態に反映するようにした
- **「このルートにする」を新設のルート決定確認画面(`app/route-summary.tsx`)への前進(push)に変更**: これまでは確認ダイアログの後に`reset()`(DriveFlowContextの初期化)→`router.replace('/')`でホームへ戻る実装だった。`reset()`によってdepartureがnullになると、Stackに残ったまま(破棄されていない)条件入力画面・出発地点選択画面のReact Contextを購読しているコンポーネントが再レンダーされ、それぞれの「departureが無ければ出発地点選択画面へ」といったガード用useEffectが発火し、意図せず過去の画面へ戻ってしまっていた。ルート決定確認画面への遷移ではreset()を呼ばないようにし、この競合を解消した
- **出発地点選択画面で、地図での場所確定後に必ず`mode`を`'menu'`へ戻すようにした**: 「指定した場所」の確定、「自宅を変更」の登録確定のどちらも、これまでは確定後に画面のmodeを地図ピッカーのままにしていたため、後から(reset()の副作用等で)出発地点選択画面に戻された際に、ユーザーが選んでいないのに地図ピッカーが再表示される状態になっていた
- **画面遷移の二重発火防止**: ルート比較画面の「このルートにする」に、遷移中は再度押せなくする状態(`isNavigatingToSummary`)を追加。`useFocusEffect`で画面へ戻ってくるたびにこの状態をリセットし、次回も正しく機能するようにした
- **選択ルートが存在しない場合の安全策**: `route-compare.tsx` `route-summary.tsx` ともに、選択中のルートが見つからない場合は再選択を促す画面を表示し、クラッシュしないようにした

### 確認したこと

- `npx tsc --noEmit`: エラーなし(`app/route-summary.tsx`追加にともない、`npx expo start --web`を一度実行してexpo-routerのtyped routes型定義を再生成する必要があった)
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metro/React Compilerが正常起動し、Web向けバンドルが成功することを確認(地図はプレースホルダー表示のため、地図操作に起因するクラッシュ自体はWebでは再現・確認できない)
- コードレビューにより、各修正が該当箇所を直接解消していることを確認。実機(Expo Go)での再現・再確認はこのセッションでは実施できていない

### 未完了

- **実機(Expo Go)での再確認が未実施**。特に以下は実機での動作確認が必要
  - 自宅を変更する際の地図選択でクラッシュしないこと
  - 「指定した場所」の地図選択でクラッシュしないこと
  - 「このルートにする」がルート決定確認画面へ前進し、過去の画面へ戻らないこと。連続タップしても二重に画面が開かないこと
  - 出発地点を「指定した場所」にした場合でも、ルート決定確認画面まで進んだ後に出発地点選択画面の地図ピッカーが勝手に再表示されないこと

### 次にやること

- 実機(Expo Go)で上記4項目を再確認し、結果をふまえて必要な追加修正を行う
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-08-30(3)

Expo Goでの実機確認で見つかった4件の不具合を、`feature/core-route-discovery-flow` ブランチ上で修正した(commit・pushは未実施、実機での再確認待ち)。

### 完了したこと

- **ルート比較画面の地図カメラ制御を作り直した**: これまでMapViewに `initialRegion` と `region`(controlled)を同時に渡していたため、選択ルートが変わるたびの再レンダーで地図のカメラ制御が競合し、特に寄り道重視ルート(4地点)→短時間ルート(1地点)のようにマーカー数が大きく変わる切り替えでクラッシュしやすい状態だった。`components/map/drive-map-view.tsx` を `forwardRef` 化し、`ref.animateToRegion()` による命令的なカメラ制御一本に統一。`region` の同時指定をやめ、`onMapReady` で地図の準備完了を待ってから初めてカメラを動かすようにした
- **Marker/Polylineをルート単位のkeyで管理**: `contentKey`(選択中ルートのid)をkeyに含め、ルート切り替え時にMarker/Polylineをまとめて作り直すようにし、要素数が変わる切り替えでも部分更新による不整合が起きないようにした
- **ルート比較画面の状態アクセスを防御的にした**: `resolveSelectedIndex()` で「選択中IDが見つからない/範囲外」の場合も必ず有効なindexへフォールバックするようにし、アンマウント後の非同期コールバックを`isMountedRef`でガード
- **出発地点選択画面の現在地取得をtry/finallyで再構成**: 許可/拒否/例外のいずれの経路でも、finallyブロックで必ず`mode`を`'menu'`または`'location-denied'`に確定させ、`'locating'`のまま残ることがないようにした。条件入力画面から戻ってきた場合も、出発地点選択画面はメニュー状態で即座に操作できる
- **登録済み自宅の変更に対応**: 自宅が登録済みの場合、「この自宅を使う」「自宅を変更」の2ボタンを表示。「自宅を変更」は登録済み座標を初期位置として地図選択画面を開き、「この場所を自宅として登録」を押したときだけSecureStoreを更新する。「戻る」で抜けた場合はSecureStore・画面状態のどちらも変更されず、元の自宅を保持する

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metro/React Compilerが正常起動し、Web向けバンドルが成功することを確認(地図はプレースホルダー表示)
- コードレビューにより、各修正が該当箇所を直接解消していることを確認。ただし下記の通り、実機(Expo Go)での再現・再確認はこのセッションでは実施できていない

### 未完了

- **実機(Expo Go)での再確認が未実施**。特に以下は実機での動作確認が必要
  - 3つ目のルート(短時間ルート)を選んでもクラッシュしないこと
  - 1→2→3→1の切り替えを20回以上繰り返してもクラッシュしないこと、どのルートでも「このルートにする」が正常に動作すること
  - 自宅の「この自宅を使う」「自宅を変更」、変更キャンセル時に元の自宅が保持されること
  - 出発地点選択→条件入力→戻る、を行っても現在地取得画面が固まらないこと

### 次にやること

- 実機(Expo Go)で上記4項目を再確認し、結果をふまえて必要な追加修正を行う
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-08-30(2)

### 完了したこと

- `feature/core-route-discovery-flow` ブランチで、最初の縦断機能(ホーム→出発地点選択→ドライブ条件入力→ルート比較)を実装
- `npx expo install react-native-maps expo-location expo-secure-store` でパッケージを追加し、`app.json` に `expo-location` の権限文言(日本語)を設定
- Expoテンプレートのデモ画面・デモコンポーネント((tabs)グループ, modal.tsx, hello-wave, parallax-scroll-view, haptic-tab, external-link, collapsible, icon-symbol, 未使用のreact-logo系画像)を削除し、アプリ独自の画面に置き換え
- `types/`(location, drive, route)、`services/route`(RouteProvider interface, MockRouteProvider, GoogleRoutesProviderのスタブ)、`services/geocoding`(GeocodingProvider interface, MockGeocodingProvider)、`services/location`(現在地取得, 自宅座標のsecure-store保存)、`contexts/drive-flow-context.tsx`(画面間で出発地点・条件・提案ルートを共有)を新規作成
- `components/map/drive-map-view.tsx` と `drive-map-view.web.tsx` を作成し、react-native-mapsがWeb未対応のため、Web版では地図をプレースホルダー表示に切り替えるプラットフォーム別実装にした
- ホーム画面(`app/index.tsx`)、出発地点選択画面(`app/departure.tsx`)、ドライブ条件入力画面(`app/conditions.tsx`)、ルート比較画面(`app/route-compare.tsx`)を実装

### 確認したこと

- `npx tsc --noEmit`: エラーなし(expo-router のtyped routesは、実装後に一度 `npx expo start --web` を実行して型定義(`.expo/types/router.d.ts`)を再生成する必要があった)
- `npm run lint`: 警告・エラーなし(未使用importを1件修正)
- `npx expo start --web`: Metro/React Compilerが正常起動し、Web向けバンドルが3回ともエラーなく完了することを確認(地図はプレースホルダー表示)
- 自宅座標はexpo-secure-storeにのみ保存し、座標値をコード内でログ出力していないことを確認
- 現在地の許可/拒否どちらの分岐でも例外を投げず、UI上でエラーにならない実装になっていることをコードレビューで確認(実機での動作確認は未実施)

### 未完了

- 実機(iOS/Android)またはExpo Goでの通し操作確認(この作業では未実施。README「Expo Goでの確認手順」を参照して別途確認が必要)
- Android実機でのGoogle Maps表示確認(APIキー未追加のため、地図タイルが表示されない可能性がある)
- 住所からの場所検索、旅行先モード、みんなのドライブ、記録機能は未実装

### 次にやること

- 実機またはExpo Goでの通し動作確認と、見つかった不具合の修正
- Google Routes API / Geocoding APIへの差し替え方針の詳細検討(導入時期含む)

---

## 2026-08-30

### 完了したこと

- リポジトリ全体の構成を確認(Expo初期テンプレートの状態であることを確認)
- Claude Code / Codex / GitHub で安全に共同開発するための基盤ドキュメントを整備
  - README.md をアプリのコンセプト・進捗が分かる内容に更新
  - AGENTS.md を、AI開発者向けの共通ルール(main直接変更禁止・秘密情報/個人情報の取り扱い・実装後の検証とドキュメント更新)として整備
  - CLAUDE.md に、Claude Code向けの追加ルール(大きな変更は計画提示・パッケージ勝手追加禁止・検証とドキュメント更新の徹底)を追記
  - docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/PROGRESS.md を新規作成
  - CHANGELOG.md, .env.example を新規作成
  - `.gitignore` に `.env` / `.env.local` を追加し、秘密情報を含むファイルが誤ってコミットされないようにした

### 確認したこと

- 現状のプロジェクトはExpo初期テンプレート(`create-expo-app`)のままで、アプリ独自の画面・機能は未実装であること
- `package.json` に型チェック専用スクリプトはないが、`npx tsc --noEmit` で型チェックが可能なこと
- `npm run lint`(`expo lint`)でlintが実行できること
- 今回のドキュメント整備作業ではアプリのコード(`app/`, `components/`等)は変更していないこと

### 未完了

- アプリの実機能(寄り道ルート提案、地図表示、位置情報取得など)は未着手
- 有料API(Google Routes, Google Places, Supabase, AI API)との連携は未着手

### 次にやること

- プロダクト要件(docs/PRODUCT.md)に基づいた画面・情報設計の検討
- 位置情報取得やルート表示など、コア機能の技術検証(無料・モックデータの範囲で)
