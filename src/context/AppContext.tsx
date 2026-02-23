import { createContext, useContext, useCallback, useMemo, useState, useEffect, type ReactNode } from 'react'
import {
  clients as initialClients,
  projects as initialProjects,
  proposals as initialProposals,
  invoices as initialInvoices,
  contracts as initialContracts,
  expenses as initialExpenses,
  automations as initialAutomations,
  type Client,
  type Project,
  type Proposal,
  type Invoice,
  type Contract,
  type Expense,
  type Automation,
} from '../data/mock'
import {
  fetchState,
  seedDatabase,
  apiCreateClient,
  apiUpdateClient,
  apiCreateProject,
  apiUpdateProject,
  apiCreateProposal,
  apiCreateContract,
  apiUpdateContract,
  apiCreateInvoice,
  apiUpdateInvoice,
  apiCreateExpense,
  apiDeleteExpense,
} from '../api/db'

const STORAGE_KEY = 'aurora_sonnet_data'

interface DocumentTemplate {
  id: string
  name: string
  fileName: string
  createdAt: string
}

interface PipelineStage {
  id: string
  label: string
  sortOrder: number
}

interface AppState {
  clients: Client[]
  projects: Project[]
  proposals: Proposal[]
  invoices: Invoice[]
  contracts: Contract[]
  expenses: Expense[]
  automations: Automation[]
  contractTemplates: DocumentTemplate[]
  invoiceTemplates: DocumentTemplate[]
  pipelineStages: PipelineStage[]
}

const defaultPipelineStages: PipelineStage[] = [
  { id: 'inquiry', label: 'Inquiry', sortOrder: 1 },
  { id: 'proposal', label: 'Proposal', sortOrder: 2 },
  { id: 'booked', label: 'Booked', sortOrder: 3 },
  { id: 'completed', label: 'Completed', sortOrder: 4 },
  { id: 'lost', label: 'Lost', sortOrder: 5 },
]

const defaultState: AppState = {
  clients: initialClients,
  projects: initialProjects,
  proposals: initialProposals,
  invoices: initialInvoices,
  contracts: initialContracts,
  expenses: initialExpenses,
  automations: initialAutomations,
  contractTemplates: [],
  invoiceTemplates: [],
  pipelineStages: defaultPipelineStages,
}

function loadStateFromStorage(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
        return {
          clients: parsed.clients ?? defaultState.clients,
          projects: parsed.projects ?? defaultState.projects,
          proposals: parsed.proposals ?? defaultState.proposals,
          invoices: parsed.invoices ?? defaultState.invoices,
          contracts: parsed.contracts ?? defaultState.contracts,
          expenses: parsed.expenses ?? defaultState.expenses,
          automations: parsed.automations ?? defaultState.automations,
          contractTemplates: parsed.contractTemplates ?? defaultState.contractTemplates,
          invoiceTemplates: parsed.invoiceTemplates ?? defaultState.invoiceTemplates,
          pipelineStages: parsed.pipelineStages ?? defaultState.pipelineStages,
        }
    }
  } catch (_) {}
  return defaultState
}

function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (_) {}
}

type AppActions = {
  updateProject: (id: string, updates: Partial<Project>) => void
  updateClient: (id: string, updates: Partial<Client>) => void
  addClient: (client: Omit<Client, 'id'>) => string
  addProject: (project: Omit<Project, 'id'>) => string
  addProposal: (proposal: Omit<Proposal, 'id'>) => string
  addContract: (contract: Omit<Contract, 'id'>) => string
  updateContract: (id: string, updates: Partial<Contract>) => void
  addInvoice: (invoice: Omit<Invoice, 'id'>) => string
  updateInvoice: (id: string, updates: Partial<Invoice>) => void
  addExpense: (expense: Omit<Expense, 'id'>) => string
  deleteExpense: (id: string) => void
  setAutomationEnabled: (id: string, enabled: boolean) => void
  refreshState: () => Promise<void>
}

const AppContext = createContext<{ state: AppState; actions: AppActions } | null>(null)

function nextId(prefix: string, existing: { id: string }[]): string {
  if (prefix === '') {
    const nums = existing.map((x) => parseInt(x.id.replace(/\D/g, ''), 10)).filter((n) => !isNaN(n))
    const max = nums.length ? Math.max(...nums, 0) : 0
    return String(max + 1)
  }
  const nums = existing.map((x) => parseInt(x.id.replace(/\D/g, ''), 10)).filter((n) => !isNaN(n))
  const max = nums.length ? Math.max(...nums, 0) : 0
  return `${prefix}${max + 1}`
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadStateFromStorage)
  const [useApi, setUseApi] = useState(false)

  // Try to load from API (Node + SQLite) on mount; fallback to localStorage
  useEffect(() => {
    let cancelled = false
    fetchState().then(async (apiState) => {
      if (cancelled) return
      if (apiState) {
        setUseApi(true)
        const hasData =
          apiState.clients.length > 0 ||
          apiState.projects.length > 0 ||
          apiState.proposals.length > 0 ||
          apiState.invoices.length > 0 ||
          apiState.contracts.length > 0 ||
          apiState.expenses.length > 0
        if (hasData) {
          setState({
            ...defaultState,
            ...apiState,
            automations: (apiState as { automations?: Automation[] }).automations ?? defaultState.automations,
            contractTemplates: (apiState as { contractTemplates?: AppState['contractTemplates'] }).contractTemplates ?? [],
            invoiceTemplates: (apiState as { invoiceTemplates?: AppState['invoiceTemplates'] }).invoiceTemplates ?? [],
            pipelineStages: (apiState as { pipelineStages?: AppState['pipelineStages'] }).pipelineStages ?? defaultState.pipelineStages,
          } as AppState)
        } else {
          // Empty DB: seed with sample data so first-time users see something
          const seeded = await seedDatabase()
          if (!cancelled && seeded) setState(seeded as AppState)
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!useApi) saveState(state)
  }, [state, useApi])

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setState((s) => {
      const next = { ...s, projects: s.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)) }
      if (useApi) apiUpdateProject(id, updates)
      return next
    })
  }, [useApi])

  const updateClient = useCallback((id: string, updates: Partial<Client>) => {
    setState((s) => {
      const next = { ...s, clients: s.clients.map((c) => (c.id === id ? { ...c, ...updates } : c)) }
      if (useApi) apiUpdateClient(id, updates)
      return next
    })
  }, [useApi])

  const addClient = useCallback((client: Omit<Client, 'id'>): string => {
    const id = nextId('', state.clients)
    const newClient = { ...client, id }
    setState((s) => ({ ...s, clients: [...s.clients, newClient] }))
    if (useApi) apiCreateClient({ ...newClient, createdAt: newClient.createdAt })
    return id
  }, [state.clients, useApi])

  const addProject = useCallback((project: Omit<Project, 'id'>): string => {
    const id = nextId('p', state.projects)
    const createdAt = project.createdAt ?? new Date().toISOString().slice(0, 10)
    const newProject = { ...project, id, createdAt }
    setState((s) => ({ ...s, projects: [...s.projects, newProject] }))
    if (useApi) apiCreateProject(newProject as Record<string, unknown>)
    return id
  }, [state.projects, useApi])

  const addProposal = useCallback((proposal: Omit<Proposal, 'id'>): string => {
    const id = nextId('pr', state.proposals)
    const newProposal = { ...proposal, id }
    setState((s) => ({ ...s, proposals: [...s.proposals, newProposal] }))
    if (useApi) apiCreateProposal(newProposal as Record<string, unknown>)
    return id
  }, [state.proposals, useApi])

  const addContract = useCallback((contract: Omit<Contract, 'id'>): string => {
    const id = nextId('c', state.contracts)
    const newContract = { ...contract, id }
    setState((s) => ({ ...s, contracts: [...s.contracts, newContract] }))
    if (useApi) apiCreateContract(newContract as Record<string, unknown>)
    return id
  }, [state.contracts, useApi])

  const updateContract = useCallback((id: string, updates: Partial<Contract>) => {
    setState((s) => {
      const next = { ...s, contracts: s.contracts.map((c) => (c.id === id ? { ...c, ...updates } : c)) }
      if (useApi) apiUpdateContract(id, updates as Record<string, unknown>)
      return next
    })
  }, [useApi])

  const addInvoice = useCallback((invoice: Omit<Invoice, 'id'>): string => {
    const id = nextId('i', state.invoices)
    const newInvoice = { ...invoice, id }
    setState((s) => ({ ...s, invoices: [...s.invoices, newInvoice] }))
    if (useApi) apiCreateInvoice(newInvoice as Record<string, unknown>)
    return id
  }, [state.invoices, useApi])

  const updateInvoice = useCallback((id: string, updates: Partial<Invoice>) => {
    setState((s) => {
      const next = { ...s, invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...updates } : i)) }
      if (useApi) apiUpdateInvoice(id, updates as Record<string, unknown>)
      return next
    })
  }, [useApi])

  const addExpense = useCallback((expense: Omit<Expense, 'id'>): string => {
    const id = nextId('e', state.expenses)
    const newExpense = { ...expense, id }
    setState((s) => ({ ...s, expenses: [...s.expenses, newExpense] }))
    if (useApi) apiCreateExpense(newExpense as Record<string, unknown>)
    return id
  }, [state.expenses, useApi])

  const deleteExpense = useCallback((id: string) => {
    setState((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }))
    if (useApi) apiDeleteExpense(id)
  }, [useApi])

  const setAutomationEnabled = useCallback((id: string, enabled: boolean) => {
    setState((s) => ({
      ...s,
      automations: s.automations.map((a) => (a.id === id ? { ...a, enabled } : a)),
    }))
  }, [])

  const refreshState = useCallback(async () => {
    const apiState = await fetchState()
    if (apiState) {
      setState((prev) => ({
        ...defaultState,
        ...apiState,
        automations: (apiState as { automations?: Automation[] }).automations ?? prev.automations,
        contractTemplates: (apiState as { contractTemplates?: DocumentTemplate[] }).contractTemplates ?? [],
        invoiceTemplates: (apiState as { invoiceTemplates?: DocumentTemplate[] }).invoiceTemplates ?? [],
      } as AppState))
    }
  }, [])

  const value = useMemo(
    () => ({
      state,
      actions: {
        updateProject,
        updateClient,
        addClient,
        addProject,
        addProposal,
        addContract,
        updateContract,
        addInvoice,
        updateInvoice,
        addExpense,
        deleteExpense,
        setAutomationEnabled,
        refreshState,
      },
    }),
    [
      state,
      updateProject,
      updateClient,
      addClient,
      addProject,
      addProposal,
      addContract,
      updateContract,
      addInvoice,
      updateInvoice,
      addExpense,
      deleteExpense,
      setAutomationEnabled,
      refreshState,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
