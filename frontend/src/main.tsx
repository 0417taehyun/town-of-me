import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// Bundled so the font comes from this origin, the only one /baseball's CSP allows; the browser fetches just the
// subsets whose unicode-range the page's text needs.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
