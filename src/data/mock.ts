
export interface Client {
  id: string
  name: string
  email: string
  phone?: string
  partnerName?: string
  createdAt: string
}

export type ProjectStage = 'inquiry' | 'proposal' | 'booked' | 'completed' | 'lost'

export interface Project {
  id: string
  clientId: string
  clientName: string
  title: string
  /** Pipeline stage id (e.g. inquiry, booked, or custom stage id) */
  stage: string
  value: number
  weddingDate: string
  venue?: string
  /** Solo or duo package id (e.g. signature-aria, grand-atelier-duo) */
  packageType?: string
  /** Client's requested artist (e.g. when inquiring for a specific vocalist) */
  requestedArtist?: string
  dueDate: string
  createdAt?: string
  /** Inquiry message (e.g. from general contact form) */
  notes?: string
}

export interface Proposal {
  id: string
  projectId: string
  clientName: string
  title: string
  status: 'draft' | 'sent' | 'accepted' | 'declined'
  value: number
  sentAt?: string
}

export interface Invoice {
  id: string
  projectId?: string
  clientName: string
  clientEmail?: string
  projectTitle: string
  amount: number
  status: 'draft' | 'sent' | 'paid' | 'overdue'
  dueDate: string
  paidAt?: string
  type?: 'deposit' | 'balance' | 'full' | 'other'
  templateId?: string
}

export type ContractStatus = 'draft' | 'sent' | 'signed'

export interface Contract {
  id: string
  projectId: string
  clientName: string
  title: string
  status: ContractStatus
  value: number
  weddingDate: string
  venue?: string
  packageType?: string
  signedAt?: string
  createdAt: string
  templateId?: string
  signToken?: string
  clientSignedAt?: string
}

export interface Expense {
  id: string
  date: string
  description: string
  amount: number
  category: string
}

export type AutomationTrigger =
  | 'inquiry_received'
  | 'proposal_sent'
  | 'contract_signed'
  | 'deposit_paid'
  | 'wedding_week'

export type AutomationAction =
  | 'send_proposal_reminder'
  | 'send_contract_reminder'
  | 'send_invoice'
  | 'send_thank_you'
  | 'add_to_calendar'

export interface Automation {
  id: string
  name: string
  trigger: AutomationTrigger
  action: AutomationAction
  enabled: boolean
  delayDays?: number
  description: string
}

// Wedding-focused mock data for Aurora Sonnet (singing agency)
export const clients: Client[] = [
  { id: '1', name: 'Emma Walsh', email: 'emma.walsh@email.com', phone: '(555) 201-3401', partnerName: 'James Walsh', createdAt: '2025-01-15' },
  { id: '2', name: 'Michael Torres', email: 'michael.t@email.com', phone: '(555) 202-3402', partnerName: 'Sofia Torres', createdAt: '2025-02-01' },
  { id: '3', name: 'Rachel Kim', email: 'rachel.kim@email.com', partnerName: 'David Kim', createdAt: '2025-02-10' },
  { id: '4', name: 'Lauren Mitchell', email: 'lauren.m@email.com', phone: '(555) 204-3404', partnerName: 'Chris Mitchell', createdAt: '2025-02-14' },
  { id: '5', name: 'Jessica Park', email: 'jessica.park@email.com', createdAt: '2025-02-18' },
]

export const projects: Project[] = [
  { id: 'p1', clientId: '1', clientName: 'Emma & James Walsh', title: 'Garden Estate Wedding', stage: 'proposal', value: 3950, weddingDate: '2025-06-14', venue: 'Garden Estate Vineyard', packageType: 'aria-plus', dueDate: '2025-03-15', createdAt: '2025-02-10' },
  { id: 'p2', clientId: '2', clientName: 'Michael & Sofia Torres', title: 'Beach House Wedding', stage: 'booked', value: 2750, weddingDate: '2025-05-22', venue: 'Sunset Beach House', packageType: 'signature-aria', dueDate: '2025-04-01', createdAt: '2025-02-01' },
  { id: 'p3', clientId: '3', clientName: 'Rachel & David Kim', title: 'City Loft Wedding', stage: 'inquiry', value: 5800, weddingDate: '2025-08-08', venue: 'The Loft at 7th', packageType: 'grand-atelier', dueDate: '2025-03-30', createdAt: '2025-02-15' },
  { id: 'p4', clientId: '4', clientName: 'Lauren & Chris Mitchell', title: 'Barn Wedding', stage: 'proposal', value: 2750, weddingDate: '2025-07-12', venue: 'Oak Hill Barn', packageType: 'signature-aria', dueDate: '2025-03-22', createdAt: '2025-02-12' },
  { id: 'p5', clientId: '2', clientName: 'Michael & Sofia Torres', title: 'Anniversary event', stage: 'completed', value: 600, weddingDate: '2024-11-01', venue: 'Private home', dueDate: '2024-10-15', createdAt: '2024-10-01' },
]

export const proposals: Proposal[] = [
  { id: 'pr1', projectId: 'p1', clientName: 'Emma & James Walsh', title: 'Garden Estate Wedding', status: 'sent', value: 3950, sentAt: '2025-02-18' },
  { id: 'pr2', projectId: 'p4', clientName: 'Lauren & Chris Mitchell', title: 'Barn Wedding', status: 'draft', value: 2750 },
]

export const invoices: Invoice[] = [
  { id: 'i1', projectId: 'p2', clientName: 'Michael & Sofia Torres', clientEmail: 'michael.t@email.com', projectTitle: 'Beach House Wedding — Deposit', amount: 1375, status: 'paid', dueDate: '2025-02-28', paidAt: '2025-02-25', type: 'deposit' },
  { id: 'i2', projectId: 'p2', clientName: 'Michael & Sofia Torres', clientEmail: 'michael.t@email.com', projectTitle: 'Beach House Wedding — Balance', amount: 1375, status: 'sent', dueDate: '2025-05-15', type: 'balance' },
  { id: 'i3', clientName: 'Rachel & David Kim', clientEmail: 'rachel.kim@email.com', projectTitle: 'Consultation fee', amount: 150, status: 'overdue', dueDate: '2025-02-15', type: 'other' },
]

export const contracts: Contract[] = [
  { id: 'c1', projectId: 'p2', clientName: 'Michael & Sofia Torres', title: 'Beach House Wedding', status: 'signed', value: 2750, weddingDate: '2025-05-22', venue: 'Sunset Beach House', packageType: 'signature-aria', signedAt: '2025-02-20', createdAt: '2025-02-15' },
  { id: 'c2', projectId: 'p1', clientName: 'Emma & James Walsh', title: 'Garden Estate Wedding', status: 'sent', value: 3950, weddingDate: '2025-06-14', venue: 'Garden Estate Vineyard', packageType: 'aria-plus', createdAt: '2025-02-18' },
]

export const expenses: Expense[] = [
  { id: 'e1', date: '2025-02-10', description: 'Sheet music / backing tracks', amount: 45, category: 'Materials' },
  { id: 'e2', date: '2025-02-15', description: 'Mileage to venue site visit', amount: 28, category: 'Travel' },
]

export const automations: Automation[] = [
  { id: 'a1', name: 'Send proposal after inquiry', trigger: 'inquiry_received', action: 'send_proposal_reminder', enabled: true, delayDays: 2, description: 'Send proposal template 2 days after new inquiry' },
  { id: 'a2', name: 'Contract reminder', trigger: 'proposal_sent', action: 'send_contract_reminder', enabled: true, delayDays: 5, description: 'Remind couple to sign contract 5 days after proposal sent' },
  { id: 'a3', name: 'Invoice after booking', trigger: 'contract_signed', action: 'send_invoice', enabled: true, description: 'Send deposit invoice when contract is signed' },
  { id: 'a4', name: 'Wedding week check-in', trigger: 'wedding_week', action: 'add_to_calendar', enabled: true, delayDays: 7, description: 'Add to your calendar and send final details 1 week before wedding' },
  { id: 'a5', name: 'Thank you after wedding', trigger: 'contract_signed', action: 'send_thank_you', enabled: false, description: 'Send thank-you email after wedding date (manual trigger for now)' },
]
