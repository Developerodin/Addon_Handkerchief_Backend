import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import { requireAnyCrudPath, requireCrud } from '../../middlewares/requireCrud.js';
import * as versioningValidation from '../../validations/versioning.validation.js';
import * as versioningController from '../../controllers/versioning.controller.js';

const router = express.Router();
const REVIEW = 'Revision review';

router.get('/reviews', auth(), requireCrud(REVIEW, 'read'), versioningController.reviews);

router.post('/pins', auth(), requireCrud(REVIEW, 'create'), validate(versioningValidation.createPin), versioningController.pin);

router.get(
  '/pins/:pinId',
  auth(),
  requireCrud(REVIEW, 'read'),
  validate(versioningValidation.getPin),
  versioningController.readPin
);

router.get(
  '/checkpoints/:checkpointId',
  auth(),
  requireCrud(REVIEW, 'read'),
  validate(versioningValidation.getCheckpoint),
  versioningController.getCheckpoint
);

router
  .route('/scopes/:scopeId')
  .get(auth(), requireCrud(REVIEW, 'read'), validate(versioningValidation.getScope), versioningController.getScope);

router.post(
  '/scopes/:scopeId/publish',
  auth(),
  requireCrud(REVIEW, 'create'),
  validate(versioningValidation.publishScope),
  versioningController.publish
);

router.post(
  '/scopes/:scopeId/revert',
  auth(),
  requireCrud(REVIEW, 'update'),
  validate(versioningValidation.revertScope),
  versioningController.revert
);

router.get(
  '/scopes/:scopeId/revisions',
  auth(),
  requireAnyCrudPath([
    { path: 'Production / Orders', action: 'read' },
    { path: 'Revision review', action: 'read' },
  ]),
  validate(versioningValidation.getScope),
  versioningController.listRevisions
);

router.get(
  '/scopes/:scopeId/revisions/:revisionId',
  auth(),
  requireCrud(REVIEW, 'read'),
  validate(versioningValidation.reconstruct),
  versioningController.reconstruct
);

router.post(
  '/scopes/:scopeId/checkpoints',
  auth(),
  requireCrud(REVIEW, 'create'),
  validate(versioningValidation.createCheckpoint),
  versioningController.checkpoint
);

export default router;
