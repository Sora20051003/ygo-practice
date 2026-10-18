# 遊戯王 展開練習（非公式ファンツール）

このアプリは個人が作った**非公式**のファンツールです。株式会社コナミデジタルエンタテインメント（KONAMI）とは関係がなく、KONAMI の承認や後援を受けたものではありません。

## 権利の表記

「遊☆戯☆王」「遊戯王オフィシャルカードゲーム」のカード名・カードの効果テキスト・イラスト・ロゴなどの権利は、原作者・権利者および KONAMI に帰属します。
©高橋和希 スタジオ・ダイス／集英社　©Konami Digital Entertainment

このリポジトリにはカードの画像・イラストを含めていません（`pics/` は `.gitignore` で除外）。
アプリはイラストを外部サイト（YGOPRODeck）から閲覧のたびに読み込むか、利用者が自分で読み込んだデッキ画像を利用者の端末の中だけで切り抜いて表示します。

無料・広告なしで公開しています。権利者から求めがあった場合は、すみやかに内容の変更や公開の停止をします。

## 使っているデータ・ソフトウェア

| 用途 | 出どころ | ライセンス・利用条件 |
| --- | --- | --- |
| 効果の自動処理のエンジン | [n1xx1/ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) | MIT License |
| エンジンの中身 | [edo9300/ygopro-core](https://github.com/edo9300/ygopro-core)（EDOPro） | AGPL-3.0（リポジトリを参照） |
| カードスクリプト | [ProjectIgnis/CardScripts](https://github.com/ProjectIgnis/CardScripts) | リポジトリを参照 |
| エンジン用カードデータ | [ProjectIgnis/BabelCDB](https://github.com/ProjectIgnis/BabelCDB) | リポジトリを参照 |
| カード情報・イラスト画像 | [YGOPRODeck](https://ygoprodeck.com/) | YGOPRODeck の利用条件に従う |
| 日本語カード名・効果テキスト | [ygocdb.com](https://ygocdb.com/)、[mycard/ygopro-database](https://github.com/mycard/ygopro-database) | 各サイト・リポジトリを参照 |
| 禁止・制限リスト | [DawnbrandBots/yaml-yugi-limit-regulation](https://github.com/DawnbrandBots/yaml-yugi-limit-regulation) | リポジトリを参照 |
| 発売日など | [YGOResources](https://db.ygoresources.com/) | サイトを参照 |
| ログイン・同期・対戦 | [Firebase](https://firebase.google.com/) | Google の利用規約 |

このアプリ自体のソースコードは https://github.com/Sora20051003/ygo-practice で公開しています。
