import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist';
import { parseSheetNumber } from './src/lib/sheetNumber.ts';

pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs');

const buf = await readFile(process.argv[2]!);
const doc = await pdfjs.getDocument({
  data: new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
}).promise;

for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();

  console.log(`\n===== PAGE ${p} (${Math.round(viewport.width)}x${Math.round(viewport.height)}, rotate=${page.rotate}) =====`);

  const hits: string[] = [];
  for (const raw of content.items) {
    const item = raw as { str: string; transform: number[] };
    if (!item.str?.trim()) continue;
    const [vx, vy] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!);
    const x = vx! / viewport.width;
    const y = vy! / viewport.height;
    const m = parseSheetNumber(item.str);
    if (m) hits.push(`  MATCH "${item.str.trim()}" at x=${x.toFixed(2)} y=${y.toFixed(2)}`);
  }
  console.log(`sheet-number candidates (${hits.length}):`);
  console.log(hits.slice(0, 25).join('\n'));

  // What is actually in the bottom-right corner?
  const corner = content.items
    .map((raw) => {
      const item = raw as { str: string; transform: number[] };
      const [vx, vy] = viewport.convertToViewportPoint(item.transform[4]!, item.transform[5]!);
      return { text: item.str.trim(), x: vx! / viewport.width, y: vy! / viewport.height };
    })
    .filter((i) => i.text && i.x > 0.8 && i.y > 0.85)
    .sort((a, b) => b.y - a.y);
  console.log(`bottom-right corner text (${corner.length}):`);
  console.log(corner.slice(0, 15).map((i) => `  "${i.text}" x=${i.x.toFixed(2)} y=${i.y.toFixed(2)}`).join('\n'));
}
await doc.destroy();
