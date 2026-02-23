import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Clients from './pages/Clients'
import ClientDetail from './pages/ClientDetail'
import Projects from './pages/Projects'
import Proposals from './pages/Proposals'
import Invoices from './pages/Invoices'
import Automations from './pages/Automations'
import Contracts from './pages/Contracts'
import Bookkeeping from './pages/Bookkeeping'
import Settings from './pages/Settings'
import Inquire from './pages/Inquire'
import InquireDuo from './pages/InquireDuo'
import InquireCombined from './pages/InquireCombined'
import InquireGeneral from './pages/InquireGeneral'
import ProposalView from './pages/ProposalView'
import SignContract from './pages/SignContract'

export default function App() {
  return (
    <Routes>
      <Route path="/proposal/:id/view" element={<ProposalView />} />
      <Route path="/sign/:contractId" element={<SignContract />} />
      <Route path="/embed/inquire-general" element={<InquireGeneral />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="bookings" element={<Projects />} />
        <Route path="proposals" element={<Proposals />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="templates" element={<Navigate to="/contracts" replace />} />
        <Route path="bookkeeping" element={<Bookkeeping />} />
        <Route path="automations" element={<Automations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="inquire" element={<Inquire />} />
        <Route path="inquire-duo" element={<InquireDuo />} />
        <Route path="inquire-combined" element={<InquireCombined />} />
        <Route path="inquire-general" element={<InquireGeneral />} />
      </Route>
    </Routes>
  )
}
