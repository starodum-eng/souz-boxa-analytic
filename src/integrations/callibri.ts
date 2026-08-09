import type { DateRange } from "./types";
import { normalizePhone } from "@/lib/phone";

/**
 * Callibri — коллтрекинг (звонки + формы + чаты) с атрибуцией по источнику.
 * Docs: получаются по email после «Получить доступ к API».
 *
 * Метод /site_get_statistics отдаёт обращения с utm_source/medium/campaign,
 * телефоном, id, датой, metrika_client_id. Пишем их в lead_touches — дальше
 * склейка по телефону с клиентами Fitbase работает автоматически.
 *
 * Ограничения API: не больше НЕДЕЛИ за запрос и не чаще 1 запроса в секунду.
 */

const DEFAULT_BASE_URL = "https://api.callibri.ru";
const RATE_LIMIT_MS = 1100; // 1 req/sec + запас

export interface CallibriTouch {
  externalId: string;
  channel: string; // call | form | chat
  phone: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  channelName: string | null;
  createdAt: Date | null;
  raw: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function baseUrl(): string {
  return (process.env.CALLIBRI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function authQuery(): string {
  const email = process.env.CALLIBRI_USER_EMAIL;
  const token = process.env.CALLIBRI_USER_TOKEN;
  if (!email || !token) throw new Error("CALLIBRI_USER_EMAIL / CALLIBRI_USER_TOKEN is not set");
  return `user_email=${encodeURIComponent(email)}&user_token=${encodeURIComponent(token)}`;
}

/** dd.mm.yyyy для параметров Callibri. */
function ddmmyyyy(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${m}.${d.getFullYear()}`;
}

/** Разбивает период на куски по ≤7 дней (лимит Callibri). */
function weekChunks(range: DateRange): Array<[Date, Date]> {
  const from = new Date(range.from + "T00:00:00");
  const to = new Date(range.to + "T00:00:00");
  const chunks: Array<[Date, Date]> = [];
  let start = new Date(from);
  while (start <= to) {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    chunks.push([new Date(start), end > to ? new Date(to) : end]);
    start.setDate(start.getDate() + 7);
  }
  return chunks;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v);
  // ISO / стандартный формат
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // dd.mm.yyyy [hh:mm[:ss]]
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Собирает обращения из ответа (calls/feedbacks/chats — на верхнем уровне или внутри каналов). */
function collect(json: any): Array<{ o: any; channel: string; nameChannel: string | null }> {
  const items: Array<{ o: any; channel: string; nameChannel: string | null }> = [];
  const push = (arr: any, channel: string, nameChannel: string | null) => {
    if (Array.isArray(arr)) for (const o of arr) items.push({ o, channel, nameChannel });
  };
  push(json?.calls, "call", null);
  push(json?.feedbacks, "form", null);
  push(json?.chats, "chat", null);
  const channels = Array.isArray(json?.channels_statistics) ? json.channels_statistics : [];
  for (const ch of channels) {
    push(ch?.calls, "call", ch?.name_channel ?? null);
    push(ch?.feedbacks, "form", ch?.name_channel ?? null);
    push(ch?.chats, "chat", ch?.name_channel ?? null);
  }
  return items;
}

export async function fetchCallibri(range: DateRange): Promise<CallibriTouch[]> {
  const auth = authQuery();

  // site_id — из env или первый из /get_sites.
  let siteId = process.env.CALLIBRI_SITE_ID?.trim();
  if (!siteId) {
    const res = await fetch(`${baseUrl()}/get_sites?${auth}`);
    if (!res.ok) throw new Error(`Callibri /get_sites error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    const sites = json?.sites ?? json?.data ?? json;
    siteId = String((Array.isArray(sites) ? sites[0]?.site_id : undefined) ?? "");
    if (!siteId) throw new Error("Callibri: не удалось определить site_id (задайте CALLIBRI_SITE_ID)");
    await sleep(RATE_LIMIT_MS);
  }

  const out: CallibriTouch[] = [];
  let firstJson: any = null;
  for (const [d1, d2] of weekChunks(range)) {
    const url = `${baseUrl()}/site_get_statistics?site_id=${encodeURIComponent(siteId)}&date1=${ddmmyyyy(d1)}&date2=${ddmmyyyy(d2)}&${auth}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Callibri /site_get_statistics error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    if (firstJson === null) firstJson = json;
    for (const { o, channel, nameChannel } of collect(json)) {
      const phone = o.phone ?? null;
      const externalId = o.id != null ? `callibri:${o.id}` : `callibri:${channel}:${normalizePhone(phone) ?? "x"}:${o.date ?? ""}`;
      out.push({
        externalId,
        channel,
        phone,
        utmSource: o.utm_source ?? null,
        utmMedium: o.utm_medium ?? null,
        utmCampaign: o.utm_campaign ?? null,
        channelName: nameChannel ?? o.name_channel ?? null,
        createdAt: parseDate(o.date),
        raw: o,
      });
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Диагностика: если ничего не распарсилось — показываем реальную структуру ответа,
  // чтобы подогнать парсер (видно в «Сообщении» статуса синхронизации).
  if (out.length === 0 && firstJson) {
    const top = firstJson && typeof firstJson === "object" ? Object.keys(firstJson) : typeof firstJson;
    const cs = firstJson?.channels_statistics;
    const csKeys = Array.isArray(cs) && cs[0] && typeof cs[0] === "object" ? Object.keys(cs[0]) : null;
    const snippet = JSON.stringify(firstJson).slice(0, 500);
    throw new Error(
      `Callibri: 0 обращений. keys=${JSON.stringify(top)}; channels_statistics[0]=${JSON.stringify(csKeys)}; sample=${snippet}`,
    );
  }
  return out;
}
