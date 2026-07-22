import { useCallback, useRef, useState } from 'react';
import { PdfError, parseFile } from '../lib/pdf.ts';
import type { PlannedSheet } from '../lib/validation.ts';

export interface FileProblem {
  file: string;
  message: string;
}

export interface ParseProgress {
  done: number;
  total: number;
  current: string;
}

/**
 * Folder a dropped file came from. Browsers expose the dropped hierarchy via
 * webkitRelativePath; a plain file selection has none, so it groups under its own
 * name. The folder is only a default for Drawing Area assignment — the review screen
 * lets the user regroup freely.
 */
function folderOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!relative) return 'Uploaded files';
  const parts = relative.split('/');
  // Drop the filename; keep the immediate parent, or the root for a flat folder.
  return parts.length > 1 ? (parts[parts.length - 2] ?? 'Uploaded files') : 'Uploaded files';
}

export function usePackage() {
  const [sheets, setSheets] = useState<PlannedSheet[]>([]);
  const [problems, setProblems] = useState<FileProblem[]>([]);
  const [progress, setProgress] = useState<ParseProgress | null>(null);

  // File handles are kept so a page can be re-read and split at upload time. These are
  // OS handles, not buffers — holding buffers for a large package would exhaust memory.
  const filesById = useRef(new Map<string, File>());

  const addFiles = useCallback(async (incoming: readonly File[]) => {
    const pdfs = incoming.filter((file) => file.name.toLowerCase().endsWith('.pdf'));
    const skipped = incoming.length - pdfs.length;

    const nextProblems: FileProblem[] = skipped
      ? [{ file: `${skipped} file(s)`, message: 'Not a PDF — Procore Drawings accepts PDFs only.' }]
      : [];
    const parsed: PlannedSheet[] = [];

    for (const [index, file] of pdfs.entries()) {
      setProgress({ done: index, total: pdfs.length, current: file.name });

      try {
        const buffer = await file.arrayBuffer();
        const pages = await parseFile(buffer, file.name);
        const folder = folderOf(file);

        for (const page of pages) {
          const id = `${file.name}#${page.pageIndex}`;
          filesById.current.set(id, file);
          parsed.push({
            id,
            sourceFile: file.name,
            folder,
            pageIndex: page.pageIndex,
            sheetNumber: page.sheetNumber,
            title: page.title,
            discipline: page.discipline,
            revision: '',
            drawingDate: null,
            receivedDate: null,
            drawingAreaId: null,
            confidence: page.confidence,
            needsOcr: page.needsOcr,
          });
        }
      } catch (cause) {
        // A file that cannot be read is reported, never silently dropped — a missing
        // sheet is far more dangerous than a visible error.
        nextProblems.push({
          file: file.name,
          message:
            cause instanceof PdfError
              ? cause.kind === 'encrypted'
                ? 'Password protected. Re-export without a password.'
                : 'Corrupt or unreadable PDF.'
              : String(cause),
        });
      }
    }

    setProgress(null);
    setSheets((existing) => [...existing, ...parsed]);
    setProblems((existing) => [...existing, ...nextProblems]);
  }, []);

  /** Applies a partial update to every sheet in `ids` — the bulk-edit primitive. */
  const updateSheets = useCallback((ids: readonly string[], patch: Partial<PlannedSheet>) => {
    const target = new Set(ids);
    setSheets((existing) =>
      existing.map((sheet) => (target.has(sheet.id) ? { ...sheet, ...patch } : sheet)),
    );
  }, []);

  const reset = useCallback(() => {
    filesById.current.clear();
    setSheets([]);
    setProblems([]);
    setProgress(null);
  }, []);

  return { sheets, problems, progress, addFiles, updateSheets, reset, filesById };
}
