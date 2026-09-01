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

## 2026-09-01(4)

`feature/route-condition-improvements` ブランチ(`feature/spot-discovery-improvements`からの派生)で、ルート提案時の条件入力を「単なるナビ条件」から「今日どんなドライブがしたいか」を選べる体験へ改善した(commit・pushは未実施)。

### 完了したこと

- `types/drive.ts`: `Mood`型の値を、既存の7値(view/sea/mountain/cafe/nightview/hidden/omakase)から新しい8値(scenic/coastal/mountain/nightDrive/leisurely/detourRich/short/homeFocused、ラベルは景色重視/海沿い/山道/夜ドライブ/のんびり/寄り道多め/短時間/帰宅時間重視)へ差し替えた。型名`Mood`・ラベル定数`MOOD_LABELS`はそのまま流用し、`DriveConditions.mood`(単一選択)は`moods: Mood[]`(複数選択、最大`MAX_SELECTED_MOODS`=3件)へ変更した(理由は`docs/DECISIONS.md`に記録)
- `AvailableTime`に`'custom'`を追加し、`DriveConditions.customAvailableMinutes?: number`を新設。`AVAILABLE_TIME_LABELS`にも「時間を指定」を追加した
- `formatMinutesLabel()`・`summarizeDriveConditions()`を`types/drive.ts`に追加。選んだ条件を「景色重視・海沿い・2時間くらい」のような1行の文字列にまとめる
- 使わなくなった`DETOUR_LEVEL_LABELS`(専用UIセクションの削除にともない未使用になった)を削除した
- `services/route/time-budget.ts`: `resolveAvailableMinutes()`を追加し、`availableTime`が`'custom'`のときは`customAvailableMinutes`(未設定時は2時間相当へフォールバック)を使うようにした。既存の4つの固定値(1h/2h/3h/half-day)の分岐・帰着時刻との比較ロジックは変更していない
- `services/route/mock-route-provider.ts`: `buildArchetypes(conditions)`を新設し、3ルート案の役割(景色重視/バランス/3案目)は固定のまま、名前・説明・タグ・「どんな人向けか」・平均速度・経由地の数・時間予算の使用割合を、選んだ`moods`・`detourLevel`に応じて組み立てるように変更した。3案目は「短時間」を選んでいれば「短時間ルート」、選んでいなければ「のんびりルート」になる。既存の二分探索によるルートフィッティング(`buildRoute`内の縮尺探索)・時間予算チェックのロジックは変更していない
- `types/route.ts`: `RouteOption`に`audience: string`(どんな人向けか)を追加。`RouteOption`を組み立てているのは`mock-route-provider.ts`だけであることを確認したうえで必須フィールドにした(理由は`docs/DECISIONS.md`に記録)
- `app/conditions.tsx`を全面的に作り替え
  - 画面上部に「今日はどんなドライブにする?」の見出しを追加
  - 「今日の気分」(旧「気分」)をチップの複数選択(最大3件、任意)にし、上限に達した場合は案内メッセージを表示する
  - 「使える時間」→「どれくらい走る?」に改称し、「時間を指定」を選ぶと30分〜5時間の候補チップが追加で表示される
  - 「帰着地点」→「戻り方」、「帰着時刻(目安)」→「何時ごろ戻る?」に改称(選択肢自体は変更していない)
  - 「寄り道」の専用チップ行を削除し、送信時に`moods`から`DetourLevel`を導出する(「寄り道多め」→多め、「短時間」→少なめ、それ以外→普通)
  - 送信ボタンを「ルートを提案してもらう」→「今日のルートを見つける」に変更
- `app/route-compare.tsx`・`app/route-summary.tsx`: 画面上部に`summarizeDriveConditions()`による選んだ条件の要約表示を追加。ルートカードに`route.audience`(どんな人向けか)の表示を追加
- 既存のルート比較・スポット探索・ドライブ記録・日記・共有機能のロジックは変更していない(`route-compare.tsx`・`route-summary.tsx`は表示追加のみ)

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metroが起動し、Web向けバンドルがエラーなく完了することを確認(共有画面由来の`shadow*`非推奨警告のみで、今回の変更によるエラー・警告はなし)
- `conditions.mood`(旧フィールド)を参照している箇所が`app/conditions.tsx`・`services/route/mock-route-provider.ts`以外にないことをコードレビュー・grepで確認済み。`services/spot/spot-route-plan.ts`は`DriveConditions`を丸ごと`resolveEffectiveTimeBudget`へ渡すだけで、`mood`・`detourLevel`を直接参照していないため、今回の変更の影響を受けないことを確認した
- 既存のルート探索・スポット探索・ドライブ記録・日記・共有機能の画面・ロジックは変更していないことをdiffで確認

### 未完了

- 実機(iOS Expo Go)での通し確認: 「今日の気分」の複数選択(上限・解除)、「時間を指定」の候補チップ、条件に応じた3ルートの違い(距離・時間・タグ・audience)、ルート比較・ルート決定確認画面での条件要約表示
- Google Routes API/Google Places API等の実データ接続、実交通情報・天気APIとの連携、複雑な日時計算(日付をまたぐ帰着時刻等)は今回スコープ外で未着手

### 次にやること

- 実機(Expo Go)で上記の一連の操作を確認する
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-09-01(3)

`feature/spot-discovery-improvements` ブランチ(`feature/drive-sharing`からの派生)で、既存のスポット探索機能を「経由地を追加する機能」から「ルート上で寄り道したくなる場所を見つける体験」に近づける改善を実装した(commit・pushは未実施)。

### 完了したこと

- `types/spot.ts`: `SpotCategory`の許容値を、内部の型名・フィールド名は変えずに「ごはん/カフェ/絶景/温泉/アクティビティ」の5カテゴリへ差し替えた。画面の絞り込み条件を表す`SpotBrowseFilter`型(`'おすすめ' | SpotCategory`)と、タブ表示順の`SPOT_BROWSE_FILTERS`定数を新規追加した(バッジ表示用と絞り込み用でカテゴリ語彙が二重にならないようにした設計判断は`docs/DECISIONS.md`に記録)
- `services/spot/mock-spot-provider.ts`: モックスポットのテンプレートを5カテゴリ×2件(計10件)に作り直し、カテゴリ切り替えが実際に確認できるようにした。Google Places API等の外部APIは今回も未使用
- `app/spot-discovery.tsx`
  - 画面上部に横スクロール可能なカテゴリチップ(既存の`OptionChip`コンポーネントを再利用)を追加。「おすすめ」は絞り込みなしで全カテゴリのスポットをそのまま表示し、他のカテゴリは`spot.category`で絞り込む
  - 地図マーカー・スポットカードの一覧を、絞り込み後の`categorizedSpots`から生成するように変更(カテゴリ切り替え時にマーカー・カードが同じ条件で連動して変わる)。カードを選ぶと対応するマーカーが選択状態になり、マーカーを選ぶと対応するカードへスクロールして選択状態になる、という既存の連動挙動は維持した
  - カテゴリ切り替え時にカード一覧の横スクロール位置を先頭へ戻し、地図カメラもそのカテゴリのスポットが収まる範囲へ再度合わせるようにした(ルート+カテゴリの組み合わせごとに一度だけ合わせ、以降のユーザー操作を上書きしない既存の設計を踏襲)
  - 選んだカテゴリに該当するスポットが0件の場合もエラー画面にはせず、案内メッセージを表示したうえで他のカテゴリへ切り替えられるようにした
  - 新しい路線に新規スポットを読み込んだとき(ルートを変えたとき)は選択中カテゴリを「おすすめ」へ戻す一方、同じルートの読み込み済みスポットへ戻ってきた場合はカテゴリ選択を維持するようにした
  - 「経由地に追加」→「ここ寄ってみる」、「経由地から外す」→「行くのをやめる」、「経由地」バッジ→「寄るところ」、関連するエラーメッセージ・ボタン文言をすべて柔らかい言い回しへ変更した。スポットを1件も選ばずに次へ進める既存の挙動、`MAX_SELECTED_SPOTS`・`calculateSpotRoutePlan`による時間予算チェック・ルート再計算のロジックは変更していない
- `app/route-plan.tsx`・`app/route-summary.tsx`: スポット選択に関する文言(「追加した経由地」→「寄るところ」等)を同様に柔らかい言い回しへ変更した。決定・時間予算チェックのロジックは変更していない
- ドライブ記録・日記フェーズで新設した画面(`drive-recording.tsx`・`drive-summary.tsx`・`drive-diary-create.tsx`・`drive-diary-confirm.tsx`)は今回のスコープ外として変更していない(理由は`docs/DECISIONS.md`に記録)
- 不要になったコード(旧`framedRouteIdRef`は`framedKeyRef`に統合、旧5カテゴリのテンプレート定義)は残さず置き換えた
- **実機確認で見つかった不具合を修正**: 地図を手動でズーム・パンした後にマーカーやカードを選択すると、地図が全体表示へ戻りズームが解除されてしまう問題を修正した。原因は、選択時のカメラ移動に`computeRegionForPath([...route.path, spot.coordinates])`(ルート全体+選択スポットを収める「全体表示」用の関数)を使っていたことだった。`onRegionChangeComplete`で地図の現在regionを`currentRegionRef`に保持し、マーカー/カード選択時はそのregionの`latitudeDelta`/`longitudeDelta`(現在のズーム量)だけを引き継いで選択スポットへセンタリングするよう変更し、「全体表示」(初回・カテゴリ切り替え時のみ)と「個別選択時のセンタリング」の責務を分離した(詳細は`docs/DECISIONS.md`に記録)。`DriveMapView`コンポーネント自体は変更していない

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metroが起動し、Web向けバンドルがエラーなく完了することを確認(共有画面由来の`shadow*`非推奨警告のみで、今回の変更によるエラー・警告はなし)
- `.category`の参照箇所(`drive-diary-create.tsx`・`drive-summary.tsx`・`route-plan.tsx`・`drive-diary-confirm.tsx`・`spot-discovery.tsx`)はすべて表示用で、特定のカテゴリ文字列に依存したロジックがないことをコードレビューで確認済み。カテゴリ値の変更によるそれらの画面への挙動影響はない
- 既存のルート探索・ドライブ記録・日記機能の画面・ロジックは変更していないことをdiffで確認
- カメラ制御の修正はコードレビューで、`handleSelectSpot`が全体表示用の関数を呼ばなくなったこと、初回表示・カテゴリ切り替え時の全体表示用`useEffect`は変更していないことを確認

### 未完了

- 実機(iOS Expo Go)での通し確認: カテゴリチップの切り替え、地図マーカー・カードの連動、スポット0件カテゴリの案内表示、寄るところの追加・削除、時間予算チェック、および手動ズーム後のマーカー/カード選択でズームが維持されること
- Google Places API等の実データ接続、共有カードへのカテゴリ情報の反映、コード全体のcleanup(チーム統合前に別途予定)は今回スコープ外

### 次にやること

- 実機(Expo Go)で上記の一連の操作(特にカメラ制御の修正)を確認する
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-09-01(2)

`feature/drive-sharing` ブランチ(`feature/drive-diary`からの派生)で、ドライブ日記の共有機能プロトタイプ(日記確認→共有テンプレート選択→共有プレビュー→システム共有)を実装した(commit・pushは未実施)。

### 完了したこと

- パッケージ追加の事前確認: 共有画像の生成(画面キャプチャ)とOS共有シートの起動には新規パッケージが必要なため、実装前にユーザーへ選択肢(パッケージ追加の有無、GPSルート線をreact-native-svgで描くか否か)を提示し、合意を得たうえで`npx expo install react-native-view-shot expo-sharing`を実行した(CLAUDE.md/AGENTS.mdの依存関係追加ルール、および今回の要件で明示された事前確認に従った)。GPSルート線はreact-native-svgを追加せず、Viewを回転させて組み合わせる方式にした
- `services/sharing/share-route.ts`(新規): `DriveDiaryEntry.track`(生の緯度経度配列)を書き換えず、共有カード内の0〜1相対座標(`SharePoint[]`)へ変換する`projectTrackToSharePoints()`を実装。経度方向は平均緯度のcosで補正し、ルート線の形が実際の移動比率に近くなるようにした。開始・終了地点付近を既定割合(8%、最大40%までクランプ)だけ間引く`maskRouteEndpoints()`という小さな汎用ユーティリティも実装し、変換パイプラインからデフォルトで利用している(本格的なプライバシーマスクUIは今回のスコープ外)
- `services/sharing/share-image.ts`(新規): 共有カードのViewを`react-native-view-shot`でPNG画像化し、`expo-sharing`でOS標準の共有シートへ渡す`shareCardView()`を実装。画像化・共有シート起動どちらの失敗時も例外を投げず、呼び出し側がエラーメッセージを表示して再試行できるようにした
- `components/sharing/route-line.tsx`(新規): 正規化済みの相対座標だけからルート線を描く`RouteLine`コンポーネント。地図タイル・地図アプリのスクリーンショットは使用せず、区間ごとに回転させた細いViewを並べて線を表現する(react-native-svgは未使用)
- 共有カードテンプレートを3種類新規作成(`components/sharing/`)
  - `share-card-photo.tsx`(PHOTO): 日記の1枚目の写真を全面背景にし、GPSルート線を重ね、下部にタイトル・日付・距離・時間を表示。写真がない場合は安全な単色背景にフォールバックする
  - `share-card-data.tsx`(DATA): 写真を使わず、走行距離・走行時間を大きな数字で、経由スポット数・日付・ルート名・タイトルを添える、Spotify Wrapped風のカード
  - `share-card-memory.tsx`(MEMORY): 写真1〜3枚・タイトル・メモ・日付・距離/時間に加え、隅に小さなGPSルート線を表示。写真がない場合はプレースホルダー表示にする
  - 3テンプレートとも`components/sharing/card-dimensions.ts`で定義した9:16(Instagram Stories想定)のサイズで統一
- 共有画面(`app/drive-diary-share.tsx`、新規)を作成。PHOTO/DATA/MEMORYを`OptionChip`(既存コンポーネントを再利用)で切り替えるとプレビューが即座に更新される。「共有する」を押すと表示中のカードを画像化し、iOSの共有シート(Instagram/LINE/AirDrop/保存等)を開く。プレビュー画面には、緯度経度や住所などの正確な位置情報を文字として表示していない旨の注記も入れた
- `app/drive-diary-confirm.tsx`(日記確認画面)に「共有する」ボタンを追加し、共有画面へ進めるようにした。既存の「ホームに戻る」はsecondaryボタンへ変更
- `app/_layout.tsx`に`drive-diary-share`画面を追加
- `types/drive-sharing.ts`(新規)に`ShareTemplateId`とラベル定義を追加
- 既存のルート探索・スポット探索・ドライブ記録・日記作成/確認のロジックは変更していない(`drive-diary-confirm.tsx`はボタン追加のみ)

### 確認したこと

- `npx tsc --noEmit`: エラーなし(`app/drive-diary-share.tsx`追加にともない、`npx expo start --web`を一度実行してexpo-routerのtyped routes型定義を再生成する必要があった。また`react-native-view-shot`の`captureRef`へ渡す`RefObject`の型をuseRefの実際の型(`View | null`)に合わせて修正した)
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metroが起動し、Web向けバンドル(entry.js / render.js)がエラーなく完了することを確認(共有カードのプレビュー用スタイルで`shadow*`スタイルがWeb向けに非推奨という警告が出るが、iOSネイティブでは標準のスタイルであるため今回は変更していない)
- 共有カードのプレビュー・画像内に、緯度経度や住所などの正確な位置情報を文字として表示していないことをコードレビューで確認
- 既存の出発地点選択・ドライブ条件入力・ルート比較・ルート決定確認・スポット探索・ルート確認・ドライブ記録・日記作成・日記確認の画面・ロジックは変更していないことをdiffで確認
- **実機(iOS Expo Go)で共有機能(日記確認→「共有する」→PHOTO/DATA/MEMORY切り替え→「共有する」→共有シート起動)が正常に動作することを確認済み**。`react-native-view-shot`によるカード画像化もこの環境で問題なく動作することを確認した
- commit前の最終確認として、`git status`・`git diff`でAPIキー・トークン・実在住所・正確な位置情報・個人情報が差分に含まれていないことを確認した

### 未完了

- 本格的なプライバシーマスク(道路上の距離基準での除外、UI上の設定切り替えなど)、共有カード・日記データのローカル永続化、Instagram専用SDK/Meta連携、「みんなのドライブ」投稿機能は今回スコープ外で未着手

### 次にやること

- `feature/drive-sharing`ブランチへcommit・push(mainには触れない)し、レビュー依頼へ進む
- 次フェーズ(記録・日記・共有カードのローカル永続化)の要件整理に着手する

---

## 2026-09-01

`feature/drive-diary` ブランチ(`feature/drive-recording`からの派生)で、ドライブ日記プロトタイプ(記録結果→日記作成→日記確認)を実装した(commit・pushは未実施)。

### 完了したこと

- パッケージ追加の事前確認: 写真ライブラリ選択には新規パッケージ(`expo-image-picker`)が必要なため、実装前にユーザーへ確認し、合意を得たうえで`npx expo install expo-image-picker`を実行した(CLAUDE.md/AGENTS.mdの依存関係追加ルールに従った)
- `app.json`の`plugins`に`expo-image-picker`を追加し、iOS写真ライブラリ許可文言(日本語)を設定した
- `app/drive-summary.tsx`(記録結果確認画面)に「日記を作成」ボタンを追加し、日記作成画面へ進めるようにした。既存の「ホームに戻る」はsecondaryボタンへ変更
- 日記作成画面(`app/drive-diary-create.tsx`)を新規作成
  - タイトル・ひとことメモ・日付(YYYY-MM-DD、初期値は記録終了日時)をテキスト入力で編集できる
  - 走行距離・走行時間・選択したルート・経由したスポットは`driveRecord`(記録結果)からの読み取り専用表示とした(自由入力にしない理由は`docs/DECISIONS.md`に記録)
  - 「写真を選ぶ」から`services/media/photo-picker.ts`(新規)経由で`expo-image-picker`を呼び出し、端末の写真ライブラリから最大3枚選択できる。許可拒否・エラー・機能非対応時も例外を投げず、案内メッセージを表示したうえで写真なしのまま日記作成を続けられるようにした
  - タイトル未入力・日付形式不正の場合はエラーメッセージを表示し保存をブロックする
  - 保存時に`driveRecord`の値をコピーして`DriveDiaryEntry`(JSON化可能なプレーンオブジェクト)を組み立て、`DriveFlowContext`の`addDiaryEntry`へ渡す
- 日記確認画面(`app/drive-diary-confirm.tsx`)を新規作成。保存したタイトル・メモ・日付・写真・走行距離・走行時間・選択したルート・経由したスポットを表示し、次の共有機能で利用する想定のデータであることを案内する。「ホームに戻る」でホーム画面へ戻れる
- `contexts/drive-flow-context.tsx`に`diaryEntries: DriveDiaryEntry[]`・`latestDiaryEntryId`・`addDiaryEntry`を追加。既存の`driveRecord`等と同じくアプリ内状態(React Context)のみで保持し、永続化(AsyncStorage・Supabase等)は行っていない
- `types/drive-diary.ts`を新規作成し、`DriveDiaryEntry`・`DiaryPhoto`の型を定義。将来の共有機能(写真・GPSルート線・距離・時間・タイトルの再利用)に向けて、記録した生のGPS座標配列(track)は加工せずそのまま保持する方針にした(`docs/DECISIONS.md`に記録)
- `app/_layout.tsx`に`drive-diary-create`・`drive-diary-confirm`の2画面を追加
- 既存のルート探索・スポット探索・ドライブ記録(`app/drive-recording.tsx`・`hooks/use-drive-recording.ts`等)は変更していない

### 確認したこと

- `npx tsc --noEmit`: エラーなし(`app/drive-diary-create.tsx`・`app/drive-diary-confirm.tsx`追加にともない、`npx expo start --web`を一度実行してexpo-routerのtyped routes型定義を再生成する必要があった)
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metroが起動し、Web向けバンドル(entry.js / render.js)がエラーなく完了することを確認
- 既存の出発地点選択・ドライブ条件入力・ルート比較・ルート決定確認・スポット探索・ルート確認・ドライブ記録の画面・ロジックは変更していないことをdiffで確認(`app/drive-summary.tsx`はボタン追加のみ)
- **実機(iOS Expo Go)で以下を確認済み**: 記録結果画面から「日記を作成」へ進めること、タイトル・メモ・日付を入力できること、写真を最大3枚選べること、写真なしでも保存できること、日記確認画面に距離・時間・選択したルート・経由したスポット・写真が表示されること
- commit前の最終確認として、`git status`・`git diff`でAPIキー・トークン・実在住所・正確な位置情報・個人情報が差分に含まれていないことを確認した

### 未完了

- タイトル未入力・日付形式不正時のエラーメッセージ表示(バリデーション)の実機確認
- 日記の一覧・編集・削除(ホーム画面の「記録を見る」は引き続き準備中)は今回スコープ外で未着手
- 日記データのローカル永続化(AsyncStorage等、アプリ再起動後も残す)、クラウド同期、共有画像生成・Instagram共有・Supabase・外部APIは今回スコープ外で未着手

### 次にやること

- `feature/drive-diary`ブランチへcommit・push(mainには触れない)し、レビュー依頼へ進む
- 次フェーズ(共有機能・記録の永続化)の要件整理に着手する

---

## 2026-08-31(4)

`feature/drive-recording` ブランチで、ルート決定後のドライブ記録プロトタイプ(ドライブ開始→走行記録→終了→記録結果確認)を実装した(commit・pushは未実施)。

### 完了したこと

- `app/route-plan.tsx` の決定完了画面に「ドライブを開始」ボタンを追加し、ドライブ記録画面(`app/drive-recording.tsx`)へ進めるようにした(スポットあり・なしどちらの完了画面からも遷移可能)
- ドライブ記録画面(`app/drive-recording.tsx`)を新規作成。経過時間・走行距離・現在地(緯度経度)・記録状態(記録前/記録中/記録終了)を表示し、「記録を開始」「ドライブを終了」で記録の開始・終了を操作できる
  - 既知の問題(`route-plan`でのMapViewマウントによるiOS Expo Goクラッシュ、2026-08-31(2)参照)を踏まえ、この画面ではMapViewを一切マウントせず、現在地はテキスト表示にとどめた(`docs/DECISIONS.md`に記録)
- 記録ロジック本体を`hooks/use-drive-recording.ts`に実装
  - 記録開始時に`requestCurrentLocation()`(既存の現在地取得処理を再利用)で許可・取得を試み、成功すれば実GPSモード、失敗(拒否/エラー)すればデモ走行モードへ自動フォールバックする
  - 実GPSモードは5秒間隔で`requestCurrentLocation()`を呼び直して座標を記録。デモ走行モードは`services/location/drive-demo-simulator.ts`が選択中ルートの`route.path`に沿って前後に往復する座標を同じ5秒間隔で生成する
  - 記録した座標配列から`services/location/coordinates.ts`に追加した`haversineDistanceKm`で走行距離を積算。経過時間は開始時刻との差分から算出し、画面のタイマー表示とずれないようにした
  - 記録開始・終了の二重実行を防止するガード(`isStartingRef`)を追加
- 記録結果確認画面(`app/drive-summary.tsx`)を新規作成。走行時間・走行距離・記録した座標数・選択したルート・経由したスポットを表示し、次フェーズの日記作成機能で使う想定のデータであることを案内する。「ホームに戻る」でホーム画面へ戻れる
- `contexts/drive-flow-context.tsx`に`driveRecord`(記録結果のスナップショット1件、`route`・`spots`・`track`・距離・時間・記録元を含む)と`setDriveRecord`を追加。既存のdeparture/conditions/routes/spots等と同じくアプリ内状態(React Context)のみで保持し、永続化(AsyncStorage・Supabase等)は行っていない
- `types/drive-recording.ts`を新規作成し、記録データの型(`RecordedTrackPoint`・`DriveRecordingResult`)を定義。将来の共有機能(GPSルート線を写真に重ねて共有)に向けて、記録データ(生の座標配列)を表示・共有用データと結合しない方針で設計した(`docs/DECISIONS.md`に記録)
- `app/_layout.tsx`に`drive-recording`(戻るボタン非表示)・`drive-summary`の2画面を追加
- 依存パッケージの追加は行っていない(`expo-location`は導入済みのものを再利用)

### 確認したこと

- `npx tsc --noEmit`: エラーなし(`app/drive-recording.tsx`・`app/drive-summary.tsx`追加にともない、`npx expo start --web`を一度実行してexpo-routerのtyped routes型定義を再生成する必要があった)
- `npm run lint`: エラー・警告なし
- `npx expo start --web`: Metroが起動し、Web向けバンドル(entry.js / render.js)がエラーなく完了することを確認(地図を使わない画面のため、Web版でも表示ロジック自体は確認できるが、実機での操作確認は別途必要)
- 既存の出発地点選択・ドライブ条件入力・ルート比較・ルート決定確認・スポット探索・ルート確認(`route-plan`)の画面・ロジックは変更していないことをdiffで確認(`route-plan.tsx`は完了画面へのボタン追加のみ)

### 未完了

- 実機(iOS Expo Go)での通し確認: 「ドライブを開始」→記録開始(許可時の実GPSモード、拒否時のデモ走行モードの両方)→「ドライブを終了」→記録結果確認、の一連の操作
- 記録中に画面を離れる(戻る操作・アプリ切り替え等)場合の挙動の実機確認(タイマー・GPS購読は画面アンマウント時に停止する実装だが、実機での見え方は未確認)
- ドライブ記録データのローカル永続化(アプリ再起動後も残す)、クラウド同期、日記作成・写真選択・共有画像生成・SNS共有は今回スコープ外で未着手

### 次にやること

- 実機(Expo Go)で上記の一連の操作を確認する
- 問題がなければcommit・push、レビュー依頼へ進む
- 次フェーズ(日記作成)の要件整理に着手する

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
