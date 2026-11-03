# Fabric purchase data capture

This folder is the offline capture for one handkerchief purchase, from the purchase order through to unallocated fabric storage.

The team fills `fabric-purchase-pipeline.xlsx`. Nothing in this folder writes to the database. A later load can read the filled file. This note is here so that load follows the same path the screens and APIs already use.

The rows already in the workbook are a sample, not a live order. They use three sort numbers from the current catalog, H0002W, H0006C, and H0016A, supplier **Ak** (Net 30), and unit **Meter**. The numbers are `PO-2026-9001` and `PO-2026-9002` so they do not collide with `PO-2026-0001` through `PO-2026-0003`. Navy's catalog rate is 0, which submit rejects, so that sample line uses rate 100. On Packlist, `PL-9001` has rolls 3, weight 48.5, and total quantity 350, split across cartons `C-9001-1` through `C-9001-3`. `PL-9002` has rolls 2, weight 22, and total quantity 100, split across `C-9002-1` and `C-9002-2`. Replace every sample row before a real load.

The first workbook had ten tabs. These orders are already approved, the goods are already received, roll weights can be filled from the lot and the received metres, and QC is bypassed. Cutoff, per-roll weights, and QC are not sheets. Lot entry and cartons are their own tabs.

## How the tabs join

**PO no** is the real purchase-order number. It is stored as `PurchaseOrder.number`, and it is the only key that ties a PO row to its lines, its Packlist rows, its carton rows, and its lot rows. Do not invent a second reference, and do not assign `PO-YYYY-NNNN` when this cell is filled.

**Item no** is `1`, `2`, `3` on that PO. The same number on PO Lines, Packlist, and Lot details is the same fabric line. When the order is created, that line becomes `lines[].lineId`. On Packlist and Lot details, Item no is the selected PO item, the same role as the line picked in the packlist drawer.

**Sort No** is how the team names the fabric. It is typed on PO Lines, and the same sort number is typed on Packlist, Cartons, and Lot details so those rows show which fabric arrived. Fabric name is not a column. Fabric type, color, count, mill old, and mill new are not columns either. A later load reads them from the catalog row for that sort number. The later load still joins rows on PO no and Item no. A carton row joins its packing list by PO No. and Packlist Id.

`supplierName` must already match a Fabric Supplier. The PO form copies address and payment terms from that supplier, so those are not columns. Unit must match a fabric measurement, usually Meter.

## Why each tab is here

1. **PO** feeds `POST /v1/store/purchase-orders`. One row per order: supplier, purchase date, credit days, estimated delivery, and notes. The number in PO no is sent as the order number.
2. **PO Lines** are the `lines[]` on that same create. The team types Sort No. Quantity here is the metres ordered. Rate and GST % live here because submit rejects a line without them. `PATCH /v1/store/purchase-orders/:poId/commercials` only edits those two fields while the order is still Draft, so commercials do not get a sheet.
3. **Packlist** is the shipment entry on screen. It feeds `POST /v1/store/packing-lists`. One row per selected PO item. Sort No is the item label. The screen requires a packing number, courier name, dispatch date, delivery date, rolls, and weight. `totalQty` is the total quantity on that same entry. Rolls, weight, and total quantity belong to the packing list, not to one fabric, so type the same three numbers on every row of that packing code. A later load reads them once and does not add the rows. Courier number, vehicle, challan, notes, mill, consignee, city, invoice, division, and LR are not columns. The screen does not require them on this entry.
4. **Lot details** is where the team enters the supplier lot. One row per selected PO item inside a lot. Sort No is the same label as on Packlist. This is `PATCH /v1/store/purchase-orders/:poId/received-lots`. It is its own tab so received metres, roll count, and weights are typed once, not mixed into the shipment row.
5. **Cartons** is one row per carton on that packing list. It is `PackingList.cartons`. The columns are PO No., Packlist Id, Sort No., Carton No, gross weight, net weight, and qty. PO No. matches PO no. Packlist Id matches `packingListCode`. Carton No, gross weight, net weight, and qty are `cartonNumber`, `grossWeight`, `netWeight`, and `totalQty`. Sort No is `fabricSortNo`. The carton does not store a separate weight for each roll inside it. A carton with no roll count counts as one roll, so the number of carton rows for a packing list should equal that packing list's `rolls`. The sum of gross weight should equal Packlist `weight`, and the sum of qty should equal Packlist `totalQty`. The packlist screen fills the packing-list rolls and weight from these rows.

## Lot details

- `lotNumber` is the supplier lot. Received lots require it, and the roll code is `ROLL-{PO no}-{lotNumber}-{sequence}`.
- `quantity` is the metres received for that item. It can be lower than the ordered quantity on PO Lines.
- `rolls` is how many barcodes to create for that item. It must be greater than 0. It is not a barcode, and it is not the packing-list roll total. `POST /v1/store/purchase-orders/:poId/process-rolls` mints one `FabricRoll` per count. `barcode` is a new id. The goods receipt number is `GRN-{PO no}-P`.
- `grossWeight` and `netWeight` are the lot totals, not a weight to add per item. Repeat the same pair on every row that shares that `lotNumber`. A later load reads the pair once for the lot. Adding the rows would double the lot. Both must be greater than 0. Packing-list weight is the `weight` column on Packlist.

Several items can share one `lotNumber`. Each PO line appears once per lot.

## Not typed by the team

- **Submit** is `POST /v1/store/purchase-orders/:poId/submit`. It checks supplier, at least one fabric, ordered quantity greater than 0, rate greater than 0, and GST from 0 to 100. Status becomes Submitted to Vendor.
- **Cutoff.** These orders are already approved, so there is no Yes/No column. `assertPackingLines` in `src/services/factory/cutoffGate.js` and `saveReceivedLots` still reject a line that is not approved. The later load approves every line before the packing list and the receipt.
- **Cartons** are typed on the Cartons tab. The transit screen saves `boxes` as the same number as the packing-list roll count.
- **Roll weights.** There is no per-roll gross or metres column. After barcodes exist, the lot gross, lot net, and received metres are spread across the rolls of that item. Where the supplier master has a tear weight, roll net stays gross minus that tear weight.
- **QC.** There is no pass, hold, or reject column. The later load marks every received lot passed. Fabric storage lists a roll as unallocated only when `FabricRoll.qcStatus` is `passed`, `FabricRoll.status` is still `received`, the matching received lot is `passed`, and the roll has no rack movement. Skipping the column does not skip that result. A rack code is not collected, because placing the roll on a rack would take it out of unallocated storage.

PO return, fabric issue, fabric return, the old `POST /v1/store/receipts` path, and GRN header edits are not in this file. They are not required to land the rolls in unallocated storage.
