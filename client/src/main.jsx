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

const isHttps =
  typeof window === 'undefined' ? true : window.location.protocol.toLowerCase() === 'https:';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>{isHttps ? <App /> : <HttpsRequiredScreen />}</React.StrictMode>,
);
