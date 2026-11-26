// Edge Function: по расписанию (pg_cron) проверяет дедлайны и отправляет списки в WhatsApp.
// Секреты: CRON_SECRET, GREEN_ID, GREEN_TOKEN, WA_CHAT_ID (SUPABASE_URL и SERVICE_ROLE_KEY подставляются платформой).
import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TZ = 5;
const DIRS: Record<string, string> = { fri: "Щучинск → Астана", sun: "Астана → Щучинск" };
const TRN: Record<string, string> = { car: "🚗 Машина" };
const fmt = (s: string) => s.split("-").reverse().join(".");
const ph = (p: string) => `+7 (${p.slice(0, 3)}) ${p.slice(3, 6)} ${p.slice(6, 8)} ${p.slice(8)}`;
function deadline(date: string, tr: string, dir: string, time: string): number {
  const [y, m, d] = date.split("-").map(Number), [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h - TZ, mi) - 864e5;
}
// Только машины: отдельный список на каждый рейс.
const key = (r: any) => `${r.trip_date}_${r.dir}_car_${r.dep_time.replace(":", "")}`;
function text(rows: any[]): string {
  const f = rows[0];
  const list = [...rows].sort((a, b) => a.dep_time.localeCompare(b.dep_time) || a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name));
  const head = `${TRN[f.tr]} | ${DIRS[f.dir]} | ${fmt(f.trip_date)} ${f.dep_time} | всего: ${list.length}`;
  const cols = `ФИО | Класс | Время | Телефон | Адрес | Направление`;
  const lines = list.map((r, i) => `${i + 1}. ${[r.name, r.cls, r.dep_time, ph(r.phone), r.addr, DIRS[r.dir]].join(" | ")}`);
  return [head, cols, ...lines].join("\n");
}
async function sendWhatsApp(message: string): Promise<boolean> {
  // Провайдер заменяемый: здесь Green API (проверьте формат запроса в его документации).
  const id = Deno.env.get("GREEN_ID"), tok = Deno.env.get("GREEN_TOKEN"), chatId = Deno.env.get("WA_CHAT_ID");
  const r = await fetch(`https://api.green-api.com/waInstance${id}/sendMessage/${tok}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId, message }) });
  return r.ok;
}
Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("forbidden", { status: 403 });
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const { data: rows, error } = await sb.from("signups").select("*").eq("tr", "car").gte("trip_date", since);
  if (error) return new Response(error.message, { status: 500 });
  const { data: sent } = await sb.from("sent_lists").select("key");
  const done = new Set((sent ?? []).map((s: any) => s.key));
  const groups: Record<string, any[]> = {};
  for (const r of rows ?? []) (groups[key(r)] ??= []).push(r);
  const out: string[] = [];
  for (const [k, g] of Object.entries(groups)) {
    const f = g[0];
    if (done.has(k) || Date.now() < deadline(f.trip_date, f.tr, f.dir, f.dep_time)) continue;
    if (await sendWhatsApp(text(g))) { await sb.from("sent_lists").insert({ key: k }); out.push(k); }
  }
  return new Response(JSON.stringify({ sent: out }), { headers: { "Content-Type": "application/json" } });
});
