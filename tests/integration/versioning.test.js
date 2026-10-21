import mongoose from 'mongoose';
import request from 'supertest';
import httpStatus from 'http-status';
import app from '../utils/versioningTestApp.js';
import setupTestDB from '../utils/setupTestDB.js';
import { insertUsers } from '../fixtures/user.fixture.js';
import { generateToken } from '../../src/services/token.service.js';
import { tokenTypes } from '../../src/config/tokens.js';
import { getDefaultNavigationByRole } from '../../src/utils/navigationHelper.js';
import moment from 'moment';
import config from '../../src/config/config.js';
import { publishScope, revertScope } from '../../src/services/versioning/publish.service.js';
import {
  createCheckpoint,
  readReadyCheckpoint,
  reconstructState,
} from '../../src/services/versioning/checkpoint.service.js';
import { createPin, getPin } from '../../src/services/versioning/pin.service.js';
import { VersionCheckpoint, VersionRevision, VersionScope } from '../../src/models/versioning.model.js';

setupTestDB();

const scopeId = 'HK-101|normal';

/**
 * Builds numbered lines with one quantity.
 * @param {number} count
 * @param {number} quantity
 * @returns {{ lineId: string, quantity: number }[]}
 */
const lines = (count, quantity = 1) =>
  Array.from({ length: count }, (_, index) => ({
    lineId: `L${String(index + 1).padStart(2, '0')}`,
    quantity,
  }));

const accessTokenFor = (userId) => {
  const expires = moment().add(config.jwt.accessExpirationMinutes, 'minutes');
  return generateToken(userId, expires, tokenTypes.ACCESS);
};

describe('Versioning engine', () => {
  test('stores only the lines that changed', async () => {
    const baseline = lines(50, 1);
    const first = await publishScope({
      scopeId,
      expectedLockVersion: 0,
      lines: baseline,
      reason: 'baseline',
    });
    expect(first.published).toBe(true);
    expect(first.revision.deltas).toHaveLength(1);
    expect(first.revision.deltas[0].op).toBe('BASELINE');

    const edited = baseline.map((line, index) => (index < 10 ? { ...line, quantity: 2 } : line));
    const second = await publishScope({
      scopeId,
      expectedLockVersion: 1,
      lines: edited,
      reason: 'ten lines',
    });

    expect(second.revision.deltas).toHaveLength(10);
    expect(second.revision.deltas.every((delta) => delta.op === 'UPDATE')).toBe(true);
    expect(await VersionRevision.countDocuments({ scopeId })).toBe(2);
  });

  test('does not create a revision when the normalized lines match', async () => {
    await publishScope({
      scopeId,
      expectedLockVersion: 0,
      lines: [{ lineId: 'A', quantity: 1.5 }],
      reason: 'first',
    });
    const again = await publishScope({
      scopeId,
      expectedLockVersion: 1,
      lines: [{ lineId: 'A', quantity: 1.5 }],
      reason: 'same',
    });
    expect(again.published).toBe(false);
    expect(again.status).toBe('UNCHANGED');
    expect(await VersionRevision.countDocuments({ scopeId })).toBe(1);
  });

  test('rejects a stale lock and a negative quantity without moving the effective revision', async () => {
    const first = await publishScope({
      scopeId,
      expectedLockVersion: 0,
      lines: [{ lineId: 'A', quantity: 1 }],
      reason: 'first',
    });

    await expect(
      publishScope({
        scopeId,
        expectedLockVersion: 0,
        lines: [{ lineId: 'A', quantity: 4 }],
        reason: 'stale',
      })
    ).rejects.toMatchObject({ statusCode: httpStatus.CONFLICT });

    await expect(
      publishScope({
        scopeId,
        expectedLockVersion: 1,
        lines: [{ lineId: 'A', quantity: -1 }],
        reason: 'bad',
      })
    ).rejects.toMatchObject({ statusCode: httpStatus.BAD_REQUEST });

    const scope = await VersionScope.findOne({ scopeId });
    expect(String(scope.effectiveRevisionId)).toBe(String(first.revision._id));
    expect(scope.effectiveState.lines[0].quantity).toBe(1);
    expect(await VersionRevision.countDocuments({ scopeId })).toBe(1);
  });

  test('revert publishes the next sequence and leaves the previous revision in place', async () => {
    const first = await publishScope({
      scopeId,
      expectedLockVersion: 0,
      lines: [{ lineId: 'A', quantity: 1 }],
      reason: 'v1',
    });
    const second = await publishScope({
      scopeId,
      expectedLockVersion: 1,
      lines: [{ lineId: 'A', quantity: 9 }],
      reason: 'v2',
    });
    const reverted = await revertScope({
      scopeId,
      expectedLockVersion: 2,
      sourceRevisionId: first.revision._id,
      reason: 'back to v1 content',
    });

    expect(reverted.revision.sequence).toBe(3);
    expect(String(reverted.revision.baseRevisionId)).toBe(String(second.revision._id));
    const stillThere = await VersionRevision.findById(second.revision._id);
    expect(stillThere.sequence).toBe(2);
    const state = await reconstructState(scopeId, reverted.revision._id);
    expect(state.lines[0].quantity).toBe(1);
  });

  test('reads a READY checkpoint and refuses a FAILED one while history still rebuilds', async () => {
    const first = await publishScope({
      scopeId,
      expectedLockVersion: 0,
      lines: lines(3, 1),
      reason: 'baseline',
    });
    await publishScope({
      scopeId,
      expectedLockVersion: 1,
      lines: lines(3, 1).map((line, index) => (index === 0 ? { ...line, quantity: 5 } : line)),
      reason: 'one line',
    });

    const checkpoint = await createCheckpoint(scopeId, first.revision._id);
    const ready = await readReadyCheckpoint(checkpoint._id);
    expect(ready.status).toBe('READY');
    expect(ready.state.lines).toHaveLength(3);

    const later = await VersionRevision.findOne({ scopeId, sequence: 2 });
    const rebuilt = await reconstructState(scopeId, later._id);
    expect(rebuilt.lines[0].quantity).toBe(5);

    await VersionCheckpoint.updateOne({ _id: checkpoint._id }, { status: 'FAILED' });
    await expect(readReadyCheckpoint(checkpoint._id)).rejects.toMatchObject({ statusCode: httpStatus.CONFLICT });

    const withoutCheckpoint = await reconstructState(scopeId, later._id);
    expect(withoutCheckpoint.lines[0].quantity).toBe(5);
  });

  test('an amendment pin does not change the parent revision', async () => {
    const first = await publishScope({
      scopeId,
      expectedLockVersion: 0,
      lines: [{ lineId: 'A', quantity: 1 }],
      reason: 'v1',
    });
    const second = await publishScope({
      scopeId,
      expectedLockVersion: 1,
      lines: [{ lineId: 'A', quantity: 2 }],
      reason: 'v2',
    });
    const release = await createPin({
      scopeId,
      revisionId: first.revision._id,
      kind: 'release',
      quantity: 1000,
    });
    const amendment = await createPin({
      scopeId,
      revisionId: second.revision._id,
      kind: 'amendment',
      quantity: 600,
      completedQuantity: 400,
      parentPinId: release.pin._id,
    });

    const loaded = await getPin(amendment.pin._id);
    expect(String(loaded.parent.revisionId)).toBe(String(first.revision._id));
    expect(String(loaded.pin.revisionId)).toBe(String(second.revision._id));
  });

  test('one of two concurrent publishes wins and the other is a stale lock', async () => {
    const attempts = await Promise.allSettled([
      publishScope({
        scopeId: 'race',
        expectedLockVersion: 0,
        lines: [{ lineId: 'A', quantity: 1 }],
        reason: 'left',
      }),
      publishScope({
        scopeId: 'race',
        expectedLockVersion: 0,
        lines: [{ lineId: 'A', quantity: 2 }],
        reason: 'right',
      }),
    ]);

    const published = attempts.filter((attempt) => attempt.status === 'fulfilled' && attempt.value.published);
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(published).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.statusCode).toBe(httpStatus.CONFLICT);
    expect(await VersionRevision.countDocuments({ scopeId: 'race' })).toBe(1);
  });

  test('revision review is forbidden without the navigation flag and allowed for super admin', async () => {
    const adminId = mongoose.Types.ObjectId();
    const superId = mongoose.Types.ObjectId();
    await insertUsers([
      {
        _id: adminId,
        name: 'Admin',
        email: 'version-admin@addon.test',
        password: 'password1',
        role: 'admin',
        navigation: getDefaultNavigationByRole('admin'),
      },
      {
        _id: superId,
        name: 'Super',
        email: 'version-super@addon.test',
        password: 'password1',
        role: 'super_admin',
        navigation: getDefaultNavigationByRole('super_admin'),
      },
    ]);

    const body = { expectedLockVersion: 0, lines: [{ lineId: 'A', quantity: 1 }], reason: 'api' };
    await request(app)
      .post('/v1/versioning/scopes/api-scope/publish')
      .set('Authorization', `Bearer ${accessTokenFor(adminId)}`)
      .send(body)
      .expect(httpStatus.FORBIDDEN);

    await request(app)
      .post('/v1/versioning/scopes/api-scope/publish')
      .set('Authorization', `Bearer ${accessTokenFor(superId)}`)
      .send(body)
      .expect(httpStatus.CREATED);
  });
});
