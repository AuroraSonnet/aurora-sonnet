import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppProvider } from './context/AppContext'
import { UndoProvider } from './context/UndoContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <UndoProvider>
          <App />
        </UndoProvider>
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
)
