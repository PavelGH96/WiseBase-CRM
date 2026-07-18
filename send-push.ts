// ============================================================
// WiseBase CRM — Edge Function «send-push» (ШАГ 3)
// Рассылает push-уведомления о задачах на сегодня и просроченных.
//
// Как задеплоить через браузер (без установки CLI):
// 1. Supabase Dashboard → Edge Functions → Deploy a new function
//    → Via Editor → имя функции: send-push
// 2. Вставить всё содержимое этого файла в index.ts → Deploy
// 3. Добавить секреты: Edge Functions → Secrets (см. инструкцию в чате)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    webpush.setVapidDetails(
      "mailto:jrkgree@mailgonow.tech",
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    // Сегодняшняя дата по Екатеринбургу (YYYY-MM-DD)
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Asia/Yekaterinburg",
    });

    // Невыполненные задачи с датой <= сегодня (сегодняшние + просроченные)
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("owner_id,date")
      .is("deleted_at", null)
      .eq("done", false)
      .lte("date", today);
    if (error) throw error;

    // Группируем по владельцу
    const byUser = new Map<string, { today: number; overdue: number }>();
    for (const t of tasks ?? []) {
      if (!t.owner_id) continue;
      const rec = byUser.get(t.owner_id) ?? { today: 0, overdue: 0 };
      if (t.date === today) rec.today++;
      else rec.overdue++;
      byUser.set(t.owner_id, rec);
    }
    if (byUser.size === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no due tasks" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Подписки этих пользователей
    const { data: subs, error: subErr } = await supabase
      .from("push_subscriptions")
      .select("user_id,endpoint,p256dh,auth")
      .in("user_id", [...byUser.keys()]);
    if (subErr) throw subErr;

    let sent = 0;
    const dead: string[] = [];
    for (const s of subs ?? []) {
      const rec = byUser.get(s.user_id)!;
      const parts: string[] = [];
      if (rec.today) parts.push(`на сегодня: ${rec.today}`);
      if (rec.overdue) parts.push(`просрочено: ${rec.overdue}`);
      const payload = JSON.stringify({
        title: "WiseBase CRM — задачи",
        body: "Задачи " + parts.join(" · "),
        tag: "daily-tasks",
        url: "./",
      });
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // 404/410 — подписка больше не действует (устройство отписалось) — удаляем
        if (code === 404 || code === 410) dead.push(s.endpoint);
        else console.error("push error:", e);
      }
    }
    if (dead.length) {
      await supabase.from("push_subscriptions").delete().in("endpoint", dead);
    }

    return new Response(
      JSON.stringify({ sent, removedDead: dead.length, users: byUser.size }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
