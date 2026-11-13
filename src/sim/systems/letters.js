// Каталог писем (GDD §7): каждое письмо рождается из конкретного состояния модели.
// collect(world) возвращает кандидатов; отбор, лимиты и кулдауны — в society.js.
import { PROFESSIONS } from '../schema.js';
import { P, IND, GOODS } from './params.js';
import { clamp } from './util.js';

const PROF = Object.fromEntries(PROFESSIONS.map(p => [p.id, p.label]));
const r05 = x => Math.round(x * 20) / 20;
const r01 = x => Math.round(x * 100) / 100;
const pc = (x, d = 0) => `${(x * 100).toFixed(d)}%`;
export const money = x => {
  const a = Math.abs(x);
  return a >= 1e5 ? `${(x / 1e3).toFixed(0)} тыс` : a >= 1e4 ? `${(x / 1e3).toFixed(1)} тыс` : String(Math.round(x));
};
const empOf = f => { let n = 0; for (const p in f.employees) n += f.employees[p]; return n; };

// ───────────── обзор мира (один проход) ─────────────
export function survey(world) {
  const st = world.stats, pol = world.policies;
  const S = { world, st, pol, ind: {}, priv: [], totalRev: 0, popF: P.popFactor, avgWage: Math.max(1, st.avgWage || 1), gdp: Math.max(1, st.gdp || 1) };
  for (const g of GOODS) S.ind[g] = { g, label: IND[g].label, firms: [], rev: 0, profit: 0, emp: 0, loss: 0, top: null, margin: 0 };
  for (const f of world.firms) {
    if (!f.alive || f.owner !== 'private') continue;
    const a = S.ind[f.industry];
    a.firms.push(f); a.rev += f.revenue; a.profit += f.profit; a.emp += empOf(f);
    if (f.profitMargin < -0.01) a.loss++;
    if (!a.top || f.marketShare > a.top.marketShare) a.top = f;
    S.totalRev += f.revenue; S.priv.push(f);
  }
  for (const g of GOODS) { const a = S.ind[g]; a.margin = a.rev > 0 ? a.profit / a.rev : 0; }
  S.totalRev = Math.max(1, S.totalRev);
  S.households = () => Math.max(1, world.households.length);
  S.cls = id => st.classes?.find(c => c.id === id) || null;
  S.unemployedHH = 0;
  for (const p in st.employmentByProfession || {}) S.unemployedHH += st.employmentByProfession[p].unemployed || 0;
  return S;
}

function clout(S, f) {
  return clamp(Math.sqrt(Math.max(0, f.revenue) / S.totalRev) * 1.6 + 0.3 * (f.marketShare || 0), 0, 1);
}
const firmSender = (S, f, type = 'corp') => ({
  type, name: `«${f.name || 'Фирма №' + f.id}»`, firmId: f.id, industry: f.industry,
  people: empOf(f) * S.popF, share: f.revenue / S.totalRev, shareOf: 'выручки частных фирм',
});
const lowestProf = S => {
  let best = null;
  for (const p in S.st.employmentByProfession || {}) {
    const e = S.st.employmentByProfession[p];
    if (e.employed >= 5 && (!best || e.avgWage < best.w)) best = { id: p, w: e.avgWage, n: e.employed };
  }
  return best;
};

function ask(S, lever, value, from, extra = {}) {
  const dir = typeof value === 'number' ? (value > from ? 1 : value < from ? -1 : 0) : 0;
  return { lever, industry: null, value, from, dir, ...extra };
}

// ───────────── кандидаты ─────────────
export function collect(world) {
  const S = survey(world);
  const { st, pol } = S;
  const out = [];
  const add = c => out.push(c);
  const strikeOk = !!pol.strikeRight && pol.unionPower >= 0.2;
  const flightOk = (pol.capitalControls || 0) < 0.8;

  // 1. безработные просят пособие
  if (st.unemployment >= 0.08 && pol.unemploymentBenefit < 0.6) {
    const v = Math.min(1, r05(pol.unemploymentBenefit + 0.15)), cur = pol.unemploymentBenefit;
    const low = lowestProf(S);
    const rate = low ? v * S.avgWage / Math.max(1, low.w) : 0;
    const cost = (v - cur) * S.avgWage * S.unemployedHH;
    add({ kind: 'unemp_benefit', key: 'unemp_benefit', sev: clamp((st.unemployment - 0.08) / 0.1 + 0.3, 0.3, 1),
      sender: { type: 'class', name: 'Безработные и нищие', people: S.unemployedHH * S.popF, share: st.unemployment, shareOf: 'рабочей силы' },
      ask: ask(S, 'unemploymentBenefit', v, cur),
      title: 'Поднимите пособие по безработице',
      stated: `«Безработица ${pc(st.unemployment)}, пособие — ${pc(cur)} средней зарплаты, детям нечего есть».`,
      real: `Новое пособие — ${pc(v)} средней зарплаты` + (low ? `, то есть ${pc(rate)} от заработка самой низкооплачиваемой профессии («${PROF[low.id]}»): работать станет заметно менее выгодно.` : '.')
        + ` Получат ${S.unemployedHH} домохозяйств — те, кто остаётся без работы дольше.`,
      payer: 'Работающие: подоходный налог, соцвзносы или госдолг. Они писем не пишут — они на работе.',
      monthly: cost, threat: null });
  }

  // 2. МРОТ
  {
    const wk = S.cls('workers'), pr = S.cls('precariat');
    const cnt = (wk?.count || 0) + (pr?.count || 0);
    const sat = cnt ? ((wk?.satisfaction || 0) * (wk?.count || 0) + (pr?.satisfaction || 0) * (pr?.count || 0)) / cnt : 1;
    const low = lowestProf(S);
    if (cnt >= 10 && sat < 0.62 && pol.minWage < 1.0 && low) {
      const v = Math.min(1.5, r05(pol.minWage + 0.15)), cur = pol.minWage;
      const floor = v * P.baseWage * (world.calib.wbar || 1);
      const hit = [];
      for (const p in st.employmentByProfession) {
        const e = st.employmentByProfession[p];
        if (e.employed >= 3 && e.avgWage < floor * 1.2) hit.push(PROF[p]);
      }
      const union = strikeOk;
      add({ kind: 'wage_floor', key: 'wage_floor', sev: clamp((0.62 - sat) / 0.3 + 0.3, 0.3, 1),
        sender: union ? { type: 'union', name: 'Профсоюз рабочих и подёнщиков', people: cnt * S.popF, share: cnt / S.households(), shareOf: 'населения' }
          : { type: 'class', name: 'Рабочие и прекариат', people: cnt * S.popF, share: cnt / S.households(), shareOf: 'населения' },
        ask: ask(S, 'minWage', v, cur),
        title: 'Поднимите МРОТ',
        stated: `«Зарплат не хватает на корзину: довольны жизнью лишь ${pc(sat)} из нас».`,
        real: `Порог вырастет до ${Math.round(floor)} в месяц. Ниже него окажутся зарплаты: ${hit.length ? hit.join(', ') : 'почти ни у кого'}. Там работодатель либо поднимет оплату, либо перестанет нанимать — первыми за дверью окажутся новички и малоопытные.`,
        payer: 'Работодатели (через издержки), покупатели (через цены) и те, кого не наймут по новому порогу.',
        monthly: null,
        threat: union ? { type: 'strike', who: 'Профсоюз', profession: low.id, months: 3, cover: 0.4,
          text: `забастовка на крупнейших предприятиях, где заняты «${PROF[low.id]}»: три месяца с выпуском вдвое меньше` } : null });
    }
  }

  // 3. пенсии
  {
    const rt = S.cls('retired');
    if (rt && rt.count >= 8 && rt.satisfaction < 0.65 && pol.pensionLevel < 0.9) {
      const cur = pol.pensionLevel, v = Math.min(1, r05(cur + 0.1));
      const workers = Object.values(st.employmentByProfession || {}).reduce((a, e) => a + e.employed, 0);
      add({ kind: 'pension_up', key: 'pension_up', sev: clamp((0.65 - rt.satisfaction) / 0.25 + 0.3, 0.3, 1),
        sender: { type: 'class', name: 'Пенсионеры', people: rt.count * S.popF, share: rt.share, shareOf: 'населения' },
        ask: ask(S, 'pensionLevel', v, cur),
        title: 'Проиндексируйте пенсии',
        stated: `«Мы всю жизнь работали; нынешняя пенсия — ${pc(cur)} средней зарплаты — это не жизнь».`,
        real: `Пенсия вырастет до ${pc(v)} средней зарплаты. Сейчас на одного пенсионера приходится ${(workers / Math.max(1, rt.count)).toFixed(1)} работающих; больше их не станет, а вот избирателей — в смысле писем — прибавилось бы.`,
        payer: 'Работающие и будущие налогоплательщики: либо взносы, либо долг, который отдавать их детям.',
        monthly: (v - cur) * S.avgWage * rt.count, threat: null });
    }
  }

  // 4. роботы: налог или запрет
  if (pol.techBan !== 'automation' && pol.techBan !== 'all') {
    let best = null;
    for (const p in world.tech?.byProfession || {}) {
      const b = world.tech.byProfession[p];
      const e = st.employmentByProfession?.[p];
      if (!e) continue;
      const share = b.displaced / Math.max(5, e.employed + e.unemployed);
      if (b.displaced >= 4 && share >= 0.04 && (!best || share > best.share)) best = { p, share, disp: b.displaced, e, b };
    }
    if (best) {
      const heavy = best.share >= 0.12 && pol.robotTax >= 0.3;
      const union = strikeOk;
      const name = union ? `Профсоюз: ${PROF[best.p]}` : `Работники: ${PROF[best.p]}`;
      const saved = best.disp * (best.e.avgWage || S.avgWage) * 0.6;
      const sender = { type: union ? 'union' : 'class', name, people: (best.e.employed + best.e.unemployed) * S.popF,
        share: (best.e.employed + best.e.unemployed) / S.households(), shareOf: 'населения' };
      const threat = union ? { type: 'strike', who: 'Профсоюз', profession: best.p, months: 3, cover: 0.4,
        text: `забастовка там, где заняты «${PROF[best.p]}»: три месяца вполсилы` } : null;
      if (heavy) {
        add({ kind: 'robot_ban', key: 'robot_ban', sev: clamp(best.share * 4, 0.4, 1), sender, threat,
          ask: ask(S, 'techBan', 'automation', pol.techBan),
          title: 'Запретите автоматизацию',
          stated: `«Машины отнимают у нас хлеб: за год потеряли работу ${best.disp} домохозяйств по профессии «${PROF[best.p]}»».`,
          real: `Запрет остановит новые внедрения, но не вернёт уже уволенных: ${world.tech.count} технологий в мире уже есть. Зато производительность отстающих отраслей застынет, а IT-фирмы пойдут искать клиентов за границей.`,
          payer: 'Все покупатели (через цены, которые не упадут) и отрасли, которые не смогут модернизироваться.', monthly: null });
      } else {
        const v = Math.min(1, r05(pol.robotTax + 0.25));
        add({ kind: 'robot_tax', key: 'robot_tax', sev: clamp(best.share * 4, 0.3, 0.9), sender, threat,
          ask: ask(S, 'robotTax', v, pol.robotTax),
          title: 'Введите налог на роботов',
          stated: `«За год из «${PROF[best.p]}» вытеснено ${best.disp} домохозяйств. Пусть машины платят за нас».`,
          real: `Налог ${pc(v)} от сэкономленных зарплат даст бюджету порядка ${money((v - pol.robotTax) * saved)} в месяц и замедлит внедрение: автоматизировать станет не так выгодно, и часть рабочих мест просто задержится на год-другой.`,
          payer: 'Фирмы-внедренцы и, в конечном счёте, покупатели.', monthly: -(v - pol.robotTax) * saved });
      }
    }
  }

  // 5-6. отраслевые лобби
  for (const g of GOODS) {
    const a = S.ind[g];
    if (a.firms.length < 2 || IND[g].id === 'security') continue;
    const ip = pol.industry[g];
    const lobby = {
      type: 'lobby', name: `Союз производителей: ${a.label}`, industry: g,
      people: a.emp * S.popF, share: a.rev / S.totalRev, shareOf: 'выручки частных фирм',
    };
    const weak = () => a.firms.slice().sort((x, y) => x.profitMargin - y.profitMargin);
    // пошлина против импорта
    const impS = world.ind?.[g]?.impShare || 0;
    if (IND[g].tradable && impS >= 0.15 && (a.margin < 0.04 || a.loss / a.firms.length >= 0.3) && ip.tariff < 0.8) {
      const cur = ip.tariff, v = Math.min(1, r05(cur + 0.25));
      const mk = world.markets[g];
      const consumers = impS * (v - cur) / (1 + cur);
      const gain = (mk.imports || 0) * (mk.price || 1) * (v - cur) * 0.6;
      add({ kind: 'tariff', key: 'tariff:' + g, sev: clamp(impS * 1.5 + (0.04 - a.margin) * 4, 0.3, 1), lobby: true, stake: 0.03 * a.rev + 1,
        sender: lobby,
        ask: ask(S, 'tariff', v, cur, { industry: g, indLabel: a.label }),
        title: `Введите пошлину на импорт: ${a.label.toLowerCase()}`,
        stated: `«Нас душит дешёвый импорт (${pc(impS)} рынка). Защитите отечественного производителя — и национальную безопасность заодно».`,
        real: `Отрасль заработает на пошлине примерно ${money(0.03 * a.rev)} в месяц, бюджет — ещё ${money(gain)}; покупателям цена вырастет на ~${pc(consumers, 1)}. Рентабельность отрасли сейчас ${pc(a.margin, 1)}: защита нужна не столько заводам, сколько их нынешним собственникам.`,
        payer: 'Покупатели всех отраслей, использующих этот товар. Их письма не дойдут: они рассеяны по всей стране.',
        monthly: -gain,
        threat: { type: 'closure', who: 'Союз', industry: g, n: 2, frac: 0.25, text: `закрыть два самых слабых предприятия отрасли: мощности сократятся на 25%` } });
    }
    // субсидия
    if (a.margin < -0.02 && a.firms.length >= 2 && ip.subsidy < 0.2 && ip.ownership !== 'state') {
      const cur = ip.subsidy, v = r01(Math.min(0.5, cur + 0.08));
      add({ kind: 'subsidy', key: 'subsidy:' + g, sev: clamp(-a.margin * 6 + 0.3, 0.3, 1), lobby: true, stake: (v - cur) * a.rev + 1,
        sender: lobby,
        ask: ask(S, 'subsidy', v, cur, { industry: g, indLabel: a.label }),
        title: `Дайте субсидию: ${a.label.toLowerCase()}`,
        stated: `«Отрасль работает в убыток (${pc(a.margin, 1)} выручки) и держится на энтузиазме. Дайте субсидию, иначе закроем завод».`,
        real: `Субсидия ${pc(v)} от цены обойдётся примерно в ${money((v - cur) * a.rev)} в месяц и покроет ${a.margin < 0 ? Math.min(100, Math.round(100 * (v - cur) / -a.margin)) : 100}% убытка. Выручит тех, кто и так убыточен, и закрепит их на рынке.`,
        payer: 'Налогоплательщики — все, кроме получателей.',
        monthly: (v - cur) * a.rev,
        threat: { type: 'closure', who: 'Союз', industry: g, n: 2, frac: 0.25, text: 'закрыть два самых слабых предприятия отрасли: мощности сократятся на 25%' } });
    }
    // лицензирование: ради потребителей
    const top = a.top;
    if (top && top.marketShare >= 0.3 && ip.ownership === 'free' && g !== 'security' && (world.ind?.[g]?.lastEntryT ?? -99) >= world.t - 24 && a.firms.length >= 3 && !IND[g].resource) {
      add({ kind: 'licensing', key: 'licensing:' + g, sev: clamp(top.marketShare, 0.3, 0.8), lobby: true, stake: 0.03 * top.revenue + 1, clout: clout(S, top),
        sender: firmSender(S, top),
        ask: ask(S, 'ownership', 'licensed', ip.ownership, { industry: g, indLabel: a.label }),
        title: `Введите лицензирование: ${a.label.toLowerCase()}`,
        stated: '«Ради защиты потребителей от недобросовестных новичков и некачественных услуг».',
        real: `В отрасли за последние два года появился новый участник; у «${top.name}» ${pc(top.marketShare)} рынка. Лицензии выдадут тем, кто уже на рынке: новичкам барьер, ей — спокойный сон.`,
        payer: 'Покупатели (меньше конкуренции — выше цены) и будущие предприниматели.', monthly: null, threat: null,
        promise: null });
    }
  }

  // 7. антимонопольный закон
  for (const g of GOODS) {
    const f = S.ind[g].top;
    if (!f || g === 'security') continue;
    const thr = pol.antitrustThreshold;
    const over = f.marketShare >= thr - 0.05;
    const dismantle = pol.antitrustBreakup && f.marketShare >= thr;
    if (!(thr < 0.95 && over && f.marketShare >= 0.3) && !dismantle) continue;
    const cl = clout(S, f);
    if (!dismantle && cl < 0.22 && f.marketShare < 0.5) continue;   // мелкие монополисты не пишут: им не по рангу
    const cur = dismantle ? true : thr;
    const v = dismantle ? false : Math.min(1, r05(Math.max(thr + 0.2, f.marketShare + 0.05)));
    const a = S.ind[g];
    add({ kind: 'antitrust', key: 'antitrust:' + g, sev: clamp(f.marketShare + 0.2, 0.4, 1), lobby: true, stake: Math.max(1, 0.03 * f.revenue), clout: cl,
      sender: firmSender(S, f),
      ask: dismantle ? ask(S, 'antitrustBreakup', false, true) : ask(S, 'antitrustThreshold', v, thr),
      title: dismantle ? 'Не дробите нас' : 'Смягчите антимонопольный закон',
      stated: dismantle ? '«Эффект масштаба — достояние страны; дробление его уничтожит».' : '«Крупные игроки эффективнее: эффект масштаба и дешёвый товар для народа».',
      real: `Доля фирмы в отрасли «${a.label}» — ${pc(f.marketShare)}, рентабельность ${pc(f.profitMargin, 1)} против ${pc(a.margin, 1)} по отрасли. Без ограничений она будет поглощать конкурентов; цена товара для покупателя — вторая по важности статья.`,
      payer: 'Покупатели (цены) и конкуренты, которых скупят до того, как они станут конкурентами.',
      monthly: null,
      threat: flightOk ? { type: 'flight', who: `«${f.name}»`, firmId: f.id, frac: 0.25, text: 'вывести за границу четверть оборотных средств ("переехать туда, где ценят бизнес")' } : null,
      promise: { text: 'построить новый завод (мощности +10%)', frac: 0.1 } });
  }

  // 8. патенты
  if (pol.patentYears < 30 && world.tech?.list?.length) {
    const own = new Map();
    for (const t of world.tech.list) {
      if (t.ownerFirmId == null || t.dead || !(t.patentUntil > world.t)) continue;
      const rec = own.get(t.ownerFirmId) || { n: 0, ad: 0, soon: 0 };
      rec.n++; rec.ad += t.adopters.length; if (t.patentUntil - world.t <= 36) rec.soon++;
      own.set(t.ownerFirmId, rec);
    }
    let bestF = null, bestR = null;
    for (const [id, r] of own) {
      if (!r.soon) continue;
      const f = world.firms.find(x => x.id === id);
      if (f && f.alive && f.owner === 'private' && (!bestR || r.ad > bestR.ad)) { bestF = f; bestR = r; }
    }
    if (bestF && bestR.ad >= 2) {
      const v = Math.min(30, pol.patentYears + 5);
      add({ kind: 'patent', key: 'patent:' + bestF.id, sev: clamp(0.3 + bestR.ad / 20, 0.3, 0.9), lobby: true, stake: 0.05 * bestF.revenue + 1, clout: clout(S, bestF),
        sender: firmSender(S, bestF),
        ask: ask(S, 'patentYears', v, pol.patentYears),
        title: 'Продлите патенты',
        stated: '«Без защиты изобретений никто не будет изобретать. Каждая лицензия — это вклад в прогресс».',
        real: `У фирмы ${bestR.n} действующих патентов, которыми пользуются ${bestR.ad} фирм-клиентов; ближайшие истекают в течение трёх лет. Продление означает ещё несколько лет платы за лицензии — и ещё несколько лет без конкуренции.`,
        payer: 'Фирмы-клиенты (лицензии) и их покупатели; свободные копии появятся позже.', monthly: null,
        threat: flightOk ? { type: 'flight', who: `«${bestF.name}»`, firmId: bestF.id, frac: 0.25, text: 'перенести исследования и четверть оборотных средств за границу' } : null,
        promise: { text: 'расширить лабораторию (мощности +10%)', frac: 0.1 } });
    }
  }

  // 9. платформы: потолок комиссии
  if (pol.platformFeeCap < 0.5) {
    let pf = null;
    for (const f of S.priv) if (f.platform && f.platform.users >= 0.2 && (!pf || f.platform.users > pf.platform.users)) pf = f;
    if (pf) {
      const cur = pol.platformFeeCap, v = r01(Math.min(0.5, cur + 0.1));
      add({ kind: 'platform_cap', key: 'platform_cap:' + pf.id, sev: clamp(pf.platform.users, 0.3, 0.9), lobby: true, stake: 0.04 * pf.revenue + 1, clout: clout(S, pf),
        sender: firmSender(S, pf),
        ask: ask(S, 'platformFeeCap', v, cur),
        title: 'Поднимите потолок комиссии платформ',
        stated: '«Наши сервисы обслуживают миллионы; потолок комиссии убивает инновации».',
        real: `Через платформу идёт ${pc(pf.platform.users)} рынка отрасли «${IND[pf.platform.industry]?.label || ''}», комиссия сейчас ${pc(pf.platform.fee)}. Выросший потолок — это доля с каждой сделки тех, кто уйти уже не может.`,
        payer: 'Продавцы и подрядчики платформы; затем — покупатели.', monthly: null,
        threat: flightOk ? { type: 'flight', who: `«${pf.name}»`, firmId: pf.id, frac: 0.25, text: 'вывести за границу четверть оборотных средств' } : null });
    }
  }
  // подрядчики просят считать их работниками
  if (!pol.gigWorkersAreEmployees && (st.gigShare || 0) >= 0.05) {
    const gigs = world.tech?.gigs || Math.round(st.gigShare * 100);
    add({ kind: 'gig_employees', key: 'gig_employees', sev: clamp(st.gigShare * 4, 0.3, 0.8),
      sender: { type: 'class', name: 'Подрядчики платформ', people: gigs * S.popF, share: st.gigShare, shareOf: 'занятых' },
      ask: ask(S, 'gigWorkersAreEmployees', true, false),
      title: 'Признайте нас наёмными работниками',
      stated: '«Нас называют партнёрами, но график, тариф и увольнение определяет платформа».',
      real: 'Платформа начнёт платить соцвзносы, МРОТ и выходное пособие: подёнщик станет дороже; часть заказов исчезнет вместе с «партнёрством».',
      payer: 'Платформы (издержки) и клиенты (цены).', monthly: null, threat: null });
  }

  // 10. банки
  {
    const fin = world.finance, bank = world.bank;
    const loans = Math.max(1, bank.loans);
    const ratio = (fin.bankCapital || 0) / loans;
    const failedRecently = world.t - (fin.bankFailedT ?? -999) < 12;
    if ((fin.bankCrunch >= 0.3 || ratio < 0.025 || failedRecently) && pol.bailoutPolicy !== 'always') {
      const v = pol.bailoutPolicy === 'never' ? 'systemic' : 'always';
      if (v === 'systemic' || failedRecently) {
        const need = Math.max(0, 0.04 * loans - (fin.bankCapital || 0));
        add({ kind: 'bank_bailout', key: 'bank_bailout', sev: clamp(0.4 + fin.bankCrunch, 0.4, 1), lobby: true, stake: loans * 0.001,
          sender: { type: 'bank', name: 'Ассоциация банков', people: 0, share: loans / (S.gdp * 12), shareOf: 'годового ВВП (кредиты)' },
          ask: ask(S, 'bailoutPolicy', v, pol.bailoutPolicy),
          title: v === 'systemic' ? 'Спасайте системно значимые банки' : 'Спасайте нас всегда',
          stated: '«Мы системно значимы: если упадём, потянем за собой всех. Спасите — и мы продолжим кредитовать экономику».',
          real: `Капитал банка — ${pc(ratio, 1)} выданных кредитов (норма ≈4%), кредитное сжатие ${pc(fin.bankCrunch)}. Спасение обойдётся порядка ${money(need)} разово, а ожидание «нас всё равно спасут» (сейчас ${(fin.moralHazard || 0).toFixed(2)}) разгонит следующий пузырь.`,
          payer: 'Все налогоплательщики. Вкладчики и акционеры банка — только потерявшие меньше.', monthly: need / 12,
          threat: { type: 'crunch', who: 'Банки', months: 6, level: 0.55, text: 'сжать кредит на полгода: новые займы фирмам станут почти недоступны' } });
      }
    }
    // налог на сделки
    if (pol.financialTransactionTax > 0 && (world.flows.ftt || 0) > 0) {
      add({ kind: 'ftt_cut', key: 'ftt_cut', sev: 0.35, lobby: true, stake: (world.flows.ftt || 0) * 0.5 + 1,
        sender: { type: 'fin', name: 'Биржевое сообщество', people: 0, share: S.ind.finance.rev / S.totalRev, shareOf: 'выручки частных фирм' },
        ask: ask(S, 'financialTransactionTax', 0, pol.financialTransactionTax),
        title: 'Отмените налог на финансовые сделки',
        stated: '«Налог душит ликвидность. Рынок без ликвидности — это просто очередь».',
        real: `Налог приносит ${money(world.flows.ftt)} в месяц. Без него сделок станет больше, пузырей — тоже; зато брокерские комиссии вырастут.`,
        payer: 'Бюджет (потеря поступлений) и те, кому достанется следующий пузырь.', monthly: world.flows.ftt, threat: null });
    }
  }

  // 11. капиталисты: налоги
  {
    const cap = S.cls('capitalists');
    if (cap && cap.count >= 3 && cap.satisfaction < 0.6) {
      let lever = null, v, cur, flowKind, tag;
      if (pol.wealthTax > 0) { lever = 'wealthTax'; cur = pol.wealthTax; v = 0; flowKind = 'tax_wealth'; tag = 'налог на богатство'; }
      else if (pol.dividendTax > 0.25) { lever = 'dividendTax'; cur = pol.dividendTax; v = r05(Math.max(0, cur - 0.1)); flowKind = 'tax_dividend'; tag = 'налог на дивиденды'; }
      else if (pol.corpTax > 0.3) { lever = 'corpTax'; cur = pol.corpTax; v = r05(Math.max(0.05, cur - 0.05)); flowKind = 'tax_corp'; tag = 'налог на прибыль'; }
      if (lever) {
        let wsum = 0;
        for (const c of st.classes) wsum += c.avgWealth * c.count;
        const wshare = wsum > 0 ? cap.avgWealth * cap.count / wsum : 0;
        const lost = (world.flows[flowKind] || 0) * (cur > 0 ? (cur - v) / cur : 0);
        add({ kind: 'capital_relief', key: 'capital_relief:' + lever, sev: clamp((0.6 - cap.satisfaction) / 0.2 + 0.3, 0.3, 1),
          sender: { type: 'class', name: 'Капиталисты', people: cap.count * S.popF, share: wshare, shareOf: 'частного богатства' },
          ask: ask(S, lever, v, cur),
          title: `Снизьте ${tag}`,
          stated: `«Налоги душат инвестиции; капитал, как известно, трусоват — ему нужны стимулы».`,
          real: `У ${cap.count} домохозяйств-капиталистов ${pc(wshare)} частного богатства. Снижение вернёт им порядка ${money(lost)} в месяц; инвестиции вырастут настолько, насколько они сами захотят.`,
          payer: 'Бюджет — то есть пенсионеры, больные, школьники и все остальные получатели услуг.', monthly: lost,
          threat: flightOk ? { type: 'flight', who: 'Капиталисты', cls: 'capitalists', frac: 0.2, text: 'вывести за границу около 20% наличных у крупных владельцев' } : null });
      }
    }
  }

  // 12. мелкий бизнес: взносы и регулирование
  {
    const small = S.priv.filter(f => (f.marketShare || 0) < 0.15);
    if (small.length >= 8) {
      let rev = 0, pr = 0, loss = 0, wb = 0, emp = 0;
      for (const f of small) { rev += f.revenue; pr += f.profit; if (f.profitMargin < -0.01) loss++; wb += f.wageBill; emp += empOf(f); }
      const margin = rev > 0 ? pr / rev : 0, lossShare = loss / small.length;
      if ((margin < 0.02 || lossShare >= 0.35) && pol.payrollTax >= 0.12) {
        const cur = pol.payrollTax, v = r01(Math.max(0.05, cur - 0.05));
        add({ kind: 'payroll_cut', key: 'payroll_cut', sev: clamp(lossShare + (0.02 - margin) * 5, 0.3, 1),
          sender: { type: 'smallbiz', name: 'Мелкий бизнес', people: emp * S.popF, share: rev / S.totalRev, shareOf: 'выручки частных фирм' },
          ask: ask(S, 'payrollTax', v, cur),
          title: 'Снизьте соцвзносы с зарплат',
          stated: `«Каждая вторая лавка в убытке (${pc(lossShare)} малых фирм), взносы — на ${pc(cur)} от зарплаты. Мы нанимаем людей, а не налоговую».`,
          real: `Малые фирмы сэкономят около ${money((cur - v) * wb * 0.8)} в месяц. Бюджет недополучит ${money((cur - v) * S.st.wageShare * S.gdp * 0.8)} со всех работодателей сразу — включая тех, кто в просьбе не нуждается.`,
          payer: 'Бюджет, из которого платят пенсии и пособия; крупные фирмы получат скидку заодно.', monthly: (cur - v) * S.st.wageShare * S.gdp * 0.8,
          threat: { type: 'scale', who: 'Мелкий бизнес', n: 4, frac: 0.12, text: 'свернуть производство: у четырёх малых фирм мощности сократятся на 12%' } });
      } else if (pol.regulationBurden >= 0.5 && (margin < 0.04 || lossShare >= 0.3)) {
        const cur = pol.regulationBurden, v = r05(Math.max(0, cur - 0.2));
        add({ kind: 'regulation_cut', key: 'regulation_cut', sev: clamp(lossShare + 0.2, 0.3, 0.8),
          sender: { type: 'smallbiz', name: 'Мелкий бизнес', people: emp * S.popF, share: rev / S.totalRev, shareOf: 'выручки частных фирм' },
          ask: ask(S, 'regulationBurden', v, cur),
          title: 'Сократите проверки и разрешения',
          stated: '«Проверяющих больше, чем клиентов. Чтобы открыть ларёк, нужно пройти восемь кабинетов».',
          real: `Малый бизнес сейчас приносит ${pc(margin, 1)} выручки прибыли. Меньше регулирования — ниже издержки и порог входа, но и меньше защиты от вредных выбросов и фальшивой колбасы.`,
          payer: 'Потребители (меньше контроля качества) и окружающая среда.', monthly: null,
          threat: { type: 'scale', who: 'Мелкий бизнес', n: 4, frac: 0.12, text: 'свернуть производство: у четырёх малых фирм мощности сократятся на 12%' } });
      }
    }
  }
  return out;
}
