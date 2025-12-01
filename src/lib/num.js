import Decimal from 'decimal.js';

/**
 * Converts an input to the most suitable numeric type and performs optional calculations with rounding.
 *
 * @param {string|number|null|undefined} input - The input to convert.
 * @param {Object} [options] - Optional operations and rounding configurations.
 * @param {number} [options.add] - Value to add.
 * @param {number} [options.subtract] - Value to subtract.
 * @param {number} [options.multiply] - Value to multiply by.
 * @param {number} [options.divide] - Value to divide by.
 * @param {boolean} [options.roundUp=false] - Whether to round the final result up to the nearest integer.
 * @param {number} [options.decimalPlaces=14] - Number of decimal places to retain.
 * @param {number} [options.defaultValue=0] - Default value to return if input is null, undefined, or empty.
 * @returns {number|BigInt|Decimal} - The converted and calculated number.
 * @throws {Error} - Throws error for invalid inputs or operations.
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
    const trimmedInput = input.trim();

    // Validate if the string is a valid number (integer or decimal)
    if (!/^[-+]?\d+(\.\d+)?$/.test(trimmedInput)) {
      throw new Error('Invalid number format');
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