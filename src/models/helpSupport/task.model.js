import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

export const TASK_STATUS = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];
export const TASK_PRIORITY = ['low', 'medium', 'high', 'urgent'];

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, trim: true },
    url: { type: String, trim: true },
    key: { type: String, trim: true },
    size: { type: Number },
    mimeType: { type: String, trim: true },
  },
  { _id: false }
);

const commentSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true },
    attachments: [attachmentSchema],
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const activitySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['created', 'status_changed', 'teams_assigned', 'comment', 'updated'],
      required: true,
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actorName: { type: String, trim: true },
    message: { type: String, trim: true },
    fromStatus: { type: String, enum: TASK_STATUS },
    toStatus: { type: String, enum: TASK_STATUS },
    teams: [{ type: String, trim: true, lowercase: true }],
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const taskSchema = new mongoose.Schema(
  {
    taskNumber: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true },
    status: { type: String, enum: TASK_STATUS, default: 'todo', index: true },
    priority: { type: String, enum: TASK_PRIORITY, default: 'medium' },
    dueDate: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    assignees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    assignedTeams: [{ type: String, trim: true, lowercase: true, index: true }],
    attachments: [attachmentSchema],
    comments: [commentSchema],
    activityLog: [activitySchema],
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

taskSchema.plugin(toJSON);
taskSchema.plugin(paginate);

const taskCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

const HelpSupportTaskCounter = mongoose.model('HelpSupportTaskCounter', taskCounterSchema);
const HelpSupportTask = mongoose.model('HelpSupportTask', taskSchema);

export { HelpSupportTaskCounter };
export default HelpSupportTask;
