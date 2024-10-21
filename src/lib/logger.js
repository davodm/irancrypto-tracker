export function logInfo(message) {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[INFO]: ${message}`);
  }
}

export function logError(message) {
  console.error(`[ERROR]: ${message}`);
}
