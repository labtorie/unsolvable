// Чистые данные о соседях для интерфейса и тестов: ничего не тянет из ядра (как phenomena-info.js).

/** Рычаг игрока по стране: policies.tradeWith[id] = { tariff, embargo }. */
export function setTradeWith(world, id, patch) {
  const t = (world.policies.tradeWith ||= {});
  t[id] = { tariff: 0, embargo: false, ...(t[id] || {}), ...patch };
  return t[id];
}


/** Сводка по соседям для интерфейса: всё в удобных единицах (деньги — в валюте игрока по текущему курсу). */
export function neighborSummary(world) {
  if (!world.neighbors?.length) return [];
  const xb = world.xb;
  const fxH = world.abroad.fx;
  const nowT = world.t;
  return world.neighbors.map(n => {
    const w = n.world, st = w.stats;
    const N = Math.max(1, w.households.length);
    const gdpPcWorld = (st.gdp || 0) / N / w.abroad.fx;                       // на домохозяйство, в мировых единицах
    const hN = Math.max(1, world.households.length);
    const mig = (from, to) => xb.mig.filter(m => m.from === from && m.to === to && nowT - m.t < 12).length;
    const migAll = (from, to) => xb.migTotal[from + '>' + to] || 0;
    const tw = world.policies.tradeWith?.[n.id] || {};
    const twN = w.policies.tradeWith?.home || {};
    const R = xb.react[n.id] || { quota: {} };
    return {
      id: n.id, name: n.name, label: n.label, presetId: n.presetId,
      regime: w.regime?.label || n.label,
      gdpPc: gdpPcWorld, gdpPcHome: (world.stats.gdp || 0) / hN / fxH,
      unemployment: st.unemployment || 0, inflation: st.inflation || 0, fx: w.abroad.fx, households: w.households.length,
      satisfaction: st.avgSatisfaction || 0, gini: st.giniIncome || 0,
      exportsToN: (xb.pairEma['home>' + n.id] || 0) * fxH,          // наш экспорт к ним, в нашей валюте за месяц
      importsFromN: (xb.pairEma[n.id + '>home'] || 0) * fxH,
      migOut12: mig('home', n.id), migIn12: mig(n.id, 'home'), migOutTotal: migAll('home', n.id), migInTotal: migAll(n.id, 'home'),
      capOutTotal: (xb.capTotal['home>' + n.id] || 0) * fxH, capInTotal: (xb.capTotal[n.id + '>home'] || 0) * fxH,
      ourTariff: tw.tariff || 0, ourEmbargo: !!tw.embargo,
      theirTariff: twN.tariff || 0, theirEmbargo: !!twN.embargo,
      quotas: Object.keys(R.quota || {}).filter(g => R.quota[g] > nowT),
    };
  });
}
