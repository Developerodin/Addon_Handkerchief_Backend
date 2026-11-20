import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const gradeSchema = mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
  },
  { timestamps: true }
);

const resultSchema = mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    kind: {
      type: String,
      enum: ['fabric-sample', 'bundle-check', 'final', 'initial-roll', 'final-qc', 'final-checking'],
      required: true,
    },
    lotId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricLot' },
    rollBarcode: { type: String, default: '' },
    bundleId: { type: String, default: '' },
    orderId: { type: String, default: '' },
    receivedLotNumber: { type: String, default: '' },
    remarks: { type: String, default: '' },
    gradeCode: { type: String, default: '' },
    passed: { type: Boolean, default: true },
    goodQty: { type: Number, default: 0 },
    /** M2 (manufacturing grade) at floor bundle check; legacy rows may only have defectQty. */
    m2Qty: { type: Number, default: 0 },
    defectQty: { type: Number, default: 0 },
    m4Qty: { type: Number, default: 0 },
    /** Bundle-check workflow: inspected (defects logged) or passed (handoff qty set). */
    phase: { type: String, enum: ['', 'inspected', 'passed'], default: '' },
    arrivalQty: { type: Number, default: 0 },
    inspectionGoodQty: { type: Number, default: 0 },
    goodAddedQty: { type: Number, default: 0 },
    passGoodQty: { type: Number, default: 0 },
    lineId: { type: String, default: '' },
    articleLabel: { type: String, default: '' },
    inspectedBy: { type: String, default: '' },
    passedBy: { type: String, default: '' },
    rackCode: { type: String, default: '' },
    grades: {
      type: [{ code: { type: String, default: '' }, qty: { type: Number, default: 0 }, rackCode: { type: String, default: '' } }],
      default: [],
    },
  },
  { timestamps: true }
);

resultSchema.index({ kind: 1, createdAt: -1 });
resultSchema.index({ kind: 1, bundleId: 1, createdAt: -1 });
resultSchema.index({ kind: 1, orderId: 1, createdAt: -1 });

gradeSchema.plugin(toJSON);
resultSchema.plugin(toJSON);

export const QualityGrade = mongoose.model('QualityGrade', gradeSchema);
export const QualityResult = mongoose.model('QualityResult', resultSchema);

export const DEFAULT_GRADES = [
  { code: 'M4', name: 'M4' },
  { code: 'vertical-long-alteration', name: 'Vertical long alteration' },
  { code: 'long', name: 'Long' },
  { code: 'hemming', name: 'Hemming' },
  { code: 'sporting', name: 'Sporting' },
  { code: 'diving', name: 'Diving' },
  { code: 'rejection', name: 'Rejection' },
];
