import type { AdSpendRow, DateRange } from "./types";

/**
 * Яндекс.Директ — Reports API.
 * Docs: https://yandex.ru/dev/direct/doc/reports/reports.html
 *
 * Особенности:
 *  - Отчёт запрашивается POST-ом, при processingMode=auto может вернуть 201/202
 *    (отчёт формируется) — тогда нужно повторить запрос спустя retryIn секунд.
 *  - Ответ — TSV с заголовком. Парсим руками.
 *  - Поле для склейки: в кампаниях должен быть проставлен utm_campaign в ссылках;
 *    здесь на уровне отчёта берём CampaignName/CampaignId, а utm_campaign
 *    сопоставляем маппингом (см. TODO).
 */

const REPORTS_URL = "https://api.direct.yandex.com/json/v5/reports";

export async function fetchYandexDirectSpend(range: DateRange): Promise<AdSpendRow[]> {
  // Один OAuth-токен Яндекса покрывает Директ + Метрику. Можно задать общий
  // YANDEX_TOKEN, а YANDEX_DIRECT_TOKEN использовать только для переопределения.
  const token = process.env.YANDEX_DIRECT_TOKEN || process.env.YANDEX_TOKEN;
  if (!token) throw new Error("YANDEX_DIRECT_TOKEN / YANDEX_TOKEN is not set");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Accept-Language": "ru",
    "processingMode": "auto",
    "returnMoneyInMicros": "false",
    "skipReportHeader": "true",
    "skipReportSummary": "true",
    "Content-Type": "application/json",
  };
  if (process.env.YANDEX_DIRECT_CLIENT_LOGIN) {
    headers["Client-Login"] = process.env.YANDEX_DIRECT_CLIENT_LOGIN;
  }

  const body = {
    params: {
      SelectionCriteria: { DateFrom: range.from, DateTo: range.to },
      FieldNames: ["Date", "CampaignId", "CampaignName", "Impressions", "Clicks", "Cost"],
      ReportName: `spend_${range.from}_${range.to}_${Date.now()}`,
      ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "YES",
    },
  };

  // Отчёты Директа асинхронные: 200 — готов, 201/202 — формируется.
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(REPORTS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 200) {
      const tsv = await res.text();
      return parseTsv(tsv);
    }
    if (res.status === 201 || res.status === 202) {
      const retryIn = Number(res.headers.get("retryIn") ?? 5);
      await new Promise((r) => setTimeout(r, retryIn * 1000));
      continue;
    }
    const text = await res.text();
    throw new Error(`Yandex.Direct API error ${res.status}: ${text}`);
  }
  throw new Error("Yandex.Direct: отчёт не сформировался за отведённое число попыток");
}

function parseTsv(tsv: string): AdSpendRow[] {
  const lines = tsv
    .trim()
    .split("\n")
    .filter(Boolean)
    // Отбрасываем строку с названиями колонок (Date\tCampaignId\t...),
    // которую TSV Директа отдаёт помимо данных, и строку "Total".
    .filter((line) => {
      const first = line.split("\t")[0];
      return first !== "Date" && first !== "Total";
    });
  return lines.map((line) => {
    const [date, campaignId, campaignName, impressions, clicks, cost] = line.split("\t");
    return {
      date,
      campaignId: campaignId || null,
      campaignName: campaignName || null,
      // TODO: если в кампаниях есть жёсткий utm_campaign — подставить через маппинг.
      utmCampaign: campaignName || null,
      impressions: Number(impressions) || 0,
      clicks: Number(clicks) || 0,
      cost: Number(cost) || 0,
      raw: { date, campaignId, campaignName, impressions, clicks, cost },
    };
  });
}
