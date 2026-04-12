import { describe, it, expect } from 'vitest';
import {
  normalizeKafkaTopic,
  normalizeRestPath,
  normalizeIdentifier,
} from '../../src/fingerprint/normalize.js';

describe('normalizeKafkaTopic', () => {
  it('lowercases and trims', () => {
    expect(normalizeKafkaTopic('  Orders.New  ')).toBe('orders.new');
  });

  it('strips environment prefixes', () => {
    expect(normalizeKafkaTopic('dev.orders.new')).toBe('orders.new');
    expect(normalizeKafkaTopic('prod.orders.new')).toBe('orders.new');
    expect(normalizeKafkaTopic('stg.orders.new')).toBe('orders.new');
  });

  it('strips version suffixes', () => {
    expect(normalizeKafkaTopic('orders.new.v1')).toBe('orders.new');
    expect(normalizeKafkaTopic('orders.new.v2')).toBe('orders.new');
  });

  it('strips env prefix and version suffix together', () => {
    expect(normalizeKafkaTopic('prod.orders.new.v2')).toBe('orders.new');
  });
});

describe('normalizeRestPath', () => {
  it('strips trailing slash', () => {
    expect(normalizeRestPath('GET /users/')).toBe('GET /users');
  });

  it('lowercases method, preserves path case', () => {
    expect(normalizeRestPath('get /Users')).toBe('GET /Users');
  });

  it('collapses named path params', () => {
    expect(normalizeRestPath('GET /users/{id}')).toBe('GET /users/:param');
    expect(normalizeRestPath('GET /users/:id')).toBe('GET /users/:param');
    expect(normalizeRestPath('GET /users/:id/orders/{orderId}')).toBe(
      'GET /users/:param/orders/:param'
    );
  });
});

describe('normalizeIdentifier', () => {
  it('dispatches on exposure type', () => {
    expect(normalizeIdentifier('kafka-topic', 'Prod.Orders.New.V1')).toBe(
      'orders.new'
    );
    expect(normalizeIdentifier('rest-endpoint', 'get /users/{id}/')).toBe(
      'GET /users/:param'
    );
  });

  it('returns unknown types untouched (trimmed + lowercased)', () => {
    expect(normalizeIdentifier('grpc-service', 'Foo.Bar/Baz ')).toBe(
      'foo.bar/baz'
    );
  });
});
