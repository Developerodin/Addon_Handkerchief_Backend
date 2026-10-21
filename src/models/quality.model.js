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
    kind: { type: String, enum: ['fabric-sample', 'bundle-check', 'final', 'initial-roll'], required: true },
    lotId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricLot' },
    rollBarcode: { type: String, default: '' },
    bundleId: { type: String, default: '' },
    orderId: { type: String, default: '' },
    receivedLotNumber: { type: String, default: '' },
    remarks: { type: String, default: '' },
    gradeCode: { type: String, default: '' },
    passed: { type: Boolean, default: true },
    goodQty: { type: Number, default: 0 },
    defectQty: { type: Number, default: 0 },
    m4Qty: { type: Number, default: 0 },
  },
  { timestamps: true }
);

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
