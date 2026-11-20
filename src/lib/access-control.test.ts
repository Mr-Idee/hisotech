import assert from 'node:assert/strict';
import test from 'node:test';
import { canAcknowledgeInstallation } from './access-control';

test('only the assigned engineer or authorized supervisors can acknowledge an installation', () => {
  assert.equal(canAcknowledgeInstallation('engineer-1', 'engineer-1', false), true);
  assert.equal(canAcknowledgeInstallation('supervisor-1', 'engineer-1', true), true);
  assert.equal(canAcknowledgeInstallation('staff-1', 'engineer-1', false), false);
  assert.equal(canAcknowledgeInstallation('staff-1', null, false), false);
});
