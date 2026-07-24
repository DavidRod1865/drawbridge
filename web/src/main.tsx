import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// ?url makes Vite emit the pdf.js worker as its own asset and hand back its URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { configurePdfWorker } from './lib/pdf.ts';
import { configureLlmExtractor, httpLlmTransport } from './lib/llmExtract.ts';
import './index.css';

configurePdfWorker(pdfWorkerUrl);
// Route sheet extraction through the server's /api/extract hop. If no LLM key is
// configured server-side it answers 204 and parsing stays on the local heuristics.
configureLlmExtractor(httpLlmTransport);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
