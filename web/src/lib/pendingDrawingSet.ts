import type { DrawingSet } from './procore.ts';

/**
 * Sentinel id for a Drawing Set that exists only in this browser session.
 * Procore create is deferred until upload so unused drafts never leak into the project.
 */
export const PENDING_DRAWING_SET_ID = -1;

export function isPendingDrawingSetId(id: number): boolean {
  return id === PENDING_DRAWING_SET_ID;
}

/**
 * Resolves the Drawing Set id that upload should use.
 * An existing Procore id passes through; a pending draft is created first.
 */
export async function resolveDrawingSetId(opts: {
  setId: number;
  pendingName: string | null;
  create: (name: string) => Promise<DrawingSet>;
}): Promise<{ id: number; created: DrawingSet | null }> {
  if (!isPendingDrawingSetId(opts.setId)) {
    return { id: opts.setId, created: null };
  }

  const name = opts.pendingName?.trim() ?? '';
  if (!name) {
    throw new Error('Pending Drawing Set has no name.');
  }

  const created = await opts.create(name);
  return { id: created.id, created };
}
