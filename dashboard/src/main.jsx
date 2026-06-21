import React from 'react';
import { createRoot } from 'react-dom/client';
// HashRouter (not BrowserRouter) so the app survives a page refresh on ANY host
// (Vercel/Netlify/etc.) with zero server rewrite config, and also works from
// file:// inside the Electron desktop build. URLs look like /#/employees.
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './lib/auth.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
);
