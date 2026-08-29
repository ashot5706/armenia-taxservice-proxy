const assert = require('node:assert/strict');
const test = require('node:test');

const { asyncRoute } = require('./async-route');

test('forwards rejected async handlers to Express error middleware', async () => {
  const expected = new Error('upstream failed');
  let received;
  const nextCalled = new Promise(resolve => {
    const wrapped = asyncRoute(async () => {
      throw expected;
    });
    wrapped({}, {}, error => {
      received = error;
      resolve();
    });
  });

  await nextCalled;
  assert.equal(received, expected);
});
