// Определитель строя (GDD 6): 9 осей -> архетипы по близости -> де-факто ярлыки, модификаторы, компас.
import { INDUSTRIES } from '../schema.js';
import { num, clamp01, div, pol, ipol } from './util.js';

export const AXIS_IDS = ['stateOwnership', 'planning', 'redistribution', 'stateSize', 'authoritarianism',
  'openness', 'concentration', 'capacity', 'rentDependence'];

// Оси, по которым сравниваются архетипы закона. Концентрация, дееспособность и рента — только для де-факто.
const LAW_AXES = ['stateOwnership', 'planning', 'redistribution', 'stateSize', 'authoritarianism', 'openness'];

// Каждый архетип: v — целевые значения осей, w — веса осей (в том же порядке, что LAW_AXES).
export const ARCHETYPES = [
  { id: 'anarchocapitalism', label: 'Анархо-капитализм',        v: [0.00, 0.00, 0.00, 0.01, 0.20, 0.90], w: [1, 1, 1.5, 3, 0.3, 0.3] },
  { id: 'minarchism',        label: 'Минархизм («ночной сторож»)', v: [0.00, 0.00, 0.06, 0.15, 0.25, 0.85], w: [1, 1, 1.5, 2.5, 0.3, 0.3] },
  { id: 'laissezfaire',      label: 'Laissez-faire',            v: [0.02, 0.00, 0.12, 0.28, 0.30, 0.85], w: [1, 1, 1.5, 1.5, 0.3, 0.3] },
  { id: 'liberalmarket',     label: 'Либеральная рыночная экономика', v: [0.03, 0.02, 0.27, 0.40, 0.25, 0.75], w: [1, 1, 1.5, 1.5, 0.4, 0.3] },
  { id: 'socialmarket',      label: 'Социальное рыночное хозяйство', v: [0.05, 0.05, 0.50, 0.55, 0.25, 0.70], w: [1, 1, 1.5, 1.2, 0.4, 0.3] },
  { id: 'socialdemocracy',   label: 'Социал-демократия',        v: [0.10, 0.07, 0.75, 0.70, 0.20, 0.60], w: [1, 1, 1.5, 1.2, 0.4, 0.3] },
  { id: 'dirigisme',         label: 'Дирижизм',                 v: [0.25, 0.40, 0.40, 0.55, 0.40, 0.35], w: [1, 1.2, 1, 1, 0.6, 0.8] },
  { id: 'statecapitalism',   label: 'Государственный капитализм', v: [0.50, 0.30, 0.25, 0.50, 0.65, 0.40], w: [1.5, 1, 1, 1, 0.8, 0.5] },
  { id: 'corporatism',       label: 'Корпоративизм',            v: [0.12, 0.25, 0.45, 0.55, 0.60, 0.35], w: [1, 1, 1, 1, 1, 0.6] },
  { id: 'marketsocialism',   label: 'Рыночный социализм',       v: [0.65, 0.05, 0.60, 0.55, 0.25, 0.50], w: [1.5, 1.5, 1, 1, 0.5, 0.3] },
  { id: 'anarchosyndicalism',label: 'Анархо-синдикализм',       v: [0.80, 0.05, 0.30, 0.08, 0.10, 0.50], w: [1.5, 1.2, 1, 2.5, 0.8, 0.3] },
  { id: 'plannedsocialism',  label: 'Плановый социализм',       v: [0.90, 0.90, 0.70, 0.75, 0.50, 0.20], w: [1.5, 1.5, 1, 1, 0.6, 0.6] },
  { id: 'totalitarian',      label: 'Тоталитарная командная экономика', v: [1.00, 1.00, 0.60, 0.85, 1.00, 0.05], w: [1, 1, 0.7, 0.8, 2, 0.8] },
];

const sumOf = (o, prefix) => {
  let s = 0;
  for (const k in o || {}) if (k.startsWith(prefix)) s += num(o[k]);
  return s;
};

function topRate(brackets) {
  let r = 0;
  if (Array.isArray(brackets)) for (const b of brackets) r = Math.max(r, num(b?.rate));
  return r;
}

// Вес отрасли при усреднении политик: общественные блага (здравоохранение, образование, безопасность) весят вдвое меньше.
function industryWeights(world) {
  const out = [];
  for (const ind of INDUSTRIES) {
    const m = world.markets?.[ind.id];
    const val = m ? Math.max(0, num(m.sold)) * Math.max(0, num(m.price)) : 0;
    out.push({ ind, w: val > 0 ? val : 0, base: ind.publicGood ? 0.5 : 1 });
  }
  const tot = out.reduce((a, o) => a + o.w, 0);
  for (const o of out) o.w = tot > 0 ? o.w : o.base;
  const sum = out.reduce((a, o) => a + o.w, 0) || 1;
  for (const o of out) o.w /= sum;
  return out;
}

/** Расчёт 9 осей (все 0..1). Формулы — в комментариях. */
export function computeAxes(world, extra = {}) {
  const st = world.stats || {};
  const gov = world.gov || {};
  const gdp = num(st.gdp);
  const iw = industryWeights(world);

  // 1. stateOwnership: доля стоимости выпуска госфирм и кооперативов; если выпуска ещё нет — по рычагу собственности
  //    отраслей (state/coop = 1, mixed = 0.4), взвешенно.
  let stateOwnership = clamp01(st.stateShareOfOutput);
  const hasOutput = (world.firms || []).some((f) => f && f.alive !== false && num(f.output) > 0);
  if (!hasOutput) {
    stateOwnership = 0;
    for (const { ind, w } of iw) {
      const o = ipol(world, ind.id, 'ownership', 'free');
      stateOwnership += w * (o === 'state' || o === 'coop' ? 1 : o === 'mixed' ? 0.4 : 0);
    }
  }

  // 2. planning: по отраслям max(план при госсобственности = 1, госмонополия без плана = 0.4, потолок цены = 0.5,
  //    смешанная = 0.1, лицензия = 0.05, кооператив = 0.05, плановый флаг без госсобственности = 0.5), взвешенно.
  let planning = 0;
  for (const { ind, w } of iw) {
    const o = ipol(world, ind.id, 'ownership', 'free');
    const planned = !!ipol(world, ind.id, 'planned', false);
    const cap = num(ipol(world, ind.id, 'priceCap', 0)) > 0;
    let v = 0;
    if (o === 'state') v = planned ? 1 : 0.4;
    else if (planned) v = 0.5;
    if (cap) v = Math.max(v, 0.5);
    if (o === 'mixed') v = Math.max(v, 0.1);
    if (o === 'licensed' || o === 'coop') v = Math.max(v, 0.05);
    planning += w * v;
  }

  // 3. redistribution: 0.5·политика + 0.5·результат (если есть ВВП и доходы бюджета).
  //    политика = 0.5·налоговая (верхняя ставка, прибыль, взносы, НДС, дивиденды, богатство) + 0.5·трансфертная (пенсия, пособие,
  //    минимальный доход, БОД, госмедицина/образование); результат = 0.4·налоги/ВВП/0.5 + 0.4·трансферты/ВВП/0.25 + 0.2·падение Джини/0.2.
  const taxN = clamp01(0.35 * topRate(pol(world, 'incomeTaxBrackets', [])) / 0.6 + 0.2 * pol(world, 'corpTax', 0) / 0.4
    + 0.15 * pol(world, 'payrollTax', 0) / 0.3 + 0.1 * pol(world, 'vat', 0) / 0.25 + 0.1 * pol(world, 'dividendTax', 0) / 0.4
    + 0.1 * pol(world, 'wealthTax', 0) / 0.03);
  const trN = clamp01(0.3 * pol(world, 'pensionLevel', 0) / 0.6 + 0.2 * pol(world, 'unemploymentBenefit', 0) / 0.5
    + 0.2 * pol(world, 'minIncomeGuarantee', 0) / 1 + 0.2 * pol(world, 'ubi', 0) / 0.5
    + 0.05 * (pol(world, 'healthMode', 'mixed') === 'state' ? 1 : 0) + 0.05 * (pol(world, 'educationMode', 'mixed') === 'state' ? 1 : 0));
  const redisPolicy = 0.5 * taxN + 0.5 * trN;
  let redistribution = redisPolicy;
  if (gdp > 0 && num(gov.revenue) > 0) {
    const transfers = sumOf(gov.spendingByKind, 'transfers_');
    const out = 0.4 * clamp01(div(gov.revenue, gdp) / 0.5) + 0.4 * clamp01(div(transfers, gdp) / 0.25)
      + 0.2 * clamp01((num(extra.giniGross) - num(st.giniIncome)) / 0.2);
    redistribution = 0.5 * redisPolicy + 0.5 * out;
  }

  // 4. stateSize: госрасходы / ВВП / 0.6 (результат, вес 0.75) + бюджеты сфер и социальные рычаги / 0.6 (политика, вес 0.25);
  //    если расходов ещё нет — только политика.
  const polSize = clamp01((pol(world, 'healthBudget', 0) + pol(world, 'educationBudget', 0) + pol(world, 'securityBudget', 0)
    + pol(world, 'infrastructureBudget', 0) + pol(world, 'scienceBudget', 0) + 0.08 * pol(world, 'pensionLevel', 0)
    + 0.04 * pol(world, 'unemploymentBenefit', 0) + 0.1 * pol(world, 'ubi', 0)) / 0.6);
  const stateSize = gdp > 0 && num(gov.spending) > 0
    ? 0.75 * clamp01(div(gov.spending, gdp) / 0.6) + 0.25 * polSize : polSize;

  // 5. authoritarianism: 0.2·(1−пресса) + 0.2·репрессии + 0.15·(1−суды) + 0.2·выборы (free 0 / managed 0.6 / none 1)
  //    + 0.1·(нет права на забастовку) + 0.15·(нет свободного выезда).
  const el = pol(world, 'elections', 'free');
  const authoritarianism = clamp01(0.2 * (1 - clamp01(pol(world, 'pressFreedom', 0.7))) + 0.2 * clamp01(pol(world, 'repression', 0))
    + 0.15 * (1 - clamp01(pol(world, 'courtsIndependence', 0.6))) + 0.2 * (el === 'none' ? 1 : el === 'managed' ? 0.6 : 0)
    + 0.1 * (pol(world, 'strikeRight', true) ? 0 : 1) + 0.15 * (pol(world, 'emigrationAllowed', true) ? 0 : 1));

  // 6. openness: 0.8·(1 − защита) + 0.2·доля торговли; защита = 0.45·средний тариф/0.5 + 0.2·экспортные пошлины
  //    + 0.35·контроль капитала. Без данных о торговле — только первый член.
  let tar = 0, dut = 0, tw = 0;
  for (const { ind, w } of iw) {
    if (!ind.tradable) continue;
    tar += w * clamp01(num(ipol(world, ind.id, 'tariff', 0.05)) / 0.5);
    dut += w * clamp01(num(ipol(world, ind.id, 'exportDuty', 0)));
    tw += w;
  }
  const protection = 0.45 * div(tar, tw) + 0.2 * div(dut, tw) + 0.35 * clamp01(pol(world, 'capitalControls', 0));
  const trade = num(world.flows?.imports) + num(world.flows?.exports);
  const openness = gdp > 0 && trade > 0
    ? 0.8 * (1 - protection) + 0.2 * clamp01(trade / gdp / 0.6) : 1 - protection;

  // 7. concentration: 0.4·avgHhi + 0.35·(доля 1% в богатстве / 0.5) + 0.25·лоббизм;
  //    лоббизм = 0.5·(мягкость антимонопольного порога: (порог−0.4)/0.6) + 0.5·коррупция.
  const lobby = 0.5 * clamp01((num(pol(world, 'antitrustThreshold', 0.4)) - 0.4) / 0.6) + 0.5 * clamp01(gov.corruption);
  const concentration = clamp01(0.4 * clamp01(st.avgHhi) + 0.35 * clamp01(num(st.top1WealthShare) / 0.5) + 0.25 * lobby);

  // 8. capacity: 0.3·собираемость + 0.3·(1−преступность) + 0.2·(1−тень) + 0.2·(1−коррупция).
  const capacity = clamp01(0.3 * clamp01(gov.taxCompliance) + 0.3 * (1 - clamp01(gov.crime))
    + 0.2 * (1 - clamp01(gov.shadowShare)) + 0.2 * (1 - clamp01(gov.corruption)));

  // 9. rentDependence: 0.8·max(b, e) + 0.2·min(b, e); b — доля налога на ренту в доходах бюджета, e — доля экспорта ресурсов (mining) в экспорте.
  const rev = num(gov.revenue);
  const rentBudget = rev > 0 ? clamp01(num(gov.revenueByKind?.tax_rent) / rev) : 0;
  const m = world.markets?.mining;
  const miningExp = m ? Math.max(0, num(m.exports)) * Math.max(0, num(m.price)) : 0;
  const rentExport = num(world.flows?.exports) > 0 ? clamp01(miningExp / world.flows.exports) : 0;
  const rentDependence = clamp01(0.8 * Math.max(rentBudget, rentExport) + 0.2 * Math.min(rentBudget, rentExport));

  return { stateOwnership, planning, redistribution, stateSize, authoritarianism, openness, concentration, capacity, rentDependence };
}

/** Близость ко всем архетипам. score = exp(−(d/0.25)²), d — взвешенное СКО по осям. */
export function rankArchetypes(axes, world) {
  const secPrivate = pol(world, 'securityMode', 'state') === 'private';
  const res = ARCHETYPES.map((a) => {
    let s = 0, ws = 0;
    for (let i = 0; i < LAW_AXES.length; i++) {
      const d = axes[LAW_AXES[i]] - a.v[i];
      s += a.w[i] * d * d; ws += a.w[i];
    }
    let d = Math.sqrt(s / ws);
    // Анкап и минархизм различает наличие государственной полиции и налогов.
    if (a.id === 'anarchocapitalism' && !secPrivate) d += 0.15;
    if (a.id === 'minarchism' && secPrivate) d += 0.1;
    // Плановый социализм и соцдем различает форма собственности (планирование/госвыпуск), задана весами осей.
    return { id: a.id, label: a.label, score: Math.exp(-((d / 0.25) ** 2)) };
  });
  const sum = res.reduce((x, r) => x + r.score, 0);
  for (const r of res) r.share = sum > 0 ? r.score / sum : 0;
  res.sort((a, b) => b.score - a.score);
  return res;
}

export function computeRegime(world, extra = {}) {
  const axes = computeAxes(world, extra);
  const top = rankArchetypes(axes, world);
  const st = world.stats || {};
  const gov = world.gov || {};
  const law = top[0];

  // Де-факто: результат расходится с законом.
  let defacto = null;
  const crime = clamp01(gov.crime);
  if (crime >= 0.6 && (axes.capacity < 0.45 || axes.stateSize < 0.08)) defacto = 'несостоявшееся государство';
  else if (axes.rentDependence >= 0.5) defacto = 'петрогосударство';
  else if (clamp01(gov.corruption) >= 0.65) defacto = 'клептократия';
  else if (axes.stateOwnership < 0.35 && axes.concentration >= 0.6 && num(st.avgHhi) >= 0.5 && num(st.top1WealthShare) >= 0.25) defacto = 'корпоратократия';
  else if (num(st.top1WealthShare) >= 0.4 && clamp01(gov.corruption) >= 0.4 && axes.stateOwnership < 0.5) defacto = 'олигархия';

  const modifiers = [];
  if (axes.authoritarianism >= 0.6) modifiers.push('авторитарная');
  if (axes.openness < 0.3) modifiers.push('протекционистская');
  if (axes.rentDependence >= 0.3 && defacto !== 'петрогосударство') modifiers.push('рентная');
  if (clamp01(gov.corruption) >= 0.5 && defacto !== 'клептократия') modifiers.push('коррумпированная');
  if (clamp01(gov.shadowShare) >= 0.4) modifiers.push('теневая');
  if (axes.concentration >= 0.6 && defacto !== 'корпоратократия') modifiers.push('монополизированная');

  // Компас: x рынок(−1)…государство(+1), y свободы(−1)…авторитаризм(+1).
  const x = 2 * (0.4 * axes.stateOwnership + 0.25 * axes.planning + 0.2 * axes.redistribution + 0.15 * axes.stateSize) - 1;
  const y = 2 * axes.authoritarianism - 1;

  return {
    label: defacto || law.label,
    lawLabel: law.label,
    modifiers, defacto, axes, top,
    compass: { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) },
  };
}
