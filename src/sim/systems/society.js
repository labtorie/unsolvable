// Общество: обращения к власти (почта) и журнал явлений. Вторая волна, GDD §7 и §10.
// Фаза идёт после computeStats: видит готовые показатели месяца. Деньги двигает только через ledger:
// «согласование» при коррупции (бюджет → чиновники) и вывод капитала (фирма/домохозяйство → заграница).
import { pay } from '../ledger.js';
import { addEvent, clamp } from './util.js';
import {
  ensureMail, mrand, MAIL_CAP, ARCHIVE_TAIL, askMet, askText,
} from '../mailbox.js';
import { collect, money } from './letters.js';

export { phenomenaPhase } from './phenomena.js';

const EXPIRE = 8;            // месяцев на ответ (у влиятельных — меньше)
const PASS_EVERY = 2;        // как часто смотреть, не пора ли кому-то написать
const WARMUP = 24;           // первые два года мир устаканивается — писем нет
const MAX_NEW = 1;           // новых писем за один проход
// однотипные письма от разных просителей не чаще, чем раз в N месяцев
const GROUP_CD = { antitrust: 8, subsidy: 10, licensing: 6, tariff: 4 };
const MAX_THREATS = 3;       // открытых писем с угрозой и ждущих исполнения угроз одновременно

// ───────────── исполнение угроз ─────────────
const empOf = f => { let n = 0; for (const p in f.employees) n += f.employees[p]; return n; };
const fname = f => `«${f.name || 'Фирма №' + f.id}»`;

function execStrike(world, th, mult) {
  const p = th.profession;
  const hit = world.firms.filter(f => f.alive && f.owner === 'private' && (f.employees[p] || 0) > 0)
    .sort((a, b) => b.employees[p] - a.employees[p]);
  let total = 0;
  for (const f of hit) total += f.employees[p];
  if (!world.policies.strikeRight) return { text: 'После запрета забастовок профсоюз ограничился заявлением для прессы.', fizzled: true };
  if (!hit.length) return { text: 'Бастовать оказалось некому: работников этой профессии не осталось.', fizzled: true };
  const target = total * clamp(th.cover * mult, 0.2, 0.55);
  let got = 0, n = 0;
  for (const f of hit) {
    if (got >= target && n >= 1) break;
    f.strikeLeft = Math.max(f.strikeLeft || 0, th.months);
    for (const q in f.wageOffer) f.wageOffer[q] *= 1.03;
    got += f.employees[p]; n++;
  }
  return { text: `Забастовка: встали ${n} предприятий, ${Math.round(got)} работников по профессии «${p}». Выпуск на них вдвое ниже, зарплаты потом всё равно подорожают.`, n, got };
}

function execFlight(world, th, mult) {
  if ((world.policies.capitalControls || 0) >= 0.8) return { text: 'Контроль за вывозом капитала оказался крепче угрозы: деньги остались дома — пока.', fizzled: true };
  const frac = clamp(th.frac * mult, 0.1, 0.45);
  let moved = 0;
  if (th.firmId != null) {
    const f = world.firms.find(x => x.id === th.firmId);
    if (!f || !f.alive) return { text: 'Фирма успела исчезнуть раньше, чем угроза.', fizzled: true };
    moved = pay(world, f, world.abroad, Math.max(0, f.cash) * frac, 'capital_flight');
    return { text: `${fname(f)} вывела за границу ${money(moved)} — почти ${Math.round(frac * 100)}% оборотных средств. Совет директоров поблагодарил за создание условий.`, moved };
  }
  for (const h of world.households) {
    if (h.classId !== 'capitalists' || !(h.cash > 0)) continue;
    moved += pay(world, h, world.abroad, h.cash * frac, 'capital_flight');
  }
  return { text: `Капиталисты вывезли за границу ${money(moved)} наличных (${Math.round(frac * 100)}% их запасов). Родина по-прежнему в сердце, счёт — в другой юрисдикции.`, moved };
}

function execClosure(world, th, mult) {
  const frac = clamp(th.frac * mult, 0.15, 0.4);
  let targets = [];
  if (th.firmId != null) {
    const f = world.firms.find(x => x.id === th.firmId);
    if (f && f.alive) targets = [f];
  } else {
    targets = world.firms.filter(f => f.alive && f.owner === 'private' && f.industry === th.industry && f.capital > 0)
      .sort((a, b) => a.profitMargin - b.profitMargin).slice(0, Math.max(1, th.n || 1));
  }
  if (!targets.length) return { text: 'Закрывать оказалось нечего.', fizzled: true };
  for (const f of targets) f.capital *= 1 - frac;
  return { text: `Предприятия закрыты: ${targets.map(fname).join(', ')} сократили мощности на ${Math.round(frac * 100)}%. Работники ищут новое место, а просители — виноватых.`, n: targets.length };
}

function execScale(world, th, mult) {
  const frac = clamp(th.frac * mult, 0.1, 0.4);
  const small = world.firms.filter(f => f.alive && f.owner === 'private' && (f.marketShare || 0) < 0.15 && f.capital > 0)
    .sort((a, b) => a.profitMargin - b.profitMargin).slice(0, th.n || 4);
  if (!small.length) return { text: 'Сворачивать было нечего.', fizzled: true };
  for (const f of small) f.capital *= 1 - frac;
  return { text: `Мелкий бизнес свернул дело: у ${small.length} фирм мощности сократились на ${Math.round(frac * 100)}%.`, n: small.length };
}

function execCrunch(world, m, th, mult) {
  const until = world.t + Math.round(th.months * clamp(mult, 1, 1.5));
  m.crunch = { until, level: th.level };
  return { text: `Банки сжали кредит на ${until - world.t} мес.: выдача новых займов фирмам почти остановилась.` };
}

function executeThreat(world, m, L, mult) {
  const th = L.threat;
  let r;
  if (th.type === 'strike') r = execStrike(world, th, mult);
  else if (th.type === 'flight') r = execFlight(world, th, mult);
  else if (th.type === 'closure') r = execClosure(world, th, mult);
  else if (th.type === 'scale') r = execScale(world, th, mult);
  else if (th.type === 'crunch') r = execCrunch(world, m, th, mult);
  else r = { text: 'Угроза растворилась без последствий.', fizzled: true };
  m.execT = world.t;
  m.cool[L.key] = Math.max(m.cool[L.key] || 0, world.t + 24);   // после исполненной угрозы тот же проситель долго не пишет
  th.state = r.fizzled ? 'fizzled' : 'executed';
  L.executed = { t: world.t, text: r.text, fizzled: !!r.fizzled };
  if (!r.fizzled) m.stats.executed++;
  addEvent(world, r.fizzled ? 'mail_threat_fizzled' : 'mail_threat', r.fizzled ? `${L.sender.name} пригрозил, но не вышло: ${r.text}` : `${L.sender.name} не блефовал: ${r.text}`, { mail: L.id });
}

// ───────────── обработка очереди ─────────────
function archiveLetter(m, L) {
  const i = m.inbox.indexOf(L);
  if (i >= 0) m.inbox.splice(i, 1);
  m.archive.unshift(L);
  if (m.archive.length > ARCHIVE_TAIL) m.archive.length = ARCHIVE_TAIL;
}

function flushQueue(world, m) {
  if (!m.queue.length) return;
  const keep = [];
  for (const q of m.queue) {
    if (q.kind === 'bribe') {
      const offs = world.households.filter(h => h.profession === 'official' && h.status === 'employed');
      const amt = Math.min(q.amount, Math.max(0, world.gov.cash));
      if (amt > 0 && offs.length) {
        const each = amt / offs.length;
        for (const h of offs) { pay(world, world.gov, h, each, 'corruption'); h.incomeBySource.business += each; }
      }
    } else if (q.kind === 'expand') {
      if (world.t < q.due) { keep.push(q); continue; }
      const f = world.firms.find(x => x.id === q.firmId);
      if (f && f.alive) {
        f.capital *= 1 + q.frac;
        addEvent(world, 'mail_promise', `Обещание выполнено: ${fname(f)} расширила мощности на ${Math.round(q.frac * 100)}%. Редкий случай, когда лоббист сдержал слово — оно, правда, было недорогим`, { firm: f.id });
      }
    }
  }
  m.queue = keep;
}

function processPending(world, m) {
  if (!m.pending.length) return;
  const keep = [];
  for (const p of m.pending) {
    if (world.t < p.due) { keep.push(p); continue; }
    const L = m.archive.find(x => x.id === p.id);
    if (!L || !L.threat) continue;
    if (m.execT != null && world.t - m.execT < 3) { keep.push({ ...p, due: world.t + 1 }); continue; }   // не чаще одной угрозы в квартал
    if (askMet(world, L.ask)) {
      L.threat.state = 'spared';
      L.outcome = (L.outcome || '') + ' Просьбу в итоге выполнили сами — угроза снята.';
      m.stats.spared++;
      continue;
    }
    executeThreat(world, m, L, p.mult || 1);
    L.outcome = (L.outcome || '') + ' ' + L.executed.text;
  }
  m.pending = keep;
}

function processInbox(world, m) {
  for (const L of m.inbox.slice()) {
    if (askMet(world, L.ask)) {
      L.status = 'solved'; L.closedT = world.t; L.outcome = 'Вопрос решился без ответа: рычаг уже стоит как просили.';
      m.stats.solved++;
      archiveLetter(m, L);
      continue;
    }
    if (world.t >= L.expires) {
      L.status = 'expired'; L.closedT = world.t;
      m.stats.expired++;
      m.ins[L.key] = (m.ins[L.key] || 0) + 1;
      m.cool[L.key] = world.t + Math.round(8 * (1 - 0.5 * (L.clout || 0)));
      if (L.threat) {
        L.threat.state = 'waiting';
        L.outcome = 'Письмо осталось без ответа: молчание тоже ответ, и его прочли как отказ.';
        m.pending.push({ id: L.id, due: world.t, mult: 1 + 0.25 * Math.min(2, (m.ins[L.key] || 1) - 1) });
      } else L.outcome = 'Письмо осталось без ответа и истекло.';
      archiveLetter(m, L);
    }
  }
}

// ───────────── формирование писем ─────────────
function makeLetter(world, m, c) {
  const id = m.nextId++;
  const insist = m.ins[c.key] || 0;
  const L = {
    id, kind: c.kind, key: c.key, t: world.t, expires: world.t + (c.clout > 0.4 ? EXPIRE - 2 : EXPIRE),
    sender: c.sender, title: c.title, stated: c.stated, real: c.real, payer: c.payer,
    ask: { ...c.ask }, threat: c.threat ? { ...c.threat, state: 'open' } : null, promise: c.promise || null,
    monthly: c.monthly ?? null, lobby: !!c.lobby, stake: c.stake || 0, clout: c.clout || 0, sev: c.sev, insist,
    status: 'open',
  };
  L.ask.text = askText(world, L.ask);
  if (insist > 0) L.title += ` (письмо №${insist + 1})`;
  return L;
}

function generate(world, m) {
  const open = m.inbox.length;
  if (open >= MAIL_CAP) return;
  const cands = collect(world);
  const fresh = [];
  const threatsLive = m.inbox.filter(x => x.threat).length + m.pending.length;
  for (const c of cands) {
    if ((m.cool[c.key] ?? -1) > world.t) continue;
    if (m.inbox.some(x => x.key === c.key || (x.ask.lever === c.ask.lever && x.ask.industry === c.ask.industry && x.ask.value === c.ask.value))) continue;
    if (askMet(world, c.ask) || c.ask.value === c.ask.from) continue;
    if (c.threat && threatsLive >= MAX_THREATS) continue;
    if (GROUP_CD[c.kind] && (m.cool['grp:' + c.kind] ?? -1) > world.t) continue;
    // влиятельные пишут чаще: вес растёт с влиянием и настойчивостью
    c.score = c.sev * (1 + 1.2 * (c.clout || 0)) * (1 + 0.15 * (m.ins[c.key] || 0));
    fresh.push(c);
  }
  fresh.sort((a, b) => b.score - a.score);
  let sent = 0;
  for (const c of fresh) {
    if (sent >= MAX_NEW || m.inbox.length >= MAIL_CAP) break;
    const p = clamp(0.2 + 0.5 * c.score, 0.2, 0.9);
    if (mrand(m) > p) continue;
    const L = makeLetter(world, m, c);
    if (GROUP_CD[c.kind]) m.cool['grp:' + c.kind] = world.t + GROUP_CD[c.kind];
    m.inbox.push(L);
    m.stats.received++;
    sent++;
    const notable = (L.threat && L.sev >= 0.6) || L.sender.share >= 0.2 || L.clout >= 0.4;
    if (notable && m.lastEventT !== world.t) {
      m.lastEventT = world.t;
      addEvent(world, 'mail', `Письмо: ${L.sender.name} — «${L.title}»${L.threat ? ' (с угрозой)' : ''}. Почтовый ящик пополнился, нервы — нет`, { mail: L.id });
    }
  }
}

/** Обращения: формирование, истечение, последствия отказа/молчания. */
export function petitionsPhase(world, ctx) {
  const m = ensureMail(world);
  if (!m.enabled) return;
  flushQueue(world, m);
  if (m.crunch) {
    if (world.t < m.crunch.until) world.finance.bankCrunch = Math.max(world.finance.bankCrunch || 0, m.crunch.level);
    else m.crunch = null;
  }
  processInbox(world, m);
  processPending(world, m);
  if (world.t >= WARMUP && world.t % PASS_EVERY === 0) generate(world, m);
}
