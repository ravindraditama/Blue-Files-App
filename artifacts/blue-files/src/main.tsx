import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { setBaseUrl } from '@workspace/api-client-react';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// API lives at <mount>/api (IIS proxies it); BASE_URL is the Vite base, e.g. /apps/blue-files/
setBaseUrl(import.meta.env.BASE_URL);

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </QueryClientProvider>,
);
