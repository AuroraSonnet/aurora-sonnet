import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Projects from './pages/Projects'
import Proposals from './pages/Proposals'
import Invoices from './pages/Invoices'
import InvoiceView from './pages/InvoiceView'
import Experiences from './pages/Experiences'
import Automations from './pages/Automations'
import Contracts from './pages/Contracts'
import Bookkeeping from './pages/Bookkeeping'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import Newsletter from './pages/Newsletter'
import Inquire from './pages/Inquire'
import InquireDuo from './pages/InquireDuo'
import InquireCombined from './pages/InquireCombined'
import InquireGeneral from './pages/InquireGeneral'
import SignContract from './pages/SignContract'
import RestrictedAccess from './pages/RestrictedAccess'
import WeddingMusicSelection from './pages/WeddingMusicSelection'

const isLocalOrigin = () => {
  const h = typeof window !== 'undefined' ? window.location.hostname : ''
  return h === 'localhost' || h === '127.0.0.1'
}

/** When true, only public routes (invoice view, sign, embed) are allowed; rest show Restricted. */
const isPublicApp = () => !isLocalOrigin()

const isPublicPath = (pathname: string) =>
  /^\/invoices\/view\/[^/]+$/.test(pathname) ||
  /^\/sign\/[^/]+$/.test(pathname) ||
  pathname === '/embed/inquire-general'

function LayoutOrRestricted() {
  const { pathname } = useLocation()
  if (isPublicApp() && !isPublicPath(pathname)) return <RestrictedAccess />
  return <Layout />
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign/:contractId" element={<SignContract />} />
      <Route path="/embed/inquire-general" element={<InquireGeneral />} />
      <Route path="/invoices/view/:id" element={<InvoiceView />} />
      <Route path="/" element={<LayoutOrRestricted />}>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="newsletter" element={<Newsletter />} />
        <Route path="bookings" element={<Projects />} />
        <Route path="proposals" element={<Proposals />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="experiences" element={<Experiences />} />
        <Route path="templates" element={<Navigate to="/contracts" replace />} />
        <Route path="bookkeeping" element={<Bookkeeping />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="automations" element={<Automations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="inquire" element={<Inquire />} />
        <Route path="inquire-duo" element={<InquireDuo />} />
        <Route path="inquire-combined" element={<InquireCombined />} />
        <Route path="inquire-general" element={<InquireGeneral />} />
        <Route path="music-selection" element={<WeddingMusicSelection />} />
      </Route>
    </Routes>
  )
}
