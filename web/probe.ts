import { readFile } from 'node:fs/promises';
import { configurePdfWorker, parseFile } from '/Users/davidrodriguez/Desktop/Projects/drawbridge/web/src/lib/pdf.ts';

configurePdfWorker(import.meta.resolve('pdfjs-dist/build/pdf.worker.mjs'));

const path = process.argv[2]!;
const buf = await readFile(path);
const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

const sheets = await parseFile(data, path.split('/').pop()!);

console.log(`\nPages: ${sheets.length}\n`);
console.log('idx | sheet#      | conf  | ocr | title');
console.log('----+-------------+-------+-----+------------------------------------');
for (const s of sheets) {
  console.log(
    `${String(s.pageIndex).padStart(3)} | ${(s.sheetNumber ?? '—').padEnd(11)} | ${String(s.confidence).padEnd(5)} | ${s.needsOcr ? 'YES' : '   '} | ${(s.title ?? '—').slice(0, 40)}`,
  );
}

const parsed = sheets.filter((s) => s.sheetNumber).length;
const lowConf = sheets.filter((s) => s.sheetNumber && s.confidence < 0.5).length;
console.log(`\nParsed ${parsed}/${sheets.length} | low-confidence: ${lowConf} | needs OCR: ${sheets.filter((s) => s.needsOcr).length}`);
