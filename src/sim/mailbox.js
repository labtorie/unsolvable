// Почтовый ящик: хранение писем и действия игрока (принять / отказать). Только схема и addEvent в зависимостях —
// интерфейс импортирует этот файл напрямую, и он не должен тянуть за собой ядро.
// Формирование писем и исполнение угроз — systems/society.js.
import { POLICY_DEFS, INDUSTRY_POLICY_DEFS } from './schema.js';
import { addEvent } from './systems/util.js';

export const MAIL_CAP = 8;            // сколько писем может лежать открытыми
export const ARCHIVE_TAIL = 60;       // сколько закрытых писем помнить

export function freshMail(seed = 1) {
  return {
    ver: 1, enabled: true,
    inbox: [],            // открытые письма
    archive: [],          // закрытые (хвост ARCHIVE_TAIL)
    nextId: 1,
    rng: (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1,   // свой генератор: ядро не трогаем
    stats: { received: 0, accepted: 0, refused: 0, expired: 0, solved: 0, executed: 0, spared: 0, bribes: 0 },
    cool: {},             // { [key]: месяц, до которого такое письмо не повторять }
    ins: {},              // { [key]: сколько раз подряд отказали (настойчивость растёт) }
    pending: [],          // [{ id (письмо), due, mult }] — угрозы, ждущие срока
    queue: [],            // [{ kind: 'bribe'|'expand', ... }] — отложенные платежи и обещания
    captured: {},         // { [firmId]: [месяцы принятых просьб этой фирмы] }
    lastEventT: -99,
  };
}

/** Миграция старых сохранений: добавляет отсутствующие поля. */
export function ensureMail(world) {
  let m = world.mail;
  if (!m || typeof m !== 'object') m = world.mail = freshMail(world.seed);
  if (m.ver === 1 && m.inbox) return m;
  const f = freshMail(world.seed);
  for (const k in f) if (m[k] === undefined) m[k] = structuredClone(f[k]);
  for (const k in f.stats) if (m.stats[k] === undefined) m.stats[k] = 0;
  m.ver = 1;
  return m;
}

/** Своя последовательность случайных чисел почты (0..1). */
export function mrand(m) {
  m.rng = (Math.imul(m.rng, 1664525) + 1013904223) >>> 0;
  return m.rng / 4294967296;
}

// ───────────── рычаги ─────────────
export function leverDef(lever, industry) {
  return industry ? INDUSTRY_POLICY_DEFS.find(d => d.id === lever) : POLICY_DEFS.find(d => d.id === lever);
}

export function getLever(world, lever, industry) {
  const p = world.policies;
  if (industry) return p.industry?.[industry]?.[lever];
  return p[lever];
}

export function setLever(world, lever, industry, value) {
  const def = leverDef(lever, industry);
  if (def && def.type === 'range') value = Math.min(def.max, Math.max(def.min, value));
  if (industry) ((world.policies.industry ||= {})[industry] ||= {})[lever] = value;
  else world.policies[lever] = value;
}

export function fmtLever(def, v) {
  if (!def) return String(v);
  if (def.type === 'toggle') return v ? 'вкл' : 'выкл';
  if (def.type === 'select') return def.options.find(o => o.id === v)?.label ?? String(v);
  if (def.type !== 'range' || typeof v !== 'number') return String(v);
  const u = def.unit || '';
  if (u === '%' || u === '% ВВП' || u === '%/год') {
    const d = (def.step || 0.01) * 100 < 1 ? 1 : 0;
    return `${(v * 100).toFixed(d)}%${u.slice(1)}`;
  }
  return `${+v.toFixed(2)}${u ? ' ' + u : ''}`;
}

/** Просьба выполнена? dir: +1 — просят поднять, −1 — снизить, 0 — поставить значение. */
export function askMet(world, ask) {
  const cur = getLever(world, ask.lever, ask.industry);
  if (ask.dir > 0) return cur >= ask.value - 1e-9;
  if (ask.dir < 0) return cur <= ask.value + 1e-9;
  return cur === ask.value;
}

export function askText(world, ask) {
  const def = leverDef(ask.lever, ask.industry);
  const name = (ask.industry ? `${ask.indLabel || ask.industry}: ` : '') + (def?.label || ask.lever);
  return `${name}: ${fmtLever(def, ask.from)} → ${fmtLever(def, ask.value)}`;
}

/** Сколько «согласование» стоит бюджету сверх официального при текущей коррупции (разово). */
export function bribeFor(world, letter) {
  if (!letter.lobby) return 0;
  const c = world.gov.corruption || 0;
  if (c < 0.12) return 0;
  return Math.max(0, c * 6 * (letter.stake || 0));
}

// ───────────── закрытие писем ─────────────
function archive(world, m, letter) {
  const i = m.inbox.indexOf(letter);
  if (i >= 0) m.inbox.splice(i, 1);
  m.archive.unshift(letter);
  if (m.archive.length > ARCHIVE_TAIL) m.archive.length = ARCHIVE_TAIL;
}

function setCooldown(world, m, letter, base) {
  const clout = letter.clout || 0;
  m.cool[letter.key] = world.t + Math.round(base * (1 - 0.5 * clout));
}

/** Принять: рычаг меняется сразу. Возвращает true, если письмо было открыто. */
export function acceptLetter(world, id) {
  const m = ensureMail(world);
  const L = m.inbox.find(x => x.id === id);
  if (!L) return false;
  const bribe = bribeFor(world, L);
  setLever(world, L.ask.lever, L.ask.industry, L.ask.value);
  L.status = 'accepted'; L.closedT = world.t;
  L.outcome = `Принято: ${askText(world, { ...L.ask, from: L.ask.from })}.` + (bribe > 0 ? ` «Согласование» обошлось казне ещё в ${Math.round(bribe)}.` : '');
  L.bribe = bribe;
  m.stats.accepted++;
  m.ins[L.key] = 0;
  setCooldown(world, m, L, 24);
  if (bribe > 0) { m.queue.push({ kind: 'bribe', amount: bribe, letter: L.id }); m.stats.bribes += bribe; }
  if (L.sender.firmId != null && L.lobby) (m.captured[L.sender.firmId] ||= []).push(world.t);
  if (L.promise && L.sender.firmId != null) m.queue.push({ kind: 'expand', firmId: L.sender.firmId, due: world.t + 3, frac: L.promise.frac, letter: L.id });
  // принятая просьба снимает угрозы по этому письму
  m.pending = m.pending.filter(p => p.id !== L.id);
  archive(world, m, L);
  addEvent(world, 'mail_accepted', `Просьба удовлетворена: ${L.sender.name} — ${L.title.toLowerCase()}. Остальные просители взяли на заметку, что письма читают`, { mail: L.id });
  return true;
}

/** Отказать: если в письме угроза — срок на раздумье 2 месяца. */
export function refuseLetter(world, id) {
  const m = ensureMail(world);
  const L = m.inbox.find(x => x.id === id);
  if (!L) return false;
  L.status = 'refused'; L.closedT = world.t;
  m.stats.refused++;
  m.ins[L.key] = (m.ins[L.key] || 0) + 1;
  setCooldown(world, m, L, 14);
  if (L.threat) {
    L.outcome = `Отказано. ${L.threat.who} дал два месяца на раздумье, после чего намерен ${L.threat.text}.`;
    m.pending.push({ id: L.id, due: world.t + 2, mult: 1 + 0.25 * Math.min(2, (m.ins[L.key] || 1) - 1) });
    m.cool[L.key] = world.t + 24;   // после исполненной угрозы тот же проситель долго не пишет
    L.threat.state = 'waiting';
    archive(world, m, L);
    // письмо с ожидающей угрозой остаётся в архиве, пока угроза не решится
  } else {
    L.outcome = 'Отказано. Ответа не последовало — просителям нечем грозить.';
    archive(world, m, L);
  }
  return true;
}
