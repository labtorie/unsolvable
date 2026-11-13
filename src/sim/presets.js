// Готовые наборы рычагов «по мотивам» строёв и стран. Это быстрый способ выставить ползунки,
// а не исторические данные: значения — грубые приближения в терминах этой модели.
// Набор задаёт только отличия от умолчаний (createPolicies); остальное сбрасывается к умолчанию.
import { createPolicies, INDUSTRIES } from './schema.js';

const flat = rate => [{ from: 0, rate }];
const ALL = '*';   // ключ «все отрасли» в поле industry

export const PRESET_GROUPS = [
  { id: 'regimes', label: 'Строи' },
  { id: 'countries', label: 'Страны (по мотивам)' },
  { id: 'extremes', label: 'Крайности' },
];

export const POLICY_PRESETS = [
  // ───────────────────────── Строи ─────────────────────────
  { id: 'default', group: 'regimes', label: 'По умолчанию', note: 'Усреднённая рыночная экономика. Ни рыба ни мясо, зато работает.', set: {}, industry: {} },

  { id: 'ancap', group: 'regimes', label: 'Анархо-капитализм',
    note: 'Государства нет. Налогов нет. Полиция — по подписке.',
    set: {
      incomeTaxBrackets: flat(0), payrollTax: 0, corpTax: 0, vat: 0, exciseVice: 0, dividendTax: 0, wealthTax: 0, inheritanceTax: 0,
      resourceRent: 0, carbonTax: 0, taxAdmin: 0,
      healthMode: 'private', healthBudget: 0, educationMode: 'private', educationBudget: 0, securityMode: 'private', securityBudget: 0,
      infrastructureBudget: 0, scienceBudget: 0, pensionLevel: 0, unemploymentBenefit: 0, minIncomeGuarantee: 0, ubi: 0, officialPay: 0.5,
      minWage: 0, unionPower: 0.2, firingCost: 0, retirementAge: 75,
      antitrustThreshold: 1, regulationBurden: 0, propertyRights: 0.6,
      cbMandate: 'none', deficitMonetization: 0, bankReserve: 0, capitalControls: 0,
      pressFreedom: 1, courtsIndependence: 1, repression: 0,
    },
    industry: { [ALL]: { ownership: 'free', tariff: 0 } } },

  { id: 'minarchy', group: 'regimes', label: 'Минархизм («ночной сторож»)',
    note: 'Государство охраняет, судит и больше ни во что не лезет.',
    set: {
      incomeTaxBrackets: flat(0.08), payrollTax: 0, corpTax: 0.08, vat: 0.05, exciseVice: 0, dividendTax: 0, inheritanceTax: 0, resourceRent: 0.1,
      healthMode: 'private', healthBudget: 0, educationMode: 'private', educationBudget: 0, securityBudget: 0.035,
      infrastructureBudget: 0.005, scienceBudget: 0, pensionLevel: 0, unemploymentBenefit: 0, minIncomeGuarantee: 0,
      minWage: 0, unionPower: 0.2, firingCost: 0, retirementAge: 75,
      antitrustThreshold: 1, regulationBurden: 0.05, propertyRights: 1,
      cbMandate: 'prices', bankReserve: 0.05, pressFreedom: 1, courtsIndependence: 1, repression: 0,
    },
    industry: { [ALL]: { tariff: 0 } } },

  { id: 'laissez', group: 'regimes', label: 'Laissez-faire XIX века',
    note: 'Золотой стандарт, 60-часовая неделя и вера в невидимую руку.',
    set: {
      incomeTaxBrackets: flat(0.03), payrollTax: 0, corpTax: 0.05, vat: 0.05, exciseVice: 0.6, dividendTax: 0, inheritanceTax: 0.02, resourceRent: 0.05, taxAdmin: 0.3,
      healthMode: 'private', healthBudget: 0.002, educationMode: 'mixed', educationBudget: 0.01, securityBudget: 0.025,
      infrastructureBudget: 0.01, scienceBudget: 0, pensionLevel: 0, unemploymentBenefit: 0, minIncomeGuarantee: 0.05,
      minWage: 0, unionPower: 0, firingCost: 0, workWeek: 60, retirementAge: 75,
      antitrustThreshold: 1, regulationBurden: 0.05, propertyRights: 0.9,
      cbMandate: 'none', fxRegime: 'fixed', bankReserve: 0.05,
      strikeRight: false, pressFreedom: 0.7, courtsIndependence: 0.6, repression: 0.25,
    },
    industry: { [ALL]: { tariff: 0.2 } } },

  { id: 'socmarket', group: 'regimes', label: 'Социальное рыночное хозяйство',
    note: 'Рынок производит, государство страхует, профсоюзы сидят в совете директоров.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.14 }, { from: 1, rate: 0.3 }, { from: 3, rate: 0.42 }, { from: 8, rate: 0.45 }],
      payrollTax: 0.3, corpTax: 0.3, vat: 0.19, vatFoodExempt: true, exciseVice: 0.8, dividendTax: 0.25, inheritanceTax: 0.2, carbonTax: 0.2, taxAdmin: 0.8,
      healthBudget: 0.085, educationMode: 'state', educationBudget: 0.05, securityBudget: 0.025, infrastructureBudget: 0.03, scienceBudget: 0.02,
      pensionLevel: 0.5, unemploymentBenefit: 0.55, minIncomeGuarantee: 0.7, officialPay: 1.2,
      minWage: 0.5, unionPower: 0.7, firingCost: 4, workWeek: 38, retirementAge: 66,
      antitrustThreshold: 0.3, regulationBurden: 0.55, propertyRights: 0.95, cbMandate: 'prices',
      pressFreedom: 0.9, courtsIndependence: 0.9, repression: 0.05,
    },
    industry: { [ALL]: { tariff: 0.04 }, energy: { ownership: 'mixed' }, agri: { subsidy: 0.1, tariff: 0.15 } } },

  { id: 'socdem', group: 'regimes', label: 'Скандинавская социал-демократия',
    note: 'Половину зарплаты отдал — зато ни о чём не беспокоишься. Водка — в государственном магазине.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.25 }, { from: 1, rate: 0.4 }, { from: 2, rate: 0.52 }, { from: 5, rate: 0.6 }],
      payrollTax: 0.3, corpTax: 0.22, vat: 0.25, exciseVice: 1.8, dividendTax: 0.3, wealthTax: 0.01, inheritanceTax: 0.1,
      resourceRent: 0.8, rentDistribution: 'fund', carbonTax: 0.5, taxAdmin: 0.95,
      healthMode: 'state', healthBudget: 0.09, educationMode: 'state', educationBudget: 0.07, securityBudget: 0.02, infrastructureBudget: 0.035, scienceBudget: 0.03,
      pensionLevel: 0.6, unemploymentBenefit: 0.7, minIncomeGuarantee: 0.9, officialPay: 1.1,
      minWage: 0, unionPower: 0.9, firingCost: 3, workWeek: 37, retirementAge: 66,
      antitrustThreshold: 0.35, regulationBurden: 0.5, propertyRights: 0.95, vicePolicy: 'licensed',
      pressFreedom: 1, courtsIndependence: 0.95, repression: 0,
    },
    industry: { [ALL]: { tariff: 0.02 }, vice: { ownership: 'state' }, energy: { ownership: 'mixed' }, mining: { ownership: 'mixed' }, agri: { subsidy: 0.15, tariff: 0.2 } } },

  { id: 'dirigisme', group: 'regimes', label: 'Дирижизм',
    note: 'Рынок есть, но министр лучше знает, какие заводы стране нужны.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 1, rate: 0.3 }, { from: 3, rate: 0.5 }, { from: 8, rate: 0.6 }],
      payrollTax: 0.35, corpTax: 0.4, vat: 0.2, dividendTax: 0.3, inheritanceTax: 0.3, taxAdmin: 0.75,
      healthMode: 'state', healthBudget: 0.07, educationMode: 'state', educationBudget: 0.055, infrastructureBudget: 0.06, scienceBudget: 0.025,
      pensionLevel: 0.55, unemploymentBenefit: 0.5, minIncomeGuarantee: 0.6, officialPay: 1.3,
      minWage: 0.6, unionPower: 0.6, firingCost: 6, retirementAge: 62,
      antitrustThreshold: 0.6, regulationBurden: 0.7, capitalControls: 0.5, cbMandate: 'dual',
      pressFreedom: 0.8, courtsIndependence: 0.7,
    },
    industry: { [ALL]: { tariff: 0.15 }, energy: { ownership: 'state' }, mining: { ownership: 'state' }, finance: { ownership: 'mixed' },
      manufacturing: { ownership: 'mixed', subsidy: 0.1, tariff: 0.25 }, tech: { subsidy: 0.15 }, agri: { subsidy: 0.2, tariff: 0.3 } } },

  { id: 'statecap', group: 'regimes', label: 'Государственный капитализм',
    note: 'Прибыль частная, командные высоты государственные, вопросы задавать не принято.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 2, rate: 0.2 }, { from: 6, rate: 0.3 }],
      payrollTax: 0.25, corpTax: 0.25, vat: 0.15, resourceRent: 0.7, taxAdmin: 0.7,
      healthBudget: 0.03, educationMode: 'state', educationBudget: 0.04, securityBudget: 0.05, infrastructureBudget: 0.085, scienceBudget: 0.022,
      pensionLevel: 0.25, unemploymentBenefit: 0.1, minIncomeGuarantee: 0.2, officialPay: 1.3,
      minWage: 0.3, unionPower: 0.1, firingCost: 1, workWeek: 48,
      antitrustThreshold: 0.8, regulationBurden: 0.6, propertyRights: 0.5,
      fxRegime: 'fixed', capitalControls: 0.7, bankReserve: 0.2,
      elections: 'none', pressFreedom: 0.15, courtsIndependence: 0.2, strikeRight: false, repression: 0.55,
    },
    industry: { [ALL]: { tariff: 0.1 }, energy: { ownership: 'state' }, mining: { ownership: 'state' }, finance: { ownership: 'state' },
      manufacturing: { ownership: 'mixed', subsidy: 0.1 }, tech: { ownership: 'licensed', subsidy: 0.1 }, construction: { ownership: 'mixed' } } },

  { id: 'corporatism', group: 'regimes', label: 'Корпоративизм 1930-х',
    note: 'Труд и капитал едины. В какой именно момент — решает вождь.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 2, rate: 0.25 }, { from: 6, rate: 0.4 }],
      payrollTax: 0.25, corpTax: 0.3, vat: 0.12, taxAdmin: 0.6,
      healthBudget: 0.03, educationMode: 'state', educationBudget: 0.035, securityBudget: 0.07, infrastructureBudget: 0.06,
      pensionLevel: 0.3, unemploymentBenefit: 0.2, minWage: 0.45, unionPower: 0.9, firingCost: 6, workWeek: 48,
      antitrustThreshold: 1, regulationBurden: 0.8, propertyRights: 0.5,
      fxRegime: 'fixed', capitalControls: 0.8, deficitMonetization: 0.3,
      elections: 'none', pressFreedom: 0.05, courtsIndependence: 0.1, strikeRight: false, repression: 0.75,
    },
    industry: { [ALL]: { ownership: 'licensed', tariff: 0.5 }, energy: { ownership: 'mixed', tariff: 0 }, finance: { ownership: 'mixed', tariff: 0 },
      manufacturing: { ownership: 'mixed', subsidy: 0.15, tariff: 0.6 }, agri: { ownership: 'licensed', subsidy: 0.2, tariff: 0.8 }, security: { ownership: 'state' } } },

  { id: 'marketsoc', group: 'regimes', label: 'Рыночный социализм',
    note: 'Заводы принадлежат рабочим. Рабочие голосуют за повышение зарплаты. Каждый год.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 1, rate: 0.25 }, { from: 3, rate: 0.45 }],
      payrollTax: 0.3, corpTax: 0.3, vat: 0.15, dividendTax: 0.5, inheritanceTax: 0.5, resourceRent: 0.8,
      healthMode: 'state', healthBudget: 0.055, educationMode: 'state', educationBudget: 0.05, infrastructureBudget: 0.04,
      pensionLevel: 0.45, unemploymentBenefit: 0.3, minIncomeGuarantee: 0.5,
      minWage: 0.5, unionPower: 0.8, firingCost: 8,
      antitrustThreshold: 0.5, regulationBurden: 0.6, propertyRights: 0.4,
      deficitMonetization: 0.4, capitalControls: 0.6,
      elections: 'managed', pressFreedom: 0.4, courtsIndependence: 0.3, repression: 0.35,
    },
    industry: { [ALL]: { ownership: 'coop', tariff: 0.3 }, energy: { ownership: 'state' }, mining: { ownership: 'state' }, finance: { ownership: 'state' }, security: { ownership: 'state' } } },

  { id: 'syndicalism', group: 'regimes', label: 'Анархо-синдикализм',
    note: 'Ни хозяев, ни чиновников — только общее собрание, которое длится четвёртый час.',
    set: {
      incomeTaxBrackets: flat(0.05), payrollTax: 0.1, corpTax: 0, vat: 0, exciseVice: 0, dividendTax: 0, inheritanceTax: 0.8, resourceRent: 0.9, rentDistribution: 'citizens', taxAdmin: 0.2,
      healthBudget: 0.03, educationBudget: 0.03, securityMode: 'private', securityBudget: 0, infrastructureBudget: 0.01, scienceBudget: 0.002,
      pensionLevel: 0.3, unemploymentBenefit: 0.2, minIncomeGuarantee: 0.5, officialPay: 0.6,
      minWage: 0, unionPower: 1, firingCost: 6, workWeek: 35,
      antitrustThreshold: 0.3, antitrustBreakup: true, regulationBurden: 0.2, propertyRights: 0.3,
      cbMandate: 'none', pressFreedom: 1, courtsIndependence: 0.9, repression: 0,
    },
    industry: { [ALL]: { ownership: 'coop', tariff: 0.05 } } },

  { id: 'planned', group: 'regimes', label: 'Плановый социализм 1970-х',
    note: 'Безработицы нет. Колбасы тоже, но это временные трудности.',
    set: {
      incomeTaxBrackets: flat(0.13), payrollTax: 0.3, corpTax: 0.8, vat: 0.2, exciseVice: 2, dividendTax: 0.8, inheritanceTax: 0.3, resourceRent: 0.95, taxAdmin: 0.9,
      healthMode: 'state', healthBudget: 0.05, educationMode: 'state', educationBudget: 0.065, securityBudget: 0.07, infrastructureBudget: 0.05, scienceBudget: 0.04,
      pensionLevel: 0.5, unemploymentBenefit: 0, minIncomeGuarantee: 0.4, officialPay: 1.3,
      minWage: 0.6, unionPower: 0.2, firingCost: 12, workWeek: 41, retirementAge: 60,
      antitrustThreshold: 1, regulationBurden: 1, propertyRights: 0.1,
      cbMandate: 'none', deficitMonetization: 0.5, fxRegime: 'fixed', capitalControls: 1, bankReserve: 1,
      elections: 'none', pressFreedom: 0.05, courtsIndependence: 0.1, strikeRight: false, emigrationAllowed: false, repression: 0.6, foreignInvestment: 'banned', immigration: 'closed',
    },
    industry: { [ALL]: { ownership: 'state', planned: true, tariff: 2 }, agri: { priceCap: 1 }, construction: { priceCap: 1 }, energy: { priceCap: 1 } } },

  // ───────────────────────── Страны ─────────────────────────
  { id: 'usa', group: 'countries', label: 'США 2010-х',
    note: 'Самая богатая страна мира, где скорую вызывают, предварительно посчитав.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 1, rate: 0.22 }, { from: 3, rate: 0.32 }, { from: 8, rate: 0.37 }],
      payrollTax: 0.15, corpTax: 0.21, vat: 0.07, exciseVice: 0.4, dividendTax: 0.2, inheritanceTax: 0.15, taxAdmin: 0.75,
      healthMode: 'private', healthBudget: 0.06, educationBudget: 0.05, securityBudget: 0.045, infrastructureBudget: 0.02, scienceBudget: 0.028,
      pensionLevel: 0.35, unemploymentBenefit: 0.25, minIncomeGuarantee: 0.25,
      minWage: 0.3, unionPower: 0.15, firingCost: 0, workWeek: 42, retirementAge: 67,
      antitrustThreshold: 0.5, regulationBurden: 0.4, propertyRights: 0.95,
      pressFreedom: 0.85, courtsIndependence: 0.85, repression: 0.15,
    },
    industry: { [ALL]: { tariff: 0.03 }, agri: { subsidy: 0.1, tariff: 0.05 } } },

  { id: 'china', group: 'countries', label: 'Китай 2010-х',
    note: 'Мастерская мира. Партия владеет банками, банки владеют всем остальным.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.03 }, { from: 1, rate: 0.1 }, { from: 3, rate: 0.25 }, { from: 8, rate: 0.45 }],
      payrollTax: 0.3, corpTax: 0.25, vat: 0.15, resourceRent: 0.6, taxAdmin: 0.65,
      healthBudget: 0.03, educationMode: 'state', educationBudget: 0.04, securityBudget: 0.06, infrastructureBudget: 0.09, scienceBudget: 0.022,
      pensionLevel: 0.2, unemploymentBenefit: 0.05, minIncomeGuarantee: 0.15, officialPay: 1.2,
      minWage: 0.3, unionPower: 0.05, firingCost: 2, workWeek: 50, retirementAge: 60,
      antitrustThreshold: 0.8, regulationBurden: 0.6, propertyRights: 0.45,
      fxRegime: 'fixed', capitalControls: 0.8, bankReserve: 0.2, cbRate: 0.04,
      elections: 'none', pressFreedom: 0.05, courtsIndependence: 0.1, strikeRight: false, repression: 0.7,
    },
    industry: { [ALL]: { tariff: 0.1 }, energy: { ownership: 'state' }, mining: { ownership: 'state' }, finance: { ownership: 'state' },
      manufacturing: { subsidy: 0.12, tariff: 0.12 }, tech: { ownership: 'licensed', subsidy: 0.15, tariff: 0.5 }, construction: { ownership: 'mixed' } } },

  { id: 'singapore', group: 'countries', label: 'Сингапур',
    note: 'Чисто, богато, жвачка под запретом. Чиновникам платят столько, что воровать лень.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0 }, { from: 1, rate: 0.07 }, { from: 3, rate: 0.15 }, { from: 8, rate: 0.22 }],
      payrollTax: 0.35, corpTax: 0.17, vat: 0.08, exciseVice: 2.5, dividendTax: 0, inheritanceTax: 0, taxAdmin: 1,
      healthBudget: 0.025, educationMode: 'state', educationBudget: 0.03, securityBudget: 0.04, infrastructureBudget: 0.05, scienceBudget: 0.02,
      pensionLevel: 0.3, unemploymentBenefit: 0, minIncomeGuarantee: 0.15, officialPay: 2,
      minWage: 0, unionPower: 0.3, firingCost: 0.5, workWeek: 45,
      antitrustThreshold: 0.6, regulationBurden: 0.25, propertyRights: 1, vicePolicy: 'licensed', cbMandate: 'prices',
      elections: 'managed', pressFreedom: 0.3, courtsIndependence: 0.75, strikeRight: false, repression: 0.35,
    },
    industry: { [ALL]: { tariff: 0 }, construction: { ownership: 'mixed' }, energy: { ownership: 'mixed' } } },

  { id: 'hongkong', group: 'countries', label: 'Гонконг 1980-х',
    note: '«Позитивное невмешательство»: губернатор старается ничего не трогать, и у него получается.',
    set: {
      incomeTaxBrackets: flat(0.15), payrollTax: 0, corpTax: 0.16, vat: 0, exciseVice: 0.5, dividendTax: 0, inheritanceTax: 0.05, taxAdmin: 0.8,
      healthMode: 'state', healthBudget: 0.02, educationBudget: 0.025, securityBudget: 0.025, infrastructureBudget: 0.03, scienceBudget: 0.001,
      pensionLevel: 0.05, unemploymentBenefit: 0, minIncomeGuarantee: 0.2,
      minWage: 0, unionPower: 0.1, firingCost: 0, workWeek: 50, retirementAge: 70,
      antitrustThreshold: 1, regulationBurden: 0.1, propertyRights: 1,
      cbMandate: 'none', fxRegime: 'fixed',
      elections: 'none', pressFreedom: 0.8, courtsIndependence: 0.9, repression: 0.1,
    },
    industry: { [ALL]: { tariff: 0 }, construction: { ownership: 'mixed' } } },

  { id: 'japan60', group: 'countries', label: 'Япония 1960-х',
    note: 'Министерство говорит, что производить; фирма нанимает на всю жизнь; все работают допоздна.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 1, rate: 0.2 }, { from: 3, rate: 0.4 }, { from: 8, rate: 0.6 }],
      payrollTax: 0.15, corpTax: 0.35, vat: 0.03, inheritanceTax: 0.4, taxAdmin: 0.8,
      healthBudget: 0.03, educationMode: 'state', educationBudget: 0.045, infrastructureBudget: 0.06, scienceBudget: 0.02,
      pensionLevel: 0.25, unemploymentBenefit: 0.15, minIncomeGuarantee: 0.2,
      minWage: 0.3, unionPower: 0.4, firingCost: 10, workWeek: 52,
      antitrustThreshold: 0.7, regulationBurden: 0.5, propertyRights: 0.9,
      cbRate: 0.03, fxRegime: 'fixed', capitalControls: 0.7,
      pressFreedom: 0.8, courtsIndependence: 0.75,
    },
    industry: { [ALL]: { tariff: 0.2 }, manufacturing: { subsidy: 0.12, tariff: 0.4 }, tech: { subsidy: 0.15, tariff: 0.4 }, agri: { subsidy: 0.25, tariff: 0.8 }, finance: { ownership: 'licensed' } } },

  { id: 'chile80', group: 'countries', label: 'Чили 1980-х',
    note: 'Экономику отдали выпускникам Чикаго, всё остальное — генералам. Медь на всякий случай оставили себе.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.05 }, { from: 2, rate: 0.15 }, { from: 6, rate: 0.3 }],
      payrollTax: 0.2, corpTax: 0.1, vat: 0.2, dividendTax: 0.1, inheritanceTax: 0.05, resourceRent: 0.7,
      healthMode: 'private', healthBudget: 0.02, educationMode: 'private', educationBudget: 0.025, securityBudget: 0.06, infrastructureBudget: 0.02, scienceBudget: 0.002,
      pensionLevel: 0.1, unemploymentBenefit: 0.05, minIncomeGuarantee: 0.15,
      minWage: 0.25, unionPower: 0, firingCost: 1, workWeek: 48,
      antitrustThreshold: 1, regulationBurden: 0.15, propertyRights: 0.85, cbMandate: 'prices',
      elections: 'none', pressFreedom: 0.15, courtsIndependence: 0.25, strikeRight: false, repression: 0.8,
    },
    industry: { [ALL]: { tariff: 0.1 }, mining: { ownership: 'state' } } },

  { id: 'petrostate', group: 'countries', label: 'Нефтяная монархия Залива',
    note: 'Налогов нет, бензин почти даром, вопросов к власти тоже нет. Всё держится на одной трубе.',
    set: {
      incomeTaxBrackets: flat(0), payrollTax: 0.05, corpTax: 0.1, vat: 0.03, dividendTax: 0, inheritanceTax: 0, resourceRent: 0.95, taxAdmin: 0.4,
      healthMode: 'state', healthBudget: 0.04, educationMode: 'state', educationBudget: 0.05, securityBudget: 0.08, infrastructureBudget: 0.06, scienceBudget: 0.002,
      pensionLevel: 0.6, unemploymentBenefit: 0.3, minIncomeGuarantee: 0.6, ubi: 0.1, officialPay: 1.7,
      minWage: 0.3, unionPower: 0, firingCost: 1,
      antitrustThreshold: 1, regulationBurden: 0.5, propertyRights: 0.6, vicePolicy: 'banned',
      fxRegime: 'fixed', elections: 'none', pressFreedom: 0.05, courtsIndependence: 0.1, strikeRight: false, repression: 0.7,
    },
    industry: { [ALL]: { tariff: 0.05 }, mining: { ownership: 'state' }, energy: { ownership: 'state', subsidy: 0.5 }, agri: { subsidy: 0.3 }, finance: { ownership: 'licensed' } } },

  { id: 'argentina', group: 'countries', label: 'Аргентина (хроническая)',
    note: 'Каждые десять лет всё чинят окончательно. Печатный станок на гарантии.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.05 }, { from: 1, rate: 0.2 }, { from: 3, rate: 0.35 }],
      payrollTax: 0.35, corpTax: 0.35, vat: 0.21, wealthTax: 0.015, taxAdmin: 0.35,
      healthMode: 'state', healthBudget: 0.06, educationMode: 'state', educationBudget: 0.055, infrastructureBudget: 0.02,
      pensionLevel: 0.55, unemploymentBenefit: 0.3, minIncomeGuarantee: 0.7, officialPay: 1.2,
      minWage: 0.6, unionPower: 0.9, firingCost: 8,
      antitrustThreshold: 0.7, regulationBurden: 0.7, propertyRights: 0.45,
      cbMandate: 'none', deficitMonetization: 0.7, cbRate: 0.3, capitalControls: 0.7, fxRegime: 'fixed',
      pressFreedom: 0.7, courtsIndependence: 0.4,
    },
    industry: { [ALL]: { tariff: 0.4 }, agri: { exportDuty: 0.3, priceCap: 1.15, tariff: 0.2 }, energy: { ownership: 'mixed', subsidy: 0.4, priceCap: 1.05 }, manufacturing: { subsidy: 0.1, tariff: 0.6 } } },

  // ───────────────────────── Крайности ─────────────────────────
  { id: 'warcommunism', group: 'extremes', label: 'Военный коммунизм',
    note: 'Торговля отменена, деньги почти тоже. Хлеб изымают, энтузиазм требуют.',
    set: {
      incomeTaxBrackets: flat(0.2), payrollTax: 0.4, corpTax: 0.9, vat: 0, dividendTax: 0.8, wealthTax: 0.1, inheritanceTax: 1, resourceRent: 0.95, taxAdmin: 0.6,
      healthMode: 'state', healthBudget: 0.02, educationMode: 'state', educationBudget: 0.03, securityBudget: 0.1, infrastructureBudget: 0.02, scienceBudget: 0.002,
      pensionLevel: 0.15, unemploymentBenefit: 0, minIncomeGuarantee: 0.3, officialPay: 1.5,
      minWage: 0.5, unionPower: 0, firingCost: 12, workWeek: 60, retirementAge: 75,
      antitrustThreshold: 1, regulationBurden: 1, propertyRights: 0, vicePolicy: 'banned',
      cbMandate: 'none', deficitMonetization: 1, fxRegime: 'fixed', capitalControls: 1, bankReserve: 1,
      elections: 'none', pressFreedom: 0, courtsIndependence: 0, strikeRight: false, emigrationAllowed: false, repression: 1,
    },
    industry: { [ALL]: { ownership: 'state', planned: true, priceCap: 0.8, tariff: 2, exportDuty: 1 } } },

  { id: 'juche', group: 'extremes', label: 'Чучхе (полная автаркия)',
    note: 'Опора на собственные силы. Сил немного, зато все собственные.',
    set: {
      incomeTaxBrackets: flat(0), payrollTax: 0.2, corpTax: 0.9, vat: 0.1, dividendTax: 0.8, inheritanceTax: 1, resourceRent: 0.95, taxAdmin: 0.8,
      healthMode: 'state', healthBudget: 0.02, educationMode: 'state', educationBudget: 0.03, securityBudget: 0.1, infrastructureBudget: 0.02, scienceBudget: 0.01,
      pensionLevel: 0.2, unemploymentBenefit: 0, minIncomeGuarantee: 0.3, officialPay: 2,
      minWage: 0.4, unionPower: 0, firingCost: 12, workWeek: 60, retirementAge: 65,
      antitrustThreshold: 1, regulationBurden: 1, propertyRights: 0, vicePolicy: 'licensed',
      cbMandate: 'none', deficitMonetization: 0.6, fxRegime: 'fixed', capitalControls: 1, bankReserve: 1,
      elections: 'none', pressFreedom: 0, courtsIndependence: 0, strikeRight: false, emigrationAllowed: false, repression: 1,
    },
    industry: { [ALL]: { ownership: 'state', planned: true, priceCap: 0.9, tariff: 2, exportDuty: 1 }, mining: { exportDuty: 0.2 } } },

  { id: 'failed', group: 'extremes', label: 'Несостоявшееся государство',
    note: 'Формально это тоже свобода от государства. Нюанс — в полевых командирах.',
    set: {
      incomeTaxBrackets: flat(0.05), payrollTax: 0.05, corpTax: 0.1, vat: 0.05, exciseVice: 0, dividendTax: 0, inheritanceTax: 0, resourceRent: 0.3, taxAdmin: 0,
      healthMode: 'private', healthBudget: 0.002, educationMode: 'private', educationBudget: 0.002, securityMode: 'private', securityBudget: 0.003,
      infrastructureBudget: 0, scienceBudget: 0, pensionLevel: 0, unemploymentBenefit: 0, minIncomeGuarantee: 0, officialPay: 0.5,
      minWage: 0, unionPower: 0, firingCost: 0, workWeek: 55, retirementAge: 75,
      antitrustThreshold: 1, regulationBurden: 0.3, propertyRights: 0.05,
      cbMandate: 'none', deficitMonetization: 0.8,
      elections: 'none', pressFreedom: 0.4, courtsIndependence: 0, repression: 0.5,
    },
    industry: { [ALL]: { tariff: 0.15 } } },

  { id: 'hyperinflation', group: 'extremes', label: 'Гиперинфляция (Зимбабве 2000-х)',
    note: 'Все — миллиардеры. Хлеб стоит три миллиарда.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 1, rate: 0.3 }, { from: 3, rate: 0.45 }],
      payrollTax: 0.2, corpTax: 0.3, vat: 0.15, taxAdmin: 0.2,
      healthMode: 'state', healthBudget: 0.05, educationMode: 'state', educationBudget: 0.06, securityBudget: 0.07,
      pensionLevel: 0.5, unemploymentBenefit: 0.3, minIncomeGuarantee: 0.8, officialPay: 1.6,
      minWage: 0.9, unionPower: 0.3, firingCost: 6,
      antitrustThreshold: 0.8, regulationBurden: 0.8, propertyRights: 0.1,
      cbMandate: 'none', deficitMonetization: 1, cbRate: 0, fxRegime: 'fixed', capitalControls: 1,
      elections: 'managed', pressFreedom: 0.2, courtsIndependence: 0.15, repression: 0.6,
    },
    industry: { [ALL]: { priceCap: 0.85, tariff: 0.3 }, agri: { ownership: 'mixed', priceCap: 0.7 }, mining: { ownership: 'mixed' } } },

  { id: 'bolivarian', group: 'extremes', label: 'Нефтяной социализм (Венесуэла 2010-х)',
    note: 'Бензин дешевле воды, пока есть нефть. Потом нет ни бензина, ни воды.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.06 }, { from: 2, rate: 0.2 }, { from: 6, rate: 0.34 }],
      payrollTax: 0.2, corpTax: 0.34, vat: 0.12, resourceRent: 0.95, taxAdmin: 0.25,
      healthMode: 'state', healthBudget: 0.05, educationMode: 'state', educationBudget: 0.06, securityBudget: 0.05, infrastructureBudget: 0.01,
      pensionLevel: 0.6, unemploymentBenefit: 0.3, minIncomeGuarantee: 1, officialPay: 1.3,
      minWage: 1.1, unionPower: 0.5, firingCost: 12,
      antitrustThreshold: 0.6, regulationBurden: 0.9, propertyRights: 0.15,
      cbMandate: 'none', deficitMonetization: 1, fxRegime: 'fixed', capitalControls: 1,
      elections: 'managed', pressFreedom: 0.25, courtsIndependence: 0.1, repression: 0.6,
    },
    industry: { [ALL]: { tariff: 0.2 }, mining: { ownership: 'state' }, energy: { ownership: 'state', subsidy: 0.5, priceCap: 0.5 },
      agri: { ownership: 'mixed', priceCap: 0.75 }, manufacturing: { ownership: 'mixed', priceCap: 0.9 }, finance: { ownership: 'mixed' } } },

  { id: 'megacorp', group: 'extremes', label: 'Корпоративная антиутопия',
    note: 'Законы пишут юристы трёх холдингов. Лицензия нужна на всё, включая конкуренцию.',
    set: {
      incomeTaxBrackets: flat(0.15), payrollTax: 0.25, corpTax: 0.02, vat: 0.3, dividendTax: 0, wealthTax: 0, inheritanceTax: 0, resourceRent: 0.05, taxAdmin: 0.7,
      healthMode: 'private', healthBudget: 0.005, educationMode: 'private', educationBudget: 0.01, securityBudget: 0.06, infrastructureBudget: 0.02, scienceBudget: 0,
      pensionLevel: 0.05, unemploymentBenefit: 0, minIncomeGuarantee: 0.1,
      minWage: 0, unionPower: 0, firingCost: 0, workWeek: 60, retirementAge: 75,
      antitrustThreshold: 1, regulationBurden: 1, propertyRights: 1,
      elections: 'managed', pressFreedom: 0.2, courtsIndependence: 0.3, strikeRight: false, repression: 0.5,
    },
    industry: { [ALL]: { ownership: 'licensed', subsidy: 0.1, tariff: 0.3 }, security: { ownership: 'licensed' } } },

  { id: 'ubitopia', group: 'extremes', label: 'Базовый доход на всё',
    note: 'Каждому — среднюю зарплату просто так. Платят богатые. Пока не уехали.',
    set: {
      incomeTaxBrackets: [{ from: 0, rate: 0.3 }, { from: 1, rate: 0.5 }, { from: 2, rate: 0.7 }, { from: 5, rate: 0.9 }],
      payrollTax: 0.2, corpTax: 0.5, vat: 0.2, dividendTax: 0.6, wealthTax: 0.05, inheritanceTax: 0.8, resourceRent: 0.9, rentDistribution: 'citizens', taxAdmin: 0.9,
      healthMode: 'state', healthBudget: 0.07, educationMode: 'state', educationBudget: 0.06,
      pensionLevel: 0, unemploymentBenefit: 0, minIncomeGuarantee: 0, ubi: 0.8,
      minWage: 0, unionPower: 0.5, workWeek: 32,
      pressFreedom: 1, courtsIndependence: 0.9, repression: 0,
    },
    industry: {} },
];

/** Собирает полный набор рычагов из пресета: умолчания + отличия. */
export function buildPolicies(preset) {
  const p = createPolicies();
  for (const [k, v] of Object.entries(preset.set || {})) p[k] = structuredClone(v);
  const ind = preset.industry || {};
  for (const i of INDUSTRIES) {
    for (const src of [ind[ALL], ind[i.id]]) {
      if (!src) continue;
      for (const [k, v] of Object.entries(src)) {
        if ((k === 'tariff' || k === 'exportDuty') && !i.tradable) continue;   // у неторгуемых отраслей этих рычагов нет
        p.industry[i.id][k] = v;
      }
    }
  }
  return p;
}

/** Применяет пресет к миру на месте (объект policies сохраняется). */
export function applyPreset(world, presetId) {
  const preset = POLICY_PRESETS.find(x => x.id === presetId);
  if (!preset) return false;
  const next = buildPolicies(preset);
  next.tradeWith = world.policies.tradeWith || next.tradeWith;   // отношения с соседями — не часть набора рычагов
  for (const k of Object.keys(world.policies)) delete world.policies[k];
  Object.assign(world.policies, next);
  world.events.push({ t: world.t, type: 'preset', text: `Курс сменился: «${preset.label}». ${preset.note}` });
  return true;
}
