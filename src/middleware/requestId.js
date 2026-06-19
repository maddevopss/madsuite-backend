const crypto = require("crypto");

function requestId(req, res, next) {
  const incomingId = req.get("X-Request-ID");
  const id = incomingId || crypto.randomUUID();

  req.id = id;
  res.setHeader("X-Request-ID", id);

  next();
}

module.exports = requestId;
