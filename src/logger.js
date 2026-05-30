function timestamp() {
  return new Date().toISOString();
}

function write(level, args) {
  const method = level === "ERROR" ? "error" : level === "WARN" ? "warn" : "log";
  console[method](`${timestamp()} [${level}]`, ...args);
}

export const logger = {
  info: (...args) => write("INFO", args),
  warn: (...args) => write("WARN", args),
  error: (...args) => write("ERROR", args),
  debug: (...args) => {
    if (process.env.DEBUG === "true") {
      write("DEBUG", args);
    }
  },
};

