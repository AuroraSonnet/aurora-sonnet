// Same as src/data/mock.ts for initial DB seed (clients, projects, proposals, invoices, contracts, expenses)
export const seedClients = [
  { id: '1', name: 'Emma Walsh', email: 'emma.walsh@email.com', phone: '(555) 201-3401', partnerName: 'James Walsh', createdAt: '2025-01-15' },
  { id: '2', name: 'Michael Torres', email: 'michael.t@email.com', phone: '(555) 202-3402', partnerName: 'Sofia Torres', createdAt: '2025-02-01' },
  { id: '3', name: 'Rachel Kim', email: 'rachel.kim@email.com', partnerName: 'David Kim', createdAt: '2025-02-10' },
  { id: '4', name: 'Lauren Mitchell', email: 'lauren.m@email.com', phone: '(555) 204-3404', partnerName: 'Chris Mitchell', createdAt: '2025-02-14' },
  { id: '5', name: 'Jessica Park', email: 'jessica.park@email.com', createdAt: '2025-02-18' },
]

export const seedProjects = [
  { id: 'p1', clientId: '1', clientName: 'Emma & James Walsh', title: 'Garden Estate Wedding', stage: 'proposal', value: 1200, weddingDate: '2025-06-14', venue: 'Garden Estate Vineyard', packageType: 'ceremony-and-reception', dueDate: '2025-03-15', createdAt: '2025-02-10' },
  { id: 'p2', clientId: '2', clientName: 'Michael & Sofia Torres', title: 'Beach House Wedding', stage: 'booked', value: 950, weddingDate: '2025-05-22', venue: 'Sunset Beach House', packageType: 'ceremony', dueDate: '2025-04-01', createdAt: '2025-02-01' },
  { id: 'p3', clientId: '3', clientName: 'Rachel & David Kim', title: 'City Loft Wedding', stage: 'inquiry', value: 1400, weddingDate: '2025-08-08', venue: 'The Loft at 7th', packageType: 'ceremony-and-reception', dueDate: '2025-03-30', createdAt: '2025-02-15' },
  { id: 'p4', clientId: '4', clientName: 'Lauren & Chris Mitchell', title: 'Barn Wedding', stage: 'proposal', value: 1100, weddingDate: '2025-07-12', venue: 'Oak Hill Barn', packageType: 'reception', dueDate: '2025-03-22', createdAt: '2025-02-12' },
  { id: 'p5', clientId: '2', clientName: 'Michael & Sofia Torres', title: 'Anniversary event', stage: 'completed', value: 600, weddingDate: '2024-11-01', venue: 'Private home', dueDate: '2024-10-15', createdAt: '2024-10-01' },
]

export const seedProposals = [
  { id: 'pr1', projectId: 'p1', clientName: 'Emma & James Walsh', title: 'Garden Estate Wedding', status: 'sent', value: 1200, sentAt: '2025-02-18' },
  { id: 'pr2', projectId: 'p4', clientName: 'Lauren & Chris Mitchell', title: 'Barn Wedding', status: 'draft', value: 1100 },
]

export const seedInvoices = [
  { id: 'i1', projectId: 'p2', clientName: 'Michael & Sofia Torres', clientEmail: 'michael.t@email.com', projectTitle: 'Beach House Wedding — Deposit', amount: 475, status: 'paid', dueDate: '2025-02-28', paidAt: '2025-02-25', type: 'deposit' },
  { id: 'i2', projectId: 'p2', clientName: 'Michael & Sofia Torres', clientEmail: 'michael.t@email.com', projectTitle: 'Beach House Wedding — Balance', amount: 475, status: 'sent', dueDate: '2025-05-15', type: 'balance' },
  { id: 'i3', clientName: 'Rachel & David Kim', clientEmail: 'rachel.kim@email.com', projectTitle: 'Consultation fee', amount: 150, status: 'overdue', dueDate: '2025-02-15', type: 'other' },
]

export const seedContracts = [
  { id: 'c1', projectId: 'p2', clientName: 'Michael & Sofia Torres', title: 'Beach House Wedding', status: 'signed', value: 950, weddingDate: '2025-05-22', venue: 'Sunset Beach House', packageType: 'ceremony', signedAt: '2025-02-20', createdAt: '2025-02-15' },
  { id: 'c2', projectId: 'p1', clientName: 'Emma & James Walsh', title: 'Garden Estate Wedding', status: 'sent', value: 1200, weddingDate: '2025-06-14', venue: 'Garden Estate Vineyard', packageType: 'ceremony-and-reception', createdAt: '2025-02-18' },
]

export const seedExpenses = [
  { id: 'e1', date: '2025-02-10', description: 'Sheet music / backing tracks', amount: 45, category: 'Materials' },
  { id: 'e2', date: '2025-02-15', description: 'Mileage to venue site visit', amount: 28, category: 'Travel' },
]
