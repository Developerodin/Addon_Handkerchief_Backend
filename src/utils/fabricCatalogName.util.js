/**
 * Canonical fabric catalog name: fabricType-color-quality-yarn-count.
 * Empty segments are omitted. Must stay in sync with the frontend helper.
 *
 * @param {object} doc - Document or plain object with denormalized lookup names
 * @returns {string}
 */
export function buildFabricCatalogName(doc) {
  if (!doc || typeof doc !== 'object') return '';

  const parts = [doc.fabricTypeName, doc.colourName, doc.qualityName, doc.yarnName, doc.countName]
    .map((value) => (value == null ? '' : String(value).trim()))
    .filter(Boolean);

  return parts.join('-');
}
