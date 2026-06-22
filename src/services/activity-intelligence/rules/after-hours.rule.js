module.exports = {
  type: "modifier",
  evaluate: (context, currentClassification) => {
    const { activity } = context;
    if (!activity || !activity.captured_at) return currentClassification;

    const date = new Date(activity.captured_at);
    const hour = date.getHours();

    // Après 19h ou avant 6h du matin
    if (hour >= 19 || hour < 6) {
      return {
        ...currentClassification,
        confidence: Math.max(0, currentClassification.confidence - 15),
        flags: [...(currentClassification.flags || []), "after_hours"]
      };
    }

    return currentClassification;
  }
};
