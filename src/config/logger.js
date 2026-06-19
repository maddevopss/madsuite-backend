const { createLogger, format, transports } = require("winston");

const fileRotation = {
  maxsize: Number(process.env.LOG_MAX_SIZE_BYTES || 5 * 1024 * 1024),
  maxFiles: Number(process.env.LOG_MAX_FILES || 5),
};

const logger = createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: format.combine(format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), format.errors({ stack: true }), format.json()),
  transports: [
    // Toujours dans la console
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, stack }) => {
          return stack ? `${timestamp} [${level}]: ${message}\n${stack}` : `${timestamp} [${level}]: ${message}`;
        }),
      ),
    }),
    new transports.File({ filename: "logs/error.log", level: "error", ...fileRotation }),
    new transports.File({ filename: "logs/combined.log", ...fileRotation }),
  ],
});

module.exports = logger;
