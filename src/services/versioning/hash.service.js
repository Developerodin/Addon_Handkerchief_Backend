import crypto from 'crypto';

/**
 * Stable SHA-256 of a JSON value. Key order is normalized first.
 * @param {unknown} value
 * @returns {string}
 */
export const hashValue = (value) => {
  const json = JSON.stringify(sortKeys(value));
  return crypto.createHash('sha256').update(json).digest('hex');
};

/**
 * Recursively sorts object keys so hashes do not depend on insertion order.
 * @param {unknown} value
 * @returns {unknown}
 */
const sortKeys = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeys(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
};
