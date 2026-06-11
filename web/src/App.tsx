import { useEffect, useState } from 'react';
import { clearStoredPassword, fetchMeta, getStoredPassword } from './api';
import { Chat } from './components/Chat';
import { PasswordGate } from './components/PasswordGate';
import { PdfView } from './components/PdfView';
import { SiteMeta } from './types';

type Tab = 'chat' | 'pdf';

export function App() {
  const [password, setPassword] = useState<string | null>(getStoredPassword());
  const [tab, setTab] = useState<Tab>('chat');
  const [meta, setMeta] = useState<SiteMeta | null>(null);

  useEffect(() => {
    void fetchMeta().then(setMeta);
  }, []);

  if (!password) {
    return <PasswordGate onUnlock={() => setPassword(getStoredPassword())} />;
  }

  function lock() {
    clearStoredPassword();
    setPassword(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Thesis Companion</span>
        <nav className="tabs">
          <button className={tab === 'chat' ? 'tab active' : 'tab'} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button className={tab === 'pdf' ? 'tab active' : 'tab'} onClick={() => setTab('pdf')}>
            Thesis PDF
          </button>
        </nav>
        <span className="spacer" />
        <a
          className="ghost"
          href="/runs.csv"
          download
          title="Download the frozen W&B runs export (lean CSV — the exact data the agent queries)"
        >
          Runs CSV
        </a>
        <button className="ghost" onClick={lock} title="Forget the password in this browser session">
          Lock
        </button>
      </header>
      {/* Both panes stay mounted so switching tabs neither reloads the PDF
          nor drops the in-memory conversation. */}
      <main className="content">
        <div style={{ display: tab === 'chat' ? 'contents' : 'none' }}>
          <Chat meta={meta} password={password} onAuthExpired={lock} />
        </div>
        <div style={{ display: tab === 'pdf' ? 'contents' : 'none' }}>
          <PdfView />
        </div>
      </main>
    </div>
  );
}
