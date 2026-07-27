function assessCognitiveLoad(input = {}) {
  const activeTasks = Math.max(0, Number(input.activeTasks || 0));
  const contextSwitches = Math.max(0, Number(input.contextSwitches || 0));
  const interruptions = Math.max(0, Number(input.interruptions || 0));
  const overdueItems = Math.max(0, Number(input.overdueItems || 0));
  const fatigueSignal = Math.max(0, Math.min(1, Number(input.fatigueSignal || 0)));
  const score = Math.min(100, Math.round(activeTasks * 4 + contextSwitches * 3 + interruptions * 4 + overdueItems * 5 + fatigueSignal * 30));
  const status = score >= 75 ? 'overloaded' : score >= 45 ? 'elevated' : 'normal';
  const recommendedAction = status === 'overloaded' ? 'Réduire les tâches actives et choisir une seule prochaine action.' : status === 'elevated' ? 'Limiter les interruptions et regrouper les tâches semblables.' : null;
  return { score, status, recommendedAction };
}
module.exports = { assessCognitiveLoad };
