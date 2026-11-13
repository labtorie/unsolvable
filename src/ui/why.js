// «Почему?»: карточка у каждого показателя правой колонки. Только то, что действительно есть в данных:
// описание, рычаги (статическая карта) с текущими значениями и разложение там, где ядро отдаёт цифры.
import { POLICY_DEFS, INDUSTRIES } from '../sim/schema.js';
import { el, fmtPct, fmtNum, fmtCompact, num, PROF_LABELS, CLASS_LABELS, IND_LABELS } from './util.js';
import { app } from './state.js';
import { fmtPolicy } from './levers.js';
import { KIND_LABELS } from './flows.js';
import { profRow } from './professions.js';

const DEF = Object.fromEntries(POLICY_DEFS.map(d => [d.id, d]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function bars(rows, fmt = fmtCompact) {
  if (!rows.length) return el('div', { class: 'dim small', text: 'Данных пока нет.' });
  const mx = Math.max(1e-9, ...rows.map(r => Math.abs(r[1])));
  return el('div', { class: 'why-bars' }, ...rows.map(([k, v, extra]) => el('div', { class: 'bud-row' },
    el('span', { class: 'bud-k', text: k, title: k }), el('span', { class: 'bud-bar' }, el('i', { style: { width: Math.max(1, Math.abs(v) / mx * 100) + '%' } })),
    el('span', { class: 'bud-v', text: fmt(v) + (extra ? ' · ' + extra : '') }))));
}
const kvs = rows => el('div', {}, ...rows.map(([k, v]) => el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v }))));
const sect = (title, node) => el('div', { class: 'why-sect' }, el('div', { class: 'dim small', text: title }), node);

function classesBy(world, f) {
  const cl = world.stats?.classes || [];
  return cl.filter(c => num(c.count) > 0).map(c => [c.label || CLASS_LABELS[c.id] || c.id, f(c), c]);
}
function budgetBreak(w) {
  const top = obj => Object.entries(obj || {}).map(([k, v]) => [KIND_LABELS[k] || k, num(v)]).filter(r => r[1] > 1e-9).sort((a, b) => b[1] - a[1]).slice(0, 7);
  return el('div', {}, sect('Доходы бюджета за прошлый месяц', bars(top(w.gov?.revenueByKind))), sect('Расходы бюджета', bars(top(w.gov?.spendingByKind))));
}

export const WHY = {
  gdpReal: { what: 'Всё, что страна произвела за месяц, в ценах старта игры. Не «благосостояние»: в нём нет ни распределения, ни экологии.',
    levers: ['corpTax', 'payrollTax', 'infrastructureBudget', 'scienceBudget', 'educationBudget', 'regulationBurden', 'propertyRights', 'patentYears', 'robotTax', 'techBan'] },
  growth: { what: 'Во сколько раз реальный ВВП вырос по сравнению с тем же месяцем год назад. Первый год считается грубо: прошлого года ещё нет.',
    levers: ['cbRate', 'corpTax', 'infrastructureBudget', 'scienceBudget', 'propertyRights', 'regulationBurden', 'marginLimit', 'automationSubsidy', 'techBan'] },
  inflation: { what: 'Прирост общего уровня цен за год. Растёт, когда денег больше, чем товаров, и когда фирмам дорого производить.',
    levers: ['cbMandate', 'inflationTarget', 'cbRate', 'deficitMonetization', 'fxRegime', 'vat', 'minWage'],
    explain: w => kvs([['Эмиссия за прошлый месяц', fmtCompact(w.flows?.emission)], ['Денежная масса', fmtCompact(w.moneySupply)],
      ['Эмиссия / денежная масса', fmtPct(num(w.moneySupply) > 0 ? num(w.flows?.emission) / w.moneySupply : 0, 2)]]) },
  unemployment: { what: 'Доля безработных среди тех, кто хочет и может работать. Подрядчики платформ считаются занятыми.',
    levers: ['minWage', 'unionPower', 'firingCost', 'unemploymentBenefit', 'workWeek', 'retrainingBudget', 'robotTax', 'automationSubsidy', 'techBan', 'gigWorkersAreEmployees'],
    explain: w => {
      const rows = Object.keys(PROF_LABELS).map(id => ({ id, ...profRow(w, id) }));
      const tot = rows.reduce((a, r) => a + r.unemployed, 0);
      return sect('Безработные по профессиям (кто сколько в общей очереди)', bars(rows.filter(r => r.unemployed > 0).sort((a, b) => b.unemployed - a.unemployed)
        .map(r => [PROF_LABELS[r.id], r.unemployed, `${fmtPct(tot ? r.unemployed / tot : 0, 0)}, уровень ${fmtPct(r.employed + r.unemployed ? r.unemployed / (r.employed + r.unemployed) : 0, 0)}`]), v => fmtNum(v, 0)));
    } },
  giniIncome: { what: 'Неравенство доходов: 0 — у всех поровну, 1 — всё у одного. Считается по доходам после налогов и трансфертов.',
    levers: ['incomeTaxBrackets', 'minIncomeGuarantee', 'ubi', 'minWage', 'unionPower', 'pensionLevel', 'dividendTax', 'robotTax'],
    explain: w => {
      const rows = classesBy(w, c => num(c.share) * num(c.avgNetIncome));
      const tot = rows.reduce((a, r) => a + r[1], 0);
      return sect('Доля класса в сумме доходов после налогов', bars(rows.sort((a, b) => b[1] - a[1]).map(([k, v, c]) => [k, tot ? v / tot : 0, `${fmtPct(c.share, 0)} людей`]), v => fmtPct(v, 0)));
    } },
  giniWealth: { what: 'Неравенство богатства: накопления, акции, жильё. Всегда выше неравенства доходов, потому что капитал копится годами.',
    levers: ['wealthTax', 'inheritanceTax', 'dividendTax', 'marginLimit', 'pensionEquityShare', 'financialTransactionTax', 'educationBudget'],
    explain: w => {
      const rows = classesBy(w, c => num(c.share) * num(c.avgWealth));
      const tot = rows.reduce((a, r) => a + r[1], 0);
      return sect('Доля класса в совокупном богатстве', bars(rows.sort((a, b) => b[1] - a[1]).map(([k, v, c]) => [k, tot ? v / tot : 0, `${fmtPct(c.share, 0)} людей`]), v => fmtPct(v, 0)));
    } },
  poverty: { what: 'Доля людей, у которых закрыто меньше трёх четвертей базовых нужд: еды, жилья, энергии.',
    levers: ['minIncomeGuarantee', 'ubi', 'minWage', 'unemploymentBenefit', 'vatFoodExempt', 'vat', 'healthBudget', 'pensionLevel'],
    explain: w => {
      const rows = classesBy(w, c => (num(c.needsMet?.food) + num(c.needsMet?.housing) + num(c.needsMet?.energy)) / 3);
      return sect('Насколько закрыты базовые нужды по классам (ниже — хуже)', bars(rows.sort((a, b) => a[1] - b[1]).map(([k, v, c]) => [k, v, `${fmtPct(c.share, 0)} людей`]), v => fmtPct(v, 0)));
    } },
  balance: { what: 'Доходы минус расходы государства за месяц. Минус — дефицит: его закрывают займами или печатным станком.',
    levers: ['incomeTaxBrackets', 'payrollTax', 'corpTax', 'vat', 'wealthTax', 'resourceRent', 'pensionLevel', 'healthBudget', 'educationBudget', 'securityBudget', 'infrastructureBudget', 'ubi', 'bailoutPolicy'],
    explain: budgetBreak },
  debtGdp: { what: 'Госдолг, делённый на годовой ВВП. Растёт с дефицитами и процентами; обесценивается инфляцией.',
    levers: ['deficitMonetization', 'cbRate', 'corpTax', 'vat', 'pensionLevel', 'bailoutPolicy'],
    explain: w => kvs([['Госдолг', fmtCompact(w.gov?.debt)], ['из него у иностранцев', fmtCompact(w.gov?.debtAbroad)], ['Ставка по госдолгу', fmtPct(w.gov?.interestRate, 1) + '/год'],
      ['Баланс за месяц', fmtCompact(w.gov?.balance)], ['Дефолтов было', fmtNum(num(w.gov?.defaults), 0)]]) },
  corruption: { what: 'Какая часть государственных денег и решений уходит чиновникам. Результат, а не рычаг: растёт, когда за чиновниками никто не смотрит.',
    levers: ['officialPay', 'taxAdmin', 'courtsIndependence', 'pressFreedom', 'repression', 'propertyRights', 'securityBudget'],
    explain: w => {
      const sp = num(w.gov?.spending), c = num(w.gov?.spendingByKind?.corruption);
      return kvs([['Осело у чиновников за месяц', fmtCompact(c)], ['Доля от расходов бюджета', fmtPct(sp > 0 ? c / sp : 0, 1)]]);
    } },
  shadow: { what: 'Доля экономики, которая ушла в тень и не платит налоги. Уходят туда, когда налоги высоки, а наказание и госуслуги слабы.',
    levers: ['taxAdmin', 'corpTax', 'payrollTax', 'vat', 'incomeTaxBrackets', 'propertyRights', 'courtsIndependence', 'repression'],
    explain: w => kvs([['Собираемость налогов', fmtPct(w.gov?.taxCompliance, 0)], ['Чёрный рынок за месяц', fmtCompact(w.flows?.black_market)]]) },
  fx: { what: 'Сколько внутренних денег стоит единица иностранной. Рост — внутренняя валюта дешевеет.',
    levers: ['fxRegime', 'cbRate', 'capitalControls', 'deficitMonetization', 'emigrationAllowed', 'foreignTech'],
    explain: w => sect('Деньги через границу за прошлый месяц', bars([['Экспорт', num(w.flows?.exports)], ['Импорт', num(w.flows?.imports)], ['Вывоз капитала', num(w.flows?.capital_flight)]].filter(r => r[1] > 0))) },
  stockIndex: { what: 'Капитализация всех фирм относительно старта (100). Цена — это оценка прибыли плюс вера инвесторов, что недавний рост продолжится.',
    levers: ['cbRate', 'marginLimit', 'crossOwnershipCap', 'vendorFinancingBan', 'pensionEquityShare', 'financialTransactionTax', 'bailoutPolicy', 'dividendTax', 'corpTax'],
    explain: w => {
      const F = w.finance || {}, tot = num(F.totalValue);
      const top = (w.firms || []).filter(f => f.alive !== false && num(f.value) > 0).sort((a, b) => b.value - a.value).slice(0, 5);
      return el('div', {}, kvs([['P/E рынка', num(F.pe) > 0 ? fmtNum(F.pe, 1) : '—'], ['Долг под залог акций', fmtCompact(F.marginDebt)], ['Настроение (−1 паника … +1 мания)', fmtNum(num(F.sentiment), 2)]]),
        top.length ? sect('Из чего сложилась капитализация', bars(top.map(f => [f.name || `Фирма №${f.id}`, tot > 0 ? f.value / tot : 0]), v => fmtPct(v, 0))) : null);
    } },
  circularShare: { what: 'Доля продаж, оплаченных деньгами самого продавца: он вложился в клиента или дал ему кредит, и тот купил у него же. Выручка есть, спроса нет.',
    levers: ['crossOwnershipCap', 'vendorFinancingBan', 'marginLimit', 'financialTransactionTax', 'antitrustThreshold', 'startupAcquisitionBan', 'cbRate'],
    explain: w => {
      const rows = (w.firms || []).filter(f => f.alive !== false && num(f.circularRevenue) > 0).sort((a, b) => b.circularRevenue - a.circularRevenue).slice(0, 8);
      const tot = rows.reduce((a, f) => a + f.circularRevenue, 0);
      return sect('Круговая выручка по фирмам (за прошлый месяц)', rows.length ? bars(rows.map(f => [f.name || `Фирма №${f.id}`, f.circularRevenue, fmtPct(tot ? f.circularRevenue / tot : 0, 0)])) : el('div', { class: 'dim small', text: 'Круговой выручки пока нет.' }));
    } },
  hhi: { what: 'Средняя концентрация рынков по индексу Херфиндаля: 0 — тысячи мелких фирм, 1 — одна монополия.',
    levers: ['antitrustThreshold', 'antitrustBreakup', 'regulationBurden', 'startupAcquisitionBan', 'patentYears', 'interoperability', 'compulsoryLicensing', 'corpTaxLargeSurcharge'],
    explain: w => sect('Концентрация по отраслям', bars(INDUSTRIES.map(i => [IND_LABELS[i.id], num(w.markets?.[i.id]?.hhi), `${fmtNum(num(w.markets?.[i.id]?.firms), 0)} фирм`]).filter(r => r[1] > 0).sort((a, b) => b[1] - a[1]), v => fmtNum(v, 2))) },
};

export function createWhy() {
  const card = el('div', { class: 'why-pop hidden', role: 'dialog' });
  document.body.append(card);
  let id = null, anchor = null, sig = '';
  const close = () => { id = null; sig = ''; card.classList.add('hidden'); };
  document.addEventListener('mousedown', e => { if (id && !card.contains(e.target) && !e.target.closest?.('.why-btn')) close(); });
  window.addEventListener('keydown', e => { if (id && e.key === 'Escape') close(); });

  function fill(w, title) {
    const spec = WHY[id];
    const pol = w.policies || {};
    const leverRows = spec.levers.filter(l => DEF[l]).map(l => {
      const d = DEF[l], v = pol[l] ?? d.def, ch = !same(v, d.def);
      return el('div', { class: 'why-lever' + (ch ? ' changed' : '') }, el('span', { class: 'lv-mark' }), el('span', { class: 'why-l', text: d.label, title: d.help || d.label }),
        el('b', { text: fmtPolicy(d, v) }), ch ? el('span', { class: 'dim small', text: 'было ' + fmtPolicy(d, d.def) }) : null);
    });
    let brk = null;
    try { brk = spec.explain?.(w) ?? null; } catch (e) { console.error('[Unsolvable] почему?', id, e); }
    card.replaceChildren(
      el('div', { class: 'fp-head' }, el('b', { text: title }), el('button', { class: 'btn ghost small', text: '×', onclick: close })),
      el('p', { class: 'why-what', text: spec.what }),
      sect('От каких рычагов зависит в основном (точка — значение отличается от умолчания)', el('div', {}, ...leverRows)),
      brk ? el('div', {}, el('div', { class: 'why-div' }), brk) : el('div', { class: 'dim small pad', text: 'Разложения на вклады нет: ядро отдаёт только итог. Выдумывать доли мы не будем.' }),
      el('div', { class: 'dim small pad', text: 'Рычаги указаны по замыслу модели. Точной доли каждого ядро не считает.' }));
  }
  return {
    toggle(metricId, title, btn) {
      if (!WHY[metricId]) return;
      if (id === metricId) return close();
      id = metricId; anchor = btn; sig = '';
      card.dataset.title = title;
      if (app.world) fill(app.world, title);
      card.classList.remove('hidden');
      const r = btn.getBoundingClientRect(), h = card.offsetHeight;
      card.style.left = Math.max(8, r.left - 372) + 'px';
      card.style.top = Math.max(8, Math.min(innerHeight - h - 8, r.top - 8)) + 'px';
      sig = app.world.seed + ':' + app.world.t;
    },
    update(w) {
      if (!id) return;
      const s = w.seed + ':' + w.t;
      if (s === sig) return;
      sig = s;
      const top = card.scrollTop;
      fill(w, card.dataset.title);
      card.scrollTop = top;
    },
  };
}
