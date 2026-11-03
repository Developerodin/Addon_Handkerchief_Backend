import { planFabricSnapshot } from '../../../src/services/store/fabricRequisitionPlan.js';
import {
  coveredFabricIds,
  gstPercentOf,
  needsRequisition,
  onHandMeters,
  orderQuantity,
  requisitionIdsOnLines,
  stageRequisitionOnLines,
  workflowStage,
} from '../../../src/services/store/fabricRequisitionRules.js';

const fabric = (id) => ({ _id: id, fabricCatalogId: id });

describe('fabric requisition rules', () => {
  test('on-hand metres ignore issued, on-floor, and received rolls', () => {
    const metres = onHandMeters([
      { status: 'stored', currentQtyMeters: 40 },
      { status: 'qc-passed', currentQtyMeters: null, qtyMeters: 15 },
      { status: 'issued', currentQtyMeters: 100 },
      { status: 'on-floor', currentQtyMeters: 80 },
      { status: 'received', currentQtyMeters: 25 },
      { status: 'lot-held', qtyMeters: 9 },
      { status: 'returned-to-vendor', currentQtyMeters: 12 },
      { status: 'stored', currentQtyMeters: 0, qtyMeters: 30 },
    ]);
    expect(metres).toBe(55);
  });

  test('a row is raised only at or below a positive min quantity', () => {
    expect(needsRequisition(10, 10)).toBe(true);
    expect(needsRequisition(10, 9.5)).toBe(true);
    expect(needsRequisition(10, 10.1)).toBe(false);
    expect(needsRequisition(0, 0)).toBe(false);
    expect(needsRequisition(null, 0)).toBe(false);
  });

  test('draft quantity is the full catalog minimum', () => {
    expect(orderQuantity(10)).toBe(10);
    expect(orderQuantity(0)).toBe(0);
    expect(gstPercentOf('5%')).toBe(5);
    expect(gstPercentOf('')).toBe(0);
  });

  test('a second fabric for the same supplier is a new line, and a repeat does not double', () => {
    const first = { _id: 'req-1' };
    const second = { _id: 'req-2' };
    const third = { _id: 'req-3' };
    const firstLine = {
      fabricId: 'fab-1',
      quantity: 10,
      sourceRequisitionId: 'req-1',
      stagedFromRequisitions: [{ requisitionId: 'req-1', quantity: 10 }],
    };
    const added = stageRequisitionOnLines([firstLine], second, {
      fabricId: 'fab-2',
      quantity: 20,
      sourceRequisitionId: 'req-2',
      stagedFromRequisitions: [{ requisitionId: 'req-2', quantity: 20 }],
    });
    expect(added.appended).toBe(true);
    expect(added.lines).toHaveLength(2);

    const sameFabric = stageRequisitionOnLines(added.lines, third, {
      fabricId: 'fab-1',
      quantity: 10,
      sourceRequisitionId: 'req-3',
      stagedFromRequisitions: [{ requisitionId: 'req-3', quantity: 10 }],
    });
    expect(sameFabric.merged).toBe(true);
    expect(sameFabric.lines[0].quantity).toBe(20);
    expect(requisitionIdsOnLines(sameFabric.lines).has('req-3')).toBe(true);

    const repeat = stageRequisitionOnLines(sameFabric.lines, first, firstLine);
    expect(repeat.alreadyStaged).toBe(true);
    expect(repeat.lines[0].quantity).toBe(20);
  });

  test('submit coverage stays until the purchase order is received', () => {
    const rows = [
      { ...fabric('fab-1'), poSent: true, linkedPurchaseOrderId: 'po-1' },
      { ...fabric('fab-2'), poSent: true, linkedPurchaseOrderId: null },
      { ...fabric('fab-3'), poSent: true, linkedPurchaseOrderId: 'po-2', dismissed: true },
      { ...fabric('fab-4'), poSent: true, linkedPurchaseOrderId: 'po-3' },
    ];
    const statusByPoId = new Map([
      ['po-1', 'Submitted to Vendor'],
      ['po-3', 'Received'],
    ]);
    const covered = coveredFabricIds(rows, statusByPoId);
    expect(covered.has('fab-1')).toBe(true);
    expect(covered.has('fab-2')).toBe(true);
    expect(covered.has('fab-3')).toBe(false);
    expect(covered.has('fab-4')).toBe(false);
  });

  test('workflow follows dismiss, placed order, then draft', () => {
    expect(workflowStage({ dismissed: true, linkedPurchaseOrderId: 'po' })).toBe('dismissed');
    expect(workflowStage({ linkedPurchaseOrderId: 'po' })).toBe('order_placed');
    expect(workflowStage({ attachedDraftPoId: 'po' })).toBe('sent_to_draft');
    expect(workflowStage({})).toBe('in_requisition');
  });

  test('reconcile plan skips a row that already matches stock', () => {
    const catalog = { _id: 'fab-1', name: 'Cambric', fabricSortNo: 'C1', colourName: 'White', minQuantity: 10 };
    const current = {
      _id: 'req-1',
      fabricName: 'Cambric',
      fabricSortNo: 'C1',
      colourName: 'White',
      minQty: 10,
      onHandMeters: 4,
    };
    expect(planFabricSnapshot(catalog, 4, false, [current])).toEqual({
      deleteIds: [],
      recoverIds: [],
      update: null,
      insert: null,
    });
  });

  test('reconcile plan updates on-hand, inserts a shortage, and clears a recovered row', () => {
    const catalog = { _id: 'fab-1', name: 'Cambric', minQuantity: 10 };
    const stale = planFabricSnapshot(catalog, 3, false, [
      { _id: 'req-1', fabricName: 'Cambric', minQty: 10, onHandMeters: 9 },
    ]);
    expect(stale.update.set.onHandMeters).toBe(3);

    const created = planFabricSnapshot(catalog, 0, false, []);
    expect(created.insert.fabricCatalogId).toBe('fab-1');
    expect(created.insert.onHandMeters).toBe(0);
    expect(created.insert.poSent).toBe(false);

    const recovered = planFabricSnapshot(catalog, 40, false, [
      { _id: 'open-1', dismissed: false },
      { _id: 'gone-1', dismissed: true, stockRecovered: false },
      { _id: 'gone-2', dismissed: true, stockRecovered: true },
    ]);
    expect(recovered.deleteIds).toEqual(['open-1']);
    expect(recovered.recoverIds).toEqual(['gone-1']);
    expect(recovered.insert).toBeNull();
  });

  test('reconcile plan drops an open row while a purchase order covers it, and honours a dismiss hold', () => {
    const catalog = { _id: 'fab-1', name: 'Cambric', minQuantity: 10 };
    const covered = planFabricSnapshot(catalog, 2, true, [
      { _id: 'open-1' },
      { _id: 'hold-1', dismissed: true, stockRecovered: false },
    ]);
    expect(covered.deleteIds).toEqual(['open-1']);
    expect(covered.recoverIds).toEqual([]);
    expect(covered.insert).toBeNull();

    const held = planFabricSnapshot(catalog, 2, false, [{ _id: 'hold-1', dismissed: true, stockRecovered: false }]);
    expect(held).toEqual({ deleteIds: [], recoverIds: [], update: null, insert: null });
  });
});
