import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

function HttpsRequiredScreen() {
  return (
    <main className="app-shell">
      <section className="error-panel">
        <p className="eyebrow">HTTPS Required</p>
        <h1>GitHub Note Sync</h1>
        <p>
          This client only runs when loaded over HTTPS. Open it through the configured reverse proxy
          instead of accessing the Vite or preview server directly.
        </p>
      </section>
    </main>
  );
}

async function detectSecureContext() {
  if (typeof window === 'undefined') {
    return true;
  }

  if (window.location.protocol.toLowerCase() === 'https:') {
    return true;
  }

  try {
    const response = await fetch('/__github-note-sync__/request-context', {
      cache: 'no-store',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      return false;
    }

    const requestContext = await response.json();
    return requestContext?.forwardedHttps === true;
  } catch {
    return false;
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));

detectSecureContext().then((isHttps) => {
  root.render(
    <React.StrictMode>{isHttps ? <App /> : <HttpsRequiredScreen />}</React.StrictMode>,
  );
});
