import { Component } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// If something goes wrong while drawing the page, show what happened instead of a blank page,
// with a way to keep a copy of the saved plan and to start again from a fresh plan.
const KEY = 'chemnitz-garage-park-v1'
class Guard extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error(error, info?.componentStack)
  }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    const saved = (() => {
      try {
        return localStorage.getItem(KEY)
      } catch {
        return null
      }
    })()
    const download = () => {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([saved ?? '{}'], { type: 'application/json' }))
      a.download = 'chemnitz-garage-park-plan.json'
      a.click()
    }
    const fresh = () => {
      try {
        if (saved) localStorage.setItem(KEY + '-backup-' + Date.now(), saved) // kept, not deleted
        localStorage.removeItem(KEY)
      } catch {
        /* nothing saved */
      }
      location.reload()
    }
    return (
      <div style={{ maxWidth: 640, margin: '12vh auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
        <h1 style={{ fontSize: 22 }}>The page could not be drawn</h1>
        <p>Something in the page went wrong. This is the message (useful to pass on):</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f1ec', padding: 12, borderRadius: 6, fontSize: 12 }}>
          {String(e?.message ?? e)}
          {'\n'}
          {String(e?.stack ?? '').split('\n').slice(1, 5).join('\n')}
        </pre>
        <p>Your plan is saved in this browser. You can keep a copy of it, then start again from a fresh plan (the old one stays stored as a backup).</p>
        <p style={{ display: 'flex', gap: 8 }}>
          <button onClick={download}>Save a copy of my plan</button>
          <button onClick={fresh}>Start from a fresh plan</button>
          <button onClick={() => location.reload()}>Try again</button>
        </p>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <Guard>
    <App />
  </Guard>,
)
