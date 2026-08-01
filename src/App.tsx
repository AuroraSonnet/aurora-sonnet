import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import { useAuth } from './context/AuthContext'
import Dashboard from './pages/Dashboard'
import MonthlyTargets from './pages/MonthlyTargets'
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
import AcceptProposal from './pages/AcceptProposal'
import WeddingMusicSelection from './pages/WeddingMusicSelection'
import PartnershipOutreach from './pages/PartnershipOutreach'
import OutreachToday from './pages/OutreachToday'
import OutreachScoreboard from './pages/OutreachScoreboard'

function RequireAuthLayout() {
  const { authenticated, loading } = useAuth()
  const { pathname } = useLocation()
  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading…
      </div>
    )
  }
  if (!authenticated) {
    return <Navigate to="/login" state={{ from: pathname }} replace />
  }
  return <Layout />
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign/:contractId" element={<SignContract />} />
      <Route path="/accept-proposal/:proposalId" element={<AcceptProposal />} />
      <Route path="/embed/inquire-general" element={<InquireGeneral />} />
      <Route path="/invoices/view/:id" element={<InvoiceView />} />
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<RequireAuthLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="monthly-targets" element={<MonthlyTargets />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="newsletter" element={<Newsletter />} />
        <Route path="bookings" element={<Projects />} />
        <Route path="proposals" element={<Proposals />} />
        <Route path="partnership-outreach" element={<PartnershipOutreach />} />
        <Route path="outreach-today" element={<OutreachToday />} />
        <Route path="outreach-scoreboard" element={<OutreachScoreboard />} />
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
