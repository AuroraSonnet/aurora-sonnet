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
  type CalendarReminder,
} from '../data/mock'
import {
  fetchState,
  apiCreateClient,
  apiUpdateClient,
  apiCreateProject,
  apiUpdateProject,
  apiCreateProposal,
  apiUpdateProposal,
  apiCreateContract,
  apiUpdateContract,
  apiCreateInvoice,
  apiUpdateInvoice,
  apiCreateExpense,
  apiDeleteExpense,
  apiCreateCalendarReminder,
  apiUpdateCalendarReminder,
  apiDeleteCalendarReminder,
} from '../api/db'
import { playNewInquirySound } from '../utils/sound'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'

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

interface NewsletterTemplate {
  id: string
  name: string
  subject: string
  body: string
  createdAt: string
}

interface AppState {
  clients: Client[]
  projects: Project[]
  proposals: Proposal[]
  invoices: Invoice[]
  contracts: Contract[]
  expenses: Expense[]
  automations: Automation[]
  calendarReminders: CalendarReminder[]
  contractTemplates: DocumentTemplate[]
  invoiceTemplates: DocumentTemplate[]
  pipelineStages: PipelineStage[]
  newsletterTemplates: NewsletterTemplate[]
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
  calendarReminders: [],
  contractTemplates: [],
  invoiceTemplates: [],
  pipelineStages: defaultPipelineStages,
  newsletterTemplates: [],
}

/** Never overwrite existing data with an empty list. If we have data and the API returns empty for that list, we keep ours. */
function preferNonEmpty<T>(prev: T[], next: T[] | undefined): T[] {
  if (!next) return prev
  if (prev.length > 0 && next.length === 0) return prev
  return next
}

/** Merge API state into app state without ever wiping a non-empty list. Use for initial load only (protects against empty API on cold start). */
function mergeStateFromApi(
  prev: AppState,
  apiState: AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }
): AppState {
  return {
    ...defaultState,
    ...apiState,
    clients: preferNonEmpty(prev.clients, apiState.clients),
    projects: preferNonEmpty(prev.projects, apiState.projects),
    proposals: preferNonEmpty(prev.proposals, apiState.proposals),
    invoices: preferNonEmpty(prev.invoices, apiState.invoices),
    contracts: preferNonEmpty(prev.contracts, apiState.contracts),
    expenses: preferNonEmpty(prev.expenses, apiState.expenses),
    automations: preferNonEmpty(prev.automations, apiState.automations) as Automation[],
    calendarReminders: preferNonEmpty(prev.calendarReminders, apiState.calendarReminders),
    contractTemplates: preferNonEmpty(prev.contractTemplates, apiState.contractTemplates),
    invoiceTemplates: preferNonEmpty(prev.invoiceTemplates, apiState.invoiceTemplates),
    pipelineStages: preferNonEmpty(prev.pipelineStages, apiState.pipelineStages),
    newsletterTemplates: prev.newsletterTemplates,
  } as AppState
}

/** Merge API state trusting the response (for explicit refresh after delete/add). Accepts empty lists so deletes work. */
function mergeStateFromApiTrusted(
  prev: AppState,
  apiState: AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }
): AppState {
  return {
    ...defaultState,
    ...apiState,
    clients: apiState.clients ?? prev.clients,
    projects: apiState.projects ?? prev.projects,
    proposals: apiState.proposals ?? prev.proposals,
    invoices: apiState.invoices ?? prev.invoices,
    contracts: apiState.contracts ?? prev.contracts,
    expenses: apiState.expenses ?? prev.expenses,
    automations: (apiState.automations ?? prev.automations) as Automation[],
    calendarReminders: apiState.calendarReminders ?? prev.calendarReminders,
    contractTemplates: apiState.contractTemplates ?? prev.contractTemplates,
    invoiceTemplates: apiState.invoiceTemplates ?? prev.invoiceTemplates,
    pipelineStages: apiState.pipelineStages ?? prev.pipelineStages,
    newsletterTemplates: prev.newsletterTemplates,
  } as AppState
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
          calendarReminders: parsed.calendarReminders ?? defaultState.calendarReminders,
          contractTemplates: parsed.contractTemplates ?? defaultState.contractTemplates,
          invoiceTemplates: parsed.invoiceTemplates ?? defaultState.invoiceTemplates,
          pipelineStages: parsed.pipelineStages ?? defaultState.pipelineStages,
          newsletterTemplates: parsed.newsletterTemplates ?? defaultState.newsletterTemplates,
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
  addProposal: (proposal: Omit<Proposal, 'id'>) => Promise<string>
  updateProposal: (id: string, updates: Partial<Proposal>) => Promise<boolean>
  addContract: (contract: Omit<Contract, 'id'>) => string
  updateContract: (id: string, updates: Partial<Contract>) => void
  addInvoice: (invoice: Omit<Invoice, 'id'>) => string
  updateInvoice: (id: string, updates: Partial<Invoice>) => void
  addExpense: (expense: Omit<Expense, 'id'>) => string
  deleteExpense: (id: string) => void
  addCalendarReminder: (reminder: Omit<CalendarReminder, 'id'>) => string
  updateCalendarReminder: (id: string, updates: Partial<CalendarReminder>) => void
  deleteCalendarReminder: (id: string) => void
  setAutomationEnabled: (id: string, enabled: boolean) => void
  refreshState: () => Promise<void>
  /** Remove one client and their projects from local state only (after API delete succeeded). Avoids refreshState overwriting with empty. */
  removeClientLocally: (clientId: string) => void
  /** Add a client and their projects back to local state (for undo after delete). Keeps undo correct without relying on refreshState. */
  restoreClientLocally: (client: Client, projects: Project[]) => void
  /** Pull new website inquiries from Inquiry API URL into the app (runs in background). */
  syncInquiriesFromWebsite: () => Promise<void>
  addNewsletterTemplate: (template: Omit<NewsletterTemplate, 'id' | 'createdAt'>) => string
  updateNewsletterTemplate: (id: string, updates: Partial<Pick<NewsletterTemplate, 'name' | 'subject' | 'body'>>) => void
  deleteNewsletterTemplate: (id: string) => void
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

  // Try to load from API (Node + SQLite) on mount; never overwrite with empty to avoid data loss on refresh/update.
  // If same-origin fetch fails or returns empty, also try the inquiry API URL so the URL app shows data when opened from another host or after cold start.
  useEffect(() => {
    let cancelled = false
    async function loadInitialState() {
      const apiState = await fetchState()
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
          setState((prev) => mergeStateFromApi(prev, apiState as AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }))
          return
        }
      }
      // Fallback: same-origin failed or returned empty — fetch from inquiry API URL so URL app shows inquiries (e.g. when opened from aurorasonnet.com or after cold start)
      const base = getInquiryApiBaseUrl()
      if (!base) return
      try {
        const res = await fetch(`${base}/api/state`)
        if (cancelled || !res.ok) return
        const fallbackState = (await res.json()) as AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }
        if (cancelled) return
        const hasData =
          (fallbackState.clients?.length ?? 0) > 0 ||
          (fallbackState.projects?.length ?? 0) > 0 ||
          (fallbackState.proposals?.length ?? 0) > 0 ||
          (fallbackState.invoices?.length ?? 0) > 0 ||
          (fallbackState.contracts?.length ?? 0) > 0 ||
          (fallbackState.expenses?.length ?? 0) > 0
        if (hasData) {
          setUseApi(true)
          setState((prev) => mergeStateFromApi(prev, fallbackState))
        }
      } catch {
        // ignore
      }
    }
    loadInitialState()
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

  const addProposal = useCallback(async (proposal: Omit<Proposal, 'id'>): Promise<string> => {
    const id = nextId('pr', state.proposals)
    const newProposal = { ...proposal, id }
    setState((s) => ({ ...s, proposals: [...s.proposals, newProposal] }))
    if (useApi) await apiCreateProposal(newProposal as Record<string, unknown>)
    return id
  }, [state.proposals, useApi])

  const updateProposal = useCallback(async (id: string, updates: Partial<Proposal>): Promise<boolean> => {
    setState((s) => ({ ...s, proposals: s.proposals.map((p) => (p.id === id ? { ...p, ...updates } : p)) }))
    if (useApi) return apiUpdateProposal(id, updates as Record<string, unknown>)
    return true
  }, [useApi])

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

  const addCalendarReminder = useCallback((reminder: Omit<CalendarReminder, 'id'>): string => {
    const id = nextId('cr', state.calendarReminders)
    const newReminder = { ...reminder, id }
    setState((s) => ({ ...s, calendarReminders: [...s.calendarReminders, newReminder] }))
    if (useApi) apiCreateCalendarReminder(newReminder)
    return id
  }, [state.calendarReminders, useApi])

  const updateCalendarReminder = useCallback((id: string, updates: Partial<CalendarReminder>) => {
    setState((s) => ({
      ...s,
      calendarReminders: s.calendarReminders.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    }))
    if (useApi) apiUpdateCalendarReminder(id, updates as Record<string, unknown>)
  }, [useApi])

  const deleteCalendarReminder = useCallback((id: string) => {
    setState((s) => ({ ...s, calendarReminders: s.calendarReminders.filter((r) => r.id !== id) }))
    if (useApi) apiDeleteCalendarReminder(id)
  }, [useApi])

  const addNewsletterTemplate = useCallback(
    (template: Omit<NewsletterTemplate, 'id' | 'createdAt'>): string => {
      const id = nextId('nt', state.newsletterTemplates)
      const createdAt = new Date().toISOString().slice(0, 10)
      const nextTemplate: NewsletterTemplate = { ...template, id, createdAt }
      setState((s) => ({ ...s, newsletterTemplates: [...s.newsletterTemplates, nextTemplate] }))
      return id
    },
    [state.newsletterTemplates]
  )

  const updateNewsletterTemplate = useCallback((id: string, updates: Partial<Pick<NewsletterTemplate, 'name' | 'subject' | 'body'>>) => {
    setState((s) => ({
      ...s,
      newsletterTemplates: s.newsletterTemplates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }))
  }, [])

  const deleteNewsletterTemplate = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      newsletterTemplates: s.newsletterTemplates.filter((t) => t.id !== id),
    }))
  }, [])

  const setAutomationEnabled = useCallback((id: string, enabled: boolean) => {
    setState((s) => ({
      ...s,
      automations: s.automations.map((a) => (a.id === id ? { ...a, enabled } : a)),
    }))
  }, [])

  const refreshState = useCallback(async () => {
    type MinimalState = {
      clients?: { id: string }[]
      projects?: { id: string }[]
      proposals?: { id: string }[]
      invoices?: { id: string }[]
      contracts?: { id: string }[]
      expenses?: { id: string }[]
    }
    function hasData(s: MinimalState | null | undefined): boolean {
      if (!s) return false
      return (
        (s.clients?.length ?? 0) > 0 ||
        (s.projects?.length ?? 0) > 0 ||
        (s.proposals?.length ?? 0) > 0 ||
        (s.invoices?.length ?? 0) > 0 ||
        (s.contracts?.length ?? 0) > 0 ||
        (s.expenses?.length ?? 0) > 0
      )
    }
    let apiState = await fetchState()
    // If same-origin returned empty or failed, try inquiry API URL so refresh doesn't wipe data or use wrong backend
    if (!hasData(apiState)) {
      const base = getInquiryApiBaseUrl()
      if (base) {
        try {
          const res = await fetch(`${base}/api/state`)
          if (res.ok) {
            const fallback = (await res.json()) as MinimalState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }
            if (hasData(fallback)) apiState = fallback
          }
        } catch {
          // ignore
        }
      }
    }
    if (!apiState || !hasData(apiState as MinimalState)) return // don't overwrite with empty
    setState((prev) => mergeStateFromApiTrusted(prev, apiState as AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }))
  }, [])

  const removeClientLocally = useCallback((clientId: string) => {
    setState((s) => ({
      ...s,
      clients: s.clients.filter((c) => c.id !== clientId),
      projects: s.projects.filter((p) => p.clientId !== clientId),
    }))
  }, [])

  const restoreClientLocally = useCallback((client: Client, projects: Project[]) => {
    setState((s) => ({
      ...s,
      clients: s.clients.some((c) => c.id === client.id) ? s.clients : [...s.clients, client],
      projects: [
        ...s.projects.filter((p) => p.clientId !== client.id),
        ...projects,
      ],
    }))
  }, [])

  const syncInquiriesFromWebsite = useCallback(async () => {
    try {
      const base = getInquiryApiBaseUrl()
      if (!base) return
      const res = await fetch(`${base}/api/state`)
      if (!res.ok) return
      const apiState = (await res.json()) as {
        clients?: { id: string; name: string; email: string; phone?: string; partnerName?: string; createdAt: string }[]
        projects?: { id: string; clientId: string; clientName: string; title: string; stage: string; value: number; weddingDate: string; venue?: string; packageType?: string; dueDate: string; createdAt?: string; notes?: string }[]
      }
      const cloudClients = apiState.clients ?? []
      const cloudProjects = apiState.projects ?? []
      const current = stateRef.current
      let localClientsSnapshot = [...current.clients]
      let localProjectsSnapshot = [...current.projects]
      let created = 0
      let usedApiSuccess = false
      for (const c of cloudClients) {
        if (!localClientsSnapshot.some((x) => x.id === c.id)) {
          const clientData = { ...c, createdAt: c.createdAt ?? new Date().toISOString().slice(0, 10) }
          const ok = await apiCreateClient(clientData)
          if (ok) {
            localClientsSnapshot = [...localClientsSnapshot, clientData]
            created++
            usedApiSuccess = true
          } else {
            setState((prev) => {
              const next = { ...prev, clients: [...prev.clients, clientData] }
              saveState(next)
              return next
            })
            localClientsSnapshot = [...localClientsSnapshot, clientData]
            created++
          }
        }
      }
      for (const p of cloudProjects) {
        const alreadyExists = localProjectsSnapshot.some(
          (x) =>
            x.clientName === p.clientName &&
            x.title === p.title &&
            x.stage === p.stage &&
            (x.notes || '') === (p.notes || '') &&
            x.weddingDate === p.weddingDate
        )
        if (alreadyExists) continue
        const newId = nextId('p', localProjectsSnapshot)
        const createdAt = p.createdAt ?? new Date().toISOString().slice(0, 10)
        const dueDate = p.dueDate ?? createdAt
        const projectData = { ...p, id: newId, createdAt, dueDate }
        const ok = await apiCreateProject(projectData as Record<string, unknown>)
        if (ok) {
          localProjectsSnapshot = [...localProjectsSnapshot, { ...p, id: newId }]
          created++
          usedApiSuccess = true
        } else {
          const newProject = {
            ...p,
            id: newId,
            clientId: p.clientId,
            clientName: p.clientName,
            title: p.title,
            stage: p.stage,
            value: p.value,
            weddingDate: p.weddingDate,
            venue: p.venue,
            packageType: p.packageType,
            dueDate,
            createdAt,
            notes: p.notes,
          }
          setState((prev) => {
            const next = { ...prev, projects: [...prev.projects, newProject] }
            saveState(next)
            return next
          })
          localProjectsSnapshot = [...localProjectsSnapshot, newProject]
          created++
        }
      }
      if (created > 0) {
        if (usedApiSuccess) await refreshState()
        playNewInquirySound()
      }
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
        updateProposal,
        addContract,
        updateContract,
        addInvoice,
        updateInvoice,
        addExpense,
        deleteExpense,
        addCalendarReminder,
        updateCalendarReminder,
        deleteCalendarReminder,
        setAutomationEnabled,
        refreshState,
        removeClientLocally,
        restoreClientLocally,
        syncInquiriesFromWebsite,
        addNewsletterTemplate,
        updateNewsletterTemplate,
        deleteNewsletterTemplate,
      },
    }),
    [
      state,
      updateProject,
      updateClient,
      addClient,
      addProject,
      addProposal,
      updateProposal,
      addContract,
      updateContract,
      addInvoice,
      updateInvoice,
      addExpense,
      deleteExpense,
      addCalendarReminder,
      updateCalendarReminder,
      deleteCalendarReminder,
      setAutomationEnabled,
      refreshState,
      removeClientLocally,
      restoreClientLocally,
      syncInquiriesFromWebsite,
      addNewsletterTemplate,
      updateNewsletterTemplate,
      deleteNewsletterTemplate,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
