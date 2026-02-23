import type { Project, Proposal, Invoice } from '../data/mock'

const today = () => new Date().toISOString().slice(0, 10)

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a)
  const d2 = new Date(b)
  return Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000))
}

export type SuggestionType =
  | 'send_proposal'
  | 'remind_contract'
  | 'payment_reminder'
  | 'upcoming_wedding'

export interface AutomationSuggestion {
  type: SuggestionType
  label: string
  sublabel?: string
  link: string
  linkLabel: string
  projectId?: string
  invoiceId?: string
  proposalId?: string
}

export function getAutomationSuggestions(
  projects: Project[],
  proposals: Proposal[],
  invoices: Invoice[],
  contracts: { projectId: string }[]
): AutomationSuggestion[] {
  const suggestions: AutomationSuggestion[] = []
  const projectIdsWithProposal = new Set(proposals.map((p) => p.projectId))
  const projectIdsWithContract = new Set(contracts.map((c) => c.projectId))

  // Inquiries with no proposal (optionally 2+ days old)
  for (const p of projects) {
    if (p.stage !== 'inquiry') continue
    if (projectIdsWithProposal.has(p.id)) continue
    const createdAt = p.createdAt || p.dueDate
    const daysOld = daysBetween(createdAt, today())
    suggestions.push({
      type: 'send_proposal',
      label: p.title,
      sublabel: `${p.clientName}${daysOld >= 2 ? ` · Inquiry ${daysOld} days ago` : ''}`,
      link: '/proposals',
      linkLabel: 'Create proposal',
      projectId: p.id,
    })
  }

  // Proposals sent 5+ days ago, project not booked, no contract signed
  for (const pr of proposals) {
    if (pr.status !== 'sent' || !pr.sentAt) continue
    const proj = projects.find((p) => p.id === pr.projectId)
    if (!proj || proj.stage === 'booked' || proj.stage === 'completed') continue
    if (projectIdsWithContract.has(pr.projectId)) continue
    const daysSinceSent = daysBetween(pr.sentAt, today())
    if (daysSinceSent < 5) continue
    suggestions.push({
      type: 'remind_contract',
      label: pr.title,
      sublabel: `${pr.clientName} · Proposal sent ${daysSinceSent} days ago`,
      link: '/contracts',
      linkLabel: 'Send contract',
      projectId: pr.projectId,
      proposalId: pr.id,
    })
  }

  // Overdue invoices (sent but past due)
  const todayStr = today()
  for (const inv of invoices) {
    if (inv.status !== 'sent' && inv.status !== 'overdue') continue
    if (inv.dueDate >= todayStr && inv.status !== 'overdue') continue
    suggestions.push({
      type: 'payment_reminder',
      label: inv.projectTitle,
      sublabel: `${inv.clientName} · $${inv.amount.toLocaleString()} due ${inv.dueDate}`,
      link: '/invoices',
      linkLabel: 'View / send link',
      invoiceId: inv.id,
    })
  }

  // Booked weddings in the next 7 days
  for (const p of projects) {
    if (p.stage !== 'booked') continue
    const daysUntil = daysBetween(todayStr, p.weddingDate)
    if (daysUntil < 0 || daysUntil > 7) continue
    suggestions.push({
      type: 'upcoming_wedding',
      label: p.title,
      sublabel:
        daysUntil === 0
          ? `Today · ${p.clientName}`
          : daysUntil === 1
            ? `Tomorrow · ${p.clientName}`
            : `${p.clientName} · in ${daysUntil} days`,
      link: '/bookings',
      linkLabel: 'View booking',
      projectId: p.id,
    })
  }

  return suggestions
}
