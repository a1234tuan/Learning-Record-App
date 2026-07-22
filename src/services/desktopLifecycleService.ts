type DesktopFlushHandler = () => Promise<void> | void;

const handlers = new Set<DesktopFlushHandler>();

export const registerDesktopFlushHandler = (handler: DesktopFlushHandler): (() => void) => {
  handlers.add(handler);
  return () => handlers.delete(handler);
};

export const flushDesktopPendingChanges = async (): Promise<void> => {
  await Promise.allSettled(Array.from(handlers).map((handler) => handler()));
};
