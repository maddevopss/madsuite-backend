module.exports = {
  type: "modifier",
  evaluate: (context, currentClassification) => {
    const { activity } = context;
    if (!activity || !activity.captured_at) return currentClassification;

    const date = new Date(activity.captured_at);
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday

    if (day === 0 || day === 6) {
      return {
        ...currentClassification,
        confidence: Math.max(0, currentClassification.confidence - 10),
        flags: [...(currentClassification.flags || []), "weekend_hours"]
      };
    }

    return currentClassification;
  }
};
