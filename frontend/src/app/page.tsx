'use client';

// The whole UI is the same React app as before (src/App.tsx). It talks to the
// API from the browser, so it is rendered on the client only.
import dynamic from 'next/dynamic';

const App = dynamic(() => import('../App'), { ssr: false });

export default function Page() {
  return <App />;
}
