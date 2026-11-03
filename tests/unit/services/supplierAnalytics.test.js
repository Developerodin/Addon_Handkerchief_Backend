import { buildSupplierDetail, mergeSupplierList } from '../../../src/services/factory/supplierAnalyticsMath.js';

/**
 * @param {object} overrides
 */
function order(overrides) {
  return {
    _id: 'po-1',
    number: 'PO-1',
    supplierName: 'Mill A',
    status: 'Submitted to Vendor',
    purchaseDate: '2026-03-01T00:00:00.000Z',
    lines: [{ lineId: 'l1', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 100 }],
    receivedLots: [],
    ...overrides,
  };
}

const catalog = [{ name: 'Mill A', city: 'Surat', status: 'active', contactPerson: 'Ravi' }];

describe('supplier analytics', () => {
  test('drafts are excluded from purchased quantity, PO count, and fabrics', () => {
    const report = mergeSupplierList({
      catalog,
      qcRows: [],
      returnBuckets: [],
      orders: [
        order({
          _id: 'draft',
          status: 'Draft',
          lines: [{ lineId: 'd1', fabricName: 'Draft cloth', fabricTypeName: 'Lawn', quantity: 50 }],
          receivedLots: [{ lines: [{ lineId: 'd1', receivedQuantity: 5 }] }],
        }),
        order({
          _id: 'live',
          lines: [{ lineId: 'l2', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 80 }],
        }),
      ],
    });
    const row = report.suppliers.find((item) => item.supplierName === 'Mill A');
    expect(row.drafts).toBe(1);
    expect(row.orders).toBe(1);
    expect(row.orderedQty).toBe(80);
    expect(row.receivedQty).toBe(5);
    expect(row.fabricCount).toBe(1);
    expect(row.fabricTypes).toEqual(['Voile']);
    expect(row.currentOrders).toBe(1);
    expect(report.totals.orderedQty).toBe(80);
  });

  test('a current PO still has quantity due and was not closed', () => {
    const report = mergeSupplierList({
      catalog,
      qcRows: [],
      returnBuckets: [],
      orders: [
        order({
          _id: 'received',
          status: 'Received',
          lines: [{ lineId: 'a', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 10 }],
        }),
        order({
          _id: 'done',
          status: 'Completed',
          lines: [{ lineId: 'b', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 10 }],
        }),
        order({
          _id: 'filled',
          status: 'Submitted to Vendor',
          lines: [{ lineId: 'c', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 10 }],
          receivedLots: [{ lines: [{ lineId: 'c', receivedQuantity: 10 }] }],
        }),
        order({
          _id: 'open',
          status: 'Partially Received',
          lines: [{ lineId: 'd', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 10 }],
          receivedLots: [{ lines: [{ lineId: 'd', receivedQuantity: 4 }] }],
        }),
      ],
    });
    expect(report.suppliers[0].currentOrders).toBe(1);
    expect(report.suppliers[0].orders).toBe(4);
  });

  test('fabric types stay distinct and the list keeps four', () => {
    const lines = ['Echo', 'Alpha', 'Charlie', 'Bravo', 'Delta'].map((typeName, index) => ({
      lineId: `t${index}`,
      fabricName: `Fabric ${index}`,
      fabricTypeName: typeName,
      quantity: 10,
    }));
    const report = mergeSupplierList({
      catalog,
      qcRows: [],
      returnBuckets: [],
      orders: [order({ lines })],
    });
    expect(report.suppliers[0].fabricCount).toBe(5);
    expect(report.suppliers[0].fabricTypes).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  });

  test('QC metres follow the purchase order supplier, and returns add quantity', () => {
    const report = mergeSupplierList({
      catalog: [...catalog, { name: 'Mill B', city: 'Ichalkaranji', status: 'active', contactPerson: '' }],
      orders: [
        order({ _id: 'p1', supplierName: 'Mill A' }),
        order({
          _id: 'p2',
          supplierName: 'mill b',
          lines: [{ lineId: 'b', fabricName: 'Poplin', fabricTypeName: 'Satin', quantity: 20 }],
        }),
      ],
      qcRows: [
        { poId: 'p1', qcStatus: 'passed', meters: 12.5, rolls: 2 },
        { poId: 'p1', qcStatus: 'rejected', meters: 3, rolls: 1 },
        { poId: 'p1', qcStatus: 'held', meters: 1, rolls: 1 },
        { poId: 'p2', qcStatus: 'passed', meters: 100, rolls: 4 },
      ],
      returnBuckets: [{ supplierName: 'Mill A', returns: 2, returnQty: 15 }],
    });
    const millA = report.suppliers.find((item) => item.supplierName === 'Mill A');
    const millB = report.suppliers.find((item) => item.supplierName === 'Mill B');
    expect(millA.qcPassedMeters).toBe(12.5);
    expect(millA.qcFailedMeters).toBe(3);
    expect(millA.qcHeldMeters).toBe(1);
    expect(millA.qcPassedRolls).toBe(2);
    expect(millA.qcFailedRolls).toBe(1);
    expect(millA.qcHeldRolls).toBe(1);
    expect(millA.returns).toBe(2);
    expect(millA.returnQty).toBe(15);
    expect(millB.qcPassedMeters).toBe(100);
    expect(millB.supplierName).toBe('Mill B');
    expect(report.totals.qcPassedMeters).toBe(112.5);
    expect(report.totals.qcFailedMeters).toBe(3);
    expect(report.totals.returnQty).toBe(15);
    expect(report.totals.currentOrders).toBe(2);
  });

  test('a catalog supplier with no orders is still listed', () => {
    const report = mergeSupplierList({ catalog, orders: [], qcRows: [], returnBuckets: [] });
    expect(report.suppliers).toEqual([
      expect.objectContaining({ supplierName: 'Mill A', city: 'Surat', orders: 0, status: 'active' }),
    ]);
  });

  test('the dossier splits fabrics, open orders, recent orders, QC rolls, and returns', () => {
    const orders = [
      order({
        _id: 'open',
        number: 'PO-9',
        purchaseDate: '2026-04-01T00:00:00.000Z',
        status: 'Partially Received',
        lines: [
          { lineId: 'a', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 100 },
          { lineId: 'b', fabricName: 'Cambric', fabricTypeName: 'Poplin', quantity: 40 },
        ],
        receivedLots: [
          {
            lines: [
              { lineId: 'a', receivedQuantity: 25 },
              { lineId: 'b', receivedQuantity: 40 },
            ],
          },
        ],
      }),
      order({ _id: 'draft', number: 'PO-D', status: 'Draft', purchaseDate: '2026-05-01T00:00:00.000Z' }),
      ...Array.from({ length: 8 }, (_, index) =>
        order({
          _id: `old-${index}`,
          number: `PO-OLD-${index}`,
          status: 'Completed',
          purchaseDate: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
          lines: [{ lineId: 'z', fabricName: 'Cambric', fabricTypeName: 'Voile', quantity: 1 }],
          receivedLots: [{ lines: [{ lineId: 'z', receivedQuantity: 1 }] }],
        })
      ),
    ];
    const detail = buildSupplierDetail({
      name: 'mill a',
      catalog,
      orders,
      qcRows: [
        { qcStatus: 'passed', meters: 20, rolls: 2 },
        { qcStatus: 'rejected', meters: 4, rolls: 1 },
        { qcStatus: 'pending', meters: 6, rolls: 3 },
      ],
      returns: [
        { supplierName: 'Mill A', reason: 'rejected', quantity: 4, poNumber: 'PO-9', issuedAt: '2026-02-01T00:00:00.000Z' },
        { supplierName: 'Mill A', reason: 'excess', quantity: 1, poNumber: 'PO-1', issuedAt: '2026-03-01T00:00:00.000Z' },
      ],
    });
    expect(detail.header).toEqual({ supplierName: 'Mill A', city: 'Surat', status: 'active', contactPerson: 'Ravi' });
    expect(detail.kpis.orderedQty).toBe(148);
    expect(detail.kpis.currentOrders).toBe(1);
    expect(detail.kpis.fabricCount).toBe(1);
    expect(detail.kpis.qcPassedRolls).toBe(2);
    expect(detail.kpis.qcFailedRolls).toBe(1);
    expect(detail.kpis.qcPendingRolls).toBe(3);
    expect(detail.kpis.returnQty).toBe(5);
    expect(detail.fabrics).toEqual([
      { fabricName: 'Cambric', fabricTypeName: 'Voile', orderedQty: 108, receivedQty: 33 },
      { fabricName: 'Cambric', fabricTypeName: 'Poplin', orderedQty: 40, receivedQty: 40 },
    ]);
    expect(detail.currentOrders.map((row) => row.number)).toEqual(['PO-9']);
    expect(detail.recentOrders).toHaveLength(8);
    expect(detail.recentOrders[0].number).toBe('PO-9');
    expect(detail.recentOrders.some((row) => row.number === 'PO-D')).toBe(false);
    expect(detail.returns.map((row) => row.reason)).toEqual(['excess', 'rejected']);
  });

  test('an unknown supplier name is not a dossier', () => {
    expect(buildSupplierDetail({ name: 'Nobody', catalog: [], orders: [], qcRows: [], returns: [] })).toBeNull();
  });
});
