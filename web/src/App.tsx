import { useEffect, useRef, useState } from 'react';
import { clearStoredPassword, fetchMeta, getStoredPassword } from './api';
import { Chat } from './components/Chat';
import { Landing } from './components/Landing';
import { PasswordGate } from './components/PasswordGate';
import { PdfView } from './components/PdfView';
import { PendingPrompt, SiteMeta } from './types';

type View = 'home' | 'chat' | 'pdf';

export function App() {
  const [password, setPassword] = useState<string | null>(getStoredPassword());
  const [view, setView] = useState<View>('home');
  const [meta, setMeta] = useState<SiteMeta | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const promptSeq = useRef(0);

  useEffect(() => {
    void fetchMeta().then(setMeta);
  }, []);

  /** Enter the chat, optionally queueing a question from the landing page.
   *  The prompt lives here rather than in Chat so it survives the password
   *  gate: set before unlock, it fires once Chat mounts. */
  function openChat(prompt?: string) {
    if (prompt) setPendingPrompt({ text: prompt, seq: ++promptSeq.current });
    setView('chat');
  }

  function lock() {
    clearStoredPassword();
    setPassword(null);
    setView('home');
  }

  /** A 401 mid-conversation: forget the password but stay on the chat view,
   *  so the gate appears in place and the user re-unlocks where they were. */
  function expire() {
    clearStoredPassword();
    setPassword(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')}>
          Thesis Companion
        </button>
        <nav className="tabs">
          <button className={view === 'home' ? 'tab active' : 'tab'} onClick={() => setView('home')}>
            Home
          </button>
          <button className={view === 'chat' ? 'tab active' : 'tab'} onClick={() => setView('chat')}>
            Chat
          </button>
          <button className={view === 'pdf' ? 'tab active' : 'tab'} onClick={() => setView('pdf')}>
            Thesis PDF
          </button>
        </nav>
        <span className="spacer" />
        {password && (
          <button
            className="ghost"
            onClick={lock}
            title="Forget the password in this browser session and return to the start page"
          >
            Lock
          </button>
        )}
      </header>
      {/* All panes stay mounted so switching views neither reloads the PDF
          nor drops the in-memory conversation. */}
      <main className="content">
        <div style={{ display: view === 'home' ? 'contents' : 'none' }}>
          <Landing meta={meta} onOpenChat={openChat} onOpenPdf={() => setView('pdf')} />
        </div>
        <div style={{ display: view === 'chat' ? 'contents' : 'none' }}>
          {password ? (
            <Chat
              meta={meta}
              password={password}
              onAuthExpired={expire}
              pendingPrompt={pendingPrompt}
              onPromptConsumed={() => setPendingPrompt(null)}
            />
          ) : (
            <PasswordGate onUnlock={() => setPassword(getStoredPassword())} />
          )}
        </div>
        <div style={{ display: view === 'pdf' ? 'contents' : 'none' }}>
          <PdfView />
        </div>
      </main>
    </div>
  );
}
