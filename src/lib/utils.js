import Decimal from "decimal.js";
import { Int32, Double, Decimal128, Long } from "mongodb";


/**
 * Determines the most suitable MongoDB BSON type for a given numeric input.
 *
 * @param {number|BigInt|Decimal} numericInput - The number to evaluate.
 * @returns {string} - The recommended BSON type: 'Int32', 'Int64', 'Double', or 'Decimal128'.
 * @throws {Error} - Throws error for unsupported input types.
 */
export function checkNumberSize(numericInput) {
  // Helper function to check if Decimal is an integer
  const isDecimalInteger = (decimal) => decimal.mod(1).isZero();

  // Step 1: Determine the type of numericInput
  if (typeof numericInput === "number") {
    if (!Number.isFinite(numericInput)) {
      throw new Error("Input number must be finite");
    }

    if (Number.isInteger(numericInput)) {
      // Integer Number
      if (numericInput >= Int32.MIN_VALUE && numericInput <= Int32.MAX_VALUE) {
        return "Int32";
      } else if (
        numericInput >= Number.MIN_SAFE_INTEGER &&
        numericInput <= Number.MAX_SAFE_INTEGER
      ) {
        return "Int64";
      } else {
        // Although Number can represent larger integers, precision is not guaranteed
        return "Decimal128";
      }
    } else {
      // Floating-point Number
      // Check if the number can be accurately represented as Double
      const doubleRepresentation = new Double(numericInput);
      const reconstructedNumber = doubleRepresentation.value;
      if (reconstructedNumber === numericInput) {
        return "Double";
      } else {
        return "Decimal128";
      }
    }
  } else if (typeof numericInput === "bigint") {
    // BigInt
    // Check if it fits within 32-bit or 64-bit ranges
    if (
      numericInput >= BigInt(Int32.MIN_VALUE) &&
      numericInput <= BigInt(Int32.MAX_VALUE)
    ) {
      return "Int32";
    } else if (
      numericInput >= BigInt("-9223372036854775808") &&
      numericInput <= BigInt("9223372036854775807")
    ) {
      // Int64 range
      return "Int64";
    } else {
      // Beyond Int64 range; use Decimal128 to preserve the value
      return "Decimal128";
    }
  } else if (numericInput instanceof Decimal) {
    // Decimal
    if (isDecimalInteger(numericInput)) {
      const intValue = numericInput.toNumber();
      if (Number.isSafeInteger(intValue)) {
        if (intValue >= Int32.MIN_VALUE && intValue <= Int32.MAX_VALUE) {
          return "Int32";
        } else {
          return "Int64";
        }
      } else {
        // Use Decimal128 for large integers
        return "Decimal128";
      }
    } else {
      // Decimal with fractional part; recommend Decimal128
      return "Decimal128";
    }
  } else {
    throw new TypeError("Input must be a number, BigInt, or Decimal instance");
  }
}

/**
 * Converts a numeric input to the most suitable MongoDB BSON type.
 * Supports conversion of numbers, BigInts, and Decimal instances.
 * @param {number|BigInt|Decimal} input - The numeric value to convert.
 * @returns {Int32|Long|Double|Decimal128} - The converted MongoDB BSON number.
 * @throws {TypeError} - Throws error for unsupported numeric value types.
 */
export function toMongoNumber(input) {
  // Handle null or undefined input
  if (input === null || input === undefined) {
    return null;
  }

  let numericValue;

  // Convert input to Decimal for consistent handling
  if (input instanceof Decimal) {
    numericValue = input;
  } else if (typeof input === 'bigint') {
    numericValue = new Decimal(input.toString());
  } else if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new Error('Input number must be finite');
    }
    numericValue = new Decimal(input);
  } else if (typeof input === 'string') {
    numericValue = new Decimal(input.trim());
  } else {
    throw new TypeError('Unsupported numeric value type');
  }

  // Analyze the numeric value
  if (numericValue.isInteger()) {
    // For integers
    if (numericValue.gte(Number.MIN_SAFE_INTEGER) && numericValue.lte(Number.MAX_SAFE_INTEGER)) {
      // Safe integers: use JavaScript Number
      return numericValue.toNumber();
    } else if (numericValue.gte('-9223372036854775808') && numericValue.lte('9223372036854775807')) {
      // Within Int64 range: use MongoDB Long
      return Long.fromString(numericValue.toFixed(0));
    } else {
      // Large integers: use Decimal128
      return Decimal128.fromString(numericValue.toString());
    }
  } else {
    // For floating-point numbers
    return Decimal128.fromString(numericValue.toString());
  }
}

/**
 * Determines the name of duration based on the number of days.
 * @param {number} duration - Duration in days.
 * @returns {string} - Name of the duration: 'weekly', 'monthly', 'quarterly', or 'annually'.
 * @throws {Error} - Throws error for invalid duration values.
 */
export function durationName(duration) {
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error("Duration must be a positive integer");
  }
  
  let type;
  // Definition of duration on recap
  if (duration <= 7) {
    type = "weekly";
  } else if (duration <= 30) {
    type = "monthly";
  } else if (duration <= 90) {
    type = "quarterly";
  } else if (duration <= 365) {
    type = "annually";
  } else {
    throw new Error(`Duration is not valid: ${duration} days (must be between 1 and 365)`);
  }
  return type;
}