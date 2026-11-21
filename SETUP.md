# 高次元SNS ステップ1 セットアップ手順

できること: メールで登録、1対1のトーク、文章と画像、スマホへの通知。
費用: すべて無料の範囲です(クレジットカードの登録は不要です)。

フォルダの中身
- `app/` … スマホで開くアプリ本体(これをネットに公開します)
- `supabase/schema.sql` … データの置き場を作る命令
- `supabase/functions/send-push/index.ts` … 通知を送る部品
- `tools/keygen.html` … 通知の鍵を作る道具

所要時間の目安は、はじめてなら1〜2時間です。画面の名前は、サービス側の更新で少し変わっている場合があります。

---

## 1. Supabase に登録して、プロジェクトを作る

1. supabase.com を開いて、登録します(メールまたはGitHub)。
2. 「New project」を押して、次のように入れます。
   - Name: 好きな名前(例: kokujigen)
   - Database Password: 自動生成でよいです。どこかに控えておきます
   - Region: Northeast Asia (Tokyo)
3. 作成が終わるまで、1〜2分待ちます。

## 2. データの置き場を作る

1. 左のメニューから「SQL Editor」を開き、「New query」を押します。
2. `supabase/schema.sql` を開いて、全部コピーして貼り付けます。
3. 「Run」を押します。「Success」と出れば完了です。エラーが出たら、その文章を私に送ってください。

## 3. メールの確認をオフにする(身内用なので)

1. 左のメニューの「Authentication」を開きます。
2. 「Sign In / Providers」(または「Providers」)の中の「Email」を開きます。
3. 「Confirm email」をオフにして、保存します。

## 4. 通知の鍵を作る

1. `tools/keygen.html` をダブルクリックして、ブラウザで開きます。
2. 「鍵を作る」を押します。
3. 出てきた「公開鍵」と「秘密鍵」を、メモ帳などにコピーして保存します。秘密鍵は人に見せないでください。

## 5. config.js に3つの値を貼る

`app/config.js` をメモ帳で開き、次の3つを貼ります(引用符の中だけを入れ替えます)。

- `SUPABASE_URL` … Supabase の「Project Settings」→「API」にある Project URL
- `SUPABASE_ANON_KEY` … 同じ場所にある anon キー(「publishable」と書かれたキーでも使えます)
- `VAPID_PUBLIC_KEY` … 手順4の公開鍵

貼る前に、秘密鍵や「service_role」のキーを入れていないか、もう一度確認してください。入れてよいのは、公開鍵と anon(publishable)キーだけです。

## 6. 通知を送る部品を置く

1. 左のメニューの「Edge Functions」を開き、「Deploy a new function」→「Via Editor」を選びます。
2. 名前を `send-push` にします。
3. `supabase/functions/send-push/index.ts` の中身を全部貼り付けて、「Deploy」を押します。
4. 同じ画面の「Secrets」(または「Edge Function Secrets」)で、次の3つを追加します。
   - `VAPID_PUBLIC_KEY` … 手順4の公開鍵
   - `VAPID_PRIVATE_KEY` … 手順4の秘密鍵
   - `VAPID_SUBJECT` … `mailto:` に続けて自分のメールアドレス(例: `mailto:you@example.com`)

## 7. 新着が届いたら通知が動くようにする

1. 左のメニューの「Database」→「Webhooks」を開き、「Create a new hook」を押します。
2. 次のように入れます。
   - Name: push-on-message
   - Table: `messages`
   - Events: Insert にだけチェック
   - Type: Supabase Edge Functions
   - Edge Function: `send-push`
   - Method: POST
3. 保存します。

## 8. ネットに公開する

`app` フォルダをネットに置くと、スマホから開けるようになります。通知にはHTTPS(鍵つきのアドレス)が必要で、下の方法ならどれも自動でそうなります。

- いちばん手軽: Netlify の「Drop」(app.netlify.com/drop)に、`app` フォルダをドラッグします。URLができます。
- ほかには、Cloudflare Pages や GitHub Pages でも大丈夫です。

できたURLを、身内の人に送ります。

## 9. スマホで使い始める

- iPhone: Safari でURLを開く → 共有ボタン →「ホーム画面に追加」→ ホーム画面のアイコンから開く → 「通知をオンにする」を押す(iOS 16.4 以降が必要です)
- Android: Chrome でURLを開く → メニュー →「ホーム画面に追加」または「アプリをインストール」→ 「通知をオンにする」を押す

はじめての方は「はじめての方はこちら」から、名前・メール・パスワードを入れて登録します。そのあと、右上の「＋」で相手を選ぶと、トークが始まります。

## 10. みんなが登録し終わったら

知らない人に登録されないよう、「Authentication」→「Sign In / Providers」(または「Settings」)で、新しい登録を受け付ける設定(Allow new users to sign up)をオフにします。人が増えるときは、またオンにします。

---

## 11. パスワードを忘れたときのメールを使えるようにする

ログイン画面の「パスワードを忘れた方はこちら」から、パスワードを決め直すメールを送れます。使うには、Supabase で次の2つの設定が必要です。

### 11-1. サイトのアドレスを登録する

1. Supabase の左のメニューの「Authentication」→「URL Configuration」を開きます。
2. 「Site URL」に `https://tomodachi-lila.netlify.app` を入れて保存します。
3. 「Redirect URLs」に `https://tomodachi-lila.netlify.app/**` を足して保存します。

### 11-2. メールを送る仕組みを用意する(必須)

Supabase に最初から入っているメール送信は、Supabase のチームのメンバーのアドレスにしか届きません(1時間に2通まで)。身内のみんなに届けるには、メールの送信サービスをつなぎます。

- 無料で始めやすいのは Resend(resend.com)や、Gmail のアプリパスワードです。
- つなぐ場所は「Authentication」→「Emails」→「SMTP Settings」です。

設定が済むまでは、メールを送ろうとすると「いまはメールを送れない設定です」と出ます。

## うまくいかないとき

- 画面に「もう少しで始められます」と出る → `config.js` の貼り付けを確認します
- 登録しても入れない → 手順3の「Confirm email」がオフか確認します
- 画像が送れない → 手順2のSQLが最後まで成功したか確認します(画像の置き場は10MBまでです)
- 通知が来ない → ①スマホで通知をオンにしたか ②手順6の3つのSecretsが入っているか ③手順7のWebhookが保存されているかを確認します。Edge Functions の「Logs」にエラーが出ていたら、私に送ってください
- 通知の部分で「401」と出る → Edge Functions の `send-push` の設定にある「Verify JWT」を、オフにして試します
- 1週間ほど誰も使わないと、無料枠のプロジェクトは一時停止します。Supabase の画面から「Restore」を押すと戻ります

## いまの制限

- トークは1対1です(グループは次のステップで作ります)
- 同じスマホで別の人に切り替えるときは、先に「設定」からログアウトしてください(通知の登録が、前の人に残らないようにするためです)
- 無料枠の目安は、保存1GB、通信が月5GBです。写真は自動で小さくして送ります
- 音声、今日のイメージ、スタンプは、次のステップで足します

## 確認できていないこと

画面と動きは、テスト用の仮のデータで確認しました。Supabase、通知、iPhoneとAndroidの実機は、まだ試せていません。うまくいかないところが出たら、表示された文章をそのまま送ってください。一緒に直します。
