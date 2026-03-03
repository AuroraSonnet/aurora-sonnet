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
  apiCreateExperience,
  apiUpdateExperience,
  apiDeleteExperience,
  type Experience,
} from '../api/db'
import { playNewInquirySound, prepareInquirySoundContext } from '../utils/sound'
import { getInquiryApiBaseUrl } from '../utils/inquiryApiUrl'
import { isTestEmail, getDeletedClientIds } from '../utils/syncFilters'

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

export interface MusicSelection {
  id: string
  clientId?: string
  submitterName: string
  submitterEmail: string
  label?: string
  songIds: string[]
  songsText?: string
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
  experiences: Experience[]
  newsletterTemplates: NewsletterTemplate[]
  musicSelections: MusicSelection[]
  config?: { publicAppUrl?: string }
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
  experiences: [],
  newsletterTemplates: [],
  musicSelections: [],
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
    experiences: preferNonEmpty(prev.experiences, (apiState as { experiences?: Experience[] }).experiences),
    newsletterTemplates: prev.newsletterTemplates,
    musicSelections: preferNonEmpty(prev.musicSelections ?? [], (apiState as { musicSelections?: MusicSelection[] }).musicSelections),
    config: (apiState as { config?: { publicAppUrl?: string } }).config ?? prev.config,
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
    experiences: (apiState as { experiences?: Experience[] }).experiences ?? prev.experiences,
    newsletterTemplates: prev.newsletterTemplates,
    musicSelections: (apiState as { musicSelections?: MusicSelection[] }).musicSelections ?? prev.musicSelections ?? [],
    config: (apiState as { config?: { publicAppUrl?: string } }).config ?? prev.config,
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
          experiences: parsed.experiences ?? defaultState.experiences,
          newsletterTemplates: parsed.newsletterTemplates ?? defaultState.newsletterTemplates,
          musicSelections: parsed.musicSelections ?? defaultState.musicSelections ?? [],
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
  updateClient: (id: string, updates: Partial<Client>) => void | Promise<void>
  addClient: (client: Omit<Client, 'id'>) => Promise<string>
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
  /** Pull new website inquiries from Inquiry API URL into the app. Uses proxy when possible to avoid CORS. */
  syncInquiriesFromWebsite: () => Promise<{ ok: boolean; message: string; created?: number; serverClients?: number; serverProjects?: number }>
  addNewsletterTemplate: (template: Omit<NewsletterTemplate, 'id' | 'createdAt'>) => string
  updateNewsletterTemplate: (id: string, updates: Partial<Pick<NewsletterTemplate, 'name' | 'subject' | 'body'>>) => void
  deleteNewsletterTemplate: (id: string) => void
  createExperience: (experience: { name: string; description: string; bullets: string[]; fromPrice: number; imageUrl?: string | null; sortOrder?: number }) => Promise<{ ok: true; experience: Experience } | { ok: false; error: string }>
  updateExperience: (id: string, updates: Partial<Pick<Experience, 'name' | 'description' | 'bullets' | 'fromPrice' | 'imageUrl' | 'sortOrder'>>) => Promise<{ ok: true; experience: Experience } | { ok: false; error: string }>
  deleteExperience: (id: string) => Promise<boolean>
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

  const updateClient = useCallback(async (id: string, updates: Partial<Client>) => {
    if (useApi) {
      const result = await apiUpdateClient(id, updates as Record<string, unknown>)
      if (!result.ok) throw new Error(result.error)
    }
    setState((s) => ({ ...s, clients: s.clients.map((c) => (c.id === id ? { ...c, ...updates } : c)) }))
  }, [useApi])

  const addClient = useCallback(async (client: Omit<Client, 'id'>): Promise<string> => {
    const id = nextId('', state.clients)
    const createdAt = (client as Client).createdAt ?? new Date().toISOString().slice(0, 10)
    const newClient = { ...client, id, createdAt } as Client
    if (useApi) {
      const result = await apiCreateClient({ ...newClient, createdAt })
      if (!result.ok) throw new Error(result.error)
    }
    setState((s) => ({ ...s, clients: [...s.clients, newClient] }))
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

  const createExperience = useCallback(
    async (experience: { name: string; description: string; bullets: string[]; fromPrice: number; imageUrl?: string | null; sortOrder?: number }) => {
      const result = await apiCreateExperience(experience)
      if (result.ok && useApi) {
        const s = await fetchState()
        if (s) setState((prev) => mergeStateFromApiTrusted(prev, { ...defaultState, ...s } as AppState))
      }
      return result
    },
    [useApi]
  )

  const updateExperience = useCallback(
    async (id: string, updates: Partial<Pick<Experience, 'name' | 'description' | 'bullets' | 'fromPrice' | 'imageUrl' | 'sortOrder'>>) => {
      const result = await apiUpdateExperience(id, updates)
      if (result.ok && useApi) {
        const s = await fetchState()
        if (s) setState((prev) => mergeStateFromApiTrusted(prev, { ...defaultState, ...s } as AppState))
      }
      return result
    },
    [useApi]
  )

  const deleteExperience = useCallback(
    async (id: string) => {
      const ok = await apiDeleteExperience(id)
      if (ok && useApi) {
        const s = await fetchState()
        if (s) setState((prev) => mergeStateFromApiTrusted(prev, { ...defaultState, ...s } as AppState))
      }
      return ok
    },
    [useApi]
  )

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
            const fallback = (await res.json()) as AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }
            if (hasData(fallback)) apiState = fallback
          }
        } catch {
          // ignore
        }
      }
    }
    if (!apiState || !hasData(apiState as MinimalState)) return // don't overwrite with empty
    const merged = apiState as AppState & { automations?: Automation[]; contractTemplates?: DocumentTemplate[]; invoiceTemplates?: DocumentTemplate[]; pipelineStages?: PipelineStage[] }
    setState((prev) => {
      const next = mergeStateFromApiTrusted(prev, merged)
      saveState(next) // persist so deleted bookings/clients stay gone after app restart
      return next
    })
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

  const syncInquiriesFromWebsite = useCallback(async (): Promise<{ ok: boolean; message: string; created?: number; serverClients?: number; serverProjects?: number }> => {
    prepareInquirySoundContext() // unlock audio on this click so chime can play after sync
    const base = getInquiryApiBaseUrl()
    if (!base) return { ok: false, message: 'Set Inquiry API URL in Settings (e.g. https://aurora-sonnet-1.onrender.com) and save.' }
    try {
      // Prefer proxy so the Mac app avoids CORS (request goes to local server, server fetches Render).
      let res = await fetch(`/api/proxy-remote-state?base=${encodeURIComponent(base)}`)
      if (!res.ok) {
        // Fallback: direct fetch (works in browser when Render CORS allows; may fail in desktop app).
        res = await fetch(`${base}/api/state`)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        return { ok: false, message: `Sync failed: server returned ${res.status}${text ? ` — ${text.slice(0, 80)}` : ''}. Check that the Inquiry API URL is correct and the server is running.` }
      }
      const apiState = (await res.json()) as {
        clients?: { id: string; name: string; email: string; phone?: string; partnerName?: string; createdAt: string }[]
        projects?: { id: string; clientId: string; clientName: string; title: string; stage: string; value: number; weddingDate: string; venue?: string; packageType?: string; dueDate: string; createdAt?: string; notes?: string }[]
      }
      const allCloudClients = apiState.clients ?? []
      const allCloudProjects = apiState.projects ?? []
      const deletedIds = getDeletedClientIds()
      // Include all clients from server except deleted; only treat as test when email is non-empty and matches test pattern (so empty-email clients still sync)
      const cloudClients = allCloudClients.filter((c) => {
        if (deletedIds.has(c.id)) return false
        const email = (c.email || '').trim()
        return email === '' || !isTestEmail(email)
      })
      const testClientIds = new Set(allCloudClients.filter((c) => (c.email || '').trim() !== '' && isTestEmail(c.email)).map((c) => c.id))
      const cloudProjects = allCloudProjects.filter((p) => !testClientIds.has(p.clientId))
      const current = stateRef.current
      let localClientsSnapshot = [...current.clients]
      let localProjectsSnapshot = [...current.projects]
      const cloudToLocalClientId: Record<string, string> = {}
      let created = 0
      for (const c of cloudClients) {
        if (!localClientsSnapshot.some((x) => x.id === c.id)) {
          const clientData = { ...c, createdAt: c.createdAt ?? new Date().toISOString().slice(0, 10) }
          const result = await apiCreateClient(clientData)
          if (result.ok) {
            localClientsSnapshot = [...localClientsSnapshot, clientData]
            cloudToLocalClientId[c.id] = c.id
            created++
            setState((prev) => {
              const next = { ...prev, clients: [...prev.clients, clientData] }
              saveState(next)
              return next
            })
          } else if (result.error?.toLowerCase().includes('already exists')) {
            const existing = localClientsSnapshot.find(
              (x) => (x.email || '').toLowerCase() === (clientData.email || '').toLowerCase()
            )
            if (existing) {
              cloudToLocalClientId[c.id] = existing.id
              // Refresh existing client from cloud so name/email/phone are never stale or empty
              setState((prev) => {
                const next = {
                  ...prev,
                  clients: prev.clients.map((x) =>
                    x.id === existing.id
                      ? { ...x, name: clientData.name, email: clientData.email, phone: clientData.phone ?? x.phone, partnerName: clientData.partnerName ?? x.partnerName }
                      : x
                  ),
                }
                saveState(next)
                return next
              })
              localClientsSnapshot = localClientsSnapshot.map((x) =>
                x.id === existing.id ? { ...x, name: clientData.name, email: clientData.email, phone: clientData.phone ?? x.phone, partnerName: clientData.partnerName ?? x.partnerName } : x
              )
            } else {
              // API says the contact already exists (likely created via /api/inquiry).
              // Trust the server and add this client locally so state matches /api/state.
              localClientsSnapshot = [...localClientsSnapshot, clientData]
              cloudToLocalClientId[c.id] = c.id
              created++
              setState((prev) => {
                const next = { ...prev, clients: [...prev.clients, clientData] }
                saveState(next)
                return next
              })
            }
          } else {
            // Create failed (e.g. network, 400) — still add to state so Contacts list shows all server clients
            localClientsSnapshot = [...localClientsSnapshot, clientData]
            cloudToLocalClientId[c.id] = c.id
            created++
            setState((prev) => {
              const next = { ...prev, clients: [...prev.clients, clientData] }
              saveState(next)
              return next
            })
          }
        } else {
          cloudToLocalClientId[c.id] = c.id
          // We already have this client by id; refresh from cloud so email/name/phone stay correct
          setState((prev) => {
            const next = {
              ...prev,
              clients: prev.clients.map((x) =>
                x.id === c.id ? { ...x, name: c.name, email: c.email, phone: c.phone ?? x.phone, partnerName: c.partnerName ?? x.partnerName } : x
              ),
            }
            saveState(next)
            return next
          })
          localClientsSnapshot = localClientsSnapshot.map((x) =>
            x.id === c.id ? { ...x, name: c.name, email: c.email, phone: c.phone ?? x.phone, partnerName: c.partnerName ?? x.partnerName } : x
          )
        }
      }
      // Ensure every cloud client appears in state (safety net if any create was skipped)
      const mergedClients = [...localClientsSnapshot]
      for (const c of cloudClients) {
        const hasById = mergedClients.some((x) => x.id === c.id)
        const hasByEmail = (c.email || '').trim() && mergedClients.some((x) => (x.email || '').toLowerCase() === (c.email || '').toLowerCase())
        if (!hasById && !hasByEmail) {
          const clientData = { ...c, createdAt: c.createdAt ?? new Date().toISOString().slice(0, 10) }
          mergedClients.push(clientData)
          setState((prev) => {
            const next = { ...prev, clients: [...prev.clients, clientData] }
            saveState(next)
            return next
          })
        }
      }
      for (const p of cloudProjects) {
        const localClientId = cloudToLocalClientId[p.clientId] ?? p.clientId
        const clientExists = localClientsSnapshot.some((c) => c.id === localClientId)
        if (!clientExists) continue
        // Dedupe by cloud project id so the same inquiry is never added twice; new inquiries get new ids on the server. Fallback to content match for projects synced before cloudProjectId existed.
        const alreadySynced =
          localProjectsSnapshot.some((x) => x.cloudProjectId === p.id) ||
          localProjectsSnapshot.some(
            (x) =>
              x.clientId === localClientId &&
              x.title === p.title &&
              x.stage === p.stage &&
              x.weddingDate === p.weddingDate &&
              (x.notes || '') === (p.notes || '') &&
              (x.createdAt || '') === (p.createdAt ?? '')
          )
        if (alreadySynced) continue
        const newId = nextId('p', localProjectsSnapshot)
        const createdAt = p.createdAt ?? new Date().toISOString().slice(0, 10)
        const dueDate = p.dueDate ?? createdAt
        const projectData = { ...p, id: newId, clientId: localClientId, createdAt, dueDate, cloudProjectId: p.id }
        const ok = await apiCreateProject(projectData as Record<string, unknown>)
        if (ok) {
          const newProject = {
            ...p,
            id: newId,
            clientId: localClientId,
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
            cloudProjectId: p.id,
          }
          localProjectsSnapshot = [...localProjectsSnapshot, newProject]
          created++
          setState((prev) => {
            const next = { ...prev, projects: [...prev.projects, newProject] }
            saveState(next)
            return next
          })
        } else {
          const newProject = {
            ...p,
            id: newId,
            clientId: localClientId,
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
            cloudProjectId: p.id,
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
        playNewInquirySound() // play immediately; list already updated via setState above
        // Do not call refreshState() here — it fetches from local server and can overwrite
        // the clients we just merged from Render (local DB may not have them yet).
      }
      const serverClients = allCloudClients.length
      const serverProjects = allCloudProjects.length
      let message: string
      if (serverClients === 0 && serverProjects === 0) {
        message = 'Server has 0 clients and 0 projects. (1) Confirm your form posts to ' + base + '/api/inquiry. (2) On Render, free tier uses ephemeral storage — data is lost when the service sleeps. Add a Persistent Disk in Render and set env var DATA_DIR to the disk path (e.g. /data) so inquiries persist.'
      } else if (created > 0) {
        message = `Synced. Server has ${serverClients} clients, ${serverProjects} projects. ${created} new item(s) added.`
      } else {
        message = `Synced. Server has ${serverClients} clients, ${serverProjects} projects. No new inquiries to add.`
      }
      return { ok: true, message, created, serverClients, serverProjects }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, message: `Sync failed: ${msg}. Check your internet connection and that the Inquiry API URL is correct.` }
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
        createExperience,
        updateExperience,
        deleteExperience,
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
      createExperience,
      updateExperience,
      deleteExperience,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
