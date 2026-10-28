import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const SIGN_OFF_COLUMNS = ['developer', 'addon', 'developed', 'testedOdin', 'testedAddon', 'implemented'];

const checkpointModuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sortOrder: { type: Number, default: 0, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const checkpointItemSchema = new mongoose.Schema(
  {
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckpointModule',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    sortOrder: { type: Number, default: 0 },
    developerChecked: { type: Boolean, default: false },
    developerCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    developerCheckedByName: { type: String, trim: true, default: '' },
    developerCheckedAt: { type: Date, default: null },
    addonChecked: { type: Boolean, default: false },
    addonCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    addonCheckedByName: { type: String, trim: true, default: '' },
    addonCheckedAt: { type: Date, default: null },
    developedChecked: { type: Boolean },
    developedCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    developedCheckedByName: { type: String, trim: true, default: '' },
    developedCheckedAt: { type: Date, default: null },
    testedOdinChecked: { type: Boolean },
    testedOdinCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    testedOdinCheckedByName: { type: String, trim: true, default: '' },
    testedOdinCheckedAt: { type: Date, default: null },
    testedAddonChecked: { type: Boolean },
    testedAddonCheckedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    testedAddonCheckedByName: { type: String, trim: true, default: '' },
    testedAddonCheckedAt: { type: Date, default: null },
    implemented: { type: Boolean },
    implementedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    implementedByName: { type: String, trim: true, default: '' },
    implementedAt: { type: Date, default: null },
    pendencyRemark: { type: String, trim: true, default: '', maxlength: 2000 },
  },
  { timestamps: true }
);

const checkpointLogSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckpointItem',
      required: true,
      index: true,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CheckpointModule',
      required: true,
      index: true,
    },
    column: { type: String, enum: SIGN_OFF_COLUMNS, required: true },
    checked: { type: Boolean, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, required: true, trim: true },
    actedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

checkpointModuleSchema.plugin(toJSON);
checkpointItemSchema.plugin(toJSON);
checkpointLogSchema.plugin(toJSON);

checkpointItemSchema.index({ moduleId: 1, sortOrder: 1 });

const CheckpointModule = mongoose.model('CheckpointModule', checkpointModuleSchema);
const CheckpointItem = mongoose.model('CheckpointItem', checkpointItemSchema);
const CheckpointLog = mongoose.model('CheckpointLog', checkpointLogSchema);

export { SIGN_OFF_COLUMNS, CheckpointModule, CheckpointItem, CheckpointLog };
