// КОНТРАКТ ДАННЫХ. Общий для ядра симуляции, аналитики и интерфейса.
// Идентификаторы и имена полей менять нельзя. Числовые коэффициенты — стартовые
// прикидки, их калибрует ядро. Новые поля добавлять можно (и описывать здесь).
//
// world обязан быть чистым JSON (никаких классов, Map, функций): снимки и ветки
// делаются через structuredClone.

// ───────────────────────── Профессии ─────────────────────────
export const PROFESSIONS = [
  { id: 'manual', label: 'Физический труд' },
  { id: 'clerical', label: 'Рутинный офисный' },
  { id: 'service', label: 'Обслуживание' },
  { id: 'care', label: 'Забота (врачи, учителя)' },
  { id: 'engineer', label: 'Инженеры и разработчики' },
  { id: 'manager', label: 'Управленцы и юристы' },
  { id: 'creative', label: 'Учёные и творческие' },
  { id: 'official', label: 'Чиновники и силовики' },
];

// ───────────────────────── Отрасли ─────────────────────────
// good = id отрасли (одна отрасль — один товар).
// inputs: сколько единиц чужого товара нужно на 1 единицу выпуска.
// labor: работников профессии на 100 единиц выпуска в месяц.
// capitalPerUnit: капитала на 1 единицу месячной мощности.
// scale: сила эффекта масштаба (0 — нет, 1 — естественная монополия).
// entryCost: порог входа в единицах капитала.
export const INDUSTRIES = [
  { id: 'agri', label: 'Сельское хозяйство', tradable: true, scale: 0.15, entryCost: 20, initialFirms: 8, capitalPerUnit: 2,
    inputs: { energy: 0.05, manufacturing: 0.05 }, labor: { manual: 6, manager: 0.5 } },
  { id: 'mining', label: 'Добыча ресурсов', tradable: true, scale: 0.5, entryCost: 200, initialFirms: 5, capitalPerUnit: 8, resource: true, pollution: 1.0,
    inputs: { energy: 0.1, manufacturing: 0.05 }, labor: { manual: 3, engineer: 0.7, manager: 0.3 } },
  { id: 'energy', label: 'Энергетика и сети', tradable: false, scale: 0.9, entryCost: 400, initialFirms: 4, capitalPerUnit: 10, pollution: 0.6,
    inputs: { mining: 0.25 }, labor: { manual: 1.5, engineer: 1, manager: 0.3 } },
  { id: 'manufacturing', label: 'Промышленность', tradable: true, scale: 0.4, entryCost: 100, initialFirms: 12, capitalPerUnit: 5, pollution: 0.4,
    inputs: { mining: 0.15, energy: 0.1, finance: 0.1, tech: 0.02 }, labor: { manual: 4, clerical: 0.8, engineer: 0.8, manager: 0.4 } },
  { id: 'construction', label: 'Строительство и жильё', tradable: false, scale: 0.25, entryCost: 80, initialFirms: 6, capitalPerUnit: 6,
    inputs: { manufacturing: 0.2, energy: 0.05, finance: 0.12 }, labor: { manual: 4, engineer: 0.5, manager: 0.4 } },
  { id: 'services', label: 'Услуги и торговля', tradable: false, scale: 0.1, entryCost: 10, initialFirms: 12, capitalPerUnit: 1,
    inputs: { energy: 0.03, manufacturing: 0.1, tech: 0.02 }, labor: { service: 6, clerical: 1, manager: 0.5, creative: 0.5 } },
  { id: 'finance', label: 'Финансы', tradable: false, scale: 0.5, entryCost: 150, initialFirms: 6, capitalPerUnit: 3,
    inputs: { tech: 0.05 }, labor: { clerical: 3, manager: 1.5, engineer: 0.5 } },
  { id: 'tech', label: 'Технологии и IT', tradable: true, scale: 0.8, entryCost: 50, initialFirms: 7, capitalPerUnit: 2,
    inputs: { energy: 0.05 }, labor: { engineer: 4, creative: 1, manager: 0.8, clerical: 0.5 } },
  { id: 'health', label: 'Здравоохранение', tradable: false, scale: 0.2, entryCost: 60, initialFirms: 7, capitalPerUnit: 4, publicGood: true,
    inputs: { manufacturing: 0.08, energy: 0.03 }, labor: { care: 5, clerical: 1, manager: 0.4 } },
  { id: 'education', label: 'Образование', tradable: false, scale: 0.15, entryCost: 40, initialFirms: 7, capitalPerUnit: 3, publicGood: true,
    inputs: { energy: 0.03 }, labor: { care: 5, creative: 0.8, clerical: 0.6, manager: 0.3 } },
  { id: 'security', label: 'Безопасность и суд', tradable: false, scale: 0.3, entryCost: 40, initialFirms: 4, capitalPerUnit: 2, publicGood: true,
    inputs: { manufacturing: 0.03 }, labor: { official: 5, clerical: 0.8, manager: 0.5 } },
  { id: 'vice', label: '«Грешные» товары', tradable: true, scale: 0.3, entryCost: 30, initialFirms: 4, capitalPerUnit: 2,
    inputs: { agri: 0.2, energy: 0.03 }, labor: { manual: 3, service: 1, manager: 0.4 } },
];

// ───────────────────────── Потребности домохозяйств ─────────────────────────
// Порядок = приоритет. sat — количество в месяц, при котором потребность закрыта.
export const NEEDS = [
  { id: 'food', good: 'agri', label: 'Еда', basic: true, sat: 1.0 },
  { id: 'housing', good: 'construction', label: 'Жильё', basic: true, sat: 0.6 },
  { id: 'energy', good: 'energy', label: 'Энергия', basic: true, sat: 0.5 },
  { id: 'goods', good: 'manufacturing', label: 'Товары', basic: false, sat: 1.0 },
  { id: 'health', good: 'health', label: 'Здоровье', basic: true, sat: 0.4 },
  { id: 'education', good: 'education', label: 'Образование', basic: false, sat: 0.3 },
  { id: 'security', good: 'security', label: 'Безопасность', basic: true, sat: 0.2 },
  { id: 'leisure', good: 'services', label: 'Досуг и услуги', basic: false, sat: 1.2 },
  { id: 'digital', good: 'tech', label: 'Цифровые сервисы', basic: false, sat: 0.4 },
  { id: 'vice', good: 'vice', label: 'Алкоголь, табак и прочее', basic: false, sat: 0.3 },
];

// ───────────────────────── Классы (для показа) ─────────────────────────
export const CLASSES = [
  { id: 'destitute', label: 'Нищие' },
  { id: 'workers', label: 'Рабочие' },
  { id: 'precariat', label: 'Прекариат' },
  { id: 'specialists', label: 'Специалисты' },
  { id: 'smallowners', label: 'Мелкие собственники' },
  { id: 'capitalists', label: 'Капиталисты' },
  { id: 'retired', label: 'Пенсионеры' },
  { id: 'nomenklatura', label: 'Номенклатура' },
];

// ───────────────────────── Виды денежных потоков ─────────────────────────
export const FLOW_KINDS = [
  'wages', 'consumption', 'b2b', 'dividends', 'investment',
  'tax_income', 'tax_payroll', 'tax_corp', 'tax_vat', 'tax_excise', 'tax_wealth',
  'tax_inheritance', 'tax_dividend', 'tax_rent', 'tax_carbon', 'tariffs',
  'transfers_pension', 'transfers_unemployment', 'transfers_ubi', 'transfers_poverty',
  'gov_wages', 'gov_procurement', 'subsidies', 'corruption',
  'imports', 'exports', 'capital_flight',
  'loans', 'repayments', 'interest', 'emission', 'gov_borrowing', 'gov_interest',
  'acquisitions', 'black_market', 'cb_stimulus',
];

// «Допущения модели» (раздел 1.5 GDD): спорные коэффициенты, которые можно крутить. world.assumptions.
export const ASSUMPTION_DEFS = [
  { id: 'taxDrag', def: 1, min: 0, max: 3, label: 'Насколько налоги душат инвестиции' },
  { id: 'stateInefficiency', def: 1, min: 0, max: 3, label: 'Неэффективность госпредприятий' },
  { id: 'planError', def: 1, min: 0, max: 3, label: 'Размер ошибок планирования' },
  { id: 'scaleEffects', def: 1, min: 0, max: 3, label: 'Сила эффекта масштаба' },
  { id: 'evasionSensitivity', def: 1, min: 0, max: 3, label: 'Склонность уходить в тень от налогов' },
  { id: 'corruptionLeak', def: 1, min: 0, max: 3, label: 'Какая часть расходов оседает у чиновников при коррупции' },
  { id: 'servicesTrust', def: 1, min: 0, max: 3, label: 'Насколько хорошие госуслуги и честные суды снижают желание уходить в тень' },
  { id: 'taxEnforcement', def: 1, min: 0, max: 3, label: 'Насколько сильная налоговая служба подавляет уклонение' },
  { id: 'crimeDamage', def: 1, min: 0, max: 3, label: 'Ущерб экономике от преступности (кражи, охрана, потери производительности)' },
  { id: 'lawlessCost', def: 1, min: 0, max: 3, label: 'Цена слабых прав собственности и судов (преступность, инвестиции, кредит, контракты)' },
  { id: 'unionBargaining', def: 1, min: 0, max: 3, label: 'Сила профсоюзов в торге о зарплате' },
];
export const ASSUMPTION_DEFAULTS = Object.fromEntries(ASSUMPTION_DEFS.map(d => [d.id, d.def]));

// ───────────────────────── Рычаги игрока ─────────────────────────
// type: 'range' | 'select' | 'toggle' | 'brackets'
// Интерфейс строит панель рычагов целиком из этого списка.
export const POLICY_GROUPS = [
  { id: 'taxes', label: 'Налоги' },
  { id: 'spending', label: 'Расходы и сферы' },
  { id: 'labor', label: 'Труд' },
  { id: 'markets', label: 'Собственность и рынки' },
  { id: 'money', label: 'Деньги' },
  { id: 'politics', label: 'Свободы' },
];

export const POLICY_DEFS = [
  // ── Налоги
  { id: 'incomeTaxBrackets', group: 'taxes', type: 'brackets', label: 'Подоходный налог: шкала',
    help: 'Ступени: от какого дохода (в медианных зарплатах) какая предельная ставка. Отрицательная ставка на первой ступени — доплата бедным.',
    def: [{ from: 0, rate: 0.1 }, { from: 1, rate: 0.2 }, { from: 3, rate: 0.3 }] },
  { id: 'payrollTax', group: 'taxes', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0.17, unit: '%', label: 'Соцвзносы с зарплат' },
  { id: 'corpTax', group: 'taxes', type: 'range', min: 0, max: 0.9, step: 0.01, def: 0.2, unit: '%', label: 'Налог на прибыль' },
  { id: 'corpTaxLargeSurcharge', group: 'taxes', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0, unit: '%', label: 'Надбавка для фирм с долей рынка > 25%' },
  { id: 'vat', group: 'taxes', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0.18, unit: '%', label: 'НДС' },
  { id: 'vatFoodExempt', group: 'taxes', type: 'toggle', def: false, label: 'Еда без НДС' },
  { id: 'exciseVice', group: 'taxes', type: 'range', min: 0, max: 3, step: 0.05, def: 0.5, unit: '%', label: 'Акциз на «грешные» товары' },
  { id: 'dividendTax', group: 'taxes', type: 'range', min: 0, max: 0.8, step: 0.01, def: 0.1, unit: '%', label: 'Налог на дивиденды' },
  { id: 'wealthTax', group: 'taxes', type: 'range', min: 0, max: 0.1, step: 0.005, def: 0, unit: '%/год', label: 'Налог на богатство (свыше 10 медианных состояний)' },
  { id: 'inheritanceTax', group: 'taxes', type: 'range', min: 0, max: 1, step: 0.05, def: 0.1, unit: '%', label: 'Налог на наследство' },
  { id: 'resourceRent', group: 'taxes', type: 'range', min: 0, max: 0.95, step: 0.05, def: 0.2, unit: '%', label: 'Рента с добычи ресурсов' },
  { id: 'rentDistribution', group: 'taxes', type: 'select', def: 'budget', label: 'Куда идёт рента',
    options: [{ id: 'budget', label: 'В бюджет' }, { id: 'fund', label: 'В суверенный фонд' }, { id: 'citizens', label: 'Гражданам поровну' }] },
  { id: 'carbonTax', group: 'taxes', type: 'range', min: 0, max: 1, step: 0.05, def: 0, unit: '%', label: 'Экологический налог на грязные отрасли' },
  { id: 'taxAdmin', group: 'taxes', type: 'range', min: 0, max: 1, step: 0.05, def: 0.5, unit: 'x', label: 'Сила налоговой службы', help: 'Стоит денег, повышает собираемость.' },

  // ── Расходы и сферы
  { id: 'healthMode', group: 'spending', type: 'select', def: 'mixed', label: 'Здравоохранение: устройство',
    options: [{ id: 'state', label: 'Государственное бесплатное' }, { id: 'mixed', label: 'Смешанное' }, { id: 'private', label: 'Частное' }] },
  { id: 'healthBudget', group: 'spending', type: 'range', min: 0, max: 0.15, step: 0.005, def: 0.04, unit: '% ВВП', label: 'Здравоохранение: бюджет' },
  { id: 'educationMode', group: 'spending', type: 'select', def: 'mixed', label: 'Образование: устройство',
    options: [{ id: 'state', label: 'Государственное бесплатное' }, { id: 'mixed', label: 'Смешанное' }, { id: 'private', label: 'Частное' }] },
  { id: 'educationBudget', group: 'spending', type: 'range', min: 0, max: 0.15, step: 0.005, def: 0.04, unit: '% ВВП', label: 'Образование: бюджет' },
  { id: 'securityMode', group: 'spending', type: 'select', def: 'state', label: 'Полиция и суд: устройство',
    options: [{ id: 'state', label: 'Государственные' }, { id: 'private', label: 'Частные охранные агентства' }] },
  { id: 'securityBudget', group: 'spending', type: 'range', min: 0, max: 0.1, step: 0.005, def: 0.02, unit: '% ВВП', label: 'Полиция и суд: бюджет' },
  { id: 'infrastructureBudget', group: 'spending', type: 'range', min: 0, max: 0.1, step: 0.005, def: 0.02, unit: '% ВВП', label: 'Инфраструктура' },
  { id: 'scienceBudget', group: 'spending', type: 'range', min: 0, max: 0.05, step: 0.0025, def: 0.005, unit: '% ВВП', label: 'Наука' },
  { id: 'pensionLevel', group: 'spending', type: 'range', min: 0, max: 1, step: 0.05, def: 0.35, unit: 'ср. зарплат', label: 'Пенсия' },
  { id: 'unemploymentBenefit', group: 'spending', type: 'range', min: 0, max: 1, step: 0.05, def: 0.2, unit: 'ср. зарплат', label: 'Пособие по безработице' },
  { id: 'minIncomeGuarantee', group: 'spending', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0.3, unit: 'баз. корзин', label: 'Доплата до минимального дохода' },
  { id: 'ubi', group: 'spending', type: 'range', min: 0, max: 1, step: 0.05, def: 0, unit: 'ср. зарплат', label: 'Безусловный базовый доход' },
  { id: 'officialPay', group: 'spending', type: 'range', min: 0.5, max: 2, step: 0.05, def: 1, unit: 'ср. зарплат', label: 'Зарплата госслужащих' },

  // ── Труд
  { id: 'minWage', group: 'labor', type: 'range', min: 0, max: 1.5, step: 0.05, def: 0.4, unit: 'медиан', label: 'МРОТ' },
  { id: 'unionPower', group: 'labor', type: 'range', min: 0, max: 1, step: 0.05, def: 0.3, unit: 'x', label: 'Сила профсоюзов', help: '0 — запрещены, 1 — обязательные отраслевые соглашения.' },
  { id: 'firingCost', group: 'labor', type: 'range', min: 0, max: 12, step: 0.5, def: 1, unit: 'мес. зарплат', label: 'Выходное пособие при увольнении' },
  { id: 'workWeek', group: 'labor', type: 'range', min: 30, max: 60, step: 1, def: 40, unit: 'ч', label: 'Рабочая неделя' },
  { id: 'retirementAge', group: 'labor', type: 'range', min: 55, max: 75, step: 1, def: 65, unit: 'лет', label: 'Пенсионный возраст' },

  // ── Собственность и рынки
  { id: 'antitrustThreshold', group: 'markets', type: 'range', min: 0.2, max: 1, step: 0.05, def: 0.4, unit: '%', label: 'Антимонопольный порог', help: 'Слияния, после которых доля рынка выше порога, запрещены. 100% — закона нет.' },
  { id: 'antitrustBreakup', group: 'markets', type: 'toggle', def: false, label: 'Принудительно дробить фирмы выше порога' },
  { id: 'regulationBurden', group: 'markets', type: 'range', min: 0, max: 1, step: 0.05, def: 0.3, unit: 'x', label: 'Плотность регулирования', help: 'Нормы и проверки: меньше вреда, выше издержки и порог входа.' },
  { id: 'propertyRights', group: 'markets', type: 'range', min: 0, max: 1, step: 0.05, def: 0.7, unit: 'x', label: 'Защита собственности и контрактов' },
  { id: 'vicePolicy', group: 'markets', type: 'select', def: 'legal', label: '«Грешные» товары',
    options: [{ id: 'legal', label: 'Разрешены' }, { id: 'licensed', label: 'По лицензии' }, { id: 'banned', label: 'Запрещены' }] },

  // ── Деньги
  { id: 'cbMandate', group: 'money', type: 'select', def: 'dual', label: 'Мандат центробанка',
    options: [{ id: 'none', label: 'Нет мандата: деньги не трогаем' }, { id: 'prices', label: 'Цель по инфляции' }, { id: 'dual', label: 'Цены и занятость' }] },
  { id: 'inflationTarget', group: 'money', type: 'range', min: 0, max: 0.2, step: 0.005, def: 0.02, unit: '%/год', label: 'Цель по инфляции' },
  { id: 'cbRate', group: 'money', type: 'range', min: 0, max: 0.5, step: 0.005, def: 0.05, unit: '%/год', label: 'Ставка центробанка' },
  { id: 'deficitMonetization', group: 'money', type: 'range', min: 0, max: 1, step: 0.05, def: 0, unit: '%', label: 'Доля дефицита, покрываемая печатным станком' },
  { id: 'fxRegime', group: 'money', type: 'select', def: 'float', label: 'Курс валюты',
    options: [{ id: 'float', label: 'Плавающий' }, { id: 'fixed', label: 'Фиксированный' }] },
  { id: 'capitalControls', group: 'money', type: 'range', min: 0, max: 1, step: 0.05, def: 0, unit: 'x', label: 'Контроль за вывозом капитала' },
  { id: 'bankReserve', group: 'money', type: 'range', min: 0, max: 1, step: 0.05, def: 0.1, unit: '%', label: 'Резервные требования к банкам' },

  // ── Свободы
  { id: 'elections', group: 'politics', type: 'select', def: 'free', label: 'Выборы (декоративный рычаг: власть не меняется)',
    options: [{ id: 'free', label: 'Свободные' }, { id: 'managed', label: 'Управляемые' }, { id: 'none', label: 'Отменены' }] },
  { id: 'pressFreedom', group: 'politics', type: 'range', min: 0, max: 1, step: 0.05, def: 0.7, unit: 'x', label: 'Свобода прессы' },
  { id: 'courtsIndependence', group: 'politics', type: 'range', min: 0, max: 1, step: 0.05, def: 0.6, unit: 'x', label: 'Независимость судов' },
  { id: 'strikeRight', group: 'politics', type: 'toggle', def: true, label: 'Право на забастовку' },
  { id: 'emigrationAllowed', group: 'politics', type: 'toggle', def: true, label: 'Свободный выезд из страны' },
  { id: 'repression', group: 'politics', type: 'range', min: 0, max: 1, step: 0.05, def: 0.1, unit: 'x', label: 'Слежка и репрессии' },
];

// Рычаги по каждой отрасли: world.policies.industry[industryId][id]
export const INDUSTRY_POLICY_DEFS = [
  { id: 'ownership', type: 'select', def: 'free', label: 'Собственность',
    options: [{ id: 'free', label: 'Свободная частная' }, { id: 'licensed', label: 'Частная по лицензии' }, { id: 'mixed', label: 'Смешанная' },
      { id: 'state', label: 'Госмонополия' }, { id: 'coop', label: 'Только кооперативы' }] },
  { id: 'planned', type: 'toggle', def: false, label: 'План вместо рынка (для госфирм)' },
  { id: 'priceCap', type: 'range', min: 0, max: 2, step: 0.05, def: 0, unit: 'x себест.', label: 'Потолок цены (0 — нет)' },
  { id: 'subsidy', type: 'range', min: 0, max: 0.5, step: 0.01, def: 0, unit: '%', label: 'Субсидия от цены' },
  { id: 'tariff', type: 'range', min: 0, max: 2, step: 0.05, def: 0.05, unit: '%', label: 'Импортная пошлина', tradableOnly: true },
  { id: 'exportDuty', type: 'range', min: 0, max: 1, step: 0.05, def: 0, unit: '%', label: 'Экспортная пошлина (100% — запрет)', tradableOnly: true },
];

export function createPolicies() {
  const p = {};
  for (const d of POLICY_DEFS) p[d.id] = structuredClone(d.def);
  p.industry = {};
  for (const ind of INDUSTRIES) {
    p.industry[ind.id] = {};
    for (const d of INDUSTRY_POLICY_DEFS) p.industry[ind.id][d.id] = d.def;
  }
  // По умолчанию полиция и суд государственные.
  p.industry.security.ownership = 'state';
  return p;
}

// ───────────────────────── Фабрики объектов ─────────────────────────

export function makeHousehold(id) {
  return {
    id,
    age: 30,               // лет; стареет, умирает, заменяется наследником
    profession: 'manual',  // id из PROFESSIONS
    skill: 0.5,            // 0..1 уровень внутри профессии
    status: 'unemployed',  // 'employed' | 'unemployed' | 'self' | 'retired'
    employerId: null,      // id фирмы или null
    wage: 0,               // месячная, до налогов
    income: 0,             // все доходы за прошлый месяц до налогов (зарплата+дивиденды+трансферты)
    netIncome: 0,          // после налогов
    incomeBySource: { wage: 0, capital: 0, transfer: 0, business: 0 },
    cash: 0,               // деньги (счёт для ledger)
    shares: {},            // { [firmId]: доля 0..1 }
    health: 0.8,           // 0..1
    needsMet: {},          // { [needId]: 0..1 } за прошлый месяц
    satisfaction: 0.5,     // 0..1 — считает аналитика
    classId: 'workers',    // id из CLASSES — считает аналитика
    parentClassId: null,   // класс родителя на момент наследования — для мобильности
    // ── добавлено ядром
    bonds: 0,              // гособлигации (номинал); входят в богатство, процент платит бюджет
    retrain: null,         // { to: id профессии, left: месяцев } — переобучение
    jobSearch: 0,          // месяцев без работы подряд
    birth: 0,              // месяц года (0..11), когда стареет
  };
}

export function makeFirm(id, industry) {
  return {
    id,
    name: '',
    industry,              // id из INDUSTRIES
    owner: 'private',      // 'private' | 'state' | 'coop' | 'foreign' (у foreign нет holders: дивиденды уходят за границу)
    alive: true,
    bornT: 0,
    capital: 0,            // производственные мощности в единицах капитала
    productivity: 1,       // множитель выпуска
    employees: {},         // { [professionId]: число работников }
    vacancies: {},         // { [professionId]: число }
    wageOffer: {},         // { [professionId]: месячная зарплата }
    price: 1,
    unitCost: 1,           // себестоимость единицы за прошлый месяц
    markup: 0.1,           // наценка над себестоимостью
    output: 0,             // выпуск за месяц
    inventory: 0,
    sales: 0,              // продано единиц за месяц
    revenue: 0,
    profit: 0,
    cash: 0,               // счёт для ledger
    debt: 0,               // долг банку
    marketShare: 0,        // доля в продажах отрасли 0..1
    acquired: [],          // имена поглощённых фирм
    // ── добавлено ядром
    inputStock: {},        // { [good]: запас сырья для производства }
    inputCost: {},         // { [good]: средняя цена закупки запаса }
    holders: {},           // { [hhId]: true } — кто владеет долей (дубль hh.shares для скорости)
    demandEMA: 0,          // ожидаемый спрос (ед./мес.)
    orders: 0,             // заказы за прошлый месяц (включая неудовлетворённые)
    share: 0,              // сглаженная «клиентская» доля (инерция покупателей)
    util: 0,               // загрузка мощностей 0..1
    profitMargin: 0,       // сглаженная рентабельность (прибыль / выручка)
    priceFree: 1,          // цена до потолка
    capex: 0,              // потрачено на мощности в прошлом месяце
    wageBill: 0,           // фонд зарплат прошлого месяца
    lossMonths: 0,         // месяцев подряд в убытке и без денег
    planTarget: 0,         // плановое задание (для planned)
    planErr: 0,            // ошибка плана
    exportsQty: 0, importsBought: 0,
    lastSplitT: -99,
    strikeLeft: 0,         // месяцев забастовки осталось
    deadT: null,           // месяц смерти/поглощения
    inventoryStart: 0,
    sizeRef: 1,            // референсная мощность отрасли для эффекта масштаба
    inputUsed: 0,          // стоимость израсходованного сырья за месяц
    target: 0,             // плановый выпуск текущего месяца
    capacity: 0,           // мощность (ед./мес.)
    supplyPrev: 0,         // предложение прошлого месяца (выпуск + остаток)
  };
}

/**
 * Пустой мир нужной формы. Население и фирмы создаёт populate() из init.js.
 * opts: { seed?: number, preset?: 'industrial' | 'agrarian' | 'resource' | 'trading', households?: number }
 */
export function createWorld(opts = {}) {
  const world = {
    t: 0,                         // месяц от начала
    seed: opts.seed ?? 1,
    rngState: opts.seed ?? 1,
    preset: opts.preset ?? 'industrial',
    policies: createPolicies(),
    households: [],
    firms: [],                    // и живые, и мёртвые (alive=false) за последние месяцы; ядро чистит старые
    nextFirmId: 1,
    nextHouseholdId: 1,
    moneySupply: 0,

    // Рынки по товарам за прошлый месяц
    markets: {},                  // { [good]: { price, demand, sold, shortage (0..1), imports, exports, hhi (0..1), firms (число живых) } }

    gov: {
      cash: 0, debt: 0, fund: 0,  // fund — суверенный фонд
      revenue: 0, spending: 0, balance: 0,   // за прошлый месяц
      revenueByKind: {}, spendingByKind: {}, // ключи из FLOW_KINDS
      corruption: 0.2,            // 0..1 — результат, не рычаг
      shadowShare: 0.1,           // доля экономики в тени 0..1
      taxCompliance: 0.8,         // собираемость 0..1
      crime: 0.2,                 // 0..1
      infrastructure: 1,          // множитель производительности
      // ── добавлено ядром
      interestRate: 0.06,         // ставка по госдолгу (годовая): cbRate + премия за долг
      defaults: 0,                // сколько раз государство объявляло дефолт
      cut: 0,                     // доля секвестра расходов (когда занять нельзя, а печатать запрещено)
      debtAbroad: 0,              // часть госдолга у иностранцев
      rebate: 0,                  // накопленные «бюджетные дивиденды» гражданам при профиците без долга
    },
    bank: { cash: 0, loans: 0, rate: 0.07, defaults: 0, defRate: 0 },   // defRate — сглаженная доля невозвратов (ядро)
    abroad: { cash: 0, fx: 1, reserves: 0, worldPrice: {}, nx: 0, peg: 0 },  // worldPrice: { [good]: цена в валюте мира }; fx — внутренних денег за единицу иностранной; nx — сглаженный платёжный баланс / ВВП; peg — зафиксированный курс
    resources: { reserves: 0, land: 0, pollution: 0, reservesInit: 0 },   // reservesInit — запасы на старте (ядро)

    flows: {},                    // { [FLOW_KIND]: сумма за прошлый месяц } — ядро обнуляет в начале тика
    stats: {
      // ── заполняет ядро
      gdp: 0,                     // номинальный, за месяц
      gdpReal: 0,                 // в ценах старта
      gdpGrowth: 0,               // год к году
      cpi: 1,
      inflation: 0,               // год к году
      unemployment: 0,            // 0..1
      avgWage: 0, medianWage: 0,
      wageShare: 0,               // доля зарплат в ВВП
      basicBasketCost: 0,         // цена базовой корзины на месяц
      tradeBalance: 0,
      population: 0,
      employmentByProfession: {}, // { [prof]: { employed, unemployed, avgWage } }
      // ── заполняет аналитика
      giniIncome: 0, giniWealth: 0,
      top1WealthShare: 0, top10IncomeShare: 0,
      povertyRate: 0,
      mobility: 0,                // шанс подняться из нижней пятой части в верхнюю
      avgSatisfaction: 0,
      classes: [],                // [{ id, label, count, share, avgIncome, avgNetIncome, avgWealth, needsMet:{}, health, satisfaction }]
      stateShareOfOutput: 0,      // доля выпуска госфирм и кооперативов
      avgHhi: 0,                  // средняя концентрация по отраслям
    },
    regime: {                     // заполняет аналитика
      label: '', modifiers: [], defacto: null,
      axes: {},                   // { [axisId]: 0..1 }
      top: [],                    // [{ id, label, score 0..1 }]
      compass: { x: 0, y: 0 },    // x: -1 рынок … +1 государство; y: -1 свободы … +1 авторитаризм
    },
    history: { t: [], series: {} },   // series: { [key]: number[] } — пишет index.js
    events: [],                   // [{ t, type, text, data? }] — лента; ядро держит последние ~200

    // ── добавлено ядром
    assumptions: { ...ASSUMPTION_DEFAULTS },   // «Допущения модели»: коэффициенты, которые игрок может крутить
    basePrice: {},                // { [good]: цена старта } — для реального ВВП и ИПЦ
    calib: { demandScale: 1, capUnit: 1, medianBase: 100 },  // калибровка старта; ядро дописывает wbar (уровень зарплат), envRef, rb0, lnRb, pollRef, carry (переносимые между месяцами показатели)
    ind: {},                      // { [industryId]: { profitMargin, ownershipApplied, impK, impShare, expBase, lastEntryT, hhi } }
    labor: {},                    // { [professionId]: { wage, w0, rel, employed, unemployed, vacancies, u } } — рынок труда
    hist: { cpi: [], gdpReal: [] },   // кольцо для годовых темпов
    shock: { expropriation: 0 },  // недоверие после национализаций (затухает)
  };
  for (const k of FLOW_KINDS) world.flows[k] = 0;
  return world;
}

// Ключи, которые index.js пишет в world.history каждый месяц (путь в world).
export const HISTORY_KEYS = {
  gdpReal: 'stats.gdpReal',
  cpi: 'stats.cpi',
  inflation: 'stats.inflation',
  unemployment: 'stats.unemployment',
  avgWage: 'stats.avgWage',
  giniIncome: 'stats.giniIncome',
  giniWealth: 'stats.giniWealth',
  top1WealthShare: 'stats.top1WealthShare',
  povertyRate: 'stats.povertyRate',
  avgSatisfaction: 'stats.avgSatisfaction',
  avgHhi: 'stats.avgHhi',
  govBalance: 'gov.balance',
  govDebt: 'gov.debt',
  gdp: 'stats.gdp',
  corruption: 'gov.corruption',
  shadowShare: 'gov.shadowShare',
  fx: 'abroad.fx',
  tradeBalance: 'stats.tradeBalance',
  moneySupply: 'moneySupply',
  compassX: 'regime.compass.x',
  compassY: 'regime.compass.y',
};
