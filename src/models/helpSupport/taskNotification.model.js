import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const taskNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['task_created', 'ticket_assigned'],
      default: 'task_created',
      index: true,
    },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'HelpSupportTask', index: true },
    taskNumber: { type: String, trim: true },
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'HelpSupportTicket', index: true },
    ticketNumber: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    assignedTeams: [{ type: String, trim: true, lowercase: true }],
    recipientUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

taskNotificationSchema.plugin(toJSON);
taskNotificationSchema.plugin(paginate);

const notificationReadStateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationReadStateSchema.plugin(toJSON);

const HelpSupportTaskNotification = mongoose.model('HelpSupportTaskNotification', taskNotificationSchema);
const HelpSupportNotificationReadState = mongoose.model(
  'HelpSupportNotificationReadState',
  notificationReadStateSchema
);

export { HelpSupportNotificationReadState };
export default HelpSupportTaskNotification;
