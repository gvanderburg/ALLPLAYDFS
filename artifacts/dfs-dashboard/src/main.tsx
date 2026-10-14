import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';
import './styles/slate-theme.css';
import './styles/reference-table-theme.css';
import './styles/usability-pass.css';
import './styles/red-black.css';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const appBasePath = import.meta.env.BASE_URL;
    navigator.serviceWorker.register(`${appBasePath}sw.js`, { scope: appBasePath }).catch((error: unknown) => {
      console.warn('ALLPLAY offline shell registration failed.', error);
    });
  });
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
