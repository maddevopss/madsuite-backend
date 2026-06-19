function requireFeatureFlag(envName, { defaultEnabled = false } = {}) {
  return (req, res, next) => {
    const rawValue = process.env[envName];
    const enabled = rawValue === undefined ? defaultEnabled : String(rawValue).toLowerCase() === "true";

    if (!enabled) {
      return res.status(404).json({ message: "Feature indisponible." });
    }

    return next();
  };
}

module.exports = {
  requireFeatureFlag,
};
