// Единственный способ двигать деньги. Любой «счёт» — объект с полем cash:
// домохозяйство, фирма, world.gov, world.bank, world.abroad.
// Инвариант (проверяется тестом): сумма cash по всем счетам === world.moneySupply.

/** Перевод. kind — строка из FLOW_KINDS (schema.js), копится в world.flows за месяц. */
export function pay(world, from, to, amount, kind) {
  if (!(amount > 0)) return 0;
  // жёсткое бюджетное ограничение в связанном мире (там нет бездонной «заграницы», которая всё кредитует): казна платит только тем, что у неё есть;
  // иначе уход в минус — это печать денег без эмиссии, и страна, потерявшая доходы, уходит в гиперинфляцию
  if (from === world.gov && (world.abroad.plan || world.hardBudget) && from.cash < amount) { if (!(from.cash > 0)) return 0; amount = from.cash; }
  from.cash -= amount;
  to.cash += amount;
  world.flows[kind] = (world.flows[kind] || 0) + amount;
  return amount;
}

/** Создание денег: эмиссия ЦБ или выдача кредита. */
export function mint(world, to, amount, kind) {
  if (!(amount > 0)) return 0;
  to.cash += amount;
  world.moneySupply += amount;
  world.flows[kind] = (world.flows[kind] || 0) + amount;
  return amount;
}

/** Уничтожение денег: погашение кредита, изъятие ЦБ. */
export function burn(world, from, amount, kind) {
  if (!(amount > 0)) return 0;
  from.cash -= amount;
  world.moneySupply -= amount;
  world.flows[kind] = (world.flows[kind] || 0) + amount;
  return amount;
}

/** Сумма денег на всех счетах — для проверки инварианта. */
export function totalCash(world) {
  let s = world.gov.cash + world.bank.cash + world.abroad.cash + (world.finance?.pensionFund?.cash || 0);
  for (const h of world.households) s += h.cash;
  for (const f of world.firms) s += f.cash;
  return s;
}
