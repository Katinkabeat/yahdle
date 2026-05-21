import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import { ThemeProvider } from './contexts/ThemeContext.jsx'
import { SQErrorBoundary } from '../../rae-side-quest/packages/sq-ui/index.js'
import './index.css'

// Register service worker for push notifications + PWA.
// Path uses BASE_URL so it works under /yahdle/ in prod and /yahdle/ in dev.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // SW registration failed — push won't work but game still loads fine
    })
  })

  // When a push notification is tapped, the SW posts { type: 'NAVIGATE', url }
  // so we can route to the right page without a full reload.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NAVIGATE' && event.data.url) {
      window.location.href = event.data.url
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SQErrorBoundary label="yahdle">
      <ThemeProvider>
        <BrowserRouter basename="/yahdle">
          <App />
        </BrowserRouter>
        <Toaster position="top-center" toastOptions={{ duration: 1800 }} />
      </ThemeProvider>
    </SQErrorBoundary>
  </React.StrictMode>,
)
