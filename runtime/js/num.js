import { Decimal } from "decimal.js";

/**
 * Sanitize and optionally transform a numeric input (price/volume helpers).
 *
 * Null, undefined, empty, or non-numeric strings return `defaultValue` (not throw).
 * Throws only for unsupported operations or divide-by-zero.
 *
 * @param {string|number|null|undefined} input
 * @param {Object} [options]
 * @param {number} [options.add]
 * @param {number} [options.subtract]
 * @param {number} [options.multiply]
 * @param {number} [options.divide]
 * @param {boolean} [options.roundUp=false]
 * @param {number} [options.decimalPlaces=14]
 * @param {number} [options.defaultValue=0]
 * @returns {number}
 */
export default function num(input, options = {}) {
  const {
    add,
    subtract,
    multiply,
    divide,
    roundUp = false,
    decimalPlaces = 14,
    defaultValue = 0,
  } = options;

  // Step 0: Handle Falsy Inputs (null, undefined, empty string)
  if (input === null || input === undefined || (typeof input === "string" && input.trim() === "")) {
    return defaultValue;
  }

  // Step 1: Validate and Convert Input to Decimal
  let dec;
  if (typeof input === "string") {
    let trimmedInput = input.trim();

    // Sanitize common separators and parentheses (e.g., "1,234.56", "(123)" )
    const isNegativeParens = /^\(.+\)$/.test(trimmedInput);
    if (isNegativeParens) {
      trimmedInput = `-${trimmedInput.replace(/^\(|\)$/g, "")}`;
    }
    // Remove thousands separators and percentage sign
    trimmedInput = trimmedInput.replace(/,/g, "").replace(/%/g, "");

    // Validate if the string is a valid number
    if (!/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(trimmedInput)) {
      return defaultValue;
    }

    try {
      dec = new Decimal(trimmedInput);
    } catch {
      return defaultValue;
    }
  } else if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return defaultValue;
    }
    try {
      dec = new Decimal(input);
    } catch {
      return defaultValue;
    }
  } else {
    return defaultValue;
  }

  // Step 2: Perform Optional Mathematical Operations in Order
  if (add !== undefined) {
    if (typeof add !== "number" || !Number.isFinite(add)) {
      throw new Error("Operation 'add' requires a finite number");
    }
    dec = dec.plus(add);
  }

  if (subtract !== undefined) {
    if (typeof subtract !== "number" || !Number.isFinite(subtract)) {
      throw new Error("Operation 'subtract' requires a finite number");
    }
    dec = dec.minus(subtract);
  }

  if (multiply !== undefined) {
    if (typeof multiply !== "number" || !Number.isFinite(multiply)) {
      throw new Error("Operation 'multiply' requires a finite number");
    }
    dec = dec.mul(multiply);
  }

  if (divide !== undefined) {
    if (typeof divide !== "number" || !Number.isFinite(divide)) {
      throw new Error("Operation 'divide' requires a finite number");
    }
    if (divide === 0) {
      throw new Error("Division by zero is not allowed");
    }
    dec = dec.div(divide);
  }

  // Step 3: Apply Rounding if Required
  if (roundUp) {
    dec = dec.ceil();
  }

  // Step 4: Set Decimal Places if Applicable
  if (decimalPlaces !== undefined && decimalPlaces >= 0) {
    dec = dec.toDecimalPlaces(decimalPlaces);
  }

  const out = dec.toNumber();
  return Number.isFinite(out) ? out : defaultValue;
}
