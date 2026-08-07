import Decimal from 'decimal.js';

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
 * @returns {number|BigInt|Decimal}
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

  let numericValue;

  // Step 0: Handle Falsy Inputs (null, undefined, empty string)
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) {
    return defaultValue;
  }

  // Step 1: Validate and Convert Input
  if (typeof input === 'string') {
    // Trim the input to remove any leading/trailing whitespaces
    let trimmedInput = input.trim();

    // Sanitize common separators and parentheses (e.g., "1,234.56", "(123)" )
    // Treat parentheses as negative numbers
    const isNegativeParens = /^\(.+\)$/.test(trimmedInput);
    if (isNegativeParens) {
      trimmedInput = '-' + trimmedInput.replace(/^\(|\)$/g, '');
    }
    // Remove thousands separators and percentage sign
    trimmedInput = trimmedInput.replace(/,/g, '').replace(/%/g, '');

    // Validate if the string is a valid number (integer or decimal)
    if (!/^[-+]?\d+(\.\d+)?$/.test(trimmedInput)) {
      // Do not throw by default — return defaultValue to avoid failing whole scraper
      return defaultValue;
    }

    // Determine if the string represents an integer or a decimal
    if (/^-?\d+$/.test(trimmedInput)) {
      // Integer
      const bigIntValue = BigInt(trimmedInput);
      if (
        bigIntValue > BigInt(Number.MAX_SAFE_INTEGER) ||
        bigIntValue < BigInt(Number.MIN_SAFE_INTEGER)
      ) {
        numericValue = bigIntValue;
      } else {
        numericValue = Number(trimmedInput);
      }
    } else {
      // Decimal
      numericValue = new Decimal(trimmedInput);
    }
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Input number must be finite');
    }
    numericValue = input;
  } else {
    throw new TypeError('Input must be a string or number');
  }

  // Step 2: Perform Optional Mathematical Operations in Order
  const operationSequence = [
    { op: 'add', value: add },
    { op: 'subtract', value: subtract },
    { op: 'multiply', value: multiply },
    { op: 'divide', value: divide },
  ];

  for (const operation of operationSequence) {
    const { op, value } = operation;
    if (value === undefined) continue; // Skip if operation not provided

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Operation '${op}' requires a finite number`);
    }

    switch (op) {
      case 'add':
        if (typeof numericValue === 'number') {
          numericValue += value;
        } else if (typeof numericValue === 'bigint') {
          numericValue += BigInt(value);
        } else if (numericValue instanceof Decimal) {
          numericValue = numericValue.plus(value);
        }
        break;

      case 'subtract':
        if (typeof numericValue === 'number') {
          numericValue -= value;
        } else if (typeof numericValue === 'bigint') {
          numericValue -= BigInt(value);
        } else if (numericValue instanceof Decimal) {
          numericValue = numericValue.minus(value);
        }
        break;

      case 'multiply':
        if (typeof numericValue === 'number') {
          numericValue *= value;
        } else if (typeof numericValue === 'bigint') {
          numericValue *= BigInt(value);
        } else if (numericValue instanceof Decimal) {
          numericValue = numericValue.mul(value);
        }
        break;

      case 'divide':
        if (value === 0) {
          throw new Error('Division by zero is not allowed');
        }

        if (typeof numericValue === 'number') {
          numericValue /= value;
        } else if (typeof numericValue === 'bigint') {
          // BigInt does not support floating-point division; convert to Decimal
          numericValue = new Decimal(numericValue.toString()).div(value);
        } else if (numericValue instanceof Decimal) {
          numericValue = numericValue.div(value);
        }
        break;

      default:
        throw new Error(`Unsupported operation: ${op}`);
    }
  }

  // Step 3: Apply Rounding if Required
  if (roundUp) {
    if (typeof numericValue === 'number') {
      numericValue = Math.ceil(numericValue);
    } else if (typeof numericValue === 'bigint') {
      // BigInt is already an integer; no action needed
    } else if (numericValue instanceof Decimal) {
      numericValue = numericValue.ceil();
    }
  }

  // Step 4: Set Decimal Places if Applicable
  if (typeof numericValue === 'number') {
    // Convert to fixed decimal places and then back to number to handle floating-point precision
    numericValue = parseFloat(numericValue.toFixed(decimalPlaces));
  } else if (typeof numericValue === 'bigint') {
    // BigInt represents integers; no decimal places needed
  } else if (numericValue instanceof Decimal) {
    numericValue = numericValue.toDecimalPlaces(decimalPlaces);
  }

  return numericValue;
}