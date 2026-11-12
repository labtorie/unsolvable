// Аналитика: чистая функция состояния. Меняет только hh.classId, hh.satisfaction, world.stats (поля аналитики), world.regime.
import { classify, computeSatisfaction, classStats } from './classes.js';
import { inequalityStats, stateShareOfOutput, averageHhi } from './stats.js';
import { computeRegime } from './regime.js';

export function analyze(world) {
  const stats = world.stats || (world.stats = {});
  const stateShare = stateShareOfOutput(world);
  const ctx = classify(world, stateShare);
  stats.avgSatisfaction = computeSatisfaction(world, ctx);
  const ineq = inequalityStats(world, ctx);
  const { classes, mobility } = classStats(world, ctx);

  stats.giniIncome = ineq.giniIncome;
  stats.giniWealth = ineq.giniWealth;
  stats.top1WealthShare = ineq.top1WealthShare;
  stats.top10IncomeShare = ineq.top10IncomeShare;
  stats.povertyRate = ineq.povertyRate;
  stats.mobility = mobility;
  stats.classes = classes;
  stats.stateShareOfOutput = stateShare;
  stats.avgHhi = averageHhi(world);

  world.regime = computeRegime(world, { giniGross: ineq.giniGross });
  return world;
}
