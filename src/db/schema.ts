import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  date,
  timestamp,
  integer,
  numeric,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Источники данных. Единый справочник, чтобы одинаково обозначать канал
 * во всех таблицах и на дашборде.
 */
export const sourceEnum = pgEnum("source", [
  "yandex_direct",
  "yandex_metrika",
  "yandex_business",
  "vk_ads",
  "fitbase",
  "site", // прочий небрендовый трафик без UTM (реферальный/соцсети и т.п.)
  "seo", // органический поиск (lastTrafficSource = organic)
  "direct", // прямые заходы (lastTrafficSource = direct)
]);

/**
 * Рекламные расходы по дням (Яндекс.Директ, VK Реклама).
 * Уровень детализации: день × источник × кампания.
 * utm_campaign — ключ для склейки с визитами Метрики и продажами Fitbase.
 */
export const adSpend = pgTable(
  "ad_spend",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    source: sourceEnum("source").notNull(),
    campaignId: varchar("campaign_id", { length: 128 }),
    campaignName: varchar("campaign_name", { length: 512 }),
    utmCampaign: varchar("utm_campaign", { length: 256 }),
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // один и тот же день+источник+кампания не должны дублироваться при повторной загрузке
    uniqueIndex("ad_spend_uniq").on(t.date, t.source, t.campaignId),
    index("ad_spend_date_idx").on(t.date),
  ],
);

/**
 * Веб-статистика из Яндекс.Метрики по дням.
 * Уровень: день × источник трафика (utm) с визитами и достижением целей.
 */
export const webSessions = pgTable(
  "web_sessions",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    // Пустые значения храним как '' (не NULL), чтобы уникальный индекс дедуплицировал
    // органику/прямые заходы (у них нет UTM) при повторной синхронизации.
    utmSource: varchar("utm_source", { length: 256 }).notNull().default(""),
    utmMedium: varchar("utm_medium", { length: 256 }).notNull().default(""),
    utmCampaign: varchar("utm_campaign", { length: 256 }).notNull().default(""),
    trafficSource: varchar("traffic_source", { length: 64 }).notNull().default(""),
    visits: integer("visits").notNull().default(0),
    users: integer("users").notNull().default(0),
    bounces: integer("bounces").notNull().default(0),
    goalReaches: integer("goal_reaches").notNull().default(0),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("web_sessions_uniq").on(t.date, t.utmSource, t.utmMedium, t.utmCampaign, t.trafficSource),
    index("web_sessions_date_idx").on(t.date),
  ],
);

/**
 * Клиенты из Fitbase (дно воронки).
 */
export const clients = pgTable(
  "clients",
  {
    id: serial("id").primaryKey(),
    fitbaseId: varchar("fitbase_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 256 }),
    phone: varchar("phone", { length: 64 }),
    utmSource: varchar("utm_source", { length: 256 }),
    utmMedium: varchar("utm_medium", { length: 256 }),
    utmCampaign: varchar("utm_campaign", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clients_fitbase_uniq").on(t.fitbaseId)],
);

/**
 * Продажи/абонементы из Fitbase — выручка.
 * Уровень: транзакция. utm_* переносим с клиента для сквозной атрибуции.
 */
export const sales = pgTable(
  "sales",
  {
    id: serial("id").primaryKey(),
    fitbaseId: varchar("fitbase_id", { length: 128 }).notNull(),
    date: date("date").notNull(),
    clientFitbaseId: varchar("client_fitbase_id", { length: 128 }),
    product: varchar("product", { length: 512 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    utmSource: varchar("utm_source", { length: 256 }),
    utmMedium: varchar("utm_medium", { length: 256 }),
    utmCampaign: varchar("utm_campaign", { length: 256 }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_fitbase_uniq").on(t.fitbaseId),
    index("sales_date_idx").on(t.date),
  ],
);

/**
 * Лиды из воронки Fitbase (/v2/lead). Несут UTM, этап воронки, источник,
 * бюджет и client_id — основа атрибуции клиента к каналу прямо из CRM.
 */
export const fitbaseLeads = pgTable(
  "fitbase_leads",
  {
    id: serial("id").primaryKey(),
    fitbaseId: varchar("fitbase_id", { length: 128 }).notNull(),
    clientId: varchar("client_id", { length: 128 }),
    phoneNorm: varchar("phone_norm", { length: 16 }),
    utmSource: varchar("utm_source", { length: 256 }),
    utmMedium: varchar("utm_medium", { length: 256 }),
    utmCampaign: varchar("utm_campaign", { length: 256 }),
    advertisingSource: varchar("advertising_source", { length: 256 }),
    funnelStep: varchar("funnel_step", { length: 256 }),
    budget: numeric("budget", { precision: 14, scale: 2 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitbase_leads_uniq").on(t.fitbaseId),
    index("fitbase_leads_client_idx").on(t.clientId),
    index("fitbase_leads_created_idx").on(t.createdAt),
  ],
);

/**
 * Абонементы клиентов Fitbase (/v2/client-contract) — деньги.
 * Сумма оплат по клиенту = его LTV.
 */
export const clientContracts = pgTable(
  "client_contracts",
  {
    id: serial("id").primaryKey(),
    fitbaseId: varchar("fitbase_id", { length: 128 }).notNull(),
    clientId: varchar("client_id", { length: 128 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    paid: integer("paid").notNull().default(0),
    beginDate: timestamp("begin_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_contracts_uniq").on(t.fitbaseId),
    index("client_contracts_client_idx").on(t.clientId),
  ],
);

/**
 * Витрина: агрегат по дню × источнику для быстрого чтения дашбордом.
 * Пересчитывается ETL-оркестратором после загрузки сырых данных.
 * Хранит и абсолютные метрики, и производные (CPL, CAC, ROMI).
 */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    // Канал как текст (человекочитаемая подпись), а не enum — чтобы поддержать
    // произвольные источники из справочника source_mappings.
    source: varchar("source", { length: 256 }).notNull(),
    cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    visits: integer("visits").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    salesCount: integer("sales_count").notNull().default(0),
    revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull().default("0"),
    // производные метрики (пересчитываются вместе с агрегатом)
    cpl: numeric("cpl", { precision: 14, scale: 2 }),
    cac: numeric("cac", { precision: 14, scale: 2 }),
    romi: numeric("romi", { precision: 8, scale: 4 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("daily_metrics_uniq").on(t.date, t.source),
    index("daily_metrics_date_idx").on(t.date),
  ],
);

/**
 * Журнал синхронизаций — чтобы видеть на дашборде статус каждого источника.
 */
export const syncLog = pgTable("sync_log", {
  id: serial("id").primaryKey(),
  source: sourceEnum("source").notNull(),
  status: varchar("status", { length: 32 }).notNull(), // ok | error
  rowsUpserted: integer("rows_upserted").notNull().default(0),
  message: varchar("message", { length: 1024 }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * Справочник соответствий UTM-метка → человекочитаемый канал.
 * Заполняется на вкладке «Источники»: незнакомым utm_source присваивается
 * название, которое показывается на дашборде (напр. reklamavliftah → «Реклама в лифтах»).
 */
export const sourceMappings = pgTable("source_mappings", {
  id: serial("id").primaryKey(),
  utmSource: varchar("utm_source", { length: 256 }).notNull().unique(), // хранится в lower-case
  label: varchar("label", { length: 256 }).notNull().default(""),
  ignored: integer("ignored").notNull().default(0), // 1 — скрыть метку из списка (мусор/тест)
  isPaid: integer("is_paid").notNull().default(0), // 1 — платный канал (для будущей группировки)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Касания-обращения из Callibri (коллтрекинг + формы + чаты).
 * Это «мост» атрибуции: телефон ↔ рекламный источник. Джойнится с клиентами
 * Fitbase по нормализованному телефону (последние 10 цифр) для сквозной аналитики.
 */
export const leadTouches = pgTable(
  "lead_touches",
  {
    id: serial("id").primaryKey(),
    externalId: varchar("external_id", { length: 128 }).notNull(), // id обращения в Callibri
    channel: varchar("channel", { length: 32 }), // call | form | chat | other
    phoneNorm: varchar("phone_norm", { length: 16 }), // последние 10 цифр — ключ склейки
    phoneRaw: varchar("phone_raw", { length: 64 }),
    utmSource: varchar("utm_source", { length: 256 }),
    utmMedium: varchar("utm_medium", { length: 256 }),
    utmCampaign: varchar("utm_campaign", { length: 256 }),
    channelName: varchar("channel_name", { length: 256 }), // человекочитаемый канал Callibri
    createdAt: timestamp("created_at", { withTimezone: true }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_touches_external_uniq").on(t.externalId),
    index("lead_touches_phone_idx").on(t.phoneNorm),
    index("lead_touches_created_idx").on(t.createdAt),
  ],
);
