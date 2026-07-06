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
