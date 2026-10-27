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

## 2026-10-27 (EAS Updateの実機反映確認・fingerprint一致確認)

EAS Preview Build(Internal Distribution)をインストールしたiPhoneに、`preview`チャンネル経由のEAS Updateが届くことを確認した。これにより、JS/TSの変更は再ビルドなしでiPhoneへ反映できる運用が確立した。

### 完了したこと

- `eas fingerprint:compare`で、ローカル(Windows)と最新のPreview Build(コミット`def5839`)のfingerprintが一致することを確認(`1d68ad408b0f8fee935250fc91a566db74127380`)
- 確認用の一時的な変更として、プロフィール画面「アプリについて」の表示を`ドライブ発見(100 Program版)✓`に1文字だけ変更し、`eas update --channel preview --environment preview`で配信(Update group `84301fbd-…`)。変更はコミットしていない
- iPhoneで反映を確認した後、表示を元に戻し、同じ`preview`チャンネルへ元に戻す更新を配信(Update group `7bfa7961-…`)

### 確認したこと

- iPhone単体(PCと同じWi-Fiでなくても)でPreview Buildを起動できること
- `preview`チャンネル経由のEAS UpdateがiPhoneに届き、アプリを2回起動し直す(1回目でダウンロード、2回目で適用)とプロフィール画面に✓が表示されること
- JS/TSの小さな変更は、fingerprint(runtimeVersion)が変わらない限り、再ビルドなしでEAS Updateから反映できること
- `eas update`実行時に、EASの`preview`環境から`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`が読み込まれること(値は表示されない)
- Supabase / Upstash復旧後、iPhoneで今ドラのルート提案・ドライブ計画のAI相談が正常に動作すること
- `npx tsc --noEmit` / `npm run lint`: エラーなし

### 未完了

- `docs/TESTING-CHECKLIST.md`(回帰テスト用)は未コミットのまま
- `feature/eas-preview-update`ブランチのpush・Pull Request作成

### 次にやること

- 今後のJS/TSの変更は、実装 → tsc/lint → `eas update --channel preview --environment preview` → iPhoneで確認、の流れで実機テストする
- 依存パッケージ・config plugin・権限等のネイティブ側の変更時は、`eas fingerprint:compare`でfingerprintの変化を確認し、変わる場合は`eas build -p ios --profile preview`で作り直す

---

## 2026-10-22 (iPhone Preview Build実機テスト・Supabase/Upstash障害の復旧)

Apple Developer Programの登録完了を受け、EAS Preview Build(Internal Distribution)でのiPhone単体テストを開始した。テスト中にSupabaseを使う機能が一斉に接続エラーになったため原因を切り分け、サーバー側の設定変更のみで復旧した(アプリのコード変更・再ビルドなし)。

### 完了したこと

- EASの`preview`環境に`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`を登録(expo.devから手動登録)
- iPhoneの実機登録(`eas device:create`)と、`preview`プロファイルでの初回iOSビルド(コミット`def5839`)を作成し、iPhoneへインストール
- 障害対応: SupabaseプロジェクトがPausedだったためResumeし、レート制限用のUpstash Redisが削除されていたため新しいRedis(`drive-discovery-rate-limit`)を作成して、Supabase Secretsの`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`を更新
- READMEに「トラブルシューティング」節(SupabaseのPause / Upstash Redisの削除の確認と対処)を追加

### 確認したこと

- 環境変数: ローカル`.env`とEAS `preview`環境の2変数は、文字数・SHA-256ハッシュで比較して完全一致(値は表示せずに比較)
- Preview Build: ビルドログでpreview環境の2変数が読み込まれていること、ダウンロードした.ipaの`main.jsbundle`に2つの値が埋め込まれていること、更新チャンネルが`preview`でEAS Updateは未配信であることを確認
- 障害の切り分け1(SupabaseのPause): Project URLのホスト名がシステムDNS・DNS-over-HTTPS(Cloudflare/Google)のいずれでもNXDOMAINとなり、PCからも`ENOTFOUND`で到達できなかった。Resume後に解決できるようになった
- 障害の切り分け2(Upstashの削除): Resume後、全Edge Function(`drive-route-planner` / `ai-trip-chat` / `google-routes` / `google-places`)が、新規のinstall-idでも`Retry-After`なしのHTTP 429 `RATE_LIMITED`を返した。コード上、`Retry-After`なしの429はUpstash未設定・接続失敗時(`RATE_LIMIT_FAIL_OPEN=false`)にのみ発生するため、Upstash側の問題と特定した
- 復旧後、iPhone単体(Preview Build)で、起動・Supabase接続・今ドラのルート提案・ドライブ計画のAI相談が正常に動作することを確認
- `npx tsc --noEmit` / `npm run lint`: エラーなし(ドキュメントのみの変更)

### 未完了

- ~~`eas update`による更新配信がPreview Buildへ届くことの確認~~ → 2026-10-27に完了
- ~~ローカル(Windows)とビルドサーバーのfingerprintが一致するかの確認(`eas fingerprint:compare`)~~ → 2026-10-27に完了
- `docs/TESTING-CHECKLIST.md`(回帰テスト用)は未コミットのまま

### 次にやること

- ~~JSの小さな変更で`eas update --channel preview --environment preview`を試し、iPhoneで反映されることを確認する~~ → 2026-10-27に完了
- 長期間テストしない期間の後は、実機テスト前にSupabase(Paused)・Upstash(Deleted)の状態を先に確認する

---

## 2026-10-20 (EAS Preview Build / EAS Update への移行準備)

`feature/100-program-finalization` を起点に `feature/eas-preview-update` ブランチを作成し、Expo Go + LAN接続から EAS Preview Build(Internal Distribution)+ EAS Update へ移行するための、Apple Developer承認前に行える準備作業を実施した。

### 完了したこと

- `npx expo install expo-updates` で `expo-updates`(~57.0.26)を導入
- `eas init` で EASプロジェクト `@kazuhiko0316/drive-discovery-app` を作成し、`app.json` に `owner` / `extra.eas.projectId` を追加
- `eas update:configure` で `updates.url` を設定。自動で付与された `runtimeVersion.policy: appVersion` は方針どおり `fingerprint` に変更。同コマンドが解決済みconfigから `android.permissions`(重複を含む)と `extra.router` を書き戻したため、意図しない変更として削除した
- `eas.json` を新規作成(`preview`: internal distribution / channel `preview` / environment `preview`、`production`: channel `production` / autoIncrement、`appVersionSource: remote`)
- `app.json` に `ios.bundleIdentifier`(`com.kazuhiko.drivediscovery`)と `ios.infoPlist.ITSAppUsesNonExemptEncryption: false` を追加
- AGENTS.md のSDK表記を v54 → v57 に修正(実際の依存は既にSDK 57)
- README に EAS環境変数の登録手順・Preview Build/EAS Updateの手順を追記

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラーなし
- `npx expo config --type public`: bundleIdentifier / projectId / runtimeVersion / updates.url が反映されていること
- `npx expo start`: 開発サーバーが起動し、iOS向けmanifestに fingerprint の runtimeVersion が入ること、iOSバンドル(1854 modules)がエラーなくビルドされること
- `npx expo-doctor`: SDK 57内のpatchバージョン差(expo 57.0.20 → 57.0.30 など16パッケージ)の1件のみ警告。今回の変更とは無関係のため据え置き

### 未完了

- Apple Developer Programの承認待ちのため、`eas build` / `eas submit` / 証明書・プロビジョニングの作成 / 実機(UDID)登録は未実施
- EASの `preview` 環境への環境変数(`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`)の登録は未実施(手順はREADMEに記載)

### 次にやること

- Apple Developer承認後: 環境変数登録 → `eas device:create` → `eas build -p ios --profile preview` → iPhoneへインストール → `eas update` で更新が届くことを確認
- 初回ビルド後、ローカル(Windows)とビルドサーバーでfingerprintが一致するか(`eas fingerprint:compare`)を確認する
- 必要に応じて `npx expo install --check` でSDK 57内のpatch更新を別ブランチで適用

---

## 2026-09-17g (Photo API真のlazy load・Spot Card整理・選択済みRoute維持でのOptional Stop追加)

`feature/100-program-finalization` ブランチで、実機テストで見つかった複数の重大な不具合(1. Photo API request暴走・非表示Spotへの写真取得・同一Placeの重複取得、2. 今ドラSpot CardのUI重複・重なり、3. 選択済みRouteへOptional Stopを追加すると元Routeの主要構成が失われる重大な不具合、4. Route Compare/warning UIの密度・強さ、5. チップサイズ、6. 「半日」の解釈ゆれ)を修正した(commit・pushは未実施)。検索品質自体の大規模な再設計・新機能追加・高沢さんコード統合は今回行っていない。

前のセッション(Photo APIのqueue/session上限導入、Spot Card写真上下の重複解消、`lockToProvidedStops`サーバーフラグの追加)からの続きで、実機再テストの結果「session上限で無理やり止まっているだけで、非表示のPlaceまでrequest自体は発生し続けている」「温泉追加で選択していたRouteそのものが失われる(直行ルート化)」という、より深い根本原因が新たに見つかったため、その修正が中心。

### 完了したこと

- **Photo APIの真のlazy load化**: `services/spot/place-photo-cache.ts`の`useCandidatePhoto`に`visible: boolean`引数を追加し、visible=falseの間は`resolveCachedPhoto`自体を呼ばない(queueへも積まない)ようにした。以前はqueueの優先度(high/low)を分けているだけで、表示されているかに関わらず候補分すべてが即座にfetch要求されていた(=遅延実行であってlazy loadではなかった)。`app/spot-discovery.tsx`は1画面1枚のpaging carousel構造のため、`Math.abs(index - selectedIndex) <= 1`(現在表示中のカード+前後1件)だけをvisible扱いにし、それ以外はスクロールで近づくまで一切fetchしないようにした
- **Photo cacheのログ拡充**: `place-photo-cache.ts`のdevStatsに`visibleRequestCount`(可視化されてfetchを要求した回数)・`maxQueueSize`(同時queue最大件数)を追加し、`uniquePlaces`(要求された一意のPlace数)も含めて`__DEV__`ログへ出すようにした(Place名・座標・APIキーは含めない、件数のみ)
- **今ドラSpot Cardの重なり対策**: 実機で地図・候補カード・下部の操作ボタンが競合して詰まって見える不具合について、地図の最小高さ(180→130)とコンパクト表示時の写真の縦横比(16:10→16:9)を縮小し、下部要素により確実にスペースを譲るようにした。あわせて`PlaceInfoOverlay`にcompact時は説明文を最大1行に切り詰める`compact`引数を追加した(写真上は場所名を優先)
- **カテゴリチップのサイズ固定**: `components/ui/option-chip.tsx`で選択時に`fontWeight`を700へ変えていたのを、常に600固定にした(太字化で文字幅が変わりchipが一瞬大きくなったように見える不具合の修正)。選択状態はborder・background・文字色のみで表現する
- **【最重要】選択済みRouteへのOptional Stop追加の再修正**: 前回導入した`lockToProvidedStops`(サーバー側で追加anchor探索をスキップし、指定した経由地点だけを通る基本ルートを返すフラグ)自体は正しい設計だが、その「指定した経由地点」の中に前回選択していたRouteのanchor(海沿い・山道等のHard Themeを成立させている実在スポット)を含める処理(`getPreservedAnchorsForActiveRoute()`)が、サーバーの基本ルート(`toBasePlan`)が`suggestedPlace`を返さない(=anchorの名前情報を持たない)ことと組み合わさり、2件目以降のOptional Stop追加でanchorの情報が消えてしまう(=温泉だけの直行ルートに近づいていく)構造的な不具合を特定した。`app/drive-plan-chat.tsx`の`generateRoutes()`で、preservedAnchors(`NamedAnchor[]`、座標+名前)をサーバーへ送る基本ルート計算の材料にするだけでなく、クライアント側で組み立てる`RouteOption.waypoints`のラベルとしても明示的に付け直すよう変更し、Optional Stopを何件追加してもanchorの名前・座標が次のRouteOptionへ自己修復的に引き継がれるようにした
- **「このルートで」の明示的なmodify強制**: `app/drive-plan-chat.tsx`の`performChatRequest`に、AIの`nextAction`判定だけに頼らないclient側のガードを追加した。「このルートで」「今のルートに」等の表現があるのにAIが`generate_routes`(ゼロから再生成)を返した場合は`modify_routes`へ強制的に読み替え、逆に「目的地を◯◯に変更して」等の明示的な変更表現が無いのに`destinationQuery`が返ってきた場合は、それを無視して単なるOptional Stop追加として扱うようにした(「温泉追加して」だけでprincipal goalが勝手に変わることを防ぐ)
- **半日の分数統一**: `supabase/functions/ai-trip-chat/openai-provider.ts`のプロンプトに、「半日」=360分・「1日」=1440分等の分数を明記した(既存の今すぐドライブ機能`services/route/time-budget.ts`の`AVAILABLE_TIME_MINUTES`と同じ定義)。会話のたびにAIが異なる分数を推測しないようにした
- **Route Compare UIの整理**: `app/route-compare.tsx`の警告表示(「目安時間より短めのルートです」等)を、目立つ赤背景のboxからcaption程度の目立たない1行表示へ変更した。カードの情報量も減らし(補助的なtag行を削除、paddingを縮小)、縦の間延びを抑えた

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`・`npx expo export --platform android` すべて成功
- 変更したEdge Function(`ai-trip-chat`、プロンプトのみ)を`npx supabase functions deploy ai-trip-chat`でデプロイ済み。`drive-route-planner`は今回コード変更していないため再デプロイ不要(前回セッションで`lockToProvidedStops`実装済みのものが既にデプロイ済み)
- `removeStopIds`/`reorderStopIds`は引き続き`selectedStops`のみを対象とし、`NamedAnchor`(preserved anchor)は削除・並べ替えの対象にしていない(構造的に非破壊、実機での再テストは未実施)

### 未完了

- 今回の修正はコードレビュー・型検査・ビルド成功で検証したものであり、実機/エミュレータでの動作確認は未実施(この環境に実機・エミュレータが無いため)。特に「温泉追加後もRouteの主要構成が維持されるか」「Photo APIの実fetch数が数カテゴリ閲覧程度で一桁に収まるか」は、ユーザー側での実機再テストが必要
- 検索品質そのもの(target durationへの収束精度・今ドラ2時間指定での1時間38分といった下振れ・和歌山半日海沿いで徳島/兵庫方面へ候補が伸びる可能性)は、既存のPrefecture Hard Constraint(`isOutsideAreaConstraint`、`supabase/functions/drive-route-planner/plan-builder.ts`)がある前提で調査したが、大規模な検索アルゴリズムの再設計は今回のスコープ外として着手していない。「prefectureが取得できない候補は距離ベースの緩いfallback判定になる」という既知の設計上の残存リスクを確認したが、live testingができない状況で挙動を推測だけで変更するのは避け、次回以降の実機再現待ちとした

### 次にやること

- ユーザーによる実機再テスト(iPhone)。特に「山道+紅葉+温泉追加」「和歌山海沿い半日」「今ドラ120分」の3シナリオと、Photo APIのfetch数ログ確認
- 実機で問題が再現する場合は、`__DEV__`ログ(`[place-photo-cache]`行、`visibleRequestCount`/`actualNetworkFetches`等)とRoute再生成後のwaypoints構成を持ち帰り、それを起点にさらに調査する

---

## 2026-09-17f (Visual Design統一 第2弾: 残存White Theme一掃・Route Compare刷新・距離時間フォーマット統一)

`feature/100-program-finalization` ブランチで、第1弾のDark Theme導入後の実機フィードバック(残存White Theme画面・内部route名「(tabs)」の露出・距離の生値表示・Route Compareの旧UI感・LoadingState/EmptyStateの未適用)を踏まえ、UI/UXの統一をさらに進めた(commit・pushは未実施)。Route planning・Photo API・AI nextAction等のロジックには一切触れていない。

### 完了したこと

- **「(tabs)」露出の修正**: `app/_layout.tsx`の`<Stack>`へ`screenOptions={{ headerBackButtonDisplayMode: 'minimal', ... }}`を追加し、戻るボタンを常にchevronアイコンのみ(テキストラベル無し)にした。これにより「(tabs)」に限らずあらゆる内部route名がUIへ露出する経路を構造的に防いだ。あわせて`headerTintColor`・`headerStyle`・`headerTitleStyle`・`contentStyle`をdarkトークンで統一し、まだ個別にvisualを作り直していないネイティブヘッダー画面もdark配色になるようにした
- **残存White Themeの一掃**: `app/departure.tsx`・`app/route-plan.tsx`・`app/spot-discovery.tsx`・`app/route-compare.tsx`・`app/route-summary.tsx`・`app/(tabs)/diary.tsx`・`app/(tabs)/profile.tsx`・`app/(tabs)/trips.tsx`・日記関連画面(`drive-diary-confirm.tsx`・`drive-diary-create.tsx`・`drive-diary-share.tsx`)をdesign tokensへtoken-swapした。JSX構造・state・ハンドラー・API呼び出しは変更していない
- **距離・時間フォーマットの共通化**: `services/location/format-drive-stats.ts`に`formatDistanceLabel()`を追加(1km未満はメートル表記、100km未満は小数第1位、100km以上は桁区切りの整数)。GPS記録由来の生の浮動小数点値(例: 0.00004822988791711062km)がそのままUIへ出ていた不具合を修正し、Home・Diary・Route比較・Route Proposal・記録関連画面のdistanceKm表示をすべてこの関数経由にした。durationは既存`formatMinutesLabel`(`types/drive.ts`)を同様に徹底適用した
- **Route Compare全面刷新**: `app/route-compare.tsx`のカードを、名前+distanceKm/durationMinutesの羅列から、theme badge→ルート名→大きな所要時間+小さめ距離→経由地(最大3件+ほか◯件)→ハイライト→残りのタグ、という情報階層を持つcardへ再構成した。選択状態は全面を塗る薄い青背景をやめ、青いborder+右上の小さいチェックバッジで表現。Card幅を画面の約86%にし、隣のCardが少し見えるようにした(選択・決定・横スワイプのロジック自体は変更していない)
- **Route Proposal Card**: 経由地表示を最大3件+「ほか◯件」に丸め、highlightに`numberOfLines={2}`を追加して情報密度を下げた。distanceKm/durationMinutesの表示も共通フォーマッタ経由にした
- **LoadingState / EmptyState の実適用**: `app/spot-discovery.tsx`のスポット読み込み中・カテゴリ0件・エラー表示、`app/route-compare.tsx`のルート0件表示を、それぞれ既存の`LoadingState`/`EmptyState`コンポーネントへ置き換えた(内部API名・エラーコードはユーザーへ出さない)
- **Settings歯車ボタンの調査**: `app/`・`components/`全体を検索したが、gear/settingsアイコンを使うボタンはコード上どこにも存在しないことを確認した(Expo Go/Dev Clientの開発用オーバーレイの可能性が高い)

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`・`npx expo export --platform android` すべて成功(lint warning 0件)
- `git status`で`supabase/functions/`配下に今回のセッションでの新規変更が無いことを確認し、Search/Route/AI/Photoロジックを変更していないことを確認した
- 主要な`app/`・`components/`ファイルへの網羅的なgrep(`#[0-9a-fA-F]{3,8}`)で、意図的に残した例外(写真オーバーレイの白文字・影の黒・旧「旅行プラン」legacy画面)以外にhexカラーの直書きが残っていないことを確認した

### 未完了

- 旧「旅行プラン」画面(`trip-create.tsx`・`trip-detail.tsx`・`trip-day-timeline.tsx`・`trip-spot-consult.tsx`・`drive-plan-segment.tsx`)は通常操作から到達不可のlegacyのため、今回もtoken-swap対象外のまま
- Settings歯車ボタンはコード上に実在しないため対応できず(実機で見えている場合はExpo Go/Dev Client起因の可能性が高い旨を報告)
- 実機(iPhone)での見た目確認はユーザー側で実施が必要

### 次にやること

- ユーザーによるiPhone実機確認(Home→今ドラ出発地点→今ドラ気分→今ドラRoute Compare→ドライブ計画一覧→ドライブ計画Chat→Route Proposal→Place Candidate→Spot Discovery→Diary→Profile→Bottom Nav→Settings button→Loading/Empty/Error→keyboardの順)
- 「大きな青い歯車」が実機のどの画面で見えるか、スクリーンショット等での追加確認

---

## 2026-09-17e (Visual Design統一: Dark Theme・Design System導入)

`feature/100-program-finalization` ブランチで、チームメンバー「高沢さん」制作のドライブ記録・共有アプリ(dark theme・iOS native感・card-based)と同じプロダクトファミリーに見えるよう、drive-discovery-app側だけでVisual/UI/UXを統一した(commit・pushは未実施)。Route planningロジック(Spot Pool・prefecture Hard Constraint・coastal Hard Constraint・destinationQuery validation・Search Session Cache・AI nextAction等)・Photo API(useCandidatePhoto・session cache・in-flight dedup)には一切触れていない。

### 完了したこと

- **Design Tokens**: 新規`constants/design-tokens.ts`にColors(dark固定)・Radius・Spacing・Typographyを集約
- **共通Component**: `PrimaryButton`(destructive variant追加)・`OptionChip`・`SelectionCard`・`WizardProgressHeader`・`QuickReplyChip`をtoken-swap。新規`ScreenHeader`(戻るcircle button+中央title)・`ActionCard`(icon+title+description、Home/今ドラの主要導線用)・`LoadingState`・`EmptyState`を追加
- **Bottom Navigation**: dark背景・selected state強調へtoken-swap(タブ構成は変更なし)
- **アプリ全体のdark固定**: `app/_layout.tsx`のReact Navigationテーマを常時`DarkTheme`に、`StatusBar`を`light`に固定(OSのlight/dark自動切替は今回導入しない)。これにより、今回visualを作り直していないネイティブヘッダー画面もdark配色に揃う
- **Home**: `ActionCard`ベースの構成へ作り直し(今ドラ/ドライブ計画を大きめカードで提示)
- **今ドラ(`app/conditions.tsx`)・ドライブ計画Chat(`app/drive-plan-chat.tsx`)**: JSX構造・state・ハンドラー・API呼び出しは一切変更せず、StyleSheetの色をすべてdesign tokensへtoken-swap(dark化)。ドライブ計画Chatのヘッダーは新規`ScreenHeader`へ置き換え
- **Place Candidate Card**: `PlacePhotoHero`・`PlaceInfoOverlay`・`PlaceActionButtons`・`PlaceCandidateCard`をtoken-swap。CTAの並びを「主要指標→ここに寄る(primary)→Google Maps/Web(secondary)」の順に整理(仕様のモックアップに合わせた)
- **Route Proposal Card**: 距離/所要時間の羅列表示から、大きな所要時間の数字+経由地の縦の矢印リスト+ハイライト(quote風box)というレイアウトへ再構成。実データ(distanceKm/durationMinutes/waypoints/highlight等)は変更せず、既存propsのまま。「ナビする」をprimary CTAへ変更(「このルートで走る」に相当する実際の挙動のため)
- **Map UI**: `components/map/drive-map-view.tsx`に`provider={Platform.OS==='android'?PROVIDER_GOOGLE:undefined}`を明示し、iOS=Apple Maps・Android=Google Mapsという既存の既定挙動を明文化。Marker/Polyline色をtoken化

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`・`npx expo export --platform android` すべて成功
- `useCandidatePhoto`の呼び出し箇所・依存配列を変更していないことを確認し、Photo API呼び出し回数に影響が無いことを確認した
- Google Places/Google Routes/AI nextAction関連のファイルには一切触れていないことをdiffで確認した

### 未完了

- `route-plan.tsx`・`route-compare.tsx`・`spot-discovery.tsx`・diary関連画面・trip関連画面・profile画面の個別画面としてのvisual再構成(Bottom Nav・DarkTheme化・共通Buttonの見た目変更が自動的に反映される範囲を除く)
- `LoadingState`/`EmptyState`は共通コンポーネントとして用意したが、今回は既存画面の個別ローディング/空状態表示への組み込みは行っていない(次回以降の適用候補)
- 実機(iPhone)での見た目確認はユーザー側で実施が必要

### 次にやること

- ユーザーによるiPhone実機確認(Home→今ドラ→ドライブ計画Chat→Place Candidate Card→Route Proposal→Map→Bottom Navigation→keyboard→loading/empty/error→Photo cacheの順)
- 未統一画面への展開の要否を次回相談

---

## 2026-09-17d (重大バグ修正: Planning Area Hard Constraintが和歌山→四国/兵庫県へ逸脱する不具合)

`feature/100-program-finalization` ブランチで、実機テストにより報告された「和歌山県を指定してRoute生成すると四国・兵庫県が目的地になる」重大な不具合を修正した(commit・pushは未実施)。UI・Spot Pool検索ロジック自体・coastal corridorロジック・Photo Card機能には触れていない。

### 完了したこと

- **根本原因の特定**: (1) `destinationQuery`の解決(`app/drive-plan-chat.tsx`)がplanning area Hard Constraintを完全に迂回していた(Text Search 1件目をそのまま`request.destination`にしていた)、(2) `resolvedPlanningArea.label`がcanonicalな都道府県名とは限らず、サーバー側`.includes()`によるあいまい一致判定が機能しない場合があった、(3) `resolveAreaRadiusMeters`が生テキストへの部分一致に依存しており「和歌山方面」が正しい半径(70km)を引けていなかった、という3つの独立したバグを特定した(詳細はdocs/DECISIONS.md)
- **サーバー側**: `drive-route-planner`の`isOutsideAreaConstraint`を、`areaConstraint.prefecture`(新規、canonicalな都道府県名)がある場合は`candidate.prefecture`との厳密一致を最優先にするよう変更。`selectFinalCandidates`の直後に`filterSelectedByAreaConstraint`(Route完成後の最終Validation)を追加。Spot Pool cache(Upstash)のキーprefixを`pool:`→`pool:v2:`へ繰り上げ、修正前の可能性のある不正キャッシュを即座に無効化
- **クライアント側**: `services/spot/google-places-client.ts`の`PlaceCandidate`へ`prefecture`を追加。`services/location/prefecture-radius.ts`の`resolveAreaRadiusMeters`がcanonicalな都道府県名を優先して引けるように変更。`app/drive-plan-chat.tsx`にarea解決ヘルパー`resolvePlanningArea`を切り出し、`applyPlanUpdates`内で同一ターン内に即座解決(レースコンディション修正)。`destinationQuery`・`biasAreaQuery`の解決に、確立済みplanning areaへのlocationBiasと、解決結果のprefecture不一致時の採用拒否を追加
- **AIプロンプト**: `ai-trip-chat`のシステム指示に、地域条件の訂正・強化(「和歌山県内で」「県外に行かないで」等)も`generate_routes`として扱う旨の明示例を追加(スキーマ変更なし)

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios` すべて成功
- `drive-route-planner`・`ai-trip-chat`をdeployし、実座標(和歌山駅 34.232,135.192)での実APIテストで、(A)おまかせ目的地3時間→紀三井寺・白崎海洋公園展望台・雑賀崎灯台等、すべて和歌山県内の実在スポット、(B)海沿いテーマ4時間→磯釣り・白崎海洋公園展望台・雑賀崎灯台等、すべて和歌山県内の海沿いスポット、いずれも四国・兵庫県への逸脱が無いことを確認した
- 同一リクエストの再実行で同じ候補が高速(1秒未満)に返ることを確認し、Spot Poolキャッシュが正しく機能していることを確認した
- 高知駅・高知県・5時間・海沿いの既存回帰テストで、仁淀川河口海岸・桂浜 海のテラス・龍王岬という多様な実在候補が返り、規制していないことを確認した

### 未完了

- 実機(iPhone)でのチャットフロー確認(「和歌山方面で探して」→結果確認→「もう一度和歌山方面で探して」/「和歌山県内で」等の訂正フロー)はユーザー側での実機確認待ち(サーバー側API・Hard Constraint自体はcurlで直接検証済み)
- dev logのcache hit/miss・rejected count等は、このセッションからは`supabase functions logs`コマンドが利用できず直接確認できなかった(コード自体は`console.log`で出力する実装のまま)

### 次にやること

- ユーザーによる実機確認(上記チャット訂正フロー、および高知以外の県境付近の地域での追加確認)

---

## 2026-09-17c (Place候補カードの「写真+場所らしさ」化: Photo Candidate Card)

`feature/100-program-finalization` ブランチで、「候補が名前だけの一覧で、一目で『ここ良さそう』と判断しづらい」という実機フィードバックを踏まえ、検索ロジック(Spot Pool・Hard Constraint・Search Session Cache・Route生成)には手を入れず、Place候補カードのUIだけを「写真+場所固有の短い説明+ドライブ適合性+Google Maps/Web確認リンク」を持つカードへ作り替えた(commit・pushは未実施)。

### 完了したこと

- **Google Places (New) Photosの実装**: 共有FIELD_MASK(`google-places-provider.ts`)へ`places.photos`を追加し、検索結果から先頭1枚分の写真参照(`photoRef.name`・`authorAttributions`)を取得できるようにした。`photos`フィールドのSKU tierは公式ドキュメントで断定できなかったため、1行で切り戻せる追加にとどめ、検索予算とは独立した`google-places-photo`予算カウンタを新設してコスト影響を分離した(詳細はdocs/DECISIONS.md参照)
- **Photo Media(実画像)取得の新規エンドポイント**: `google-places` Edge Functionへ`mode:'photo'`を追加し、サーバー側でGoogle Photo Media(`skipHttpRedirect=true`)を叩いて`photoUri`(APIキーを含まない、直接fetch可能なGoogle CDN URL)だけをクライアントへ返すようにした。実機のTokyo Towerでのテストで、返された`photoUri`が追加認証なしで200 image/jpegとして取得できることを確認した
- **クライアント側の写真キャッシュ**: `services/spot/place-photo-cache.ts`を新設し、セッション内のみのMapキャッシュ(TTL 20分)・進行中フェッチの重複防止・`__DEV__`時のfetch数/cache hit/miss/unavailable件数ログを実装した。表示された候補分だけ、1Place1枚、キャッシュ経由でのみ写真を取得する
- **場所固有の説明文(AI不使用、決定的テンプレート)**: `services/spot/place-description.ts`を新設し、Google Placesが実際に返したaddressComponents(市区町村・都道府県)とカテゴリだけから「事実」の文を、テーマだけから「ルート適合性」の文を、それぞれ別のテンプレートで機械的に組み立てるようにした。AIへの新規問い合わせは行わず、源泉かけ流し・絶景・SNSで人気等の未確認の主張を一切作らない設計にした
- **新規再利用コンポーネント**: `PlacePhotoHero`(写真/プレースホルダー+グラデーション+カテゴリバッジ)・`PlaceInfoOverlay`(写真上の名前/カテゴリ/短い説明)・`PlaceActionButtons`(ここに寄る+Google Maps/Web)・`PlaceCandidateCard`(ドライブ計画チャット向けフル版)を`components/ui/`に追加した。写真取得失敗/写真無し/予算切れのいずれでもカードの高さ・情報は変わらず表示される(カテゴリ別の色付きプレースホルダーへフォールバック、生成AI画像は使わない)
- **Google Maps単体リンク・Web検索リンク**: `services/navigation/google-maps-view.ts`を新設し、APIキー不要のGoogle Maps Universal URL(`query_place_id`でPlace ID精度)と、シンプルなWeb検索URLを組み立てられるようにした
- **既存画面への適用**: ドライブ計画チャット(`drive-plan-chat.tsx`)のPlace候補カードを`PlaceCandidateCard`(フル版)へ置き換え、今ドラ(`app/spot-discovery.tsx`)の`SpotCard`には`PlacePhotoHero`(コンパクト版)+Google Maps/Webの小さいテキストリンクを追加した(既存の名前・カテゴリバッジ・追加時間・説明・「ここ寄ってみる」ボタンはそのまま維持)
- **依存関係**: 写真下部の「黒→透明」グラデーションのために`expo-linear-gradient`(Expo公式SDKパッケージ)を追加した

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios` すべて成功
- `google-places` Edge Functionをdeployし、実APIで(1)Text Searchが`photoRef`・`locality`を正しく返すこと、(2)`mode:'photo'`が実際の`photoUri`を返し、そのURLが追加認証なしで画像として取得できること、(3)不正な`photoName`(URL注入を試みた文字列)が`INVALID_REQUEST`として安全に拒否されること、(4)実在しないが形式は正しい`photoName`が例外を出さず`PLACE_PHOTO_FAILED`として失敗することを確認した
- 実装直後の実APIテストで、`photoName`の長さ上限(決め打ちの300文字)が実際のGoogleの値(476文字)より小さく、正当なリクエストを誤って拒否するバグを自己発見し、2000文字へ修正・再deployして解消した(docs/DECISIONS.md参照)

### 未完了

- 実機(iPhone)でのドライブ計画チャット・今ドラ双方のPhoto Candidate Card表示確認(写真の見え方、no-photoフォールバック、キャッシュヒットの体感)はユーザー側での実機確認待ち
- 写真機能追加前後でのGoogle Places検索予算(`google-places`)の消費量比較による、`places.photos`追加の実コスト影響の最終確認は、日次予算の消費状況次第で追加確認が必要
- 完成済みRoute Proposal本体・「このルートの近く」欄への写真適用は今回のスコープ外(指示どおり)

### 次にやること

- ユーザーによる実機確認(高知+温泉/海沿い候補、今ドラの絶景候補、同一Place再表示時のキャッシュヒット、写真無しPlaceの表示崩れなし)
- 将来のUI/UX統一ラウンドで、今回のコンポーネント(`PlaceCandidateCard`等)を土台にした横展開を検討

---

## 2026-09-17b (検索品質の抜本改善: Spot Pool設計・Hard Theme全Route適用・planning area Hard Constraint化)

`feature/100-program-finalization` ブランチで、「AIとの相談・チャットUI/UXは良好だが、検索品質・候補選び・ルート提案品質にまだ大きな課題がある」という実機フィードバックを踏まえ、UIを一切作り直さずに検索・候補ランキング・ルート生成エンジンを抜本的に作り直した(commit・pushは未実施)。

### 完了したこと

- **Spot Poolパイプラインの導入**: 「Nearby Searchで近くの場所を少数拾い、その中からRouteを作る」構造から、「areaConstraint.label(実在確認済みの地域名)がある場合、テーマ別に複数のText Searchクエリ(例:「高知県 海岸 観光」「高知県 岬 絶景」「高知県 ビーチ」)を並列実行して広くSpot Poolを作り、そこから食事系除外・planning area整合性チェックを経て候補を選ぶ」構造へ切り替えた(`buildSpotPool`、`plan-builder.ts`)。Nearby Searchは「選ばれたRouteの近くにある場所」用途(既存のNearby Suggestions)に残しつつ、主目的地・主要waypointの選定はこのSpot Pool経由の実在候補(観光地・景勝地・地域代表スポット)を優先するようにした
- **planning areaのHard Constraint化**: Google Places API (New)のaddressComponentsフィールド(`administrative_area_level_1`)から都道府県名を取得し(`prefecture`)、candidate.prefectureとareaConstraint.labelを直接比較するようにした。**一致すれば必ず許容、prefectureが確実に取得できていて不一致なら原則除外**という、単純な距離ベースの制約より遥かに正確なHard Constraintにした(WebFetchで、Text Search・Nearby Searchいずれもこのfieldの追加が既存の課金tierの範囲内であることを確認済み、追加コストなし)。prefectureが取得できない候補(一部の自然地形等)のみ、代表地点からの距離による軽い判定へフォールバックする
- **Hard Theme(海沿い)を1案だけでなく全Route Optionへ適用**: 出発地点へ戻るループ・目的地なしの場合、`buildMultiSectorCoastalPlans`が、実在する海沿いPoolの分布から実際に候補が存在する方向を貪欲法で選び(`selectDiverseBearings`)、方向ごとに独立したcoastal corridorを生成するようにした。固定のコンパス方位(0°/120°/240°)ではなく実在候補の分布に基づく方向選定にしたことで、高知県のように海岸線が特定方向(南側)に偏る地域でも、候補が存在しない方角を無駄に探索しない
- **長時間指定での近場偏重を修正**: anchor距離計算の上限(`resolveLoopRadialMeters`)が45kmで固定されていたため、150分を超える指定(例: 5時間)でもすべて同じ半径にクランプされ、近場の候補を組み合わせて時間を埋める状態になっていた。上限を200kmへ引き上げた(areaConstraintがある場合は引き続きその地域の半径までクランプされるため、県外まで飛ぶわけではない)
- **温泉検索の改善**: 「温泉」カテゴリの検索を、Nearby Searchだけでなく地域名+「日帰り温泉」「天然温泉 日帰り」「温泉 入浴」のText Search優先にし(サーバー側`buildSpotPool`・クライアント側`drive-plan-chat.tsx`の両方)、villa/一棟貸し/コテージ/旅館等の宿泊専用と思われる施設名を除外するようにした。候補カードには「日帰り利用可否等の利用条件は、公式情報でご確認ください」という注記を追加した
- **Search Session Cache**: Upstash Redisを使ったfingerprintベースのPoolキャッシュ(`spot-pool-cache.ts`)を追加した。planning area・テーマ・時間帯等から決定的なfingerprintを作り、同一条件のText Search結果を30分間再利用する(座標・自由記述文は一切含まない)。「別の案見せて」的な再生成でも、同じText Searchを繰り返さない
- **既出候補の除外(`excludePlaceIds`)**: クライアント(`drive-plan-chat.tsx`)がセッション中に一度でも提示した実在Place IDを記憶し(`usedPlaceIdsRef`)、再生成時にサーバーへ送って優先的に避けるようにした(完全ランダム化はしない、ソフトな除外)
- **安全なdebugログ**: candidate pool size・query count・cache hit/miss・area/food rejection count・multiSectorの最終Route数等を、座標・施設名・Secretを含まない形でログ出力するようにした

### 確認したこと

- **高知駅/高知県/5時間/海沿い/目的地おまかせ**: 3案とも高知県内の実在する海沿いランドマーク(室戸岬・足摺岬・龍王岬・竜串海岸・柏島ビーチ等)を経由し、方向・主要地点・Route shapeが明確に異なり、所要時間はそれぞれ93.2%/114.6%/121.6%(目標5時間に対して極端に短い案は無くなった)。修正前は候補が愛媛県境付近まで飛ぶ・小規模飲食店primaryTypeが混じる等の不具合があったが、prefecture Hard Constraint導入後は解消を確認した
- 既存の120分target-time回帰テスト(no-bias): 117分/115分/123分(97.6%/95.6%/102.3%)、理想帯を維持
- 既存の生駒biasPointテスト: 引き続き生駒方向の実在候補を最優先で採用、候補が城跡・神社・寺院等の観光地寄りになっていることを確認
- Google Places Text Searchのlocation Bias半径の実装時バグ(後述)を発見・修正し、修正後に実在する複数の地域代表スポット(柏島ビーチ等)が正しく取得できることを確認した
- `npx tsc --noEmit` / `npm run lint` / `npx expo export --platform ios` いずれもエラーなし

### 実装中に発見・修正した重大なバグ

- **Text Search maxResultsの上限超過**: Spot Pool構築時のText Search呼び出しで`maxResults: 6`を指定していたが、google-places側のバリデーション上限は5件までだった。結果、Spot Pool用のText Searchが**毎回`INVALID_REQUEST`で失敗し、実装した新しいSpot Pool機構がテスト中ずっと機能していなかった**。5件へ修正した
- **locationBias半径の上限誤り**: `MAX_TEXT_BIAS_RADIUS_METERS`を200,000(200km)と設定していたが、WebFetchでGoogle Places API (New) Text Searchの公式ドキュメントを確認したところ、`locationBias.circle.radius`の実際の上限は**50,000(50km)**だった。この誤った上限値のせいで、高知県のような広域のplanning areaを指定するとGoogle側がリクエストを拒否し、Spot Pool検索が全滅していた。50kmへ修正した(それを超えるplanning areaの半径は、locationBias送信時にクランプするだけで、Text Search自体は引き続き地域名を含むクエリ文字列で機能する)
- **空Poolの誤キャッシュ**: 上記2つのバグにより空結果が返っていたText Search結果を、そのままキャッシュへ保存してしまっていたため、バグ修正後も一定時間(TTL 30分)古い空キャッシュが再利用され続ける状態になっていた。空(全クエリ失敗・該当なし)の結果はキャッシュしないよう修正した

### 未完了

- **Search Session Cacheの「別の案見せて」時のAPI削減効果**: 実装・fingerprint設計は完了しているが、本セッション中に一般トラフィックレート制限(`RATE_LIMITED`)に達してしまい、連続リクエストでの厳密な計測(1回目 vs 2回目の実際のGoogle呼び出し回数比較)を完了できなかった。ロジック上はcache hit時にText Search呼び出し自体をスキップする設計になっていることをコードレビューで確認済み
- mountain/river corridorへのHard Theme全Route適用は、`buildCoastalCorridorPlan`/`buildMultiSectorCoastalPlans`と同じ枠組みを再利用できる設計にはしたが、今回はcoastalのみ実装・検証した(ユーザー自身の優先順位指定に従った)
- 今ドラ(`conditions.tsx`)は area概念が無いため、Spot Pool・prefecture Hard Constraintの対象外のまま(既存のanchor+Nearby Search探索を維持)。「今回大規模UI変更は不要」の方針どおり、今ドラ側のUI・入力ステップは変更していない
- 実機でのUI操作を伴う完全なE2E確認(温泉候補カードの注記表示、Kochi 5時間シナリオの実際のチャット操作等)は、curlベースの検証環境の制約により未実施

### 次にやること

- 一般トラフィックレート制限のクールダウン後、Search Session Cacheのヒット率・API呼び出し削減効果を厳密に再計測する
- 実機(iPhone)で、高知県・5時間・海沿い・おまかせの一連の操作、および温泉候補カードの注記表示を確認する

---

## 2026-09-17 (実機フィードバック対応: coastal時間収束・planning area分離・optional stop個別ID管理・UI/UXは変更せず)

`feature/100-program-finalization` ブランチで、実機テストの結果「チャットUI/UXは良好」だが裏側のルート生成・スポット順序・状態管理に残っていた不具合を修正した(UI/UXコンポーネントは一切変更していない。commit・pushは未実施)。

### 完了したこと

- **coastal corridorのtarget-time収束**: `buildCoastalCorridorPlan()`を、既存のtarget-time anchor探索と同じ理想帯(85〜110%)判定に従う適応的探索へ変更した。理想帯より短い場合、直前に見つかった海沿い候補の方角(originから見たフロンティア方向)へさらに遠くを探し、既存候補を置き換えるのではなく**積み増す**ことで中間解を逃さないようにした(須磨1件では短すぎるが須磨+もう1件でちょうど良い、のようなケースに対応)。理想帯より長い場合はorigin寄りの1件に絞って再計算する
- **おまかせgoal候補の実測時間フィルタ**(`app/conditions.tsx`): AIのテーマ一致だけで採用せず、各候補について実測したGoogle Routes所要時間が目標時間に対して近すぎる(比率0.5未満)場合は単独ゴールとして採用しないようにした
- **観光地優先のカテゴリ整理**: `google-places/place-types.ts`の`scenic`カテゴリに、WebFetchで確認したGoogle公式Table Aの実在type(`tourist_attraction`/`national_park`/`historical_landmark`/`castle`/`monument`/`cultural_landmark`/`shinto_shrine`/`buddhist_temple`/`museum`/`aquarium`/`zoo`)を追加し、観光地・景勝地を優先しやすくした。あわせて、ユーザーが明示的に飲食を求めていない検索では飲食店寄りのprimaryTypeの候補を除外する`isLikelyFoodPlace`判定を追加した
- **AIのgoal候補生成プロンプト改訂**(`ai-route-planning`): 主ゴール候補が実在店舗名(飲食店等)に偏らないよう、観光地・景勝地・地域を代表するランドマークを優先する指示を追加した
- **「ドライブする地域」と「出発地点」の分離**(`app/drive-plan-chat.tsx`、ドライブ計画チャット限定・今ドラは対象外): `areaQuery`を実在確認して代表地点+目安半径(`resolvedPlanningArea`)を持つようにし、この情報を実際のルート生成(`areaConstraint`)へ渡すようにした。これまで`areaQuery`は表示用のラベルでしかなく、実際のanchor探索は出発地点(自宅等)を中心に行われていたため、「高知県でドライブ」と言っても無関係な地域にルートが生成される不具合の根本原因だった
- **origin外confirmationフロー**: planning areaと出発地点が明らかに離れている場合、勝手にルートを作らず「移動も含めるか・現地に着いてから探すか」を確認するようにした。「現地に着いてから探す」を選んだ場合は、自宅座標を使わず実在する現地の代表地点(駅等)を新しい出発地点として使う
- **候補のarea制約**(`drive-route-planner`): `areaConstraint`(代表地点+半径)を新設し、候補・anchor生成をこの範囲内へ制約するようにした(代表地点からの距離による安全な範囲制約。厳密な行政界polygonは今回導入していない)
- **optionalスポットの個別ID管理**(`app/drive-plan-chat.tsx`): 候補カードから選んで追加したスポットを、`viaPoints`(名前+座標のみ)から`SelectedStop`(id・Google Place ID・カテゴリ・追加順・表示名・座標)へ置き換えた。AIには座標を渡さず、id・カテゴリ・追加順・実在施設名のみの安全な構造(`stops`)を渡すようにした
- **AIスキーマへ`removeStopIds`/`reorderStopIds`を追加**: 「最初に追加した温泉を消して」→addedOrder最小のonsenのidだけを`removeStopIds`へ、「温泉は最後にして」→現在のstop id全件を希望順に並べた`reorderStopIds`を返すようにした。カテゴリ単位の全削除ではなく個別idでの削除・並べ替えになる
- **optionalスポットの順序最適化**(`drive-route-planner`): `orderWaypointsForEfficiency()`を新設し、順序に意味を持たないoptionalViaPoints(候補カードから追加したスポット)を、総移動距離+Uターンpenalty(進行方向が120°を超えて反転する箇所へ加算)が最小になる順へ並べ替えるようにした。追加のGoogle API呼び出しは一切行わない(純粋な幾何計算のみ)。userViaPoints(今ドラの経由地点ステップ等、順序固定の必須経由地点)は一切並べ替えない
- **状態を失わない設計**: `generate_routes`/`modify_routes`のたびに無条件でoptional stopをリセットしていたのをやめ、originまたはareaQueryが実際に変わった場合のみリセットするようにした。これにより海沿いcorridor+温泉のような複合条件でも、既存の海沿い希望を維持したまま選択済みスポットを組み込めるようになった
- **優先順位の明文化**: `drive-route-planner`のコード冒頭コメントに、必須地点＞planning area制約＞明示的なcorridor希望＞選択済みoptional stop＞時間目標＞柔らかいテーマ、という優先順位を明記した

### 確認したこと

- coastal corridor(大阪駅・120分・海沿い): 修正前は須磨ヨットハーバー1件のみで90分(75.3%、時間目標を無視)固定だったのが、修正後は須磨+イースターマリーナの2件で147分(122.4%)まで収束するようになった(実在データの制約上、厳密な85〜110%には届かないケースもあるが、時間目標に反応して積極的に調整するようになったことを確認)
- 既存の120分target-time回帰テスト(no-bias): 117分/115分/123分(97.6%/95.6%/102.3%)、理想帯を維持
- 既存の生駒biasPointテスト: 引き続き生駒方向の実在候補を最優先で採用。observed候補が城跡・神社等の観光地寄りになったことを確認(scenicカテゴリ拡張の効果)
- `ai-trip-chat`の「最初に追加した温泉を消して」テスト: AIが正しくaddedOrder最小のonsenのidを`removeStopIds`へ返すことを確認
- `ai-trip-chat`の「温泉は最後にして」テスト: AIが正しく現在のstop id全件を希望順に並べた`reorderStopIds`を返すことを確認
- `ai-trip-chat`の7ターン会話・nextAction遷移(search_places→generate_routes→save)の既存回帰テストが、`stops`フィールド追加後も引き続き成功することを確認
- `ai-route-planning`のおまかせgoal候補が、修正前後とも観光地寄りの語句(夜景スポット/高原の展望台/市街地を望む公園等)を返すことを確認
- `npx tsc --noEmit` / `npm run lint` / `npx expo export --platform ios` いずれもエラーなし

### 未完了

- **Google Places/Google Routes日次予算の枯渇により、本ラウンド後半のplanning area制約(高知県5時間diversityテスト)・optionalViaPoints順序最適化のライブ確認が完了できなかった**。本ラウンドの大量デバッグ用リクエスト(coastal corridorの複数回の調整・再デプロイ・確認)で1日あたりの外部API予算(`checkExternalApiBudget`、既定300件/日等)を使い切ったため、`drive-route-planner`が`budget_exceeded`で候補を返せない状態になった(fail-closedで正しく動作しており、コード側のバグではないことをprefilter・base route双方の切り分けテストで確認済み)。日次予算がリセットされ次第、Test C(planning area外confirmation)・Test D(高知県内diversity・県外へ飛ばないこと)・Uターンpenaltyの実route確認を再実施する必要がある
- optionalViaPoints順序最適化(`orderWaypointsForEfficiency`)は、tscでの型検証・ロジックレビューのみ完了しており、実route(Polyline)での最終確認は上記の予算枯渇により未実施
- 実機でのUI操作を伴う完全なE2E確認(area外confirmationのquick reply操作・候補カード選択→ルート再生成→過去提案のcompact化、等)は未実施(curlベースの検証環境の制約)

### 次にやること

- 日次予算リセット後、Test C/D・Uターンpenalty確認を再実施する
- 実機(iPhone)で、高知県・大阪起点・海沿い・温泉追加・削除・並べ替えの一連の操作を確認する

---

## 2026-09-16 (追加作業: 「AIが完成させる」から「AIと一緒に組み立てる」への転換・海沿いcorridor・Route Proposalの完全な時系列化)

`feature/100-program-finalization` ブランチで、「条件を入力するとすぐルートを自動生成するだけ」という実機フィードバックを踏まえ、今ドラ・ドライブ計画の両方を「AIと候補を見ながら一緒にドライブを組み立てる」体験へ改善した(commit・pushは未実施)。

### 完了したこと

- **今ドラ「おまかせ」最終地点の複数候補化**: `ai-route-planning`が性格の異なる最大3件の検索意図(例:「夜景スポット」「高原の展望台」「夜カフェ」)を返すようにし(`suggestedGoalQuery`/`Alt1`/`Alt2`)、クライアント(`app/conditions.tsx`)が実在確認できた候補ごとに個別に`requestDrivePlans`を呼び、体験の異なる複数ゴールを**既存のルート比較画面(3案比較UI)**でそのまま選べるようにした(新しい選択専用画面は追加していない)
- **「海沿い」をルート全体のcorridorとして扱う**(今ドラ・ドライブ計画共通の`drive-route-planner`): これまで最終地点だけが海側になる挙動だったのを、`buildCoastalCorridorPlan()`を新設し、基本ルートのPolyline沿いに複数anchorを置いて実在する海沿いスポット(`beach`/`marina`/`fishing_pier`、WebFetchでGoogle公式Table Aを確認済みの実在type)を検索し、最大2件を経由地点としてGoogle Routesへ渡すことで、ルート形状自体を海側へ寄せるようにした。実在する海沿いスポットが見つからない場合は架空の候補で埋めず、従来のanchor探索結果をそのまま使う
- **origin重複waypointバグの修正**: 「高知駅から出発→高知駅に寄る」という不自然な候補が実機で報告されたため、`MIN_DISTANCE_FROM_MANDATORY_METERS`を150m→800mへ拡大した
- **ドライブ計画チャットのAI意思決定を`nextAction`ベースへ全面刷新**: `shouldGenerateRoutes`/`shouldSave`の2つのbooleanを廃止し、`nextAction`(ask/search_places/generate_routes/modify_routes/save/chat)という1つの決定フィールドへ統合した。「温泉追加して」のような**カテゴリの実在候補を求めているだけ**のメッセージでは`search_places`を選ばせ、即座にルートを完成させず、まずGoogle Placesの実在候補をカードで提示するようにした
- **実在スポット候補のchat item化**: AIが`search_places`を選んだ場合、クライアントが実際にGoogle Placesへ問い合わせ、候補(名前・カテゴリ・既存のdetour見積もり手法(services/spot/google-places-spot-provider.tsと同じHaversine概算)による目安追加時間)をカード形式のchat itemとして表示する。ユーザーが「ここに寄る」を直接タップした候補**だけ**をwaypointへ追加してルートを再生成する(AIは実在の場所名を一切見ない・創作しない、候補選択はAIとの往復無しに直接クライアントで処理する)
- **Route Proposalを本当にチャット履歴へ統合**: `app/drive-plan-chat.tsx`の内部データモデルを、メッセージ配列とルート提案配列が別々だった構造から、`ChatItem`(message/proposal/placeCandidates/error)の単一時系列配列(`items`)へ全面再設計した。新しいメッセージ・ルート提案・実在候補・エラーはすべて同じ`FlatList`の要素として時系列に追加され、最新のRoute Proposalだけが地図付きで展開表示され、それ以前は自動でcompact表示になる
- **スクロール挙動の改善**: チャット一覧が下端付近にある場合だけ新しいitem追加時に自動scrollするようにし(`isNearBottomRef`)、ユーザーが過去のやり取りを読んでいる時に強制的に最下部へ飛ばさないようにした
- **エラー表示のchat item化**: 独立した固定位置のエラーカードをやめ、エラーもchat itemの1種として時系列に表示するようにした(再試行ボタンは引き続き機能する)

### 確認したこと

- `npx tsc --noEmit` / `npm run lint` / `npx expo export --platform ios`: すべてエラーなしで完了
- `drive-route-planner`をdeployし、大阪駅発120分ループ(海沿い希望あり)で、実在するマリーナ(神戸市立須磨ヨットハーバー、primaryType: marina)を経由地点としたルートが返ることを確認。海沿い希望なしの場合の120分収束(97.5%/101.7%/95.8%)・生駒biasPointの効果(前回確認済み)がいずれも維持されていることも再確認した
- `ai-route-planning`をdeployし、「おまかせ」最終地点で3つの体験の異なる検索意図(夜景スポット/高原の展望台/夜カフェ)が返ることを確認
- `ai-trip-chat`をdeployし、「温泉に寄りたいです」→`nextAction: search_places`(即座にルート完成させない)、「海沿い多めにして」→`generate_routes`、「保存したいです」→`save`、と会話の意図に応じて正しく使い分けられることを実際の3ターン会話で確認。既存の7ターン連続会話の無エラー回帰テストも引き続きHTTP 200で通ることを確認した

### 未完了

- 実機(iPhone)での再テストは未実施
- おまかせ最終地点の複数候補・海沿いcorridor・実在スポット候補カードのUIは、実機での見た目・操作感の確認が未検証
- 実在スポット候補カードの「+◯分」表示は、既存のSpot Discoveryと同じ直線距離ベースの見積もりであり、選択後のGoogle Routes実測値とは異なりうる(選択して初めて正確な値になる、という既存の設計方針を踏襲)

### 次にやること

- 実機再テスト

---

## 2026-09-16 (追加作業: ルート提案のdiversity engine根本改善・地理的希望の反映・「おまかせ」最終地点)

`feature/100-program-finalization` ブランチで、実機テストで見つかった「ルート提案そのものが毎回似る」「条件を変えてもルートが変わらない(例:「生駒を走りたい」を追加しても無視される)」という根本問題を修正した。今ドラ・ドライブ計画共通のルート生成エンジン(`drive-route-planner/plan-builder.ts`)を改善し、AIスキーマに強い地理的希望を伝える経路を新設した(commit・pushは未実施)。

### 完了したこと

- **根本原因の特定**: `drive-route-planner`のanchor生成(`LOOP_ANCHOR_BEARINGS`等)は常に固定のコンパス方位のみを使い、どの嗜好パラメータにも一切連動していなかった。かつ今ドラのAI解釈結果(`AiRoutePreferences`)には地名を表すフィールドが存在せず、「生駒を走りたい」という自由記述はAIの出力スキーマ上どこにも反映できない構造だった。これが「条件を変えてもルートが変わらない」の直接の原因
- **biasPointの新設**(`drive-route-planner`): `DrivePlanRequest.biasPoint`(実在確認済みの座標)を追加。指定されるとanchor生成(`generateLoopAnchors`/`generateDestinationAnchors`/`exploreAddedMinutesCandidates`のcorridor anchor)がその地点を最優先anchor(index 0)として必ず含み、残りのanchorもその方角へ偏らせる。`selectFinalCandidates`/`selectDiverseAddedMinutesCandidates`に`priorityAnchorIndex`を追加し、biasPoint由来の候補はscoreの順位に関わらず必ず1件目に採用する
- **AI解釈への地理的希望の追加**: `ai-route-planning`の`AiRoutePreferences`に`requestedAreaQuery`(例:「生駒山」、検索意図の文字列のみ、AIは座標を創作しない)を追加。System instructionsで「生駒を走りたい」等の地名言及をこのフィールドへ抽出するよう指示。クライアント(`app/conditions.tsx`)が`searchPlaceByText`で実在確認してから`biasPoint`として`drive-route-planner`へ渡す。`ai-trip-chat`側にも同じ仕組み(`planUpdates.biasAreaQuery`)を追加し、ドライブ計画チャットでも同じdiversity engineを使えるようにした
- **類似ルート検出(軽量、Polyline上のサンプル点の近接割合のみ)**: `isSimilarRoute()`を新設し、2つのGoogle Routes実測ルートのPolylineから12点サンプリングして70%以上近接していれば「同じルート」と判定する。`selectFinalCandidates`/`selectDiverseAddedMinutesCandidates`を、似た候補を新しい別ルートにせず`nearbySuggestions`(「このルートの近く」)へ振り分けるよう変更(Route diversityとOptional spot diversityの分離)。「3件返すことを優先しない」方針に変更し、本当に別と言える候補が無ければ2件のまま返す
- **候補探索の予算を拡大**(合理的な範囲、既存のbudget check・rate limitは無変更): `MAX_CANDIDATES_TO_EVALUATE`を4→5、`ROUND_ANCHOR_COUNTS`を`[3,2]`→`[4,2]`に変更(最大2ラウンドでPlaces最大6回・Routes評価最大10回程度)
- **今ドラ「おまかせ」最終地点**: `returnTarget`に`'ai-suggested'`を追加。AIが`suggestedGoalQuery`(例:「夜景スポット」、実在する具体的施設名は創作しない)を提案し、クライアントがGoogle Places Text Search(出発地点周辺への`locationBias`付き)で実在確認してから目的地として採用する。解決できなければ安全に通常のループへフォールバックする
- **Google Places Text SearchへのlocationBias追加**: 「夜景スポット」のような一般語句が出発地点から無関係な場所にマッチしないよう、`google-places`のText Searchモードに任意の`locationBias`(中心+半径)を追加した(Nearby Searchの挙動には影響しない)
- **Nearby Suggestions UI**: `RouteProposalCard`に「このルートの近く」セクションを追加し、`+X分`の表示と「追加して再計算」ボタンから、実際にその地点を経由地として加えて`drive-route-planner`を再呼び出しできるようにした
- **チャットのRoute Proposal履歴化**: `drive-plan-chat.tsx`の状態を`routeOptions`/`selectedRouteId`の単一state から`proposals: DrivePlanProposal[]`(履歴配列)へ再設計。新しい提案は常に配列末尾に追加され(既存を上書きしない)、最新の提案だけがMap付きで展開表示され、過去の提案は「前の提案(全Nコース)」+「もう一度見る」のcompact表示になる(過去の提案ではMapを一切mountしない)
- **safe debug log**: `drive-route-planner`に候補数・採用anchor数・biasPoint使用有無を出す`logDiversityOutcome()`を追加(座標・場所名は含めない)

### 確認したこと

- `npx tsc --noEmit` / `npm run lint` / `npx expo export --platform ios`: すべてエラーなしで完了
- `drive-route-planner`を実際にdeployし、大阪駅発120分ループでbiasPoint無し/生駒山biasPointありの2パターンを比較: bias無しではsuggestedPlaceが東西南北ばらばら(豊田池34.539,135.835等)、biasありでは1件目が生駒山からわずか約1kmの実在地点(生フォトット、34.679,135.679)になることを確認。biasPoint無しの120分収束(97.5%/101.7%/95.8%)も維持されていることを確認(回帰無し)
- `ai-route-planning`を実際にdeployし、「生駒を走りたいです」でrequestedAreaQuery:"生駒"が正しく抽出されることを確認。地理的希望の無い通常リクエスト(「海沿いの気持ちいい道を走りたい」)ではrequestedAreaQuery/suggestedGoalQueryが両方とも正しく空文字列になることも確認(回帰無し)
- 「おまかせ」最終地点を実際にdeployして確認: wantsAiSuggestedDestination:trueで「夜景スポット」が提案され、大阪駅周辺へのlocationBias付きText Searchで実在する展望台(日の丸展望台)に解決されることを確認
- `ai-trip-chat`を実際にdeployし、既存の複数ターン会話テストが引き続きHTTP 200で通ることを確認。「桂浜の方に行きたいです」でbiasAreaQuery:"桂浜"が抽出されることも確認

### 未完了

- 実機(iPhone)での再テストは未実施(次回、下記の再テスト手順を参照)
- Nearby Suggestionsの「追加して再計算」ボタンは実機での動作確認が未検証
- Route Proposal履歴化のUI(前の提案のcompact表示)は実機での見た目確認が未検証

### 次にやること

- 実機再テスト(下記21章の手順を参照)

---

## 2026-09-16 (追加作業: ドライブ計画チャットの実機不具合修正・状態管理の堅牢化・UI改善)

`feature/100-program-finalization` ブランチで、直前(同日)にシンプル化した「ドライブ計画をほぼ1画面のチャットへ」のiPhone実機テストで見つかった不具合(ユーザーメッセージの重複、数ターン後にAIへ相談できなくなる、クイック返信のUIがキーボード開閉で崩れる等)を修正した。新機能追加より安定化を優先する指示に従い、機能追加は行っていない(commit・pushは未実施)。

### 完了したこと

- **最重要のバグ修正**: `ai-trip-chat`が数ターン後に必ず失敗する不具合の根本原因を特定・修正した。`openai-provider.ts`の`buildInputMessages()`が会話履歴のassistant発言にも一律で`type: "input_text"`を使っていたが、OpenAI Responses APIはassistant役割のcontentに`"output_text"`を要求するため、2ターン目以降(履歴にassistant発言が含まれた時点)で毎回OpenAI側から400が返っていた。ログ基盤(Supabase CLIに`functions logs`が無い)が使えなかったため、一時的なデバッグ手段でOpenAIの生エラーメッセージを直接確認してから確定的に修正した。修正後、7ターンの実会話テストで全ターンHTTP 200を確認
- 安全ログの強化: `ai-trip-chat`にrequestId(相関ID)・turnCount・HTTPステータス・エラーカテゴリ(timeout/rate_limited/json解析失敗/schema検証失敗等)を`logSafe()`経由で記録するようにした(会話内容・座標は一切含めない)
- 安全マージンの拡大: `MAX_ASSISTANT_MESSAGE_LENGTH`(500→700)・`OPENAI_MAX_OUTPUT_TOKENS`(600→800)を引き上げ、OpenAI Structured Outputsのstrict modeが文字列長をハード制約しないことによる実行時再検証落ち・出力トークン超過を起こりにくくした
- 会話のテンポ改善: System instructionsに「1メッセージで複数情報が伝えられた場合は一度に抽出する」「assistantMessageは2〜3文・120文字程度に簡潔にする」という指示を追加した
- **状態管理の堅牢化**(`app/drive-plan-chat.tsx`): 手動送信・クイック返信・再試行の3経路を`performChatRequest()`に集約し、`useRef`による同期ロック(`sendLockRef`)で「1ユーザー操作につきリクエストは必ず1つだけ」を構造的に保証した。`requestSeqRef`による最新リクエストのみ反映する防御チェックも追加。エラー時は赤文字ではなくinline error card(「うまく接続できませんでした」+「もう一度試す」)にし、再試行は`lastSentMessagesRef`に保持した直前の送信内容だけを再送する(ユーザーメッセージを二重追加しない)
- **クイック返信のpill化**: `components/ui/quick-reply-chip.tsx`に固定`height`(34)・`alignSelf:'flex-start'`・`flexGrow/flexShrink: 0`を設定し、コンテナ側の`ScrollView`にも固定`height`(46)を設定して、キーボード開閉でチップが縦に伸びる不具合を修正した
- **キーボード操作性**: メッセージ一覧`FlatList`・クイック返信`ScrollView`の両方に`keyboardShouldPersistTaps="handled"`を追加し、キーボード表示中でもチップ・ボタンが1タップで反応するようにした(`Keyboard.dismiss()`は元々どこからも呼んでいないため、タップでキーボードが閉じることもない)
- **入力欄のplaceholder動的化**: AIスキーマは変更せず、クライアント側の既知の状態(areaQuery/hasOrigin/themes/routeOptions)だけから「行きたい地域を入力」→「出発地点を入力」→「景色・食事・温泉など希望を入力」→「AIに希望を伝える」の4段階でplaceholderを切り替える軽量ヒューリスティックを追加した
- **レイアウト調整**: ヘッダーの上下余白・メッセージバブルの間隔を詰めた
- **ルート提案カードの再設計**(`components/ui/route-proposal-card.tsx`、新規): Figma参考の「カード単位でまとまった情報設計」を、実データのみ(距離・所要時間・実在suggestedPlace・実際に選んだテーマ・drive-plan-mapper.ts由来の説明文)で構成した。星評価・口コミ件数・架空の写真・架空の「追加時間」は表示しない。保存ボタンに加え、既存の`services/navigation/google-maps-navigation.ts`を使った「ナビする」ボタンを追加した
- 保存済みプランカード(`app/(tabs)/trips.tsx`)に主なスポット名・「続きをAIと相談する」の導線ヒントを追加

### 確認したこと

- `npx tsc --noEmit` / `npm run lint` / `npx expo export --platform ios`: すべてエラーなしで完了
- `ai-trip-chat`をdeployし、7ターンの実会話(「高知県でドライブしたいです」→…→「保存したいです」)をNode script経由で連続送信し、全ターンHTTP 200・想定通りのplanUpdates(1メッセージで複数テーマ+時間を同時抽出できていることも確認)を確認
- 修正前は同じテストが必ずturn 2でHTTP 502(OpenAI側400)になることを再現し、修正後に再現しなくなったことを確認(deterministicな不具合だったため、再現性の確認自体が有力な検証となった)
- headerの「Settingsボタン」について: 現在のコードベース(`app/drive-plan-chat.tsx`および関連画面)には該当するボタンが見当たらなかった。ヘッダーは「← 戻る」テキストリンクとタイトルのみで、過大なコンポーネントは無い。別画面を指している可能性があるため、次回確認が必要

### 未完了

- 実機(iPhone)での再テストは未実施(次回、下記の手順で確認予定)
- Route Proposal Cardの「ナビする」ボタンは実機での動作確認(Google Mapsアプリ起動)が未検証

### 次にやること

- 実機再テスト(下記の再テスト手順を参照)
- 「Settingsボタン」について、該当箇所のスクリーンショット等で認識合わせ

---

## 2026-09-16 (追加作業: ドライブ計画をほぼ1画面のチャットへ大幅シンプル化)

`feature/100-program-finalization` ブランチで、直前(同日)の「今ドラ」/「ドライブ計画」再設計後も実機で使った結果まだ複雑と判断され、「旅行計画アプリを作らない」を最優先方針に、ドライブ計画を「今ドラの、未来・旅先版」としてほぼ1つのチャット画面へ大幅に作り直した(commit・pushは未実施)。着手前にEnterPlanModeで計画を提示しユーザー承認を得てから実装した。

### 完了したこと

- **A. `drive-route-planner`の候補多様性改善**: `plan-builder.ts`に、候補がどの検索anchorから来たかを追跡する`anchorIndex`を追加し、評価予算へ絞り込む前に`interleaveByAnchor()`でラウンドロビン化。最終選抜も2パス化(まだ選ばれていないanchor由来の最良候補を優先→残りはscore順)し、`selectFinalCandidates`・`exploreAddedMinutesCandidates`/`selectDiverseAddedMinutesCandidates`の両方に適用。スコアリング・時間収束ロジック自体は無変更。deploy後、Osaka駅発120分ループで117.15/121.9/114.2分と収束が維持されていることを確認、多様性も改善(地理条件により完全な3-way多様化に至らないケースがあることは確認済みで許容範囲と判断、docs/DECISIONS.md参照)
- **B. Google Places Text Search追加**: 既存`google-places` Edge Functionへ`mode: 'text'`を追加(新規Function無し)。`place-types.ts`に`TextPlaceSearchRequest`/`validateTextPlaceSearchRequest`、`google-places-provider.ts`に`searchTextPlaces`/`buildTextRequestBody`、`index.ts`にmode分岐、`services/spot/google-places-client.ts`に`searchPlaceByText`を追加。deploy後、「高知駅」のText Search・カフェのNearby Search回帰確認をともにHTTP 200で確認
- **C. `SavedDrivePlan`型・ストア新設**: `types/drive-plan.ts`(`SavedDrivePlan`、`Trip`/`TripDay`には合わせない薄い構造)、`services/drive-plan/drive-plan-store.ts`(`trip-store.ts`と同じ安全なAsyncStorageパターン、`drive-discovery.driveplans.v1`キー)を新規作成
- **D. `ai-trip-chat`をv3(Drive Planning Assistant)へ全面刷新**: `chat-types.ts`/`openai-provider.ts`/`index.ts`/`services/ai/trip-chat-client.ts`を全面書き換え。`assistantMessage`+`suggestedQuickReplies`+`planUpdates`(検索意図の文字列のみ、実座標なし)+`shouldGenerateRoutes`+`shouldSave`の5フィールド設計にし、v1/v2のDay/searchIntents概念を撤去。deploy後、実リクエスト(「高知県で気持ちよく走れるドライブコースを探したい」)でHTTP 200・想定どおりの1問だけの追質問・`planUpdates`を確認
- **E. 新しい1画面チャットUX**: `app/drive-plan-chat.tsx`を新規作成。`FlatList`ベースのメッセージ一覧、`KeyboardAvoidingView`+SafeArea対応の入力欄、ワンタップ送信の`components/ui/quick-reply-chip.tsx`、ルート候補が出たらチャット内にインラインで`DriveMapView`+コース切替チップ+簡易しおり+保存ボタンを表示。`savedPlanId`パラメータで保存済みプランを同じ画面に復元して相談を再開できる
- **F. ドライブ計画タブの再構成**: `app/(tabs)/trips.tsx`を「新しくAIと相談する」ボタン+保存済み`SavedDrivePlan`のカード一覧へ全面書き換え。カードは地図を持たず(`route-plan.tsx`で確認済みの既知クラッシュ回避方針を継続)、新規`components/ui/route-preview-strip.tsx`(View/StyleSheetのみのドット+接続線)でルートの形を視覚化。`app/(tabs)/index.tsx`のホーム画面プレビューも`Trip`/`getTrips()`から`SavedDrivePlan`/`getDrivePlans()`へ切り替えた
- **G. 旧UIのlegacy化**: `app/trip-create.tsx`・`app/trip-detail.tsx`・`app/trip-day-timeline.tsx`・`app/trip-day-detail.tsx`・`app/trip-spot-consult.tsx`・`app/drive-plan-segment.tsx`・`services/trip/trip-store.ts`・`types/trip.ts`はコードを削除せず維持し、メイン導線(Bottom Tab・ホーム)からの参照のみ外した。例外として`app/trip-chat.tsx`(v2)は新スキーマとの非互換により動作不能になるため削除し、`app/_layout.tsx`のStack.Screen登録・`app/trip-detail.tsx`からの遷移先を新しい`drive-plan-chat.tsx`へ差し替えた
- ESLintのReact Compilerルール(`react-hooks/immutability`/`react-hooks/purity`)対応: `drive-plan-chat.tsx`で関数の前方参照(`restoreFromSavedPlan`・`persistPlan`)を宣言順に並び替え、`Date.now()`呼び出しをJSXのonPressに最も近い箇所で計算しparameter経由で下位関数へ渡す形に統一した

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo export --platform ios`: 成功(1635 modules、iOS bundle出力を確認)
- Expo Router typed routesが`drive-plan-chat`を認識していることを`.expo/types/router.d.ts`で確認
- `google-places`(Text Search追加分)・`ai-trip-chat`(v3)をdeployし、実リクエストでレスポンス形・HTTPステータスを確認(詳細は上記A/B/D)
- `drive-route-planner`はSection A実装時に1度deploy済みで、以降この画面(E〜G)の実装ではサーバー側コードを変更していないため再deployは行っていない

### 未完了

- 実機(iPhone Expo Go)での一連の動作確認(ドライブ計画のチャット→ルート提案→保存→カード一覧→再編集のフルフロー)は未実施
- README.md / CHANGELOG.md の更新はこのエントリと同時に実施予定(本エントリ記録時点で進行中)

### 次にやること

- 実機でのフルフロー確認(特にキーボード・スクロール・二重送信防止・地図contentKey切替)
- ユーザーへの最終報告(20項目)

---

## 2026-09-16 (追加作業: 「今ドラ」/「ドライブ計画」再設計)

`feature/100-program-finalization` ブランチで、同日の実機フィードバックを踏まえ、アプリの使い方を「今ドラ(今から走る)」/「ドライブ計画(今度走る)」の2つに整理した(commit・pushは未実施、既存の未commit変更はすべて維持)。大きな変更のため、着手前にEnterPlanModeで計画を提示しユーザー承認を得てから実装した。

### 完了したこと

- **今ドラ側は無改造で維持**(`app/conditions.tsx`・`app/route-compare.tsx`・`app/spot-discovery.tsx`・`app/route-plan.tsx`・`drive-route-planner`の時間指定ありパス等)。季節コンテキスト(下記)の追加のみ
- 型拡張(`types/trip.ts`、`types/spot.ts`): `TripSavedPlace`(気になる場所)・`TripDriveSegment`/`TripDriveSegmentCandidate`(区間探索の保存)・`Trip.areaName`/`departurePlace`/`destinationPlace`を追加。`SpotCategory`に`'歴史'`/`'市場'`を追加(`SPOT_BROWSE_FILTERS`は5種のまま変更せず、今すぐドライブのSpot Discoveryチップは無変更)。すべて追加のみで`TRIP_SCHEMA_VERSION`は据え置き
- `services/trip/trip-store.ts`に`addDraftDays`/`setDeparturePlace`/`setDestinationPlace`/`addSavedPlace`/`removeSavedPlace`/`addDriveSegment`を追加。`buildTripFromDateRange`は「最初からDay1/2/3を大量に作らない」方針にあわせ、`days: []`(未分割)で作成するよう変更した(日程分けは`addDraftDays`で後から任意に行う)
- Google Placesカテゴリを5→7種へ拡張(`supabase/functions/google-places/place-types.ts`、`services/spot/google-places-client.ts`、`services/spot/google-places-spot-provider.ts`)。「歴史」「市場」の実在するGoogle Place Types (New) の値はWebFetchで公式ドキュメントを確認して採用した(`historical_landmark`/`historical_place`/`castle`/`shinto_shrine`/`buddhist_temple`/`museum`/`cultural_landmark`/`monument`、`market`/`farmers_market`/`flea_market`)。FIELD_MASK・コスト構造は無変更。`drive-route-planner/plan-types.ts`のローカル複製`DESIRED_STOP_OPTIONS`も同じ2値を追加(`ai-route-planning`側は5値のまま、今ドラの挙動に影響しない)
- `ai-trip-chat`をv2スキーマへ全面刷新(`chat-types.ts`/`openai-provider.ts`/`index.ts`)。`proposedDays`(Day単位の提案)を廃止し、`assistantMessage`+`searchIntents`(カテゴリ・エリアの手がかりのみ、実座標・実名称なし)+任意の`daySuggestion`(ユーザーが明示的に尋ねた場合だけの大まかな日数目安)へ変更。System instructionsを「旅行日程を完成させるAI」から「知らない土地の相談相手」へ書き換え、実在未確認の場所を断定しないことを明記した
- 「この日についてAIに相談する」の日単位チャット導線(`trip-day-timeline.tsx`)を撤去し、「AIへの相談はドライブ計画のホームから」への案内リンクに置き換えた。実機で報告された「どの日から相談してもDayIndex 2固定になる」不具合は、静的解析の結果、AIレスポンスのJSON Schemaがscope.dayIndexへの制約を持たない設計だったことが濃厚な原因と判断し、day概念自体をレスポンスから撤去することで解消した(個別パッチではなく設計変更で対応)
- 季節コンテキスト(`services/date/season.ts`、日付から機械的に算出、外部API不使用)を追加し、今ドラ(`ai-route-planning`、`seasonHint`をoptional追加)・ドライブ計画(`ai-trip-chat`)の両方のAI相談へ渡すようにした。開花・積雪等の実況を断定しない指示をSystem instructionsに追加
- 新規/改修画面: `app/trip-create.tsx`(地域名を追加)、`app/trip-detail.tsx`(ドライブ計画ホームへ全面再設計: 出発地点/目的地の地図設定・気になる場所一覧・AI相談・区間探索・任意の日程分割)、`app/trip-chat.tsx`(v2スキーマ対応、Day概念を撤去)、`app/trip-spot-consult.tsx`(dayId任意化、dayId無しの場合は気になる場所へ保存)、`app/drive-plan-segment.tsx`(新規、A→B区間探索)。`app/trip-day-timeline.tsx`・`app/trip-day-detail.tsx`は既存のまま維持(日程を作った場合の従来導線として到達可能)
- A→B区間探索は、前回実装した`drive-route-planner`の「時間指定なし+目的地あり」パス(基本ルート+corridor anchorのaddedMinutes候補)をそのまま再利用し、新規サーバーロジックは追加していない。「+30分まで/+1時間まで/気にしない」の上限は、返ってきた候補のaddedMinutesをクライアント側でフィルタするだけで実現した
- Bottom Tab・ホーム・一覧画面の文言を「今ドラ」「ドライブ計画」へ軽く変更(タブ構成・アイコン・ナビゲーション構造は無変更)

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`: いずれもエラーなし(型の二重定義(`PlaceSearchCategory`が`spot-provider.ts`と`google-places-client.ts`に別々に存在)に起因する型エラーを発見・修正した)
- 変更したEdge Function(`google-places`・`drive-route-planner`・`ai-route-planning`・`ai-trip-chat`)をdeployし、全関数のOPTIONS応答(204)を確認
- `ai-trip-chat`は実際にリクエストを送信し(`context`にareaName/seasonHint/plannedStartDate等を含む実データ)、v2スキーマのレスポンス(`assistantMessage`+`searchIntents`)が正しく返ることを確認した。返信文中で「紅葉状況や道路状況は直前に確認してください」のように季節情報が弱い表現で扱われ、`searchIntents`が具体的な場所名を創作せずカテゴリ+エリアの手がかりのみを返すことを確認した
- `ai-route-planning`(今ドラ)に`seasonHint`を渡すリクエストを送信し、既存のレスポンス形状のまま正常に動作すること(季節が解釈結果へ自然に反映されつつ、既存フィールドは変更されていないこと)を確認した
- `drive-route-planner`のカテゴリ拡張(`plan-types.ts`)は今回`plan-builder.ts`のロジック自体を変更していないため、実際のGoogle Routes呼び出しを伴うライブテストは行っていない(コスト抑制のため見送り、型検証・deploy成功のみで確認)

### 未完了

- iPhone実機での通し確認(下記「次にやること」参照)はユーザー側で実施予定
- ドライブ計画の「気になる場所」の手動地図追加(AI検索を経ない直接追加)は今回未実装(AI検索意図経由のみ)
- `trip-spot-consult.tsx`・`drive-plan-segment.tsx`は既知のiOS Expo Go + DriveMapViewクラッシュ回避のため地図非表示のまま
- AI相談の会話履歴は画面を開いている間だけの一時状態(永続化なし)

### 次にやること

- iPhone実機で、今ドラ側が無改造で今まで通り動作すること→ドライブ計画の作成(地域名込み)→AIに相談(検索意図の表示・実在候補の確認・気になる場所への保存)→区間のドライブを探す(2地点選択・候補比較・保存)→任意で日程に分けてみる、の順に確認する
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-09-16 (100 Program完成版 UX改善: マーカー操作・時間指定なし・目的地任意化・長距離候補・旅行プランAI相談型しおり)

`feature/100-program-finalization` ブランチで、iPhone実機テストの結果を踏まえたUX改善(A〜N)を実装した(commit・pushは未実施、既存の未commit変更はすべて維持)。大きな変更のため、着手前にEnterPlanModeで計画を提示しユーザー承認を得てから実装した。

### 完了したこと

**今すぐドライブ側**

- Spot Discoveryのマーカー操作(`app/spot-discovery.tsx`, `components/map/drive-map-view.tsx`, `contexts/drive-flow-context.tsx`)
  - 選択中のマーカーを再タップ、または地図の背景(マーカー以外)をタップすると選択解除されるようにした。`DriveFlowContext`に`clearSelectedSpotId`を追加し、`DriveMapView`に`onPress`(背景タップ)・`MapMarkerSpec.zIndex`を追加した
  - 選択中マーカーの`zIndex`を上げて重なったマーカーより前面に表示するようにした。クラスタリングライブラリは追加していない
- 時間指定なしの一貫対応(`services/route/time-budget.ts`, `app/conditions.tsx`, `services/route/drive-route-planner-client.ts`, `services/route/drive-plan-mapper.ts`, `app/route-compare.tsx`, `supabase/functions/drive-route-planner/{plan-types.ts,plan-builder.ts}`)
  - `resolveAvailableMinutes()`が「指定なし」の場合に架空の120分を返していたのをやめ、`undefined`を返すようにした。`availableTimeMinutes`/`RouteOption.targetDurationMinutes`はクライアント・サーバーの型を`number | undefined`に変更し、未指定時はリクエストにキー自体を含めない
  - `route-compare.tsx`は架空の「目安2時間」を表示せず、`targetDurationMinutes`が無く条件が「指定なし」の場合は「時間指定なし ・ 約◯分」と表示する
  - `drive-route-planner`の`buildDrivePlans`を、時間指定あり(既存ロジックを完全に維持)/時間指定なし+目的地あり(基本ルートを基準にaddedMinutes評価で寄り道候補を追加)/時間指定なし+目的地なし(内部ヒューリスティック値はanchor距離計算にのみ使い、meta/RouteOptionには一切出さない)の3ケースに整理した
- 最終目的地の任意化は、既存の`conditions.tsx`「最後はどこにする?」ステップ・`plan-builder.ts`のloop/destination分岐で既に対応済みであることを確認した(追加のロジック変更は不要と判断)
- 長距離・時間超過時の候補(`supabase/functions/drive-route-planner/{plan-builder.ts,polyline.ts}`)
  - 基本ルートが時間予算を大幅超過している場合の検索アンカーを、固定1点(直行区間の中点)から、基本ルートのPolylineを25%/50%/75%でサンプリングしたcorridor anchor(最大3点)へ変更した。Deno実行環境はExpo側の`decodeGooglePolyline`を直接importできないため、同一アルゴリズムを`supabase/functions/drive-route-planner/polyline.ts`へ移植した(意図的な複製、コメントで明記)
  - 評価基準を`addedMinutes = candidate - base`に統一し、目標収束スコアは使わない。実在候補が見つからなければ基本ルートのみを返す(架空の複数案で埋めない)
- スポット情報の見やすさ(`services/spot/google-places-spot-provider.ts`, `app/spot-discovery.tsx`)
  - **方針転換**: 当初はGoogle Places評価(rating)の追加を検討したが、実装中に既存コード(`google-places-provider.ts`のFIELD_MASKコメント、`spot-discovery.tsx`の「Googleの評価・口コミは表示していません」という既存ポリシー文言)と競合することが判明したため、ユーザーに確認のうえ**評価表示は追加しない**方針とした(既存方針を維持)
  - 代わりに、全スポット共通だった固定文言(「実在するスポットです。」等)を、カテゴリ・追加時間・追加距離に基づく具体的な表示へ改善した。Places APIのフィールド追加は行っていない(コスト影響なし)

**旅行プラン側(AI相談型「しおり」への再設計)**

- 型追加(`types/trip.ts`、既存フィールドは変更せずすべて追加のみ、`TRIP_SCHEMA_VERSION`は据え置き): `TransportMode`・`TripTimeHint`・`TripTimelineEntry`(`TripDay.timeline?`)・`TripNotificationSettings`(`Trip.notificationSettings?`、未使用の置き場所のみ)・`Trip.initialWish?`
- `services/trip/trip-store.ts`に`appendTimelineEntries`/`reorderTimelineEntries`/`removeTimelineEntry`/`updateTimelineEntry`/`attachRouteToTimelineEntry`を追加(すべて既存の`updateTripDay`への薄いラッパー、新しい永続化プリミティブは作っていない)
- `DriveFlowContext.activeTripDay`に`entryId?`を追加。`app/route-plan.tsx`の`handleDecide`は`entryId`があればそのタイムラインエントリ1件だけにルートを紐付け(`attachRouteToTimelineEntry`)、無ければ従来どおり1日まるごと更新する(既存の`trip-day-detail.tsx`経由フローは無改造のまま維持)
- 新規Supabase Edge Function `ai-trip-chat`(`index.ts`/`chat-types.ts`/`openai-provider.ts`/`deno.json`、`supabase/config.toml`に登録)を追加。`ai-route-planning`は無改造。既存の`"openai"`予算バケットを共有する。実座標は一切受け取らない設計。AIが具体的な場所を提案したい場合は`needsPlaceSearch`+カテゴリ/エリアの手がかりだけを返させ、場所の創作(店名・座標)はシステム指示で明示的に禁止している
- `services/ai/trip-chat-client.ts`を新規追加(`route-planning-client.ts`と同じfetch/timeout/実行時応答検証パターン)
- 画面: `app/trip-create.tsx`(自由記述欄を追加、3項目のまま)、`app/trip-chat.tsx`(新規、旅行全体/特定日のAI相談チャット、提案は個別に「追加する」まで反映されない)、`app/trip-spot-consult.tsx`(新規、AIの提案からGoogle Placesで実在候補を取得しカード一覧で表示、「予定に追加」で実在Placeだけをタイムラインへ追加)、`app/trip-day-timeline.tsx`(新規、縦のタイムライン、▲▼並べ替え・追加・削除、車区間のみ既存ウィザードへのハンドオフ導線)、`app/trip-detail.tsx`(しおりのヘッダー+各日の予定プレビュー+「AIに旅行全体を相談する」ボタンへ再設計)。`app/_layout.tsx`に新規画面を登録した

### 確認したこと

- `npx tsc --noEmit`: エラーなし(新規画面追加にともない、一度`npx expo export --platform ios`を実行してexpo-routerのtyped routes型定義を再生成する必要があった)
- `npm run lint`: エラー・警告なし
- `npx expo export --platform ios`: iOSバンドルのビルドが成功することを確認
- `supabase/functions/*`はDeno環境のためこのリポジトリの`tsc`のチェック対象外(`tsconfig.json`の`exclude`で除外済み)。Deno CLIがこの環境に無いため、`ai-trip-chat`・`drive-route-planner`の変更はコードレビューのみで、`deno check`相当の型検証は実施できていない
- Google Places評価(rating)表示の方針転換について、ユーザーに確認し「既存方針を維持」の回答を得た

### 未完了

- iPhone実機での通し確認(下記「次にやること」参照)はユーザー側で実施予定
- `ai-trip-chat`は未deploy(Edge Functionの実デプロイ・実際のOpenAI呼び出し確認は次のステップ)
- 旅行のしおり画面(`trip-day-timeline.tsx`)の予定編集(タイトル変更等)・時刻の詳細設定は今回未実装(追加・削除・並べ替え・移動手段のみ)。地図表示は、`route-plan.tsx`で既知のiOS Expo Go + DriveMapViewネイティブクラッシュ問題(docs/DECISIONS.md参照)を踏まえ、`trip-spot-consult.tsx`ではあえて地図を表示せずカード一覧のみにした(将来Development Buildでの原因切り分け後に追加検討)
- 通知機能(データモデルの置き場所のみ追加、配信ロジックは未実装。理由は本セッションの最終報告を参照)

### 次にやること

- `supabase functions deploy drive-route-planner` / `supabase functions deploy google-places` / `supabase functions deploy ai-trip-chat`(変更した関数のみ。`ai-route-planning`・`google-routes`は無変更のためdeployしない)
- iPhone実機で、Spot Discoveryのマーカー4操作→時間未指定時の表示→目的地なしでのPlanning Flow完走→長距離時の候補件数→SpotCardの情報量→旅行作成→AI相談→候補追加→タイムライン確認、の順に確認する
- 問題がなければcommit・push、レビュー依頼へ進む

---

## 2026-09-15 (追加作業2: Spot Discoveryのルート沿い検索・Google Routes再計算・時間予算の非ブロッキング化・日記保存の確実性向上)

`feature/100-program-finalization` ブランチで、100 Program完成版の最終実機テスト前に、Spot Discoveryについて残っていた指摘2点(+関連する時間予算・日記保存の調整)を修正した(commit・pushは未実施)。

### 完了したこと

- 寄り道スポット探索を「ルート沿い」の検索に変更
  - `services/spot/google-places-spot-provider.ts`に`sampleRouteAnchors()`を追加。選択中ルートのPolyline(`route.path`)から25%/50%/75%地点の実座標を検索アンカーとして使い、目的地・出発地点付近だけに検索が偏らないようにした
  - 1カテゴリにつき最大3回(アンカー数ぶん)のGoogle Places検索に抑え、取得結果はPlace IDで重複除外、表示件数は`MAX_RESULTS_PER_CATEGORY`(8件)に制限
  - `services/spot/spot-provider.ts`の`SpotSearchParams`を`preferredCategory?`(2カテゴリ一括取得)から`category`(1カテゴリ必須)へ変更し、1回のAPI呼び出しは常に1カテゴリだけを対象にするよう単純化
- カテゴリチップのオンデマンド検索
  - `app/spot-discovery.tsx`に`ensureCategoryLoaded()`を追加。初回表示時は現在選択中のチップ(既定は「おすすめ」)だけを自動取得し、それ以外のチップは実際にタップされた時点で未取得なら検索する。取得済み/取得中はルート単位で`fetchedCategoriesRef`/`inFlightCategoriesRef`が管理し、同じカテゴリを重複取得しない
  - `contexts/drive-flow-context.tsx`の`initializeSpotDiscovery`を「置き換え」から「マージ(既存spotsへの追加)」へ変更し、カテゴリを追加取得しても既存の選択・表示が失われないようにした
  - API失敗時はモックへフォールバックせず、全アンカー失敗時のみ「検索に失敗しました」の非全画面ブロッキングな案内(初回のみ全画面)を表示する
- 選択スポット追加後のGoogle Routes再計算
  - `services/route/google-routes-client.ts`(再作成)・`services/spot/spot-route-recalculation.ts`(新規)を追加し、既存のdeploy済みSupabase Edge Function(`google-routes`)を使って、出発地点→ユーザー指定の経由地点→drive-route-plannerの提案スポット→選択した寄り道スポット→目的地(ループなら出発地点)の順で実際の道路ルートを再計算するようにした
  - `app/route-plan.tsx`にこの再計算をuseFocusEffectで組み込み、成功時はPolyline・距離・所要時間を実測値へ更新(`recalculatedPlan`)、失敗時は既存のHaversine見積もり(`estimatedPlan`)へ後退して画面を止めない
  - Google Maps外部ナビへ渡すwaypoint順(`navWaypoints`)は、再計算に使うwaypoint順と完全に一致させている(Google Maps側で道路線自体が再計算される既知制約は維持)
- 時間予算を非ブロッキング化
  - `app/spot-discovery.tsx`の寄るところ追加・「寄り道を確認する」ボタンから、時間予算超過時のブロック(選択拒否・ボタン無効化)をすべて撤去し、`services/spot/spot-route-plan.ts`のメッセージ文言も「この寄り道をすると目安時間を約◯分超えそうです」という非ブロッキングの案内へ統一した
  - `app/route-plan.tsx`は元々「この内容で決定」「Google Mapsでナビする」「アプリ内で記録」を時間超過でブロックしていなかったため、実測値ベースの同じ警告文言(`plan.budgetMessage`)を表示するよう整合を取った
- 日記保存の確実性向上
  - `contexts/drive-flow-context.tsx`の`addDiaryEntry`を`Promise<boolean>`を返す非同期関数へ変更し、AsyncStorageへの書き込み完了までawaitできるようにした(同じidでの再保存はupsertし、重複エントリを作らない)
  - `app/drive-diary-create.tsx`の「日記を保存」を、書き込み完了をawaitしてから確認画面へ遷移するよう変更。保存中はボタンを「保存しています…」に変えて連打を防ぎ、保存失敗時はエラーメッセージを表示して確認画面へは進まないようにした

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`: いずれもエラーなし
- Supabase Edge Function(`google-routes`・`google-places`)は今回無変更(`git diff`で確認済み)のため再deployせず
- `app/drive-recording.tsx`・下部タブ(`app/(tabs)/`)・`services/trip/*`は今回無変更(`git diff --stat`で確認済み)

### 未完了

- iPhone実機での最終確認(ルート沿い検索・オンデマンドカテゴリ取得・Google Routes再計算・時間超過時の非ブロッキング挙動・日記保存の確実性)はユーザー側で実施予定

### 次にやること

- iPhone実機確認後、フィードバックに応じて調整

---

## 2026-09-15 (追加作業: Spot Discovery実データ化・日記永続化)

`feature/100-program-finalization` ブランチで、100 Program完成版の総合実機確認前に残っていた「ユーザーから見てモック/再起動で消えるデータ」の2点を仕上げた(commit・pushは未実施)。

### 完了したこと

- 寄り道スポット探索画面(`app/spot-discovery.tsx`)を実Google Placesデータへ置き換え
  - `services/spot/google-places-client.ts`(新規): Supabase Edge Function(`google-places`)へのfetchクライアント。`EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`getInstallId()`を再利用し、Expoから直接Google Places APIは呼ばない。応答は実行時に形状検証し、1件でも壊れていれば応答全体を`invalid_response`として拒否する
  - `services/spot/google-places-spot-provider.ts`(全面書き換え): `resolvePreferredSpotCategory()`でAI解釈の`desiredStops`先頭優先・無ければ`scenic`を選び、この優先カテゴリ+`scenic`の最大2カテゴリを検索。立ち寄り追加時間・距離は、ルート終端の実座標とスポットの実座標のhaversine距離を往復とみなした見積もり(`services/location/coordinates.ts`の`haversineDistanceKm`を再利用、追加のGoogle Routes呼び出しはしない)
  - `services/spot/index.ts`を更新し、`getSpotProvider()`が`GooglePlacesSpotProvider`を返すよう変更(`MockSpotProvider`は残すが呼ばない)
  - 実在スポット(`isMock: false`)を通すためのブロッカーを3箇所修正: `types/spot.ts`の`Spot.isMock`を`true`固定の型から`boolean`へ、`contexts/drive-flow-context.tsx`の`initializeSpotDiscovery`が`isMock`スポットのみ通していたフィルタを削除、`services/spot/spot-route-plan.ts`の`calculateSpotRoutePlan`が「全スポットがモックであること」を要求していたバリデーションを削除
  - `app/spot-discovery.tsx`のモック専用UI文言(マーカー説明文の「・モック」固定表示、ヘッダーの「すべて架空のモックデータです」、カードの「モック」バッジ、口コミ導線の「将来は実在スポットに接続後」という文言)を、`spot.isMock`に応じた条件表示・実データ前提の文言に更新
  - 選択したスポットの実座標は、既存の`app/route-plan.tsx`のGoogle Mapsナビ導線(`selectedSpots.map((spot) => spot.coordinates)`)がそのまま使うため、この画面自体への追加変更は不要だった
- ドライブ日記のローカル永続化
  - `services/diary/diary-store.ts`(新規): `services/trip/trip-store.ts`と同じパターン(schema version付きJSON、AsyncStorage、壊れたデータは安全に空へフォールバック)。`getDiaryEntries()`/`getDiaryEntry()`/`saveDiaryEntry()`(upsert)/`deleteDiaryEntry()`を実装。ストレージキーは`drive-discovery.diary.v1`。`types/drive-diary.ts`自体は無変更
  - `contexts/drive-flow-context.tsx`の`DriveFlowProvider`起動時に`getDiaryEntries()`で永続化済みの日記を読み込み`diaryEntries`へ反映するeffectを追加。`addDiaryEntry()`にfire-and-forgetの`saveDiaryEntry()`呼び出しを追加(in-memory更新は従来通り即時)
  - 日記タブ・ホームのプレビュー・日記詳細・日記共有はすべて既存通り`diaryEntries`(Context)を参照するだけのため、画面側の追加変更は不要だった

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`: いずれもエラーなし
- `app/route-plan.tsx`のナビ導線が`selectedSpots.map((spot) => spot.coordinates)`を使っていることをコードで確認し、実スポットの座標がGoogle Mapsナビへそのまま渡ることを確認した
- 日記関連画面(`(tabs)/diary.tsx`、`(tabs)/index.tsx`、`diary-detail.tsx`、`drive-diary-confirm.tsx`、`drive-diary-share.tsx`)がすべて`useDriveFlow().diaryEntries`のみを参照していることを`grep`で確認し、永続化の変更が画面側の追加改修なしで反映されることを確認した
- Supabase Edge Function(`google-places`)は今回無変更のため再deployしていない

### 未完了

- iPhone実機での最終確認(寄り道スポット探索画面での実在スポット表示、API失敗時の非フォールバック、日記のアプリ完全終了→再起動後の保持)はユーザー側で実施予定
- 日記と旅行プランのtripId連携は今回スコープ外のまま(ユーザー指示により見送り)

### 次にやること

- iPhone実機確認後、フィードバックに応じて調整

---

## 2026-09-15

`feature/100-program-finalization` ブランチで、100 Program版としての完成範囲(下部ナビ・旅行プラン・既存機能の統合)を一連で実装した(commit・pushは未実施)。

### 完了したこと

- 下部ナビ(ホーム/日記/今すぐドライブ/旅行プラン/プロフィール)をexpo-routerの`(tabs)`グループ+`Tabs`で追加。中央の「今すぐドライブ」はタブ押下を横取りし、既存の`resetPlanningSession()`→`/departure`の導線へ直接進む(タブ画面自体は保険用フォールバックのみ)
- `app/index.tsx`を`app/(tabs)/index.tsx`へ移動し、最近の日記・保存中の旅行プランのプレビューを追加したホーム画面に更新
- 旅行プラン機能を新規実装: `types/trip.ts`(Trip/TripDay、既存のDriveConditions/RouteOption/AiRoutePreferencesを再利用)、`services/trip/trip-store.ts`(AsyncStorageによるローカル永続化、schema version・runtime validation・壊れたJSONへのfallback付き)
- 旅行プラン画面: 一覧(`(tabs)/trips.tsx`、新規作成/開く/削除)、作成(`trip-create.tsx`、日程からDay1/2/3を自動生成)、詳細(`trip-detail.tsx`)、日次詳細(`trip-day-detail.tsx`、既存の条件入力ウィザード・drive-route-plannerへ橋渡し)
- `DriveFlowContext`に`activeTripDay`(旅行日から計画中かを示す)・`selectDiaryEntry()`(日記タブから任意の過去日記を開く)を追加。`resetPlanningSession()`で`activeTripDay`を必ずクリア、`beginConditionsEdit()`では維持(同じ旅行日の編集を継続するため)
- `app/route-plan.tsx`の「この内容で決定」成功時、`activeTripDay`が設定されていればそのままdrive-route-plannerの結果(生成ルート・選択ルート・使用した条件)を`updateTripDay()`で該当日へ保存
- 日記タブ(`(tabs)/diary.tsx`)・日記詳細(`diary-detail.tsx`、既存のDriveDiaryEntryモデル・selectDiaryEntry()をそのまま再利用、drive-diary-confirm.tsx自体は無改修)を新設
- プロフィールタブ(`(tabs)/profile.tsx`)をローカル設定のみ(自宅地点の登録/変更/削除、アプリについて、データ/プライバシーについて)で新設。ログイン・アカウント情報は一切表示しない
- `@react-native-async-storage/async-storage`を`npx expo install`で追加(旅行プランの永続化用。installId等の秘密値は引き続きexpo-secure-storeのまま)
- 不要になったクライアント側の旧コードを削除: `services/route/google-routes-client.ts`・`google-route-mapper.ts`(drive-route-plannerに統合済みで無参照)、`services/route/google-routes-provider.ts`(未実装のまま放置されていたRouteProviderスタブ、実際のGoogle Routes統合は別経路で完成済みのため削除)。`services/route/index.ts`・`route-provider.ts`のコメントも実状に合わせて更新
- `components/ui/primary-button.tsx`・`selection-card.tsx`に`accessibilityRole`/`accessibilityLabel`/`accessibilityState`を追加(既存の全画面へ後方互換のまま適用される)
- Google Mapsナビ・GPS記録・日記・共有・スポット探索・AI解釈・drive-route-planner本体はコードレベルで無変更(既存動作を維持)

### 確認したこと

- `npx tsc --noEmit`・`npm run lint`・`npx expo export --platform ios`: いずれもエラーなし
- Supabase Edge Function(`drive-route-planner`)は今回無変更のため再deployせず、既存deploy済みのものに対して60分ループのスモークテスト(56.9/63.1/66.8分)を実行し、正常応答を再確認
- `google-routes-client.ts`等の削除対象ファイルは、削除前に`grep`でアプリ全体から無参照であることを確認済み

### 未完了

- iPhone実機での総合確認(下部ナビの操作感・safe area/Home Indicator、旅行プラン作成〜Day1/2/3のルート生成〜アプリ再起動後の保持〜Google Mapsナビ、既存のGPS記録/日記/共有フローとの統合)はユーザー側で実施予定
- 旅行日の条件は「気分(mood)」を保存していない(TripDayの型に含めていないため、日を再編集すると気分は毎回未選択に戻る)
- 旅行日の出発地点・目的地・使える時間等は、実際にルートを決定するまでローカルに保存されない(途中経過の自動保存は今回のスコープ外)

### 次にやること

- iPhone実機確認後、フィードバックに応じて調整
- UI/UXの統一(余白・typography等)は今回は新規画面を既存トークンに合わせる範囲に留めたため、既存画面全体の横断的な見直しが必要なら別タスクとして計画する

---

## 2026-09-06

`feature/ai-route-planning` ブランチで、既にdeploy済みのSupabase Edge Function `ai-route-planning` を、`app/conditions.tsx` の条件入力ウィザードへ接続した(commit・pushは未実施、ユーザー指示によりこのセッションでは行わない)。

### 完了したこと

- `npx expo install expo-crypto` を追加した(ユーザー承認済み)。既存コード・React Native/Expoコアには暗号学的に安全なUUID生成手段がなかったため、`Crypto.randomUUID()`を利用する
- `services/device/install-id-store.ts` を新規追加。`home-location-store.ts`と同じパターン(expo-secure-store、モジュールキー`drive-discovery.install-id`)で、端末単位の匿名UUIDを初回のみ生成・保存し、以降再利用する。ユーザーID・ハードウェア固有IDではなく、ログ・UIにも出力しない
- `types/ai-route-preferences.ts` を新規追加。Edge Function側(`supabase/functions/ai-route-planning/ai-types.ts`、Denoランタイムのためアプリのtsconfigに含まれない)の`AiRoutePreferences`型を、クライアント側で手動同期する形で定義した
- `services/ai/route-planning-client.ts` を新規追加。`EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`を読み、未設定なら開発時にわかりやすい警告を出して`config_missing`を返す(秘密値を推測・ハードコードしない)。`x-install-id`ヘッダーを付けて`/functions/v1/ai-route-planning`へPOSTし、クライアント側タイムアウトは18秒(サーバー側の最大1回リトライを含む最悪ケース約16.3秒を上回る値)。応答は`ok`/`data`/`aiUsed`/`fallback`/`preferences`の型を実行時に検証し、想定外の形なら例外を投げずに`invalid_response`を返す。クライアント側からの自動リトライは行わない
- `services/route/time-budget.ts` の`resolveAvailableMinutes`を、AI送信ペイロード構築のために`export`した(ロジックの複製はしていない)
- `contexts/drive-flow-context.tsx` に、1回の計画セッションだけに属する`aiInterpretation`(`{ aiUsed, fallback, preferences } | null`)状態と`setAiInterpretation`セッターを追加。`resetPlanningSession()`(新規ドライブ開始)と`beginConditionsEdit()`(「条件を変える」)の両方でこの状態をクリアし、古いAI解釈結果を新しいセッションや変更後の条件へ持ち越さないようにした
- `app/conditions.tsx`: 「今日のルートを見つける」押下時の`handleSubmit`を書き換えた
  - `aiNote`が空なら、AI Gatewayへは問い合わせず(サーバー側の`shouldUseAi`判定を待たずクライアント側で判定)、これまでどおり構造化条件だけでルート提案に進む
  - `aiNote`があれば、条件確認画面の押下時に一度だけ`requestAiRoutePreferences()`を呼ぶ(7/7入力時点では呼ばない)。成功時は`aiUsed`/`fallback`/`preferences`をDriveFlowContextに保存。失敗・タイムアウト・不正な応答・サーバー側フォールバックのいずれでも画面は止めず、「AIで追加条件を整理できませんでした。入力済みの条件でルートを探します。」という短い案内を表示したうえで構造化条件だけのルート生成を続行する
  - 「考えています」演出を、固定時間のタイマー(`THINKING_MESSAGES`/`THINKING_STEP_MS`)から、実際の非同期処理の進行(`interpreting`→`planning`)に合わせて切り替わる方式に変更した。「あなたの希望を読み取っています」はAIに問い合わせる場合のみ表示する。技術用語(OpenAI/API/GPT等)は表示しない
  - 連打による二重リクエストを防ぐため`submitting`状態を追加し、確認画面の送信ボタンに`disabled`を付けた(ボタン自体は`step`が`'thinking'`になった時点で非表示にもなる)
- `.env.example` の該当箇所を更新: `EXPO_PUBLIC_SUPABASE_ANON_KEY` → `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`(実際に使用するキー名に合わせた)。`SUPABASE_SERVICE_ROLE_KEY`はExpoアプリの`.env`に置くべきではないため、Supabase Edge Function Secrets側でのみ設定する旨のコメントに変更した

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `npx expo export --platform ios`: 1579モジュールがエラーなくバンドルできることを確認(Metro dev serverの`/index.bundle`直叩きはexpo-routerの構成では404になったため、`expo export`でのフルバンドル確認に切り替えた)
- Supabase Edge Function自体は再deployしていない(既にdeploy済み・変更不要と判断)

### 未完了

- iPhone実機での動作確認(ユーザー側で実施予定): `.env`に`EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`を設定した状態での、AI解釈あり/なし両方のルート提案までの一連の動作
- AIが返した`avoidHighways`/`preferScenicRoads`等のフィールドを、モックルート生成(`mock-route-provider.ts`)の説明文へ反映する対応(今回は優先度を下げ、意図的に見送った。架空の道路・座標・店舗を生成しないという制約は変わらない)
- `interpretationSummary`をUIへ表示する対応(必須要件ではないため今回は見送った)

### 次にやること

- iPhone実機で、AIノートあり/なしの両方のパターンと、意図的な設定不備(`.env`未設定)・機内モード等でのフォールバック動作を確認する
- 確認後、Google Routes/Places APIとの接続や、AI結果をルート生成へ反映する対応を別タスクとして計画する

---

## 2026-09-03

`feature/drive-planning-wizard` ブランチ(`feature/route-condition-improvements`からの派生)で、ドライブ条件入力を1画面フォームから多段階ウィザードへ全面的に再設計した(commit・pushは未実施)。

### 完了したこと

- `types/location.ts`: `PlaceSource`・`PlaceSelection`・`ViaPoint`・`SavedPlace`・`RecentPlace`型を新規追加した
- `types/drive.ts`: `Mood`を`short`/`homeFocused`→`driveFocused`(とにかく走りたい)/`omakase`(おまかせ)に差し替え、`AvailableTime`に`day`(1日)/`unspecified`(指定なし)を追加。`DriveConditions`に`finalDestination`・`viaPoints`・`aiNote`を追加し、`returnDeadline`の形式を`"HH:mm"`からISO 8601へ変更した。`deriveDetourLevel`を`app/conditions.tsx`からこのファイルへ移動してexportし、`short`分岐の削除に伴い`detourRich→many`、それ以外`normal`へ単純化。`summarizeDriveConditions()`をISO日時の整形・`finalDestination`/`viaPoints`の反映に対応させた。`formatMinutesLabel()`を日単位にも対応させた
- `services/route/time-budget.ts`: `resolveNextDeadline`(HH:mm前提の翌日ロールオーバー)を削除し、ISO 8601文字列を`new Date(iso)`で直接パースする実装に置き換えた。`resolveAvailableMinutes`に`day`(1440分)・`unspecified`(暫定的に2時間相当へフォールバック)を追加。ISO化により「帰着日時はすでに過ぎている」判定は意味のあるチェックとして復活させた(詳細は`docs/DECISIONS.md`)
- `services/route/mock-route-provider.ts`: `MOOD_SPOT_NAME`・`paceAdjustedSpeedKmH`・3つ目アーキタイプの分岐条件を新しいMood値(`driveFocused`)に合わせて更新(「短時間ルート」→「たっぷり走るルート」)。`createGeometry`が`conditions.finalDestination`(実際に地図で選んだ目的地)を優先して使うよう対応(未設定時は従来の合成オフセット地点にフォールバック)。`conditions.viaPoints`の先頭1件を各ルートの`highlight`文言に反映する`viaPointsHighlightSuffix()`を追加
- `services/location/saved-places-store.ts`・`services/location/recent-places-store.ts`を新規追加。`home-location-store.ts`と同じパターン(expo-secure-store、JSON配列、モジュールキー`drive-discovery.saved-places`/`drive-discovery.recent-places`)で実装
- `components/ui/wizard-progress-header.tsx`を新規追加(「X / 7」+ドットバー+任意の「戻る」リンク)
- `components/location/map-point-picker.tsx`を新規追加。`app/departure.tsx`の中心ピン方式ピッカーと同じ考え方を独立コンポーネントとして実装(departure.tsx自体は無改修)
- `app/conditions.tsx`を全面書き換え。1ファイル内の`useState<StepId>`によるステップ・マシンとして、気分(2/7)→どれくらい走る?(3/7)→最後はどこにする?(4/7)→経由したい場所はある?(5/7)→何時ごろ戻る?(6/7)→AIに追加で伝えたいこと(7/7)→条件確認→あなたに合うドライブを考えています、の順で実装した
  - 「今日の気分」: 「おまかせ」選択で他を解除、他選択で「おまかせ」を解除する排他ロジックを追加
  - 「どれくらい走る?」: 日/時間/分の数字入力(`NumberField`)、合計15分未満は「次へ」を無効化してブロック(警告だけで進める挙動にはしていない)
  - 「最後はどこにする?」: 「別の場所」選択時に`MapPointPicker`を開き、確定した座標を`finalDestination`として保持
  - 「経由したい場所はある?」: 地図(`MapPointPicker`)/保存済み場所/最近使った場所の3通りで追加。地図で選んだ場所は名前入力画面(`overlay: 'via-name'`)を経由し、任意で`saved-places-store`に保存。追加のたびに`recent-places-store`に記録
  - 「何時ごろ戻る?」: 日付チップ(今日/明日/明後日/日付を指定)+時・分の数字入力から、`toIsoWithOffset()`でタイムゾーンオフセット付きISO 8601文字列を組み立てる自前実装(新規パッケージなし)。プレビューで、現在より過去になる場合は非ブロッキングの案内を表示
  - 「AIに追加で伝えたいこと」: `KeyboardAvoidingView`(iOSは`behavior="padding"`)+`ScrollView`(`keyboardShouldPersistTaps="handled"`)で、キーボード表示時も入力欄・ボタンが隠れないようにした
  - 「条件確認」: 各項目に「変更」リンクを設け、押すと該当ステップへジャンプ(`jumpedFromConfirmRef`で「次へ」を押すと確認画面へ戻るよう制御)。入力済みの内容は消えない
  - 「あなたに合うドライブを考えています」: `THINKING_MESSAGES`を順番に表示する固定時間のモック待機のあと、既存の`getRouteProvider().getRoutes()`を呼び出す(将来AI APIへ差し替えやすいよう、この待機とルート取得を1つの`handleSubmit`にまとめている)
  - `useDriveFlow()`の`conditions`が既に存在する場合(ルート比較画面の「条件を変える」から来た場合)は、ステップ機械の初期値を`'confirm'`にして、いきなり条件確認から始まるようにした
- `app/departure.tsx`: 内部ロジックは無改修のまま、全ての表示分岐(menu/locating/location-denied/home-register/custom-pick)の先頭に`<WizardProgressHeader step={1} total={7} />`を追加
- `app/route-compare.tsx`: フッターに「条件を変える」ボタンを追加(`router.push('/conditions')`のみ、既存の条件は保持されたまま)
- `app/_layout.tsx`: `conditions`ルートのみ`headerShown: false`に変更(独自の進捗ヘッダーに置き換えるため)。`departure`はネイティブヘッダー(戻る導線)を維持

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `CI=1 npx expo start --web --port 8083`: Web向けバンドルがエラーなく完了(1138モジュール、既知の`shadow*`非推奨警告のみ)することを確認
- `DriveConditions`のフィールドへ実際に触れているファイル(`app/conditions.tsx`・`types/drive.ts`・`services/route/time-budget.ts`・`services/route/mock-route-provider.ts`)以外の画面(`route-compare.tsx`・`route-summary.tsx`・`spot-discovery.tsx`・`route-plan.tsx`・`services/spot/spot-route-plan.ts`)にコード変更が不要だったことを、型チェックが通ることと合わせて確認
- `app/departure.tsx`の内部ロジック(SecureStore呼び出し・地図ピッカーの状態機械)に差分がないことをdiffで確認

### 未完了

- 実機(iOS Expo Go)での通し確認: ウィザードの7ステップ、経由したい場所の保存済み/最近使った場所、帰着日時の日付またぎ、条件確認からの部分編集、「条件を変える」、あなたに合うドライブを考えています演出、既存のルート比較以降のフロー
- 「経由したい場所」を実際のルート形状(ポリライン)へ反映する処理は未着手(表示上の差別化のみ)
- 「保存済み場所」の一覧・編集・削除を行う専用画面は未着手
- 「最後はどこにする?」「経由したい場所」の検索(住所からの場所検索)は未着手
- 本物のAI API接続は未着手(演出は固定時間のモック待機)

### 次にやること

- 実機(iOS Expo Go)で上記の一連の操作を確認する
- 問題がなければcommit・push、レビュー依頼へ進む

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
  - 「使える時間」→「どれくらい走る?」に改称(時間指定の中身は後述の修正で数字入力欄へ変更)
  - 「帰着地点」→「戻り方」、「帰着時刻(目安)」→「何時ごろ戻る?」に改称(帰着時刻の選び方は後述の修正で数字入力欄へ変更)
  - 「寄り道」の専用チップ行を削除し、送信時に`moods`から`DetourLevel`を導出する(「寄り道多め」→多め、「短時間」→少なめ、それ以外→普通)
  - 送信ボタンを「ルートを提案してもらう」→「今日のルートを見つける」に変更
- `app/route-compare.tsx`・`app/route-summary.tsx`: 画面上部に`summarizeDriveConditions()`による選んだ条件の要約表示を追加。ルートカードに`route.audience`(どんな人向けか)の表示を追加
- 既存のルート比較・スポット探索・ドライブ記録・日記・共有機能のロジックは変更していない(`route-compare.tsx`・`route-summary.tsx`は表示追加のみ)
- **実機確認前のフィードバックを受けて、時間まわりのUIをさらに自由度の高い形へ修正(1回目: 数字入力欄化)**
  - パッケージ追加の事前確認: 「時刻を指定」にネイティブのTimePicker(`@react-native-community/datetimepicker`等)を使う案と、既存コンポーネントのみで数字入力欄を作る案をユーザーへ提示し、既存コンポーネントのみで実装する方を選んだ(理由は`docs/DECISIONS.md`に記録)
  - 「どれくらい走る?」の「時間を指定」候補チップ(30分刻み)を廃止し、「自分で入力」に改称。選ぶと「時間」「分」の数字入力欄(`TextInput`、`keyboardType="number-pad"`)が表示され、任意の時間(例: 2時間30分)を指定できるようにした
  - 「何時ごろ戻る?」の固定候補チップ(17:00〜21:00)を廃止し、「指定なし」/「時刻を指定」の2択にした。「時刻を指定」を選ぶと「時」「分」の数字入力欄が表示され、任意の時刻(例: 18:30)を指定できる。保存形式は既存どおり`"HH:mm"`を維持
  - 入力値は`sanitizeDigits`(数字以外を除去)→`clampInt`(範囲へクランプ)の2段階で処理。「時間」0〜12・「分」0〜59・使える時間の合計10分〜12時間・帰着時刻の「時」0〜23・「分」0〜59へ必ず収め、`onBlur`と送信時の両方でクランプすることで、空欄・0・負数相当・桁あふれのいずれでも安全に扱えるようにした
  - `types/drive.ts`の`summarizeDriveConditions()`の帰着時刻表記を「`◯◯までに戻る`」から「`◯◯まで`」に短縮し、要件例の「2時間30分・18:30まで」に近づけた
  - `AVAILABLE_TIME_LABELS.custom`のラベルを「時間を指定」→「自分で入力」に変更。使わなくなった候補チップ用の定数(`CUSTOM_MINUTE_OPTIONS`・`RETURN_DEADLINE_OPTIONS`)・`conditions.tsx`内で使われなくなった`formatMinutesLabel`のimportは削除した
- **さらなるフィードバックを受けて、iPhoneではホイール型のTimePickerを使う形へ変更(2回目: ネイティブピッカー化)** → 後述のとおり、実機確認でうまく動作しなかったため3回目で取りやめた
  - `npx expo install @react-native-community/datetimepicker`を追加(バージョン8.4.4は`node_modules/expo/bundledNativeModules.json`記載のExpo Go SDK 54標準搭載バージョンと一致することを確認し、Development Build不要でExpo Goのまま使えると判断)。`npx expo install`により`app.json`の`plugins`へ自動追加された
  - 「何時ごろ戻る?」の「時刻を指定」を、`mode="time"` `display="spinner"` `is24Hour`のホイール型ピッカーに置き換えた(iOS・Android共通、旧「時」「分」の数字入力欄は削除)
  - 「どれくらい走る?」の「自分で入力」は、日時ではなく所要時間を扱うため`mode="time"`をそのまま使わず、iOSのみ`mode="countdown"`(Appleの「タイマー」アプリと同じ、時間・分のみのホイール)を使用。Androidでは`countdown`が未対応のため、1回目の修正で作った「時間」「分」の数字入力欄をフォールバックとして残し、`Platform.OS === 'ios'`で出し分けた
  - `minutesToDurationDate()`/`durationDateToMinutes()`を追加し、countdownピッカーのDate値↔分数を相互変換。ピッカーの値は必ず既存の`clampMinutes()`(10分〜720分)を通してから`customAvailableMinutes`へ入れるため、ピッカー自体が選べる範囲(最大23時間59分)がアプリの実用上限を超えても安全に収まる
  - `returnDeadline`(`"HH:mm"`)・`customAvailableMinutes`(分単位)というデータ形状、`services/route/time-budget.ts`・`services/route/mock-route-provider.ts`のロジックは1回目の修正時から変更していない
- **実機確認でTimePicker方式がうまく動作しなかったため、導入を取りやめて1回目の数字入力欄方式へ差し戻し(3回目: TimePicker撤去)**
  - `npm uninstall @react-native-community/datetimepicker`でパッケージを削除。`package.json`・`package-lock.json`から該当エントリが消え、`node_modules/@react-native-community/datetimepicker`も削除されたことを確認した。`npm uninstall`実行時に`package.json`の`devDependencies`の順序が変わる副作用があったため、元の順序に戻した
  - `app.json`の`plugins`から`npx expo install`時に自動追加されていた`"@react-native-community/datetimepicker"`エントリを削除
  - `app/conditions.tsx`から`DateTimePicker`のimport・`Platform`分岐・countdownピッカー用の`customDurationDate`state・`minutesToDurationDate()`/`durationDateToMinutes()`/`clampMinutes()`・`wheelPickerBox`スタイルを削除し、2回目の直前(1回目の完了時点)の「時間」「分」・「時」「分」の数字入力欄(`TextInput`)のみの実装へ全面的に戻した
  - `customAvailableMinutes`(分単位)・`returnDeadline`(`"HH:mm"`)というデータ構造、`sanitizeDigits`/`clampInt`によるバリデーション、`types/drive.ts`・`services/route/time-budget.ts`・`services/route/mock-route-provider.ts`・`route-compare.tsx`・`route-summary.tsx`(条件要約・3ルートの作り分け等、TimePicker導入前後で変更していない部分)は変更していない
  - `git diff app.json package.json package-lock.json`が完全に空(コミット済み内容と一致)になることを確認し、依存関係が導入前の状態に戻っていることを確認した
- **実機確認で「帰着時刻はすでに過ぎています」という警告が消えない不具合が見つかり、原因調査のうえ修正(4回目: 帰着時刻のライブ判定追加→日付またぎ対応への修正)**
  - 1回目の調査: `submissionError`が`handleSubmit`内でのみ設定・クリアされ、時刻入力を変更しても再評価されないことが原因と判明。`services/route/time-budget.ts`に`isReturnDeadlineInPast()`を追加し、`app/conditions.tsx`に送信前のライブ判定・警告表示を追加する形で一度修正した(この時点ではまだ同日限定の判定のまま)
  - 実機での追加確認で、未来時刻や翌日の時刻(例: 現在23時台に対して00:30〜02:00)を指定しても正しく判定されないと分かり、根本原因は`minutesUntilDeadline`が常に「今日の日付」にHH:mmを当てはめて比較しており、日付をまたぐケースを考慮していなかったことだと判明(詳細は`docs/DECISIONS.md`の該当エントリに記録)
  - `time-budget.ts`に`resolveNextDeadline(deadline, now)`を新設し、「今日の日付に当てはめた日時が現在日時以下なら翌日とみなす」ロールオーバー処理を追加。`minutesUntilDeadline`はこれを使うよう書き換え、常に0より大きい値を返すようになったため、`resolveEffectiveTimeBudget`の「すでに過ぎている」分岐を削除した
  - 1回目の修正で追加した`isReturnDeadlineInPast()`・条件入力画面側のライブ警告表示は、同日限定という同じ欠陥を持つ重複した判定だったため削除し、判定ロジックを`time-budget.ts`側の1箇所へ統一した
  - 「どれくらい走る?」(`customAvailableMinutes`・時間予算計算)には一切手を加えていない

### 確認したこと

- `npx tsc --noEmit`: エラーなし
- `npm run lint`: エラー・警告なし
- `node_modules`・`package.json`・`package-lock.json`・`app.json`に`datetimepicker`関連の記述が一切残っていないことをgrepで確認
- `conditions.mood`(旧フィールド)を参照している箇所が`app/conditions.tsx`・`services/route/mock-route-provider.ts`以外にないことをコードレビュー・grepで確認済み。`services/spot/spot-route-plan.ts`は`DriveConditions`を丸ごと`resolveEffectiveTimeBudget`へ渡すだけで、`mood`・`detourLevel`を直接参照していないため、今回の変更の影響を受けないことを確認した
- 既存のルート探索・スポット探索・ドライブ記録・日記・共有機能の画面・ロジックは変更していないことをdiffで確認
- 数字入力欄(`clampInt`)が空文字・"0"・"99"・負の符号を含む文字列のいずれでも例外を投げず、指定した範囲内の整数を返すことをコードレビューで確認
- 帰着時刻の判定(`resolveNextDeadline`/`minutesUntilDeadline`)を`services/route/time-budget.ts`の1箇所にまとめ、`app/conditions.tsx`・`resolveEffectiveTimeBudget`の両方から見て重複した判定が存在しないことをgrepで確認(`returnDeadline`関連のロジックが`time-budget.ts`以外に存在しないことを確認)
- 実機(iOS Expo Go)で、「今日の気分」の複数選択(上限・解除)、「自分で入力」「時刻を指定」の数字入力(境界値・極端な値を含む)、時間指定・帰着時刻・帰着時刻の日付またぎ判定(帰着23:50→当日、00:30/01:00/02:00→翌日として正常、指定なし→制限なし)、条件に応じた3ルートの違い、ルート比較・ルート決定確認画面での条件要約表示を、ユーザーによる実機確認で問題なしと確認

### 未完了

- TimePicker方式が具体的にどう動作しなかったか(症状・原因)の切り分けは行っていない。将来ネイティブピッカーを再検討する際は、原因調査から改めて行う必要がある
- Google Routes API/Google Places API等の実データ接続、実交通情報・天気APIとの連携、2日以上先の日付をまたぐ帰着時刻の指定(日付選択UI等)は今回スコープ外で未着手

### 次にやること

- commit・pushを実施し、レビュー依頼へ進む

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
