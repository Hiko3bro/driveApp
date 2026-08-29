# ドライブ発見アプリ (drive-discovery-app)

## コンセプト

このアプリは「行き先を決めるためのアプリ」ではありません。

**何気ない時間や移動を、新しい発見と思い出に変えるアプリ**です。

特に重視しているのは、旅行先で土地勘がないユーザーが、レンタカーの返却時刻や残り時間から、景色の良い道・穴場・寄り道を含むルートを見つけられる体験です。目的地ありきの効率的なナビではなく、「移動そのもの」を楽しくすることを目指します。

## 提供する価値

- 移動時間そのものを、発見と体験の時間に変える
- 「返却時刻まであと〇時間」といった制約の中で、無理なく楽しめる寄り道を提案する
- 土地勘がない場所でも、安心して寄り道を選べる
- 偶然の発見(セレンディピティ)を後押しする
- 移動の記憶を思い出として残せるようにする

詳しいプロダクト定義は [docs/PRODUCT.md](./docs/PRODUCT.md) を参照してください。

## 主な機能

> 現時点ではアプリ機能は未実装です。以下は今後実装を予定している主な機能です。

- 残り時間・返却時刻を起点にした寄り道ルートの提案
- 景色の良い道・穴場スポットのレコメンド
- 発見した場所・移動の記録(思い出化)

## 技術構成

- [Expo](https://expo.dev) (SDK 54)
- React Native / TypeScript
- [expo-router](https://docs.expo.dev/router/introduction/) によるファイルベースルーティング
- 現時点では有料の外部API(地図・ルート検索・バックエンド・AI API等)は未使用です

技術方針の詳細は [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) を参照してください。

## 起動方法

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npx expo start
```

起動後、ターミナルの案内に従って以下のいずれかで開けます。

- [Development build](https://docs.expo.dev/develop/development-builds/introduction/)
- Android エミュレータ
- iOS シミュレータ
- [Expo Go](https://expo.dev/go)

### 検証コマンド

```bash
npm run lint          # ESLint によるコード検証
npx tsc --noEmit      # TypeScript の型チェック
```

## 現在の進捗

現在は Expo の初期テンプレートの状態から、Claude Code / Codex / GitHub で安全に共同開発するためのドキュメント・ルール基盤を整備している段階です。アプリ画面・機能はまだ実装していません。

日々の詳細な進捗は [docs/PROGRESS.md](./docs/PROGRESS.md)、ユーザーに見える変更は [CHANGELOG.md](./CHANGELOG.md) に記録しています。

## 今後の予定

1. プロダクト要件に基づく画面・情報設計の検討
2. 位置情報取得やルート表示などコア機能の技術検証(無料/モックデータの範囲で)
3. 段階的な有料API(Google Routes / Google Places / Supabase / AI API 等)の導入検討

## 既知の制限

- アプリの画面・機能はまだ実装されていません(Expo初期テンプレートの状態)
- 地図表示・ルート検索・位置情報取得などのコア機能は未実装です
- 有料の外部API(Google Routes, Google Places, Supabase, AI API等)とは未連携です
- ネイティブアプリのビルド設定(iOS/Android)はデフォルトのままです

## 開発に参加するAIエージェント/開発者へ

このリポジトリで作業する場合は、必ず [AGENTS.md](./AGENTS.md) の共通ルールに従ってください。Claude Codeで作業する場合は [CLAUDE.md](./CLAUDE.md) も参照してください。
