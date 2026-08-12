import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const taskTeamSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500 },
    roles: [{ type: String, trim: true, lowercase: true }],
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

taskTeamSchema.plugin(toJSON);
taskTeamSchema.plugin(paginate);

const HelpSupportTaskTeam = mongoose.model('HelpSupportTaskTeam', taskTeamSchema);

export default HelpSupportTaskTeam;
