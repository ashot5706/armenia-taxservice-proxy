const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { PrintIdempotencyStore } = require('./print-idempotency');

function withStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-idempotency-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new PrintIdempotencyStore(directory);
}

test('replays a completed fiscal response without acquiring a second print', (t) => {
  const store = withStore(t);
  const body = { mode: 3, cardAmount: 18700 };
  const first = store.begin('order-64-prepayment', body);
  assert.equal(first.kind, 'acquired');

  const response = { result: { receiptId: 42, fiscal: 'F-42' } };
  store.complete('order-64-prepayment', first.requestHash, response);

  assert.deepEqual(store.begin('order-64-prepayment', body), {
    kind: 'replay',
    response,
  });
});

test('blocks a retry while the previous fiscal outcome is uncertain', (t) => {
  const store = withStore(t);
  const body = { mode: 2, prePaymentAmount: 18700 };
  assert.equal(store.begin('order-64-delivery', body).kind, 'acquired');
  assert.deepEqual(store.begin('order-64-delivery', body), { kind: 'uncertain' });
});

test('rejects reusing an idempotency key with a different fiscal payload', (t) => {
  const store = withStore(t);
  assert.equal(store.begin('order-64-prepayment', { cardAmount: 18700 }).kind, 'acquired');
  assert.deepEqual(
    store.begin('order-64-prepayment', { cardAmount: 20000 }),
    { kind: 'conflict' },
  );
});

test('a second store instance observes the durable pending marker', (t) => {
  const firstStore = withStore(t);
  const secondStore = new PrintIdempotencyStore(firstStore.directory);
  const body = { mode: 3, cardAmount: 18700 };

  assert.equal(firstStore.begin('order-64-prepayment', body).kind, 'acquired');
  assert.deepEqual(secondStore.begin('order-64-prepayment', body), { kind: 'uncertain' });
});
