module.exports = {
  type: "modifier",
  evaluate: (context, currentClassification) => {
    const { activity } = context;
    if (!activity || !activity.duration_seconds) return currentClassification;

    // Si la durée dépasse 4 heures d'un coup (14400 secondes), on réduit la confiance
    if (activity.duration_seconds > 14400) {
      return {
        ...currentClassification,
        confidence: Math.max(0, currentClassification.confidence - 30),
        flags: [...(currentClassification.flags || []), "excessive_duration"]
      };
    }

    return currentClassification;
  }
};
