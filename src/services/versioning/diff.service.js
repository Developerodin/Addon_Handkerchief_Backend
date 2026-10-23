const CANONICALIZATION_VERSION = 1;

/**
 * Turns 1.5000 and 1.5 into the same canonical number string.
 * @param {unknown} value
 * @returns {unknown}
 */
export const canonicalValue = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(6));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalValue(entry));
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalValue(value[key]);
    }
    return sorted;
  }
  return value;
};

/**
 * Normalizes one BOM-style line for comparison and storage.
 * @param {object} line
 * @returns {{ lineId: string, quantity: number, values: object }}
 */
export const canonicalLine = (line) => {
  const values = line?.values && typeof line.values === 'object' && !Array.isArray(line.values) ? line.values : {};
  return {
    lineId: String(line.lineId),
    quantity: canonicalValue(Number(line.quantity)),
    values: canonicalValue(values),
  };
};

/**
 * Sorts lines by stable line id.
 * @param {object[]} lines
 * @returns {object[]}
 */
export const sortLines = (lines) =>
  [...lines].map((line) => canonicalLine(line)).sort((a, b) => a.lineId.localeCompare(b.lineId));

/**
 * Rejects duplicate ids, missing ids, and negative quantities.
 * @param {object[]} lines
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export const validateLines = (lines) => {
  if (!Array.isArray(lines)) {
    return { ok: false, message: 'VALIDATION FAILED: lines must be a list' };
  }
  const seen = new Set();
  for (const raw of lines) {
    if (!raw || raw.lineId == null || String(raw.lineId).trim() === '') {
      return { ok: false, message: 'VALIDATION FAILED: every line needs a lineId' };
    }
    const line = canonicalLine(raw);
    if (seen.has(line.lineId)) {
      if (String(line.lineId).startsWith('pack:')) {
        return {
          ok: false,
          message:
            'Packaging BOM has the same material and role more than once. Use each material+role only once, or change the role on one row.',
        };
      }
      return {
        ok: false,
        message: 'The BOM has a duplicate line. Remove the repeated row and try again.',
      };
    }
    seen.add(line.lineId);
    if (typeof line.quantity !== 'number' || Number.isNaN(line.quantity) || line.quantity < 0) {
      return {
        ok: false,
        message: 'A BOM line has an invalid quantity. Enter zero or a positive number and try again.',
      };
    }
  }
  return { ok: true };
};

/**
 * Field-level line diff. Identical normalized lines produce no operations.
 * @param {object[]} previousLines
 * @param {object[]} nextLines
 * @returns {{ empty: boolean, deltas: object[] }}
 */
export const diffLines = (previousLines, nextLines) => {
  const previous = new Map(sortLines(previousLines || []).map((line) => [line.lineId, line]));
  const next = new Map(sortLines(nextLines || []).map((line) => [line.lineId, line]));
  const deltas = [];

  if ((previousLines || []).length === 0 && next.size > 0 && previous.size === 0) {
    return {
      empty: false,
      deltas: [{ op: 'BASELINE', lines: sortLines(nextLines) }],
    };
  }

  for (const [lineId, line] of next) {
    const oldLine = previous.get(lineId);
    if (!oldLine) {
      deltas.push({ op: 'ADD', line });
    } else if (JSON.stringify(oldLine) !== JSON.stringify(line)) {
      deltas.push({ op: 'UPDATE', lineId, oldLine, newLine: line });
    }
  }
  for (const [lineId, line] of previous) {
    if (!next.has(lineId)) {
      deltas.push({ op: 'DELETE', line });
    }
  }

  return { empty: deltas.length === 0, deltas };
};

/**
 * Applies committed deltas to a line list.
 * @param {object[]} lines
 * @param {object[]} deltas
 * @returns {object[]}
 */
export const applyDeltas = (lines, deltas) => {
  let current = sortLines(lines || []);
  for (const delta of deltas || []) {
    if (delta.op === 'BASELINE') {
      current = sortLines(delta.lines || []);
    } else if (delta.op === 'ADD') {
      current = sortLines([...current, delta.line]);
    } else if (delta.op === 'UPDATE') {
      current = sortLines(current.map((line) => (line.lineId === delta.lineId ? delta.newLine : line)));
    } else if (delta.op === 'DELETE') {
      current = current.filter((line) => line.lineId !== delta.line.lineId);
    }
  }
  return current;
};

export { CANONICALIZATION_VERSION };
