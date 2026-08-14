import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import { requireCrud } from '../../../middlewares/requireCrud.js';
import * as ticketValidation from '../../../validations/helpSupport/ticket.validation.js';
import * as ticketController from '../../../controllers/helpSupport/ticket.controller.js';

const router = express.Router();
const HS_TICKETS = 'Help & Support.Tickets';

router
  .route('/')
  .post(
    auth('getHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'create'),
    validate(ticketValidation.createTicket),
    ticketController.createTicket
  )
  .get(
    auth('getHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'read'),
    validate(ticketValidation.listTickets),
    ticketController.listTickets
  );

router
  .route('/:ticketId')
  .get(
    auth('getHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'read'),
    validate(ticketValidation.ticketIdParam),
    ticketController.getTicket
  )
  .patch(
    auth('getHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'update'),
    validate(ticketValidation.updateTicket),
    ticketController.updateTicket
  )
  .delete(
    auth('deleteHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'delete'),
    validate(ticketValidation.ticketIdParam),
    ticketController.deleteTicket
  );

router.patch(
  '/:ticketId/status',
  auth('manageHelpSupportTickets'),
  requireCrud(HS_TICKETS, 'update'),
  validate(ticketValidation.updateStatus),
  ticketController.updateStatus
);

router.patch(
  '/:ticketId/disposition',
  auth('manageHelpSupportTickets'),
  requireCrud(HS_TICKETS, 'update'),
  validate(ticketValidation.updateDisposition),
  ticketController.updateDisposition
);

router.patch(
  '/:ticketId/assign',
  auth('manageHelpSupportTickets'),
  requireCrud(HS_TICKETS, 'update'),
  validate(ticketValidation.assignTicket),
  ticketController.assignTicket
);

router.get(
  '/:ticketId/history',
  auth('getHelpSupportTickets'),
  requireCrud(HS_TICKETS, 'read'),
  validate(ticketValidation.ticketIdParam),
  ticketController.getHistory
);

router
  .route('/:ticketId/comments')
  .post(
    auth('getHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'update'),
    validate(ticketValidation.addComment),
    ticketController.addComment
  )
  .get(
    auth('getHelpSupportTickets'),
    requireCrud(HS_TICKETS, 'read'),
    validate(ticketValidation.ticketIdParam),
    ticketController.listComments
  );

export default router;
