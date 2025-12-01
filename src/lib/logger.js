export function logInfo(message) {
  const time = new Date().toISOString();
  const text = typeof message === "string" ? message : JSON.stringify(message);
  console.log(`${time} [INFO] ${text}`);
}

export function logError(err) {
  const time = new Date().toISOString();
  if (err instanceof Error) {
    console.error(`${time} [ERROR] ${err.message}`);
    if (err.stack) console.error(err.stack);
  } else {
    const text = typeof err === "string" ? err : JSON.stringify(err);
    console.error(`${time} [ERROR] ${text}`);
  }
}
