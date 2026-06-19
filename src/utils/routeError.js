const ApiResponse = require("./apiResponse");

function handleServiceError(err, res, next, options = {}) {
  if (err.statusCode) {
    const code = options.code || err.apiCode || "REQUEST_ERROR";
    return res.status(err.statusCode).json(ApiResponse.error(code, {
      message: err.message,
    }));
  }

  return next(err);
}

module.exports = {
  handleServiceError,
};
