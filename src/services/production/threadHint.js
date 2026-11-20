import { ProductionOrder } from '../../models/production.model.js';
import RawMaterial from '../../models/rawMaterial.model.js';

/**
 * Thread lines from an order line snapshot for one material role.
 * @param {object | undefined} order
 * @param {string} lineId
 * @param {string} materialRole
 * @param {Map<string, string>} names
 */
export const threadFromOrder = (order, lineId, materialRole, names) => {
  const matched = (order?.lines || []).find((line) => lineId && String(line.id || line._id) === String(lineId));
  const line = matched || order?.lines?.[0];
  const rows = (line?.snapshot?.threadLines || []).filter((row) => row.materialRole === materialRole);
  const lines = rows.map((row) => ({
    name: names.get(String(row.rawMaterialId || '')) || materialRole,
    perPiece: Number(row.quantity) || 0,
  }));
  return {
    lines,
    perPiece: lines.reduce((sum, row) => sum + row.perPiece, 0),
  };
};

/**
 * Orders and material names for thread lines on a station board.
 * @param {object[]} shapedBundles
 * @param {string} materialRole
 */
export const threadContext = async (shapedBundles, materialRole) => {
  const orderIds = [...new Set(shapedBundles.map((row) => String(row.orderId)).filter(Boolean))];
  if (!orderIds.length) return { orders: new Map(), names: new Map() };
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } })
    .select('orderNumber lines.id lines.snapshot.threadLines')
    .lean();
  const materialIds = [
    ...new Set(
      orders.flatMap((order) =>
        (order.lines || []).flatMap((line) =>
          (line.snapshot?.threadLines || [])
            .filter((thread) => thread.materialRole === materialRole && thread.rawMaterialId)
            .map((thread) => String(thread.rawMaterialId))
        )
      )
    ),
  ];
  const materials = materialIds.length ? await RawMaterial.find({ _id: { $in: materialIds } }).select('name') : [];
  return {
    orders: new Map(orders.map((order) => [String(order._id || order.id), order])),
    names: new Map(materials.map((material) => [String(material.id || material._id), material.name || materialRole])),
  };
};

/**
 * Attach `threadHint` ({ lines, perPiece }) to each bundle row.
 * @param {object} board
 * @param {string} materialRole
 */
export const attachThreadHint = async (board, materialRole) => {
  const shaped = [...(board.results || []), ...(board.active || [])];
  if (!shaped.length) return board;
  const { orders, names } = await threadContext(shaped, materialRole);
  const withHint = (row) => ({
    ...row,
    threadHint: threadFromOrder(orders.get(String(row.orderId)), row.lineId || '', materialRole, names),
  });
  return {
    ...board,
    results: (board.results || []).map(withHint),
    active: (board.active || []).map(withHint),
  };
};