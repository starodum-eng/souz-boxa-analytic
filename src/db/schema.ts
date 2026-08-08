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
  "site", // органика/прямой трафик (веб-сессии без рекламных UTM)
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
    utmSource: varchar("utm_source", { length: 256 }),
    utmMedium: varchar("utm_medium", { length: 256 }),
    utmCampaign: varchar("utm_campaign", { length: 256 }),
    visits: integer("visits").notNull().default(0),
    users: integer("users").notNull().default(0),
    bounces: integer("bounces").notNull().default(0),
    goalReaches: integer("goal_reaches").notNull().default(0),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("web_sessions_uniq").on(t.date, t.utmSource, t.utmMedium, t.utmCampaign),
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
 * Витрина: агрегат по дню × источнику для быстрого чтения дашбордом.
 * Пересчитывается ETL-оркестратором после загрузки сырых данных.
 * Хранит и абсолютные метрики, и производные (CPL, CAC, ROMI).
 */
export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    source: sourceEnum("source").notNull(),
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
