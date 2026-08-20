import {
  pgTable,
  pgEnum,
  serial,
  varchar,
  text,
  date,
  timestamp,
  integer,
  bigint,
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
  "callibri", // коллтрекинг: звонки/формы/чаты
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
    funnelId: varchar("funnel_id", { length: 64 }),
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
    paymentDate: timestamp("payment_date", { withTimezone: true }),
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
 * Единая касса Fitbase: абонементы + услуги + товары.
 * Источник правды для выручки/LTV (у клуба деньги не только в абонементах).
 */
export const clientPayments = pgTable(
  "client_payments",
  {
    id: serial("id").primaryKey(),
    extId: varchar("ext_id", { length: 160 }).notNull(), // kind:id
    kind: varchar("kind", { length: 32 }).notNull(), // contract | service | product
    clientId: varchar("client_id", { length: 128 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    paid: integer("paid").notNull().default(0),
    payDate: timestamp("pay_date", { withTimezone: true }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_payments_uniq").on(t.extId),
    index("client_payments_client_idx").on(t.clientId),
    index("client_payments_paydate_idx").on(t.payDate),
  ],
);

/**
 * Журнал продаж из отчёта Fitbase «Отчёт по продажам» (Финансы).
 * Источник правды по ВЫРУЧКЕ: включает и онлайн-платежи CloudPayments/продления,
 * которых нет в объектном API. Заливается вручную выгрузкой Excel из Fitbase.
 * Привязка к каналу — по client_id (= clients.fitbase_id).
 */
export const salesLedger = pgTable(
  "sales_ledger",
  {
    id: serial("id").primaryKey(),
    // Синтетический ключ дедупа (у отчёта нет id платежа): клиент+дата+сумма+наименование.
    extId: varchar("ext_id", { length: 200 }).notNull(),
    clientId: varchar("client_id", { length: 128 }), // ID клиента Fitbase → join к clients.fitbase_id
    clientName: varchar("client_name", { length: 256 }),
    payDate: timestamp("pay_date", { withTimezone: true }),
    accrualDate: timestamp("accrual_date", { withTimezone: true }),
    // «Итого» из отчёта — фактически оплаченная сумма (после скидок, с учётом пробных = 0).
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    method: varchar("method", { length: 64 }), // Карта | CloudPayments | Наличные
    kind: varchar("kind", { length: 64 }), // Абонемент | Услуга | Товар
    name: varchar("name", { length: 512 }),
    category: varchar("category", { length: 256 }),
    manager: varchar("manager", { length: 256 }),
    raw: jsonb("raw"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_ledger_ext_uniq").on(t.extId),
    index("sales_ledger_paydate_idx").on(t.payDate),
    index("sales_ledger_client_idx").on(t.clientId),
  ],
);

/**
 * Визиты клиентов Fitbase (/v2/client/visits) — посещаемость по дням.
 */
export const clientVisits = pgTable(
  "client_visits",
  {
    id: serial("id").primaryKey(),
    fitbaseId: varchar("fitbase_id", { length: 128 }).notNull(),
    clientId: varchar("client_id", { length: 128 }),
    startAt: timestamp("start_at", { withTimezone: true }),
    raw: jsonb("raw"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("client_visits_uniq").on(t.fitbaseId),
    index("client_visits_start_idx").on(t.startAt),
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
 * Недельные показатели SMM по площадкам (ручной ввод во вкладке «Контент»).
 * Неделя = дата понедельника (МСК). Заявки/клиенты сюда НЕ вводятся — они
 * приходят из CRM-атрибуции. Это верх воронки: контент, охват, аудитория.
 */
export const smmWeekly = pgTable(
  "smm_weekly",
  {
    id: serial("id").primaryKey(),
    weekStart: date("week_start").notNull(), // понедельник недели
    platform: varchar("platform", { length: 16 }).notNull(),
    posts: integer("posts").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    engagement: integer("engagement").notNull().default(0),
    followers: integer("followers").notNull().default(0), // всего на конец недели
    clicks: integer("clicks").notNull().default(0),
    spend: numeric("spend", { precision: 14, scale: 2 }).notNull().default("0"),
    note: varchar("note", { length: 512 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("smm_weekly_uniq").on(t.weekStart, t.platform)],
);

/**
 * Плановые KPI по месяцам (ручной ввод во вкладке «Цели»).
 * Одна строка = цель по метрике на месяц. Факт считается из данных на лету.
 */
export const kpiTargets = pgTable(
  "kpi_targets",
  {
    id: serial("id").primaryKey(),
    month: varchar("month", { length: 7 }).notNull(), // 'YYYY-MM'
    metric: varchar("metric", { length: 32 }).notNull(),
    target: numeric("target", { precision: 14, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("kpi_targets_uniq").on(t.month, t.metric)],
);

/**
 * Водяные знаки инкрементального синка: unix-секунды последнего УСПЕШНОГО
 * прогона по эндпоинту (напр. 'fitbase:client'). Позволяет тянуть только
 * изменённые с прошлого раза записи (updated_at), не перекачивая всё.
 */
export const syncState = pgTable("sync_state", {
  key: varchar("key", { length: 64 }).primaryKey(),
  lastUpdatedAt: bigint("last_updated_at", { mode: "number" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Кэш OAuth-токенов интеграций (одна строка на провайдера).
 * Нужен, чтобы не плодить токены при каждом синке (у VK Ads лимит 5 токенов
 * на client_id): держим один активный, обновляем по refresh_token.
 */
export const oauthTokens = pgTable("oauth_tokens", {
  provider: varchar("provider", { length: 64 }).primaryKey(), // напр. 'vk_ads'
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  userId: varchar("user_id", { length: 128 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
