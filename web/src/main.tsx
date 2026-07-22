import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// ?url makes Vite emit the pdf.js worker as its own asset and hand back its URL.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { App } from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { configurePdfWorker } from './lib/pdf.ts';
import './index.css';

configurePdfWorker(pdfWorkerUrl);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
