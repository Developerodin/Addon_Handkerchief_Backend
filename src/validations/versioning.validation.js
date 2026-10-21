import Joi from 'joi';

const line = Joi.object().keys({
  lineId: Joi.string().required(),
  quantity: Joi.number().required(),
  values: Joi.object().unknown(true),
});

export const publishScope = {
  params: Joi.object().keys({
    scopeId: Joi.string().required(),
  }),
  body: Joi.object().keys({
    expectedLockVersion: Joi.number().integer().min(0).required(),
    baseRevisionId: Joi.string().allow(null, ''),
    lines: Joi.array().items(line).required(),
    reason: Joi.string().allow(''),
    requireReview: Joi.boolean(),
    dependencyPins: Joi.array().items(
      Joi.object().keys({
        componentScopeId: Joi.string().required(),
        revisionId: Joi.string().required(),
      })
    ),
  }),
};

export const revertScope = {
  params: Joi.object().keys({
    scopeId: Joi.string().required(),
  }),
  body: Joi.object().keys({
    expectedLockVersion: Joi.number().integer().min(0).required(),
    sourceRevisionId: Joi.string().required(),
    reason: Joi.string().allow(''),
  }),
};

export const getScope = {
  params: Joi.object().keys({
    scopeId: Joi.string().required(),
  }),
};

export const createCheckpoint = {
  params: Joi.object().keys({
    scopeId: Joi.string().required(),
  }),
  body: Joi.object().keys({
    revisionId: Joi.string().required(),
  }),
};

export const getCheckpoint = {
  params: Joi.object().keys({
    checkpointId: Joi.string().required(),
  }),
};

export const reconstruct = {
  params: Joi.object().keys({
    scopeId: Joi.string().required(),
    revisionId: Joi.string().required(),
  }),
};

export const createPin = {
  body: Joi.object().keys({
    scopeId: Joi.string().required(),
    revisionId: Joi.string().required(),
    kind: Joi.string().valid('release', 'amendment').required(),
    quantity: Joi.number().min(0).required(),
    completedQuantity: Joi.number().min(0),
    parentPinId: Joi.string().allow(null, ''),
    note: Joi.string().allow(''),
  }),
};

export const getPin = {
  params: Joi.object().keys({
    pinId: Joi.string().required(),
  }),
};
