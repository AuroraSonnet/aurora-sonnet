import { createContext, useContext, useCallback, useMemo, useRef, useState, useEffect, type ReactNode } from 'react'
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
const INQUIRY_API_URL_KEY = 'aurora_inquiry_api_url'

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

/** True if API state has no clients/projects (avoid overwriting user data with empty response). */
function isApiStateEmpty(apiState: { clients: unknown[]; projects: unknown[] } | null): boolean {
  if (!apiState) return true
  return apiState.clients.length === 0 && apiState.projects.length === 0
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
  /** Pull new website inquiries from Inquiry API URL into the app (runs in background). */
  syncInquiriesFromWebsite: () => Promise<void>
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
  const stateRef = useRef(state)
  stateRef.current = state

  // Try to load from API (Node + SQLite) on mount; never overwrite with empty to avoid data loss on refresh/update
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
        }
        // If API returned empty, do NOT overwrite state or auto-seed — keep existing (e.g. localStorage) so user data isn't lost on refresh/update
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
    // Never replace state with empty API response — prevents clients/pipelines from disappearing on refresh or after update
    if (!apiState || isApiStateEmpty(apiState)) return
    setState((prev) => ({
      ...defaultState,
      ...apiState,
      automations: (apiState as { automations?: Automation[] }).automations ?? prev.automations,
      contractTemplates: (apiState as { contractTemplates?: DocumentTemplate[] }).contractTemplates ?? [],
      invoiceTemplates: (apiState as { invoiceTemplates?: DocumentTemplate[] }).invoiceTemplates ?? [],
      pipelineStages: (apiState as { pipelineStages?: AppState['pipelineStages'] }).pipelineStages ?? prev.pipelineStages,
    } as AppState))
  }, [])

  const syncInquiriesFromWebsite = useCallback(async () => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(INQUIRY_API_URL_KEY) : null
      const base = raw && typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : ''
      if (!base) return
      const res = await fetch(`${base}/api/state`)
      if (!res.ok) return
      const apiState = (await res.json()) as {
        clients?: { id: string; name: string; email: string; phone?: string; partnerName?: string; createdAt: string }[]
        projects?: { id: string; clientId: string; clientName: string; title: string; stage: string; value: number; weddingDate: string; venue?: string; packageType?: string; dueDate: string; createdAt?: string }[]
      }
      const cloudClients = apiState.clients ?? []
      const cloudProjects = apiState.projects ?? []
      const current = stateRef.current
      let created = 0
      for (const c of cloudClients) {
        if (!current.clients.some((x) => x.id === c.id)) {
          await apiCreateClient({ ...c, createdAt: c.createdAt ?? new Date().toISOString().slice(0, 10) })
          created++
        }
      }
      for (const p of cloudProjects) {
        if (!current.projects.some((x) => x.id === p.id)) {
          await apiCreateProject({ ...p, dueDate: p.dueDate ?? new Date().toISOString().slice(0, 10) })
          created++
        }
      }
      if (created > 0) await refreshState()
    } catch {
      // ignore (e.g. network, CORS, or URL not set)
    }
  }, [refreshState])

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
        syncInquiriesFromWebsite,
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
      syncInquiriesFromWebsite,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
