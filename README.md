# lila(高次元SNS)

身内向けのクローズドSNS。音声・イメージ中心のPWAです。

- `app/` … アプリ本体(Netlifyがこのフォルダを公開します)
  - `app.js` 画面と動き / `aura.js` 今日のイメージ / `stamp.js` スタンプ作成 / `voice.js` 声から色をつくる
  - `preview/` 機能の見本ページ
- `supabase/` … データベースの設定(schema.sql、step2.sql)と通知用の関数
- `tools/` … 通知の鍵を作る道具
- `SETUP.md` … 最初のセットアップ手順

秘密の鍵(VAPIDの秘密鍵など)は、このリポジトリに入れないでください。Supabaseの画面でだけ設定します。
