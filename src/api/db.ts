const API = '/api'

export interface DocumentTemplate {
  id: string
  name: string
  fileName: string
  createdAt: string
  contentHtml?: string | null
}

export interface PipelineStage {
  id: string
  label: string
  sortOrder: number
}

export interface Experience {
  id: string
  name: string
  description: string
  bullets: string[]
  fromPrice: number
  imageUrl: string | null
  sortOrder: number
  createdAt: string
}

export interface AppState {
  clients: { id: string; name: string; email: string; phone?: string; partnerName?: string; createdAt: string }[]
  projects: { id: string; clientId: string; clientName: string; title: string; stage: string; value: number; weddingDate: string; venue?: string; packageType?: string; dueDate: string; createdAt?: string; archivedAt?: string }[]
  proposals: { id: string; projectId: string; clientName: string; title: string; status: string; value: number; sentAt?: string }[]
  invoices: { id: string; projectId?: string; clientName: string; clientEmail?: string; projectTitle: string; amount: number; status: string; dueDate: string; paidAt?: string; type?: string; templateId?: string; invoiceNumber?: string; lineItems?: { description: string; quantity: number; unitPrice: number }[]; lastReminderSentAt?: string }[]
  contracts: { id: string; projectId: string; clientName: string; title: string; status: string; value: number; weddingDate: string; venue?: string; packageType?: string; signedAt?: string; createdAt: string; templateId?: string; signToken?: string; clientSignedAt?: string }[]
  expenses: { id: string; date: string; description: string; amount: number; category: string }[]
  calendarReminders?: { id: string; date: string; title: string; notes?: string; clientId?: string; projectId?: string; reminderAt?: string; sentAt?: string; createdAt: string }[]
  contractTemplates?: DocumentTemplate[]
  invoiceTemplates?: DocumentTemplate[]
  pipelineStages?: PipelineStage[]
  experiences?: Experience[]
  config?: { publicAppUrl?: string }
}

export async function fetchState(): Promise<AppState | null> {
  try {
    const res = await fetch(`${API}/state`)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function getPublicAppUrl(): Promise<string> {
  try {
    const res = await fetch(`${API}/settings/public-url`)
    if (!res.ok) return ''
    const data = await res.json().catch(() => ({}))
    return typeof data.publicAppUrl === 'string' ? data.publicAppUrl : ''
  } catch {
    return ''
  }
}

export async function savePublicAppUrl(publicAppUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/settings/public-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicAppUrl: publicAppUrl.trim() }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Seed the database with sample data (only works when DB is empty). Returns new state or null. */
export async function seedDatabase(): Promise<AppState | null> {
  try {
    const res = await fetch(`${API}/seed`, { method: 'POST' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function apiCreateClient(client: { id: string; name: string; email: string; phone?: string; partnerName?: string; createdAt: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(client) })
    const body = await res.json().catch(() => ({}))
    const msg = (body && typeof body.error === 'string') ? body.error : 'Failed to create client'
    if (res.ok) return { ok: true }
    return { ok: false, error: res.status === 409 ? msg : msg }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function apiUpdateClient(id: string, updates: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/clients/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    const body = await res.json().catch(() => ({}))
    const msg = (body && typeof body.error === 'string') ? body.error : 'Failed to update client'
    if (res.ok) return { ok: true }
    return { ok: false, error: res.status === 409 ? msg : msg }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

/** Submit inquiry form (creates client + project in one call). For in-app or website form. */
export async function apiSubmitInquiry(data: { name: string; email: string; phone?: string; weddingDate?: string; venue?: string; packageId?: string; requestedArtist?: string; message?: string }): Promise<{ clientId: string; projectId: string } | null> {
  try {
    const res = await fetch(`${API}/inquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { clientId: string; projectId: string }
    return json
  } catch {
    return null
  }
}

export async function apiCreateProject(project: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiUpdateProject(id: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/projects/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiCreateProposal(proposal: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/proposals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proposal) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiCreateContract(contract: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/contracts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contract) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiUpdateContract(id: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/contracts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiCreateInvoice(invoice: Record<string, unknown>): Promise<{ ok: true; invoiceNumber: string } | { ok: false }> {
  try {
    const res = await fetch(`${API}/invoices`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invoice) })
    if (!res.ok) return { ok: false }
    const data = await res.json().catch(() => ({}))
    return { ok: true, invoiceNumber: data.invoiceNumber ?? '' }
  } catch {
    return { ok: false }
  }
}

export async function apiUpdateInvoice(id: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/invoices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    return res.ok
  } catch {
    return false
  }
}

/** Send overdue "please pay" reminder email to client (requires SMTP). */
export async function apiSendInvoiceReminder(invoiceId: string, baseUrl?: string): Promise<{ ok: true; sentAt: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/invoices/${invoiceId}/send-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: baseUrl || (typeof window !== 'undefined' ? window.location.origin : '') }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.sentAt) return { ok: true, sentAt: data.sentAt }
    const msg = typeof data.error === 'string' ? data.error : res.status === 503 ? 'Email not configured' : 'Failed to send reminder'
    return { ok: false, error: msg }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function apiCreateExpense(expense: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expense) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteClient(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/clients/${id}`, { method: 'DELETE' })
    // Treat 404 (not found) as success so local deletes can still proceed even if the
    // record was already removed on the server.
    if (res.ok || res.status === 404) return true
    return false
  } catch {
    return false
  }
}

export async function apiRestoreClient(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/clients/${id}/restore`, { method: 'POST' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteProject(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/projects/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiUpdateProposal(id: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/proposals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteProposal(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/proposals/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteContract(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/contracts/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export function getContractFileUrl(id: string): string {
  return `${API}/contracts/${id}/file`
}

export async function apiSignContractClient(id: string, token: string, signatureDataUrl: string): Promise<{ ok: boolean; clientSignedAt?: string }> {
  try {
    const res = await fetch(`${API}/contracts/${id}/sign-client`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, signatureDataUrl }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Failed to sign')
    return data
  } catch (err) {
    throw err
  }
}

export async function apiSignContractVendor(id: string, signatureDataUrl: string): Promise<{ ok: boolean; signedAt?: string }> {
  try {
    const res = await fetch(`${API}/contracts/${id}/sign-vendor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureDataUrl }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Failed to sign')
    return data
  } catch (err) {
    throw err
  }
}

export async function apiDeleteInvoice(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/invoices/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteExpense(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/expenses/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiCreateCalendarReminder(reminder: {
  id: string
  date: string
  title: string
  notes?: string
  clientId?: string
  projectId?: string
  reminderAt?: string
  createdAt: string
}): Promise<boolean> {
  try {
    const res = await fetch(`${API}/calendar-reminders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reminder),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function apiUpdateCalendarReminder(id: string, updates: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${API}/calendar-reminders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteCalendarReminder(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/calendar-reminders/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiCreateExperience(experience: {
  name: string
  description: string
  bullets: string[]
  fromPrice: number
  imageUrl?: string | null
  sortOrder?: number
}): Promise<{ ok: true; experience: Experience } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/experiences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: experience.name.trim(),
        description: experience.description?.trim() ?? '',
        bullets: experience.bullets ?? [],
        fromPrice: experience.fromPrice ?? 0,
        imageUrl: experience.imageUrl ?? null,
        sortOrder: experience.sortOrder ?? 0,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.id) return { ok: true, experience: data as Experience }
    return { ok: false, error: (data && data.error) || 'Failed to create experience' }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function apiUpdateExperience(
  id: string,
  updates: { name?: string; description?: string; bullets?: string[]; fromPrice?: number; imageUrl?: string | null; sortOrder?: number }
): Promise<{ ok: true; experience: Experience } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/experiences/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.id) return { ok: true, experience: data as Experience }
    return { ok: false, error: (data && data.error) || 'Failed to update experience' }
  } catch {
    return { ok: false, error: 'Network error' }
  }
}

export async function apiDeleteExperience(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/experiences/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// Pipeline stages
export async function apiCreatePipelineStage(label: string): Promise<PipelineStage | null> {
  try {
    const res = await fetch(`${API}/pipeline-stages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: label.trim() }),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export async function apiUpdatePipelineStage(id: string, updates: { label?: string; sortOrder?: number }): Promise<boolean> {
  try {
    const res = await fetch(`${API}/pipeline-stages/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeletePipelineStage(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/pipeline-stages/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// Document templates
export async function apiUploadContractTemplate(name: string, fileBase64: string): Promise<string | null> {
  const res = await fetch(`${API}/templates/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, fileBase64 }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = 'Upload failed'
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
  const data = (await res.json()) as { id?: string }
  return data.id ?? null
}

export function getContractTemplateFileUrl(id: string): string {
  return `${API}/templates/contracts/${id}/file`
}

export async function apiUpdateContractTemplateName(id: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/templates/contracts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteContractTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/templates/contracts/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiReplaceContractTemplateFile(id: string, fileBase64: string): Promise<void> {
  const res = await fetch(`${API}/templates/contracts/${id}/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64 }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = 'Failed to replace file'
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
}

/** Create an editor-only contract template (no PDF). */
export async function apiCreateContractTemplateEditor(name: string, contentHtml: string): Promise<string | null> {
  const res = await fetch(`${API}/templates/contracts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, contentHtml: contentHtml || '' }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = 'Failed to create template'
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
  const data = (await res.json()) as { id?: string }
  return data.id ?? null
}

export async function apiUpdateContractTemplateContent(id: string, contentHtml: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/templates/contracts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentHtml }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Upload generated PDF for a contract (e.g. from editor template merge). */
export async function apiUploadContractFile(contractId: string, fileBase64: string): Promise<void> {
  const res = await fetch(`${API}/contracts/${contractId}/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64 }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = 'Failed to upload contract PDF'
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
}

export async function apiUploadInvoiceTemplate(name: string, fileBase64: string): Promise<string | null> {
  const res = await fetch(`${API}/templates/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, fileBase64 }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = 'Upload failed'
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
  const data = (await res.json()) as { id?: string }
  return data.id ?? null
}

export function getInvoiceTemplateFileUrl(id: string): string {
  return `${API}/templates/invoices/${id}/file`
}

export async function apiUpdateInvoiceTemplateName(id: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/templates/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function apiDeleteInvoiceTemplate(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/templates/invoices/${id}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

export async function apiReplaceInvoiceTemplateFile(id: string, fileBase64: string): Promise<void> {
  const res = await fetch(`${API}/templates/invoices/${id}/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64 }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = 'Failed to replace file'
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      if (text) msg = text
    }
    throw new Error(msg)
  }
}
