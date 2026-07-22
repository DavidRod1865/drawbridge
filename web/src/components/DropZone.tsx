import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * Walks a dropped directory tree.
 *
 * The DataTransferItem entry API is the only way to read a dropped *folder* — the
 * plain `files` list is empty for directories. Files carry no webkitRelativePath when
 * obtained this way, so the path is threaded through manually to preserve folder
 * grouping.
 */
async function readEntry(entry: FileSystemEntry, path: string): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    Object.defineProperty(file, 'webkitRelativePath', { value: `${path}${file.name}` });
    return [file];
  }

  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const collected: File[] = [];

  // readEntries returns at most 100 entries per call, so it must be drained in a loop
  // until it yields an empty batch. Reading once silently truncates large folders.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) {
      collected.push(...(await readEntry(child, `${path}${entry.name}/`)));
    }
  }
  return collected;
}

export function DropZone({ onFiles, disabled }: Props) {
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setActive(false);
    if (disabled) return;

    const entries = [...event.dataTransfer.items]
      .map((item) => item.webkitGetAsEntry())
      .filter((entry): entry is FileSystemEntry => entry !== null);

    if (entries.length === 0) {
      onFiles([...event.dataTransfer.files]);
      return;
    }

    const files: File[] = [];
    for (const entry of entries) files.push(...(await readEntry(entry, '')));
    onFiles(files);
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-dashed bg-card px-6 py-14 text-center transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-input',
        disabled && 'pointer-events-none opacity-55',
      )}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setActive(true);
      }}
      onDragLeave={() => setActive(false)}
      onDrop={(event) => void handleDrop(event)}
    >
      <UploadCloud
        className={cn('mx-auto size-8', active ? 'text-primary' : 'text-muted-foreground')}
      />
      <p className="mt-3 text-base font-semibold">Drop drawing files or folders here</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Multi-page packages are split automatically. PDFs only.
      </p>
      <Button
        variant="outline"
        className="mt-4"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Choose files
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple
        hidden
        onChange={(event) => {
          onFiles([...(event.target.files ?? [])]);
          // Reset so selecting the same file twice still fires a change event.
          event.target.value = '';
        }}
      />
    </div>
  );
}
