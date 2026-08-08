import { nanoid } from "nanoid";

import type { BaseEntity } from "../types";
import { nowISO } from "./date";

export const newId = (): string => nanoid(12);

export const createBaseEntity = (): BaseEntity => {
  const now = nowISO();
  return {
    id: newId(),
    createdAt: now,
    updatedAt: now,
  };
};

export const touch = <T extends BaseEntity>(entity: T): T => ({
  ...entity,
  updatedAt: nowISO(),
});

/**
 * Shallow key-by-key equality for primitive fields (string/number/boolean/undefined). Used before
 * calling `touch()` so re-saving an entity with unchanged content doesn't bump `updatedAt` — cloud
 * sync hashes the whole payload including `updatedAt`, so an unnecessary bump makes an otherwise
 * untouched record look like a real edit on the next sync.
 *
 * Not a deep-equal: array/object fields (e.g. RecordBlock.assets/formulas/tags) compare by
 * reference here, so callers with those fields must compare them separately (deepEqualIgnoring,
 * below) before deciding whether to skip touch().
 */
export const shallowEqual = <T extends object>(a: T, b: T): boolean => {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
};

const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const next = (value as Record<string, unknown>)[key];
        if (next !== undefined) {
          result[key] = sortKeysDeep(next);
        }
        return result;
      }, {});
  }
  return value;
};

/**
 * Deep-equal for entities with nested array/object fields (e.g. RecordBlock.assets/formulas/tags),
 * ignoring a set of top-level keys (typically "updatedAt" and any derived/bookkeeping fields the
 * caller has already compared separately). Sorts object keys before stringifying so two objects
 * with the same content but different key insertion order still compare equal — a plain
 * `JSON.stringify(a) === JSON.stringify(b)` would wrongly report a change in that case.
 */
export const deepEqualIgnoring = <T extends object>(
  a: T,
  b: T,
  ignoreKeys: readonly string[],
): boolean => {
  const strip = (value: T) => {
    const clone = { ...value } as Record<string, unknown>;
    for (const key of ignoreKeys) delete clone[key];
    return clone;
  };
  return JSON.stringify(sortKeysDeep(strip(a))) === JSON.stringify(sortKeysDeep(strip(b)));
};
