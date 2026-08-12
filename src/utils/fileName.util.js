/**
 * Detect UTF-8 text that was misread as Latin-1 (common multer/busboy filename issue).
 * @param {string} name
 * @returns {boolean}
 */
const looksLikeMojibake = (name) =>
  /[\uFFFD]/.test(name) ||
  /â€[\u009C\u009D\u0094\u0093]/.test(name) ||
  /[\u00E0-\u00EF][\u0080-\u00BF]{2}/.test(name) ||
  /[\u00C2-\u00DF][\u0080-\u00BF]/.test(name);

/**
 * Re-decode a Latin-1 misread of UTF-8 bytes back to UTF-8.
 * @param {string} name
 * @returns {string}
 */
const fixUtf8Mojibake = (name) => {
  if (!name || !looksLikeMojibake(name)) return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed && !fixed.includes('\uFFFD') && fixed.length > 0) {
      return fixed;
    }
  } catch {
    // fall through
  }
  return name;
};

/**
 * Normalize an uploaded filename for storage/display.
 * Prefers an explicit UTF-8 client filename when provided.
 * @param {string|undefined|null} primary
 * @param {string|undefined|null} fallback
 * @returns {string}
 */
const decodeUploadedFileName = (primary, fallback) => {
  const raw = (primary || fallback || '').trim();
  if (!raw) return raw;

  let result = fixUtf8Mojibake(raw);

  if (looksLikeMojibake(result)) {
    result = result.replace(/â€"/g, '—').replace(/â€"/g, '–').replace(/\uFFFD/g, '-');
  }

  return result
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return result;
};

export { looksLikeMojibake, fixUtf8Mojibake, decodeUploadedFileName };
