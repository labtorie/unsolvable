// Показатели правой колонки: как достать ряд из history и как показать значение.
import { fmtNum, fmtPct, fmtCompact, num } from './util.js';

const S = (h, k) => h?.series?.[k] || [];

function yoy(arr) {
  return arr.map((v, i) => (i >= 12 && arr[i - 12] > 0 ? v / arr[i - 12] - 1 : (i > 0 && arr[0] > 0 ? (v / arr[0] - 1) * (12 / i) : 0)));
}
function debtGdp(h) {
  const d = S(h, 'govDebt'), g = S(h, 'gdp');
  return d.map((v, i) => (g[i] > 0 ? v / (g[i] * 12) : 0));
}
const last = a => (a.length ? a[a.length - 1] : 0);

export const METRICS = [
  { id: 'gdpReal', label: 'Реальный ВВП', series: h => S(h, 'gdpReal'), fmt: fmtCompact, cur: w => w.stats?.gdpReal },
  { id: 'growth', label: 'Рост ВВП (год к году)', series: h => yoy(S(h, 'gdpReal')), fmt: v => fmtPct(v, 1), cur: w => w.stats?.gdpGrowth },
  { id: 'inflation', label: 'Инфляция', series: h => S(h, 'inflation'), fmt: v => fmtPct(v, 1), cur: w => w.stats?.inflation },
  { id: 'unemployment', label: 'Безработица', series: h => S(h, 'unemployment'), fmt: v => fmtPct(v, 1), cur: w => w.stats?.unemployment },
  { id: 'giniIncome', label: 'Джини: доходы', series: h => S(h, 'giniIncome'), fmt: v => fmtNum(v, 2), cur: w => w.stats?.giniIncome },
  { id: 'giniWealth', label: 'Джини: богатство', series: h => S(h, 'giniWealth'), fmt: v => fmtNum(v, 2), cur: w => w.stats?.giniWealth },
  { id: 'poverty', label: 'Бедность', series: h => S(h, 'povertyRate'), fmt: v => fmtPct(v, 1), cur: w => w.stats?.povertyRate },
  { id: 'balance', label: 'Баланс бюджета (в месяц)', series: h => S(h, 'govBalance'), fmt: fmtCompact, cur: w => w.gov?.balance },
  { id: 'debtGdp', label: 'Госдолг / ВВП', series: debtGdp, fmt: v => fmtPct(v, 0), cur: w => (num(w.stats?.gdp) > 0 ? num(w.gov?.debt) / (w.stats.gdp * 12) : 0) },
  { id: 'corruption', label: 'Коррупция', series: h => S(h, 'corruption'), fmt: v => fmtPct(v, 0), cur: w => w.gov?.corruption },
  { id: 'shadow', label: 'Тень', series: h => S(h, 'shadowShare'), fmt: v => fmtPct(v, 0), cur: w => w.gov?.shadowShare },
  { id: 'hhi', label: 'Концентрация рынков', series: h => S(h, 'avgHhi'), fmt: v => fmtNum(v, 2), cur: w => w.stats?.avgHhi },
  { id: 'fx', label: 'Курс', series: h => S(h, 'fx'), fmt: v => fmtNum(v, 2), cur: w => w.abroad?.fx },
  // вторая волна: финансы
  { id: 'stockIndex', label: 'Фондовый индекс', series: h => S(h, 'stockIndex'), fmt: v => fmtNum(v, 1), cur: w => w.finance?.index },
  { id: 'circularShare', label: 'Круговая выручка', series: h => S(h, 'circularShare'), fmt: v => fmtPct(v, 1), cur: w => w.finance?.circularShare },
];
export const metricById = id => METRICS.find(m => m.id === id) || METRICS[0];
export { last };
