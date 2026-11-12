// Калибровочные константы ядра. Спорные вынесены в world.assumptions (schema.js).
import { INDUSTRIES, NEEDS } from '../schema.js';

export const IND = Object.fromEntries(INDUSTRIES.map(i => [i.id, i]));
export const GOODS = INDUSTRIES.map(i => i.id);
export const NEED_BY_GOOD = Object.fromEntries(NEEDS.map(n => [n.good, n]));

export const P = {
  delta: 0.004,           // амортизация капитала в месяц
  capUnitMult: 5,         // цена единицы капитала = capUnitMult × индекс цен инвестиционных товаров
  baseWage: 100,          // медианная месячная зарплата на старте
  frictions: 0.6,         // доля ищущих работу, находящих её за месяц (фрикции)
  priceEps: 6,            // чувствительность покупателей к цене
  shareInertia: 0.7,      // инерция клиентской базы
  invGoods: { manufacturing: 0.65, construction: 0.35 },
  // доля сохраняющихся остатков на складе (0 — не хранится)
  retention: { agri: 0.6, mining: 1, manufacturing: 0.95, construction: 0.7, vice: 0.9, tech: 0 },
  pollutionScale: 0.0006,
  cashMult: 1,            // запас денег у домохозяйств на старте (в месячных доходах, множитель)
  moneyNorm: 1.6,
  stabilizer: 2.8,        // сила денежной стабилизации при безработице выше 8%         // норма денежной массы относительно стартовой (равновесная масса выше стартовой)
  popFactor: 2000,        // людей в одном домохозяйстве (для показа населения)
};

export const PROF_WAGE = { manual: 0.85, clerical: 0.95, service: 0.8, care: 1.15, engineer: 1.7, manager: 2.1, creative: 1.5, official: 1.1 };
// профессии, требующие образования
export const SKILLED = { engineer: 1, manager: 1, creative: 1, care: 0.7, official: 0.3 };

export const PRESETS = {
  industrial: {
    land: 1, reserveYears: 90, prod: 1, ratio: {},
    imp: { agri: 0.08, mining: 0.1, manufacturing: 0.1, tech: 0.1, vice: 0.05 },
    exp: { agri: 0.06, mining: 0.08, manufacturing: 0.12, tech: 0.1, vice: 0.05 },
    scale: {},
  },
  agrarian: {
    land: 1.6, reserveYears: 90, prod: 0.85, ratio: {},
    imp: { agri: 0.02, mining: 0.15, manufacturing: 0.45, tech: 0.6, vice: 0.05 },
    exp: { agri: 0.25, mining: 0.05, manufacturing: 0.02, tech: 0.02, vice: 0.05 },
    scale: { agri: 1.3, manufacturing: 0.6, tech: 0.5, finance: 0.6, energy: 0.8 },
  },
  resource: {
    land: 0.9, reserveYears: 120, prod: 0.95, ratio: { mining: 1.2 },
    imp: { agri: 0.2, mining: 0, manufacturing: 0.3, tech: 0.4, vice: 0.1 },
    exp: { agri: 0.02, mining: 0.6, manufacturing: 0.02, tech: 0.02, vice: 0.02 },
    scale: { mining: 1.6 },
  },
  trading: {
    land: 0.5, reserveYears: 25, prod: 1.05, ratio: {},
    imp: { agri: 0.4, mining: 0.7, manufacturing: 0.3, tech: 0.2, vice: 0.15 },
    exp: { agri: 0.03, mining: 0.0, manufacturing: 0.22, tech: 0.25, vice: 0.1 },
    scale: { services: 1.25, finance: 1.5, manufacturing: 0.8, mining: 0.5, agri: 0.7 },
  },
};

/** Эффективный режим собственности: «план» подразумевает государственное управление. */
export function effOwnership(ip) {
  return ip.planned ? 'state' : ip.ownership;
}

// Годовая вероятность смерти (Гомпертц)
export function hazard(a) { return 0.00009 * Math.exp(0.082 * a); }
