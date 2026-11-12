// Конфигурации миров под конкретные строи (политики + результаты).
import { INDUSTRIES } from '../src/sim/schema.js';

const allInd = (v) => Object.fromEntries(INDUSTRIES.map((i) => [i.id, typeof v === 'function' ? v(i) : v]));
const noTariff = (i) => (i.tradable ? { tariff: 0 } : {});
const zeroTax = { incomeTaxBrackets: [{ from: 0, rate: 0 }], payrollTax: 0, corpTax: 0, vat: 0, exciseVice: 0, dividendTax: 0,
  wealthTax: 0, inheritanceTax: 0, resourceRent: 0 };
const zeroSpend = { healthBudget: 0, educationBudget: 0, securityBudget: 0, infrastructureBudget: 0, scienceBudget: 0,
  pensionLevel: 0, unemploymentBenefit: 0, minIncomeGuarantee: 0, ubi: 0, healthMode: 'private', educationMode: 'private' };
const freedoms = { elections: 'free', pressFreedom: 0.9, courtsIndependence: 0.9, strikeRight: true, emigrationAllowed: true, repression: 0 };

export const SCEN = {
  anarchocapitalism: {
    policies: { ...zeroTax, ...zeroSpend, ...freedoms, securityMode: 'private', antitrustThreshold: 1, regulationBurden: 0, propertyRights: 1, unionPower: 0 },
    industry: allInd((i) => ({ ownership: 'free', ...noTariff(i) })),
    spendingFrac: 0, revenueFrac: 0,
  },
  minarchism: {
    policies: { ...zeroTax, ...zeroSpend, ...freedoms, incomeTaxBrackets: [{ from: 0, rate: 0.08 }], vat: 0.06, corpTax: 0.08, securityBudget: 0.04, infrastructureBudget: 0.02, unionPower: 0.1 },
    industry: allInd((i) => ({ ownership: 'free', ...noTariff(i) })),
    spendingFrac: 0.08, revenueFrac: 0.08,
  },
  socialdemocracy: {
    policies: { ...freedoms, incomeTaxBrackets: [{ from: 0, rate: 0.2 }, { from: 1, rate: 0.4 }, { from: 3, rate: 0.55 }], payrollTax: 0.25, corpTax: 0.3, vat: 0.2,
      dividendTax: 0.3, wealthTax: 0.01, healthMode: 'state', educationMode: 'state', healthBudget: 0.08, educationBudget: 0.06, securityBudget: 0.02,
      infrastructureBudget: 0.03, scienceBudget: 0.01, pensionLevel: 0.6, unemploymentBenefit: 0.5, minIncomeGuarantee: 1, ubi: 0.2, unionPower: 0.7 },
    industry: allInd((i) => ({ ownership: ['health', 'education', 'security'].includes(i.id) ? 'mixed' : 'free', tariff: 0.05 })),
    owners: { health: 'state', education: 'state', security: 'state' },
    spendingFrac: 0.42, revenueFrac: 0.4, transferFrac: 0.18, stats: { giniIncome: 0.26 },
  },
  plannedsocialism: {
    policies: { ...freedoms, elections: 'managed', pressFreedom: 0.3, repression: 0.4, courtsIndependence: 0.3, strikeRight: false, emigrationAllowed: false,
      capitalControls: 1, pensionLevel: 0.6, unemploymentBenefit: 0.5, minIncomeGuarantee: 1, healthMode: 'state', educationMode: 'state',
      healthBudget: 0.08, educationBudget: 0.06, securityBudget: 0.04, infrastructureBudget: 0.05, scienceBudget: 0.03, corpTax: 0.5, incomeTaxBrackets: [{ from: 0, rate: 0.2 }, { from: 3, rate: 0.5 }] },
    industry: allInd({ ownership: 'state', planned: true, tariff: 1, exportDuty: 0.5 }),
    owners: Object.fromEntries(INDUSTRIES.map((i) => [i.id, 'state'])),
    spendingFrac: 0.55, revenueFrac: 0.5, transferFrac: 0.15, hhi: 1,
  },
  statecapitalism: {
    policies: { ...freedoms, elections: 'managed', pressFreedom: 0.2, repression: 0.6, courtsIndependence: 0.2, emigrationAllowed: false, strikeRight: false,
      incomeTaxBrackets: [{ from: 0, rate: 0.1 }, { from: 3, rate: 0.25 }], corpTax: 0.2, vat: 0.1, securityBudget: 0.05, infrastructureBudget: 0.06, scienceBudget: 0.02,
      healthBudget: 0.03, educationBudget: 0.03, pensionLevel: 0.2, unemploymentBenefit: 0.1, minIncomeGuarantee: 0.2, capitalControls: 0.5 },
    industry: allInd((i) => ({ ownership: ['energy', 'mining', 'finance', 'manufacturing', 'tech'].includes(i.id) ? 'state' : 'free', tariff: 0.3 })),
    owners: { energy: 'state', mining: 'state', finance: 'state', manufacturing: 'state', tech: 'state', construction: 'state', security: 'state' },
    spendingFrac: 0.3, revenueFrac: 0.28, transferFrac: 0.05, hhi: 0.3,
  },
  marketsocialism: {
    policies: { ...freedoms, pressFreedom: 0.8, repression: 0.05, incomeTaxBrackets: [{ from: 0, rate: 0.15 }, { from: 1, rate: 0.3 }, { from: 3, rate: 0.5 }],
      corpTax: 0.3, vat: 0.15, payrollTax: 0.2, healthMode: 'state', educationMode: 'state', healthBudget: 0.06, educationBudget: 0.05, securityBudget: 0.02,
      infrastructureBudget: 0.03, pensionLevel: 0.5, unemploymentBenefit: 0.4, minIncomeGuarantee: 0.8, ubi: 0.1, unionPower: 0.7 },
    industry: allInd((i) => ({ ownership: ['health', 'education', 'security'].includes(i.id) ? 'state' : 'coop', tariff: 0.1 })),
    owners: Object.fromEntries(INDUSTRIES.map((i) => [i.id, ['health', 'education', 'security'].includes(i.id) ? 'state' : 'coop'])),
    spendingFrac: 0.35, revenueFrac: 0.33, transferFrac: 0.12, hhi: 0.12,
  },
};
