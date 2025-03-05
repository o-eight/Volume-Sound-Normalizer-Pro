# Volume & Sound Normalizer Pro

YouTubeやTwitchなど動画サイトの視聴時の音量を自動調整するChrome拡張機能です。コンプレッサーを使って、音量のばらつきを抑え、快適な視聴体験を提供します。

## 機能

- **基本音量調整**: 手動で音量レベルを細かく調整 (-12dB～+30dB)
- **ダイナミックコンプレッション**: 音の大小差を自動で調整し、小さな音も聞き取りやすく
- **チャンネルごとの設定保存**: YouTubeやTwitchチャンネルごとに最適な設定を保存
- **URL除外機能**: 特定のサイトでは拡張機能を自動的に無効化

## 対応サイト

- **YouTube**: 動画ページ、チャンネルページで完全対応
- **Twitch**: ライブストリーム、VOD（録画）、クリップページで完全対応

## 開発者モードでのインストール方法

1. **リポジトリをクローンまたはダウンロード**
   ```
   git clone https://github.com/o-eight/volume-normalizer-pro.git
   ```
   またはZIPファイルとしてダウンロードして解凍します。

2. **Chromeで拡張機能の管理ページを開く**
   - Chromeを開き、アドレスバーに `chrome://extensions/` と入力
   - または、メニュー → その他のツール → 拡張機能 を選択

3. **デベロッパーモードを有効化**
   - 右上の「デベロッパーモード」トグルをオンに切り替える

4. **拡張機能をロード**
   - 「パッケージ化されていない拡張機能を読み込む」ボタンをクリック
   - ダウンロードした拡張機能のフォルダを選択（manifest.jsonファイルが含まれるフォルダ）

5. **拡張機能が読み込まれ、使用可能になります**
   - Chrome右上に拡張機能のアイコンが表示されます

## 使用方法

1. YouTubeやTwitchなどの動画ページで拡張機能のアイコンをクリックしてポップアップを開きます。

2. **基本音量設定**:
   - 音量調整スライダーで全体的な音量レベルを手動調整 (-12dB～+30dB)

3. **コンプレッサー**:
   - トグルスイッチでオン/オフを切り替え
   - 「コンプレッサーの詳細設定」を開いて詳細なパラメータを調整

4. **URL除外設定**:
   - 特定のウェブサイトで拡張機能を無効化したい場合に設定
   - 現在閲覧中のサイトをクリック一つで除外リストに追加可能

5. **設定の保存**:
   - YouTubeやTwitchでは「チャンネルに保存」で現在のチャンネルに設定を保存
   - 「デフォルトとして保存」で全サイト共通のデフォルト設定として保存

## パラメータ説明

### 基本音量設定
- **音量調整 (dB)**: 全体的な音量を調整します (-12dB〜+30dB)

### コンプレッサー詳細設定
- **閾値 (dB)**: コンプレッサーが動作を始める音量レベル (-60dB～0dB)
- **比率**: 圧縮の強さ（1～20、高いほど圧縮が強い）
- **アタック (ms)**: 音量が閾値を超えてから圧縮が始まるまでの時間 (0ms～1000ms)
- **リリース (ms)**: 音量が閾値以下に戻ってから圧縮が終わるまでの時間 (0ms～1000ms)
- **ニー幅 (dB)**: 圧縮の始まり方（滑らかさ）(0dB～40dB)

### URL除外設定
特定のウェブサイトではこの拡張機能の機能を無効にできます。例えば、すでに独自の音量調整を行っているサイトなどで便利です。

- 現在閲覧しているサイトのURLを「現在のURLを追加」ボタンをクリックして簡単に除外リストに追加できます
- 除外リストから削除する場合は、各URLの横にある「削除」ボタンをクリックします

## トラブルシューティング

- **拡張機能が反応しない場合**: ページを更新してください
- **音が出ない/歪む場合**: 「音量調整」を下げるか、コンプレッサーをオフにしてください
- **設定が保存されない場合**: ストレージの許可が正しく設定されているか確認してください
- **Twitchでプレーヤーが検出されない場合**: ページを完全にロードした後に拡張機能を有効にしてみてください

## ファイル構成

- **manifest.json**: 拡張機能のメタデータと設定
- **background.js**: バックグラウンドで動作するスクリプト
- **content-early.js**: ウェブページの早期ロード時に注入されるスクリプト（YouTubeとTwitch検出機能含む）
- **content-main.js**: メインのオーディオ処理機能を含むコンテンツスクリプト
- **popup.html**: 拡張機能のポップアップUI
- **popup-core.js**: ポップアップの基本機能を提供するスクリプト
- **popup-advanced.js**: 上級者向け機能を提供する拡張スクリプト
- **images/**: アイコンなどの画像ファイル

## 技術仕様

- **Web Audio API**: オーディオ処理に使用
- **Chrome Storage API**: 設定の保存に使用
- **JavaScript ES6+**: 全体的なコード実装
- **MutationObserver**: 動画要素検出に使用
- **サイト検出**: YouTubeとTwitchのチャンネル情報を自動検出

## 注意事項

- 開発者モードでインストールした拡張機能は、Chromeを再起動すると無効になることがあります。その場合は拡張機能の管理ページで再度有効化してください。
- この拡張機能はYouTubeとTwitchに最適化されていますが、他のHTML5ビデオを使用するサイトでも動作します。
- 高い「音量調整」値を使用すると音が歪む場合があります。適切なレベルを見つけてください。

## ライセンス

MIT License - 詳細はLICENSEファイルを参照してください。

## バージョン履歴

- **v1.4**: Twitch.tvサポートの追加、チャンネル固有の設定機能を強化
- **v1.3**: パフォーマンス改善、チャンネル検出の安定性向上、不要な機能の削除
- **v1.2**: URL除外機能の追加、ラウドネスメーターの改善
- **v1.1**: ラウドネスノーマライズ機能（ベータ）の追加
- **v1.0**: 初回リリース

## 支援について

Pixiv Fanbox経由で作者の活動の支援が可能になっています。
仕組み上、毎月更新になっていますが1ヶ月入って抜ける形でも助かります。
https://o-eight.fanbox.cc