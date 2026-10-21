import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const DEVICE_TYPES = ['printer', 'scanner', 'scale', 'rfid-reader', 'rfid-writer'];

const deviceRegistrySchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    deviceType: {
      type: String,
      enum: DEVICE_TYPES,
      required: true,
    },
    model: { type: String, trim: true, default: '' },
    location: { type: String, trim: true, default: '' },
    labelSize: { type: String, trim: true, default: '' },
    scannerType: {
      type: String,
      enum: ['handheld', 'fixed', ''],
      default: '',
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

deviceRegistrySchema.plugin(toJSON);
deviceRegistrySchema.plugin(paginate);

const DeviceRegistry = mongoose.model('DeviceRegistry', deviceRegistrySchema);
export default DeviceRegistry;
