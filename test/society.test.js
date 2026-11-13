// Общество (GDD §7, §10): обращения к власти и журнал явлений.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, step } from '../src/sim/index.js';
import { tick } from '../src/sim/tick.js';
import { totalCash } from '../src/sim/ledger.js';
import { applyPreset } from '../src/sim/presets.js';
import { ensureMail, acceptLetter, refuseLetter, askMet, bribeFor } from '../src/sim/mailbox.js';
import { collect } from '../src/sim/systems/letters.js';

const run = (w, n) => { for (let i = 0; i < n; i++) step(w); return w; };
const game = (seed = 3) => newGame({ seed, preset: 'industrial', neighbors: [] });
const drift = w => Math.abs(totalCash(w) - w.moneySupply) / Math.max(1, w.moneySupply);

const arch = (w, L) => w.mail.archive.find(x => x.id === L.id);

// минимальное письмо с заданной угрозой — для проверки исполнения
function inject(w, extra = {}) {
  const m = ensureMail(w);
  const L = {
    id: m.nextId++, kind: 'test', key: 'test:' + m.nextId, t: w.t, expires: w.t + 8,
    sender: { type: 'union', name: 'Тестовый союз', people: 1, share: 0.1, shareOf: 'населения' },
    title: 'Тест', stated: '', real: '', payer: '', ask: { lever: 'minWage', industry: null, value: 1.4, from: w.policies.minWage, dir: 1, text: '' },
    threat: null, promise: null, monthly: null, lobby: false, stake: 0, clout: 0, sev: 1, insist: 0, status: 'open', ...extra,
  };
  m.inbox.push(L);
  return L;
}

test('общество: инвариант денег при почте, принятии, отказе и исполнении угроз (15 лет)', { timeout: 120000 }, () => {
  const w = game(2);
  w.gov.corruption = 0.5;
  let maxErr = 0, k = 0;
  for (let i = 0; i < 180; i++) {
    step(w);
    if (w.mail.inbox.length && i % 3 === 0) {
      const L = w.mail.inbox[0];
      (k++ % 2 ? acceptLetter : refuseLetter)(w, L.id);
    }
    maxErr = Math.max(maxErr, drift(w));
  }
  assert.ok(w.mail.stats.received > 3, 'письма приходят: ' + w.mail.stats.received);
  assert.ok(maxErr < 1e-9, 'деньги сходятся: ' + maxErr);
});

test('общество: детерминизм и чистый JSON', { timeout: 120000 }, () => {
  const play = () => {
    const w = game(5);
    for (let i = 0; i < 100; i++) { step(w); if (w.mail.inbox.length && i % 4 === 0) refuseLetter(w, w.mail.inbox[0].id); }
    return w;
  };
  const a = play(), b = play();
  assert.deepEqual(a.mail, b.mail);
  assert.deepEqual(a.phenomena, b.phenomena);
  assert.equal(a.rngState, b.rngState);
  const copy = structuredClone(a);
  assert.deepEqual(JSON.parse(JSON.stringify(a.mail)), copy.mail);
  assert.deepEqual(JSON.parse(JSON.stringify(a.phenomena)), copy.phenomena);
});

test('общество: старое сохранение без mail и phenomena мигрирует', () => {
  const w = run(game(), 30);
  delete w.mail; delete w.phenomena;
  step(w);
  assert.ok(Array.isArray(w.mail.inbox) && w.mail.nextId >= 1);
  assert.ok(w.phenomena.active && Array.isArray(w.phenomena.log));
});

test('письма: безработица → пособие; монополист → смягчить антимонопольный закон', () => {
  const w = run(game(), 40);
  w.stats.unemployment = 0.16;
  let c = collect(w).find(x => x.kind === 'unemp_benefit');
  assert.ok(c, 'письмо о пособии');
  assert.equal(c.ask.lever, 'unemploymentBenefit');
  assert.ok(c.ask.value > w.policies.unemploymentBenefit);
  assert.match(c.real, /пособие/i);
  // монополист
  const f = w.firms.filter(x => x.alive && x.owner === 'private').sort((a, b) => b.revenue - a.revenue)[0];
  f.marketShare = 0.7;
  c = collect(w).find(x => x.kind === 'antitrust' && x.sender.firmId === f.id);
  assert.ok(c, 'письмо от монополиста');
  assert.equal(c.ask.lever, 'antitrustThreshold');
  assert.ok(c.ask.value > w.policies.antitrustThreshold);
  assert.ok(c.lobby && c.stake > 0);
});

test('письма: банк просит спасения при кредитном сжатии, импортозамещение просит пошлину', () => {
  const w = run(game(), 40);
  w.policies.bailoutPolicy = 'never';
  w.finance.bankCrunch = 0.6;
  assert.ok(collect(w).some(x => x.kind === 'bank_bailout' && x.ask.value === 'systemic'));
  // отрасль, проигрывающая импорту
  w.ind.manufacturing.impShare = 0.4;
  for (const f of w.firms) if (f.alive && f.industry === 'manufacturing' && f.owner === 'private') { f.profit = -0.05 * f.revenue; f.profitMargin = -0.05; }
  const t = collect(w).find(x => x.kind === 'tariff' && x.ask.industry === 'manufacturing');
  assert.ok(t, 'письмо о пошлине');
  assert.ok(t.ask.value > w.policies.industry.manufacturing.tariff);
  assert.equal(t.threat.type, 'closure');
});

test('почта: принять — рычаг меняется; при коррупции лобби дороже; письма не дублируются и не копятся', { timeout: 120000 }, () => {
  const w = run(game(4), 40);
  w.gov.corruption = 0.45;
  const L = inject(w, { lobby: true, stake: 100, ask: { lever: 'antitrustThreshold', industry: null, value: 0.9, from: 0.4, dir: 1, text: '' } });
  const bribe = bribeFor(w, L);
  assert.ok(bribe > 0, 'надбавка за согласование видна');
  w.gov.cash = Math.max(w.gov.cash, bribe * 2);
  const cashBefore = w.gov.cash;
  assert.ok(acceptLetter(w, L.id));
  assert.equal(w.policies.antitrustThreshold, 0.9);
  assert.equal(arch(w, L).status, 'accepted');
  tick(w);
  assert.ok(w.flows.corruption > 0 && w.gov.cash < cashBefore, 'казна заплатила чиновникам');
  assert.ok(drift(w) < 1e-9);
  // лимит открытых и отсутствие дублей
  const w2 = run(game(4), 140);
  assert.ok(w2.mail.inbox.length <= 8);
  const keys = w2.mail.inbox.map(x => x.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('угрозы не блеф: отказ или молчание → забастовка, вывод капитала, закрытие, сжатие кредита', { timeout: 120000 }, () => {
  // забастовка (отказ)
  let w = run(game(), 30);
  w.policies.strikeRight = true;
  let L = inject(w, { threat: { type: 'strike', who: 'Профсоюз', profession: 'manual', months: 3, cover: 0.4, text: 'забастовка', state: 'open' } });
  refuseLetter(w, L.id);
  let struck = 0;
  for (let i = 0; i < 4; i++) { tick(w); struck = Math.max(struck, w.firms.filter(f => f.alive && f.strikeLeft > 0).length); }
  assert.ok(struck > 0, 'на фирмах началась забастовка');
  assert.equal(arch(w, L).threat.state, 'executed');
  assert.ok(w.mail.stats.executed >= 1 && w.events.some(e => e.type === 'mail_threat'));

  // вывод капитала (молчание до истечения)
  w = run(game(), 30);
  const f = w.firms.filter(x => x.alive && x.owner === 'private').sort((a, b) => b.cash - a.cash)[0];
  w.policies.capitalControls = 0;
  L = inject(w, { expires: w.t + 2, threat: { type: 'flight', who: f.name, firmId: f.id, frac: 0.3, text: 'вывести', state: 'open' } });
  const ab0 = w.abroad.cash, cash0 = f.cash;
  let flight = 0;
  for (let i = 0; i < 5; i++) { tick(w); flight += w.flows.capital_flight; assert.ok(drift(w) < 1e-9); }
  assert.equal(arch(w, L).status, 'expired');
  assert.equal(arch(w, L).threat.state, 'executed');
  assert.ok(flight > 0 && w.abroad.cash > ab0 && f.cash < cash0, 'деньги ушли за границу');

  // контроль капитала делает угрозу невыполнимой — и это честно записано
  w = run(game(), 30);
  const f2 = w.firms.filter(x => x.alive && x.owner === 'private')[0];
  w.policies.capitalControls = 1;
  L = inject(w, { threat: { type: 'flight', who: 'x', firmId: f2.id, frac: 0.3, text: 'вывести', state: 'open' } });
  refuseLetter(w, L.id);
  for (let i = 0; i < 4; i++) tick(w);
  assert.equal(arch(w, L).threat.state, 'fizzled');

  // закрытие
  w = run(game(), 30);
  const f3 = w.firms.filter(x => x.alive && x.owner === 'private' && x.industry === 'manufacturing')[0];
  const cap0 = f3.capital;
  L = inject(w, { threat: { type: 'closure', who: 'Союз', firmId: f3.id, frac: 0.3, text: 'закрыть', state: 'open' } });
  refuseLetter(w, L.id);
  for (let i = 0; i < 4; i++) tick(w);
  assert.ok(f3.capital < 0.85 * cap0, 'мощности сокращены');

  // сжатие кредита
  w = run(game(), 30);
  L = inject(w, { threat: { type: 'crunch', who: 'Банки', months: 6, level: 0.6, text: 'сжать', state: 'open' } });
  refuseLetter(w, L.id);
  for (let i = 0; i < 4; i++) tick(w);
  assert.ok(w.finance.bankCrunch >= 0.55, 'кредит сжат: ' + w.finance.bankCrunch);

  // выполненная просьба снимает угрозу
  w = run(game(), 30);
  L = inject(w, { threat: { type: 'strike', who: 'Профсоюз', profession: 'manual', months: 3, cover: 0.4, text: 'забастовка', state: 'open' } });
  refuseLetter(w, L.id);
  w.policies.minWage = 1.4;
  for (let i = 0; i < 4; i++) tick(w);
  assert.equal(arch(w, L).threat.state, 'spared');
  assert.ok(askMet(w, arch(w, L).ask));
});

test('почта отключается', { timeout: 60000 }, () => {
  const w = game(3);
  w.mail.enabled = false;
  run(w, 80);
  assert.equal(w.mail.stats.received, 0);
});

test('явления: гиперинфляция узнаётся в пресете и не мигает; в журнале есть причины-рычаги', { timeout: 120000 }, () => {
  const w = game(3);
  applyPreset(w, 'hyperinflation');
  let first = -1;
  for (let i = 0; i < 150; i++) {
    step(w);
    if (first < 0 && w.phenomena.active.hyperinflation) first = w.t;
    if (first > 0 && i === first + 24) {
      const a = w.phenomena.active.hyperinflation;
      assert.ok(a, 'два года подряд держится');
      assert.ok(a.causes.some(c => c.lever === 'deficitMonetization'), 'среди решений — печатный станок');
      assert.ok(a.facts.length >= 2);
    }
  }
  assert.ok(first > 0 && first <= 36, 'распознана в первые три года: ' + first);
  assert.ok(w.events.some(e => e.type === 'phenomenon' && e.data?.phenomenon === 'hyperinflation'));
  assert.ok(w.phenomena.active.shortage || w.phenomena.log.some(e => e.id === 'shortage'), 'потолки цен → дефицит');
  // не мигает: закрытые эпизоды долгие, а повторный вход — не раньше чем через полгода после выхода
  const eps = [...w.phenomena.log.filter(e => e.id === 'hyperinflation')].sort((a, b) => a.since - b.since);
  for (const e of eps) assert.ok(e.months >= 12, 'эпизод не короче года: ' + e.months);
  for (let i = 1; i < eps.length; i++) assert.ok(eps[i].since - eps[i - 1].to >= 6);
  assert.ok((w.phenomena.seen.hyperinflation || 0) <= 3);
});

test('явления: обычная страна не получает гиперинфляцию, а закрытые явления уходят в журнал', { timeout: 120000 }, () => {
  const w = run(game(3), 150);
  assert.ok(!w.phenomena.active.hyperinflation && !w.phenomena.seen.hyperinflation);
  for (const e of w.phenomena.log) assert.ok(e.to >= e.since + 3 && e.name && Array.isArray(e.causes));
  assert.ok(w.phenomena.log.length + Object.keys(w.phenomena.active).length > 0, 'хоть что-то узнано (стагфляция переходного периода)');
});

test('явления: захват регулятора по принятым просьбам одной фирмы при коррупции', () => {
  const w = run(game(3), 40);
  const f = w.firms.find(x => x.alive && x.owner === 'private');
  w.gov.corruption = 0.4;
  for (let i = 0; i < 2; i++) {
    const L = inject(w, { lobby: true, stake: 10, sender: { type: 'corp', name: f.name, firmId: f.id, people: 1, share: 0.1, shareOf: '' }, ask: { lever: 'patentYears', industry: null, value: 20 + i, from: 15, dir: 1, text: '' } });
    acceptLetter(w, L.id);
  }
  w.gov.corruption = 0.4;
  run(w, 12);
  assert.ok(w.phenomena.active.regulator_capture, 'явление распознано');
});
