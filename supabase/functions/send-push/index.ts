// 新しいメッセージが届いたら、相手のスマホに通知を送る
// Database Webhook(messages の Insert)から呼ばれます。
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:example@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

function previewOf(m: { kind: string; body: string | null }): string {
  if (m.kind === "text") return (m.body ?? "").slice(0, 120);
  if (m.kind === "image") return "画像を送りました";
  if (m.kind === "voice") return "音声メッセージ";
  return "ファイルを送りました";
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const m = payload?.record;
    if (payload?.type !== "INSERT" || !m) return new Response("ignored");

    const { data: sender } = await supabase
      .from("profiles")
      .select("name")
      .eq("id", m.sender_id)
      .maybeSingle();

    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", m.conversation_id)
      .neq("user_id", m.sender_id);

    const ids = (members ?? []).map((x: { user_id: string }) => x.user_id);
    if (ids.length === 0) return new Response("no recipients");

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", ids);

    const body = JSON.stringify({
      title: sender?.name ?? "新着メッセージ",
      body: previewOf(m),
      conversationId: m.conversation_id,
    });

    await Promise.all(
      (subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 3600 },
          );
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            // 使えなくなった端末の登録を消す
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
          } else {
            console.error("push failed", code, e);
          }
        }
      }),
    );

    return new Response("ok");
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
});
