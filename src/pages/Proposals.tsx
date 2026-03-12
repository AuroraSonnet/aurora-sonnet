import { useState, useRef, useEffect, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import {
  apiDeleteProposal,
  apiCreateProposal,
  apiCreateContract,
  apiCreateInvoice,
  apiEnsureProposalAcceptToken,
  apiSyncProposalForAccept,
  apiUploadContractFile,
  fetchContractTemplateFileAsBase64,
} from '../api/db'
import { getInquiryApiBaseUrl, DEFAULT_INQUIRY_API_URL } from '../utils/inquiryApiUrl'
import { ALL_PACKAGES, getPackageOrDuoLabel, getPackageOrDuoPrice } from '../data/packages'
import type { Proposal } from '../data/mock'
import { EMAIL_SIGNATURE } from '../utils/emailSignature'
import { mergeContractTemplate } from '../utils/mergeContractTemplate'
import { htmlToPdfBase64 } from '../utils/htmlToPdf'
import styles from './Proposals.module.css'

const DEFAULT_EMAIL_BODY = `Dear [Client],

It is our pleasure to present your curated proposal for the {{experienceName}} experience with Aurora Sonnet.

Event

Date: {{eventDate}}
Venue: {{venue}}

Experience: {{experienceName}}
{{experienceBullets}}

Experience Investment

{{total}}

Retainer to reserve your date: {{retainer}}
Remaining balance: {{balance}} due 30 days prior to your event

Next Steps

To proceed, please confirm your experience below. Once confirmed, we will send your agreement and retainer invoice to secure your date.

After booking, you will receive access to our repertoire form to select your songs and share any special requests.

Confirm your experience:
{{acceptProposalUrl}}`

function formatExperienceBullets(details: string | undefined): string {
  if (!details || !details.trim()) return ''
  return details
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => `• ${line}`)
    .join('\n')
}

function formatBulletsList(bullets: string[] | undefined): string {
  if (!bullets || bullets.length === 0) return ''
  return bullets.map((b) => b.trim()).filter(Boolean).map((b) => `• ${b}`).join('\n')
}

function getExperienceBulletsFallback(
  proposal: Proposal,
  presetExperiences: Array<{ name: string; bullets: string[] }>
): string {
  const fromDetails = formatExperienceBullets(proposal.customPackageDetails)
  if (fromDetails.trim()) return fromDetails

  const name = (proposal.customPackageName?.trim() || proposal.title || '').trim()
  if (!name) return ''
  const match = presetExperiences.find((e) => e.name.trim().toLowerCase() === name.toLowerCase())
  return formatBulletsList(match?.bullets)
}

function getDefaultEmailBody(
  _title: string,
  clientName?: string,
  extras?: {
    eventDate?: string
    venue?: string
    total?: number
    retainer?: number
    balance?: number
    experienceName?: string
    experienceBullets?: string
    acceptProposalUrl?: string
  }
): string {
  const greetingName = clientName?.trim() || '[Client]'
  const greeting = `Dear ${greetingName},`
  let body = DEFAULT_EMAIL_BODY.replace('Dear [Client],', greeting)

  const replaceToken = (token: string, value: string) => {
    body = body.split(token).join(value)
  }

  const fmtMoney = (n?: number) =>
    n != null && Number.isFinite(n) ? `$${n.toLocaleString()}` : '$____'

  const {
    eventDate,
    venue,
    total,
    retainer,
    balance,
    experienceName,
    experienceBullets,
    acceptProposalUrl,
  } = extras || {}

  const totalStr = fmtMoney(total)
  const retainerStr = fmtMoney(retainer)
  const balanceStr = fmtMoney(balance)

  replaceToken('{{eventDate}}', eventDate || '[Event date]')
  replaceToken('{{venue}}', venue || '[Venue]')
  replaceToken('{{total}}', totalStr)
  replaceToken('{{retainer}}', retainerStr)
  replaceToken('{{balance}}', balanceStr)
  replaceToken('{{experienceName}}', experienceName || '[Experience]')
  replaceToken('{{experienceBullets}}', experienceBullets ?? '')
  replaceToken(
    '{{acceptProposalUrl}}',
    acceptProposalUrl || '[Link to accept proposal — will be added when you send]'
  )

  return body
}

export default function Proposals() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { proposals, projects, clients, contracts, invoices, experiences = [], contractTemplates = [] } = state
  const [showCreate, setShowCreate] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<Record<string, string>>({})
  const [customPackageByProject, setCustomPackageByProject] = useState<
    Record<string, { name: string; details: string; breakdown: string; total: number }>
  >({})
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    title: '',
    value: 0,
    status: 'draft' as Proposal['status'],
    emailBody: '',
    customPackageName: '',
    customPackageDetails: '',
    customPriceBreakdown: '',
  })
  const [sendModal, setSendModal] = useState<{
    proposal: Proposal
    subject: string
    body: string
    toEmail: string
    markAsSentOnSend: boolean
  } | null>(null)
  const [duplicateSource, setDuplicateSource] = useState<Proposal | null>(null)
  const [duplicateProjectId, setDuplicateProjectId] = useState<string>('')
  const [toast, setToast] = useState<string | null>(null)
  const [savingProposalId, setSavingProposalId] = useState<string | null>(null)
  const [duplicateCreating, setDuplicateCreating] = useState(false)
  const [menuTriggerRect, setMenuTriggerRect] = useState<{
    top: number
    left: number
    height: number
    width: number
    openUp: boolean
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dropdownPortalRef = useRef<HTMLDivElement | null>(null)
  const [selectedExperienceId, setSelectedExperienceId] = useState<string>('')
  const [sortBy, setSortBy] = useState<'date' | 'alphabetical'>('date')

  const sortedProposals = useMemo(() => {
    const list = [...proposals]
    if (sortBy === 'date') {
      list.sort((a, b) => {
        const aDate = a.sentAt || ''
        const bDate = b.sentAt || ''
        if (!aDate && !bDate) return 0
        if (!aDate) return 1
        if (!bDate) return -1
        return bDate.localeCompare(aDate)
      })
    } else {
      list.sort((a, b) => {
        const cmp = (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
        if (cmp !== 0) return cmp
        return (a.clientName || '').toLowerCase().localeCompare((b.clientName || '').toLowerCase())
      })
    }
    return list
  }, [proposals, sortBy])

  const presetExperiences = [
    ...ALL_PACKAGES.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      bullets: p.bullets,
      fromPrice: p.fromPrice,
      isCustom: false,
    })),
    ...(experiences ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      bullets: e.bullets,
      fromPrice: e.fromPrice,
      isCustom: true,
    })),
  ]

  const showToast = (message: string) => {
    setToast(message)
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const projectsWithProposal = new Set(proposals.map((p) => p.projectId))
  const projectsWithoutProposal = projects.filter((p) => !projectsWithProposal.has(p.id))

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      const inTrigger = menuTriggerRef.current?.contains(target)
      const inDropdown = dropdownPortalRef.current?.contains(target)
      if (menuOpenId && !inTrigger && !inDropdown) {
        setMenuOpenId(null)
        setMenuTriggerRect(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpenId])

  const getClientForProposal = (proposal: Proposal) => {
    const project = projects.find((x) => x.id === proposal.projectId)
    if (!project) return null
    const client = clients.find((c) => c.id === project.clientId)
    return { project, client: client ?? null }
  }

  const randomToken = () => Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 15)

  const ensureAgreementAndInvoice = async (p: Proposal) => {
    const pair = getClientForProposal(p)
    const project = pair?.project
    const client = pair?.client
    if (!project) throw new Error('Project not found for this proposal.')

    let contract = (contracts ?? []).find((c) => c.projectId === p.projectId)
    const packageLabel = p.customPackageName?.trim() || getPackageOrDuoLabel(project.packageType) || project.title
    const template =
      (contract?.templateId ? contractTemplates.find((t) => t.id === contract?.templateId) : null) ||
      contractTemplates[0] ||
      null
    const templateContentHtml = template && 'contentHtml' in template ? (template as { contentHtml?: string | null }).contentHtml : null

    if (!contract) {
      const createdAt = new Date().toISOString().slice(0, 10)
      const contractId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const signToken = randomToken()
      const ok = await apiCreateContract({
        id: contractId,
        projectId: project.id,
        clientName: project.clientName,
        title: project.title,
        status: 'sent',
        value: project.value,
        weddingDate: project.weddingDate || '',
        venue: project.venue,
        packageType: packageLabel || (project.packageType ?? undefined),
        createdAt,
        templateId: template?.id,
        signToken,
        clientSignedAt: undefined,
        lastReminderSentAt: undefined,
      })
      if (!ok) throw new Error('Could not create agreement.')
      contract = {
        id: contractId,
        projectId: project.id,
        clientName: project.clientName,
        title: project.title,
        status: 'sent',
        value: project.value,
        weddingDate: project.weddingDate || '',
        venue: project.venue,
        packageType: packageLabel || (project.packageType ?? undefined),
        createdAt,
        templateId: template?.id,
        signToken,
        clientSignedAt: undefined,
        lastReminderSentAt: undefined,
      } as (typeof contracts)[0]
    }

    if (contract.status !== 'sent' || !contract.signToken) {
      const signToken = contract.signToken || randomToken()
      actions.updateContract(contract.id, { status: 'sent', signToken })
      contract = { ...contract, status: 'sent', signToken } as (typeof contracts)[0]
    }

    if (!template) {
      throw new Error('No contract template found. Add a contract template first.')
    }

    if (templateContentHtml?.trim()) {
      const merged = mergeContractTemplate(templateContentHtml, {
        clientName: project.clientName,
        weddingDate: project.weddingDate,
        venue: project.venue,
        packageType: project.packageType,
        value: project.value,
        title: project.title,
        clientEmail: client?.email,
        clientPhone: client?.phone,
      })
      const base64 = await htmlToPdfBase64(merged)
      await apiUploadContractFile(contract.id, base64)
    } else if (template.fileName) {
      const base64 = await fetchContractTemplateFileAsBase64(template.id)
      await apiUploadContractFile(contract.id, base64)
    }

    let invoice =
      (invoices ?? []).find((i) => i.projectId === p.projectId && (i.type === 'deposit' || i.type === 'other' || !i.type)) ||
      null
    const retainer = Math.round(p.value * 0.5)
    const lineItems = [{ description: `Retainer (50%) — ${packageLabel}`, quantity: 1, unitPrice: retainer }]
    if (!invoice) {
      const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const invoiceId = `i-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const result = await apiCreateInvoice({
        id: invoiceId,
        projectId: project.id,
        clientName: project.clientName,
        clientEmail: client?.email,
        projectTitle: `${project.title} — Retainer`,
        amount: retainer,
        status: 'sent',
        dueDate,
        type: 'deposit',
        lineItems,
      })
      if (!result.ok) throw new Error('Could not create retainer invoice.')
      invoice = {
        id: invoiceId,
        projectId: project.id,
        clientName: project.clientName,
        clientEmail: client?.email,
        projectTitle: `${project.title} — Retainer`,
        amount: retainer,
        status: 'sent',
        dueDate,
        type: 'deposit',
        lineItems,
      } as (typeof invoices)[0]
    } else if (!invoice.paidAt && invoice.status !== 'paid' && (invoice.amount !== retainer || invoice.status === 'draft')) {
      actions.updateInvoice(invoice.id, {
        amount: retainer,
        projectTitle: `${project.title} — Retainer`,
        lineItems,
        status: 'sent',
      })
      invoice = { ...invoice, amount: retainer, projectTitle: `${project.title} — Retainer`, lineItems, status: 'sent' } as (typeof invoices)[0]
    }

    await actions.refreshState()
    return { contract, invoice }
  }

  const getClientEmailForProposal = (proposal: Proposal): string => {
    const pair = getClientForProposal(proposal)
    return pair?.client?.email ?? ''
  }

  const openSendModal = async (p: Proposal) => {
    const pair = getClientForProposal(p)
    const clientName = pair?.client?.name
    const project = pair?.project
    const eventDate =
      project?.weddingDate ? new Date(project.weddingDate).toLocaleDateString() : undefined
    const venue = project?.venue
    const total = p.value
    const retainer = Math.round(total * 0.5)
    const balance = Math.max(0, total - retainer)
    // Use a URL that works for the client (never localhost/file when emailing). Prefer Settings → Public app URL.
    const rawBase =
      (state.config?.publicAppUrl || '').trim() ||
      getInquiryApiBaseUrl() ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    const baseUrl =
      typeof window !== 'undefined' &&
      (rawBase.startsWith('http://localhost') || rawBase.startsWith('file:'))
        ? DEFAULT_INQUIRY_API_URL
        : rawBase || DEFAULT_INQUIRY_API_URL
    let acceptToken = p.acceptToken
    if (!acceptToken) {
      const result = await apiEnsureProposalAcceptToken(p.id)
      if (result) acceptToken = result.acceptToken
      else await actions.refreshState()
    }
    let syncOk = false
    if (baseUrl && acceptToken && pair?.client && pair?.project) {
      const payload = {
        client: {
          id: pair.client.id,
          name: pair.client.name,
          email: pair.client.email,
          phone: pair.client.phone,
          partnerName: pair.client.partnerName,
          createdAt: pair.client.createdAt,
        },
        project: {
          id: pair.project.id,
          clientId: pair.project.clientId,
          clientName: pair.project.clientName,
          title: pair.project.title,
          stage: pair.project.stage,
          value: pair.project.value,
          weddingDate: pair.project.weddingDate,
          venue: pair.project.venue,
          packageType: pair.project.packageType,
          dueDate: pair.project.dueDate,
          createdAt: pair.project.createdAt,
          notes: pair.project.notes,
          requestedArtist: pair.project.requestedArtist,
          cloudProjectId: pair.project.cloudProjectId,
        },
        proposal: {
          id: p.id,
          projectId: p.projectId,
          clientName: p.clientName,
          title: p.title,
          status: p.status,
          value: p.value,
          sentAt: p.sentAt,
          acceptToken,
        },
      }
      syncOk = await apiSyncProposalForAccept(baseUrl, payload)
      if (!syncOk && baseUrl !== DEFAULT_INQUIRY_API_URL) {
        syncOk = await apiSyncProposalForAccept(DEFAULT_INQUIRY_API_URL, payload)
      }
    }
    let acceptProposalUrl: string | undefined
    if (baseUrl && acceptToken) {
      const base = baseUrl.replace(/\/$/, '')
      if (syncOk) {
        acceptProposalUrl = `${base}/accept-proposal/${p.id}?token=${encodeURIComponent(acceptToken)}`
      } else {
        const d = btoa(JSON.stringify({
          t: p.title, n: p.clientName, v: p.value, p: p.projectId,
          ci: pair?.client?.id, ce: pair?.client?.email,
        }))
        acceptProposalUrl = `${base}/accept-proposal/${p.id}?token=${encodeURIComponent(acceptToken)}&d=${encodeURIComponent(d)}`
      }
    }
    const experienceName =
      p.customPackageName?.trim() || project?.packageType?.trim() || p.title
    const experienceBullets = getExperienceBulletsFallback(p, presetExperiences)
    const defaultBody = getDefaultEmailBody(p.title, clientName, {
      eventDate,
      venue,
      total,
      retainer,
      balance,
      experienceName,
      experienceBullets,
      acceptProposalUrl,
    })
    let body = p.emailBody?.trim() || defaultBody
    if (acceptProposalUrl && body) {
      body = body.replace(
        /https?:\/\/[^\s]*\/accept-proposal\/[^\s]*/g,
        acceptProposalUrl
      )
    }
    const toEmail = getClientEmailForProposal(p)
    setSendModal({
      proposal: p,
      subject: `Your Curated Proposal — ${p.title} | Aurora Sonnet`,
      body,
      toEmail: toEmail || '',
      markAsSentOnSend: true,
    })
    setMenuOpenId(null)
    setMenuTriggerRect(null)
  }

  const closeSendModal = () => {
    setSendModal(null)
  }

  const openEmailAgreementAndInvoice = async (p: Proposal) => {
    const pair = getClientForProposal(p)
    const client = pair?.client
    let ensured
    try {
      ensured = await ensureAgreementAndInvoice(p)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not prepare agreement and retainer.')
      return
    }
    const contract = ensured.contract as { id: string; status: string; signToken?: string } | undefined
    const invoice = ensured.invoice ?? ((invoices ?? []).find(
      (i) => i.projectId === p.projectId && (i.type === 'deposit' || i.type === 'other' || !i.type)
    ) ?? (invoices ?? []).find((i) => i.projectId === p.projectId))
    const baseUrl =
      (state.config?.publicAppUrl || '').trim() ||
      getInquiryApiBaseUrl() ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    const signUrl =
      contract?.status === 'sent' && contract?.signToken && baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/sign/${contract.id}?token=${encodeURIComponent(contract.signToken)}`
        : ''
    const invoiceViewUrl =
      invoice && baseUrl ? `${baseUrl.replace(/\/$/, '')}/invoices/view/${invoice.id}` : ''
    const toEmail = (client?.email || '').trim()
    const firstName = (p.clientName || '').split(/\s+/)[0] || 'there'
    const subject = `Your agreement and retainer — ${p.title} | Aurora Sonnet`
    const body =
      `Hi ${firstName},\n\nThank you for accepting your proposal for ${p.title}. Please sign your agreement and pay your retainer to secure your date.\n\n` +
      (signUrl ? `Sign your agreement: ${signUrl}\n\n` : '') +
      (invoiceViewUrl ? `View and pay your retainer: ${invoiceViewUrl}\n\n` : '') +
      `Best,\nAurora Sonnet`
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    if (toEmail) {
      window.location.href = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    } else {
      const url = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      window.location.href = url
    }
  }

  const doSendProposalEmail = async () => {
    if (!sendModal) return
    const { proposal: p, subject, body, toEmail, markAsSentOnSend } = sendModal
    const email = (toEmail || '').trim()
    const signatureAppended = body.includes('Lisa Dubocquet')
    let finalBody = signatureAppended ? body : `${body}\n\n${EMAIL_SIGNATURE}`
    if (markAsSentOnSend && p.status === 'draft') {
      await actions.updateProposal(p.id, { status: 'sent', sentAt: new Date().toISOString().slice(0, 10) })
      showToast('Marked as sent')
    }
    closeSendModal()
    if (email) {
      const pair = getClientForProposal(p)
      if (pair?.client && email !== pair.client.email) {
        try {
          await actions.updateClient(pair.client.id, { email })
        } catch {
          showToast('That email is already used by another contact.')
        }
      }
      window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(finalBody)}`
      showToast('Opening your email app…')
    } else {
      showToast('Add a contact email above to send the proposal.')
    }
  }

  const startEdit = async (p: Proposal) => {
    setEditingId(p.id)
    const pair = getClientForProposal(p)
    const clientName = pair?.client?.name
    const project = pair?.project
    const eventDate =
      project?.weddingDate ? new Date(project.weddingDate).toLocaleDateString() : undefined
    const venue = project?.venue
    const total = p.value
    const retainer = Math.round(total * 0.5)
    const balance = Math.max(0, total - retainer)
    const rawBase =
      (state.config?.publicAppUrl || '').trim() ||
      getInquiryApiBaseUrl() ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    const baseUrl =
      typeof window !== 'undefined' &&
      (rawBase.startsWith('http://localhost') || rawBase.startsWith('file:'))
        ? DEFAULT_INQUIRY_API_URL
        : rawBase || DEFAULT_INQUIRY_API_URL
    let syncOk = false
    if (baseUrl && p.acceptToken && pair?.client && pair?.project) {
      const payload = {
        client: { id: pair.client.id, name: pair.client.name, email: pair.client.email, phone: pair.client.phone, partnerName: pair.client.partnerName, createdAt: pair.client.createdAt },
        project: { id: pair.project.id, clientId: pair.project.clientId, clientName: pair.project.clientName, title: pair.project.title, stage: pair.project.stage, value: pair.project.value, weddingDate: pair.project.weddingDate, venue: pair.project.venue, packageType: pair.project.packageType, dueDate: pair.project.dueDate, createdAt: pair.project.createdAt, notes: pair.project.notes, requestedArtist: pair.project.requestedArtist, cloudProjectId: pair.project.cloudProjectId },
        proposal: { id: p.id, projectId: p.projectId, clientName: p.clientName, title: p.title, status: p.status, value: p.value, sentAt: p.sentAt, acceptToken: p.acceptToken },
      }
      syncOk = await apiSyncProposalForAccept(baseUrl, payload)
      if (!syncOk && baseUrl !== DEFAULT_INQUIRY_API_URL) syncOk = await apiSyncProposalForAccept(DEFAULT_INQUIRY_API_URL, payload)
    }
    let acceptProposalUrl: string | undefined
    if (baseUrl && p.acceptToken) {
      const base = baseUrl.replace(/\/$/, '')
      if (syncOk) {
        acceptProposalUrl = `${base}/accept-proposal/${p.id}?token=${encodeURIComponent(p.acceptToken)}`
      } else {
        const d = btoa(JSON.stringify({
          t: p.title, n: p.clientName, v: p.value, p: p.projectId,
          ci: pair?.client?.id, ce: pair?.client?.email,
        }))
        acceptProposalUrl = `${base}/accept-proposal/${p.id}?token=${encodeURIComponent(p.acceptToken)}&d=${encodeURIComponent(d)}`
      }
    }
    const experienceName =
      p.customPackageName?.trim() || project?.packageType?.trim() || p.title
    const experienceBullets = getExperienceBulletsFallback(p, presetExperiences)
    const defaultBody = getDefaultEmailBody(p.title, clientName, {
      eventDate,
      venue,
      total,
      retainer,
      balance,
      experienceName,
      experienceBullets,
      acceptProposalUrl,
    })
    setSelectedExperienceId('')
    setEditForm({
      title: p.title,
      value: p.value,
      status: p.status as Proposal['status'],
      emailBody: p.emailBody?.trim() || defaultBody,
      customPackageName: p.customPackageName ?? '',
      customPackageDetails: p.customPackageDetails ?? '',
      customPriceBreakdown: p.customPriceBreakdown ?? '',
    })
    setMenuOpenId(null)
    setMenuTriggerRect(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    const current = proposals.find((pr) => pr.id === editingId)
    if (!current) return
    const prev = {
      title: current.title,
      value: current.value,
      status: current.status,
      emailBody: current.emailBody,
      customPackageName: current.customPackageName,
      customPackageDetails: current.customPackageDetails,
      customPriceBreakdown: current.customPriceBreakdown,
    }
    const title = editForm.title.trim()
    setSavingProposalId(editingId)
    await actions.updateProposal(editingId, {
      title: title || (current.title ?? ''),
      value: editForm.value,
      status: editForm.status,
      emailBody: editForm.emailBody.trim() || undefined,
      customPackageName: editForm.customPackageName.trim() || undefined,
      customPackageDetails: editForm.customPackageDetails.trim() || undefined,
      customPriceBreakdown: editForm.customPriceBreakdown.trim() || undefined,
    })
    const savedId = editingId
    pushUndo({
      id: `proposal-edit-${savedId}-${Date.now()}`,
      label: `Proposal "${title || current.title}" edited`,
      undo: async () => {
        await actions.updateProposal(savedId, prev as Record<string, unknown>)
        await actions.refreshState()
      },
    })
    setSavingProposalId(null)
    setEditingId(null)
    showToast('Changes saved')
  }

  const markAsSent = async (p: Proposal) => {
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    const prevStatus = p.status
    const prevSentAt = p.sentAt
    setSavingProposalId(p.id)
    await actions.updateProposal(p.id, { status: 'sent', sentAt: new Date().toISOString().slice(0, 10) })
    pushUndo({
      id: `proposal-sent-${p.id}-${Date.now()}`,
      label: `Proposal "${p.title}" marked as sent`,
      undo: async () => {
        await actions.updateProposal(p.id, { status: prevStatus, sentAt: prevSentAt || null } as Record<string, unknown>)
        await actions.refreshState()
      },
    })
    setSavingProposalId(null)
    showToast('Marked as sent')
  }

  const markAsAccepted = async (p: Proposal) => {
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    const prevStatus = p.status
    const project = projects.find((x) => x.id === p.projectId)
    const prevStage = project?.stage
    setSavingProposalId(p.id)
    await actions.updateProposal(p.id, { status: 'accepted' })
    if (project) actions.updateProject(project.id, { stage: 'booked' })
    pushUndo({
      id: `proposal-accepted-${p.id}-${Date.now()}`,
      label: `Proposal "${p.title}" marked as accepted`,
      undo: async () => {
        await actions.updateProposal(p.id, { status: prevStatus } as Record<string, unknown>)
        if (project && prevStage) actions.updateProject(project.id, { stage: prevStage })
        await actions.refreshState()
      },
    })
    setSavingProposalId(null)
    showToast('Marked as accepted')
  }

  const openDuplicateModal = (p: Proposal) => {
    setDuplicateSource(p)
    setDuplicateProjectId('')
    setMenuOpenId(null)
    setMenuTriggerRect(null)
  }

  const closeDuplicateModal = () => {
    setDuplicateSource(null)
    setDuplicateProjectId('')
  }

  const doDuplicate = async () => {
    if (!duplicateSource || !duplicateProjectId) return
    const targetProject = projects.find((x) => x.id === duplicateProjectId)
    if (!targetProject) return
    setDuplicateCreating(true)
    const proposalId = await actions.addProposal({
      projectId: targetProject.id,
      clientName: targetProject.clientName,
      title: duplicateSource.title,
      status: 'draft',
      value: duplicateSource.value,
      emailBody: duplicateSource.emailBody,
      customPackageName: duplicateSource.customPackageName,
      customPackageDetails: duplicateSource.customPackageDetails,
      customPriceBreakdown: duplicateSource.customPriceBreakdown,
    })
    pushUndo({
      id: `proposal-${proposalId}`,
      label: `Proposal "${duplicateSource.title}" duplicated`,
      undo: async () => {
        await apiDeleteProposal(proposalId)
        await actions.refreshState()
      },
    })
    setDuplicateCreating(false)
    closeDuplicateModal()
    showToast('Proposal duplicated')
  }

  const handleDelete = async (p: Proposal) => {
    if (!window.confirm(`Delete proposal "${p.title}"?`)) return
    setMenuOpenId(null)
    setMenuTriggerRect(null)
    const deleted = { ...p }
    const ok = await apiDeleteProposal(p.id)
    if (ok) {
      pushUndo({
        id: `proposal-delete-${p.id}`,
        label: `Proposal "${p.title}" deleted`,
        undo: async () => {
          await apiCreateProposal(deleted as Record<string, unknown>)
          await actions.refreshState()
        },
      })
      await actions.refreshState()
    }
  }

  const handleCreateFromBooking = async (projectId: string) => {
    const p = projects.find((x) => x.id === projectId)
    if (!p) return
    const pkgId = (selectedPackage[p.id] ?? p.packageType) || undefined
    const isCustom = !pkgId || pkgId === ''
    const custom = customPackageByProject[p.id]
    const value = isCustom && custom ? custom.total : (getPackageOrDuoPrice(pkgId) ?? p.value)
    const proposalId = await actions.addProposal({
      projectId: p.id,
      clientName: p.clientName,
      title: p.title,
      status: 'draft',
      value,
      ...(isCustom && custom && {
        customPackageName: custom.name.trim() || undefined,
        customPackageDetails: custom.details.trim() || undefined,
        customPriceBreakdown: custom.breakdown.trim() || undefined,
      }),
    })
    pushUndo({
      id: `proposal-${proposalId}`,
      label: `Proposal "${p.title}" created`,
      undo: async () => {
        await apiDeleteProposal(proposalId)
        await actions.refreshState()
      },
    })
    if (p.stage === 'inquiry') {
      const updates: { stage: 'proposal'; value?: number; packageType?: string } = { stage: 'proposal' }
      if (pkgId && (!p.packageType || p.value !== value)) {
        updates.value = value
        updates.packageType = pkgId
      }
      actions.updateProject(p.id, updates)
    }
    setSelectedPackage((s) => ({ ...s, [projectId]: '' }))
    setCustomPackageByProject((s) => {
      const next = { ...s }
      delete next[projectId]
      return next
    })
    setShowCreate(false)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Proposals</h1>
        <p className={styles.subtitle}>
          Create and track proposals. Edit your message and send directly from Aurora Sonnet; clients confirm by reply.
        </p>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? 'Cancel' : 'New proposal'}
        </button>
      </header>

      {showCreate && (
        <section className={styles.card}>
          <h2>Create proposal from booking</h2>
          <p className={styles.cardDesc}>
            Pick a project to create a proposal. Send by email; agreement and invoice go out after they accept.
          </p>
          {projectsWithoutProposal.length === 0 ? (
            <p className={styles.emptyText}>Every project already has a proposal.</p>
          ) : (
            <ul className={styles.bookingList}>
              {projectsWithoutProposal.map((p) => {
                const pkgId = (selectedPackage[p.id] ?? p.packageType) ?? ''
                const isCustom = !pkgId
                const custom = customPackageByProject[p.id]
                const customState = custom ?? { name: '', details: '', breakdown: '', total: p.value }
                const value = isCustom ? (custom?.total ?? p.value) : (getPackageOrDuoPrice(pkgId) ?? p.value)
                return (
                  <li key={p.id} className={styles.bookingItem}>
                    <div>
                      <strong>{p.title}</strong>
                      <span className={styles.muted}>
                        {p.clientName} · {p.weddingDate}
                        {p.venue && ` · ${p.venue}`}
                      </span>
                    </div>
                    <div className={styles.proposalCreateRow}>
                      <select
                        value={pkgId}
                        onChange={(e) =>
                          setSelectedPackage((s) => ({
                            ...s,
                            [p.id]: e.target.value || '',
                          }))
                        }
                        className={styles.packageSelect}
                        aria-label="Select package"
                      >
                        <option value="">
                          Custom package
                        </option>
                        {ALL_PACKAGES.map((pk) => (
                          <option key={pk.id} value={pk.id}>
                            {pk.shortName} — ${pk.fromPrice.toLocaleString()}
                          </option>
                        ))}
                      </select>
                      <span className={styles.value}>${value.toLocaleString()}</span>
                      <button
                        type="button"
                        className={styles.primaryBtn}
                        onClick={() => handleCreateFromBooking(p.id)}
                      >
                        Create proposal
                      </button>
                    </div>
                    {isCustom && (
                      <div className={styles.customPackageForm}>
                        <label className={styles.customPackageLabel}>Package name</label>
                        <input
                          type="text"
                          className={styles.modalInput}
                          value={customState.name}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), name: e.target.value },
                            }))
                          }
                          placeholder="e.g. Custom Celebration Package"
                        />
                        <label className={styles.customPackageLabel}>Details</label>
                        <textarea
                          className={styles.customPackageTextarea}
                          value={customState.details}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), details: e.target.value },
                            }))
                          }
                          placeholder="Describe what’s included (bullets or paragraph)"
                          rows={3}
                        />
                        <label className={styles.customPackageLabel}>Price breakdown</label>
                        <textarea
                          className={styles.customPackageTextarea}
                          value={customState.breakdown}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), breakdown: e.target.value },
                            }))
                          }
                          placeholder="e.g. Ceremony — $1,500
Reception — $2,000
Total — $3,500"
                          rows={3}
                        />
                        <label className={styles.customPackageLabel}>Total ($)</label>
                        <input
                          type="number"
                          className={styles.inlineInput}
                          value={customState.total || ''}
                          onChange={(e) =>
                            setCustomPackageByProject((s) => ({
                              ...s,
                              [p.id]: { ...(s[p.id] ?? customState), total: Number(e.target.value) || 0 },
                            }))
                          }
                          min={0}
                          step={50}
                          placeholder="0"
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      <div className={styles.sortBar}>
        <label htmlFor="proposals-sort" className={styles.sortLabel}>Sort by</label>
        <select
          id="proposals-sort"
          className={styles.sortSelect}
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'date' | 'alphabetical')}
          aria-label="Sort proposals"
        >
          <option value="date">Date (newest first)</option>
          <option value="alphabetical">Alphabetical (by project)</option>
        </select>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Value</th>
              <th>Status</th>
              <th>Actions</th>
              <th aria-hidden />
            </tr>
          </thead>
          <tbody>
            {sortedProposals.map((p) => (
              <Fragment key={p.id}>
                <tr>
                  {editingId === p.id ? (
                    <>
                      <td>
                        <input
                          type="text"
                          className={styles.inlineInput}
                          value={editForm.title}
                          onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                          placeholder="Project title"
                        />
                      </td>
                      <td>{p.clientName}</td>
                      <td>
                        <input
                          type="number"
                          className={styles.inlineInput}
                          value={editForm.value || ''}
                          onChange={(e) => setEditForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))}
                          min={0}
                          step={50}
                        />
                      </td>
                      <td>
                        <select
                          className={styles.inlineSelect}
                          value={editForm.status}
                          onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as Proposal['status'] }))}
                        >
                          <option value="draft">Draft</option>
                          <option value="sent">Sent</option>
                          <option value="accepted">Accepted</option>
                          <option value="declined">Declined</option>
                        </select>
                      </td>
                      <td colSpan={2}>
                        <div className={styles.inlineEditActions}>
                          <button
                            type="button"
                            className={styles.primaryBtn}
                            onClick={saveEdit}
                            disabled={savingProposalId === editingId}
                          >
                            {savingProposalId === editingId ? 'Saving…' : 'Save'}
                          </button>
                          <button type="button" className={styles.linkBtn} onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                  <>
                    <td>
                      <strong>{p.title}</strong>
                    </td>
                    <td>
                      {getClientForProposal(p)?.client ? (
                        <Link to={`/clients/${getClientForProposal(p)!.client!.id}`} className={styles.clientLink}>
                          {p.clientName}
                        </Link>
                      ) : (
                        p.clientName
                      )}
                    </td>
                    <td>${p.value.toLocaleString()}</td>
                    <td>
                      <div className={styles.statusCell}>
                        <span className={styles.status} data-status={p.status}>
                          {p.status}
                        </span>
                        {p.status === 'draft' && (
                          <button
                            type="button"
                            className={styles.quickStatusBtn}
                            onClick={() => markAsSent(p)}
                            disabled={savingProposalId === p.id}
                          >
                            {savingProposalId === p.id ? 'Saving…' : 'Mark as Sent'}
                          </button>
                        )}
                        {p.status === 'sent' && (
                          <button
                            type="button"
                            className={styles.quickStatusBtn}
                            onClick={() => markAsAccepted(p)}
                            disabled={savingProposalId === p.id}
                          >
                            {savingProposalId === p.id ? 'Saving…' : 'Mark as Accepted'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={styles.actionsCell}>
                        <button
                          type="button"
                          className={styles.primaryBtn}
                          onClick={() => void openSendModal(p)}
                          title="Edit and send proposal by email"
                        >
                          Edit/Send
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className={styles.menuWrap} ref={menuOpenId === p.id ? menuRef : undefined}>
                        <button
                          ref={menuOpenId === p.id ? menuTriggerRef : undefined}
                          type="button"
                          className={styles.menuBtn}
                          aria-label="More actions"
                          aria-expanded={menuOpenId === p.id}
                          aria-haspopup="true"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (menuOpenId === p.id) {
                              setMenuOpenId(null)
                              setMenuTriggerRect(null)
                            } else {
                              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              setMenuTriggerRect({
                                top: rect.top,
                                left: rect.left,
                                width: rect.width,
                                height: rect.height,
                                openUp: rect.bottom + 220 > window.innerHeight,
                              })
                              setMenuOpenId(p.id)
                            }
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    </td>
                  </>
                  )}
                </tr>
                {editingId === p.id && (
                  <tr key={`${p.id}-custom`}>
                    <td colSpan={6} className={styles.editEmailCell}>
                      <div className={styles.customPackageEditSection}>
                        <span className={styles.editEmailLabel}>Experience & package (optional)</span>
                        <label className={styles.customPackageLabel}>Experience preset</label>
                        <select
                          className={styles.inlineSelect}
                          value={selectedExperienceId}
                          onChange={(e) => {
                            const id = e.target.value
                            setSelectedExperienceId(id)
                            const exp = presetExperiences.find((x) => x.id === id)
                            if (!exp) return
                            const detailsLines = [
                              exp.description?.trim() || '',
                              '',
                              ...exp.bullets,
                            ].filter(Boolean)
                            setEditForm((f) => ({
                              ...f,
                              customPackageName: exp.name,
                              customPackageDetails: detailsLines.join('\n'),
                              customPriceBreakdown: `From $${exp.fromPrice.toLocaleString()}`,
                              value: f.value || exp.fromPrice,
                            }))
                          }}
                        >
                          <option value="">None selected</option>
                          {presetExperiences.map((exp) => (
                            <option key={exp.id} value={exp.id}>
                              {exp.name} {exp.isCustom ? '— custom' : ''}
                            </option>
                          ))}
                        </select>
                        <label className={styles.customPackageLabel}>Package name</label>
                        <input
                          type="text"
                          className={styles.inlineInput}
                          value={editForm.customPackageName}
                          onChange={(e) => setEditForm((f) => ({ ...f, customPackageName: e.target.value }))}
                          placeholder="e.g. Custom Celebration Package"
                        />
                        <label className={styles.customPackageLabel}>Details</label>
                        <textarea
                          className={styles.editEmailTextarea}
                          value={editForm.customPackageDetails}
                          onChange={(e) => setEditForm((f) => ({ ...f, customPackageDetails: e.target.value }))}
                          placeholder="What’s included"
                          rows={2}
                        />
                        <label className={styles.customPackageLabel}>Price breakdown</label>
                        <textarea
                          className={styles.editEmailTextarea}
                          value={editForm.customPriceBreakdown}
                          onChange={(e) => setEditForm((f) => ({ ...f, customPriceBreakdown: e.target.value }))}
                          placeholder="e.g. Ceremony — $1,500"
                          rows={2}
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {editingId === p.id && (
                  <tr key={`${p.id}-email`}>
                    <td colSpan={6} className={styles.editEmailCell}>
                      <label className={styles.editEmailLabel}>Email message (used when you send the proposal)</label>
                      <textarea
                        className={styles.editEmailTextarea}
                        value={editForm.emailBody}
                        onChange={(e) => setEditForm((f) => ({ ...f, emailBody: e.target.value }))}
                        placeholder={getDefaultEmailBody(p.title, getClientForProposal(p)?.client?.name)}
                        rows={6}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {menuOpenId && menuTriggerRect && (() => {
        const p = proposals.find((pr) => pr.id === menuOpenId)
        if (!p) return null
        const { left, top, height, width, openUp } = menuTriggerRect
        const menuWidth = 180
        const style: React.CSSProperties = {
          position: 'fixed',
          left: Math.max(8, left + width - menuWidth),
          top: openUp ? undefined : top + height + 2,
          bottom: openUp ? window.innerHeight - top + 2 : undefined,
          minWidth: 140,
          width: menuWidth,
          zIndex: 1000,
        }
        return createPortal(
          <div
            ref={dropdownPortalRef}
            className={`${styles.dropdown} ${styles.dropdownPortal} ${openUp ? styles.dropdownOpenUp : ''}`}
            style={style}
            role="menu"
          >
            <button type="button" role="menuitem" onClick={() => startEdit(p)}>Edit</button>
            <button type="button" role="menuitem" onClick={() => void openSendModal(p)}>Send email</button>
            {p.status === 'accepted' && (
              <>
                <Link
                  to={`/contracts?projectId=${encodeURIComponent(p.projectId)}`}
                  className={styles.dropdownItemLink}
                  onClick={() => { setMenuOpenId(null); setMenuTriggerRect(null) }}
                  role="menuitem"
                >
                  Edit contract
                </Link>
                <Link
                  to={`/invoices?projectId=${encodeURIComponent(p.projectId)}`}
                  className={styles.dropdownItemLink}
                  onClick={() => { setMenuOpenId(null); setMenuTriggerRect(null) }}
                  role="menuitem"
                >
                  Edit invoice
                </Link>
                <button type="button" role="menuitem" onClick={() => openEmailAgreementAndInvoice(p)}>
                  Email agreement & invoice
                </button>
              </>
            )}
            <button type="button" role="menuitem" onClick={() => openDuplicateModal(p)}>Duplicate</button>
            <button type="button" role="menuitem" className={styles.dropdownDanger} onClick={() => handleDelete(p)}>Delete</button>
          </div>,
          document.body
        )
      })()}

      {proposals.length === 0 && !showCreate && (
        <div className={styles.empty}>
          <p>No proposals yet. Create one from a booking to get started.</p>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowCreate(true)}
          >
            New proposal
          </button>
        </div>
      )}

      {sendModal && (() => {
        const pair = getClientForProposal(sendModal.proposal)
        return (
        <div className={styles.modalOverlay} onClick={closeSendModal} role="dialog" aria-modal="true" aria-labelledby="send-proposal-title">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="send-proposal-title" className={styles.modalTitle}>Send proposal by email</h2>
            <div className={styles.modalField}>
              <label>Contact</label>
              <select
                className={styles.modalInput}
                value={clients.find((c) => (c.email || '').trim() === sendModal.toEmail.trim())?.id ?? ''}
                onChange={(e) => {
                  const clientId = e.target.value
                  const client = clients.find((c) => c.id === clientId)
                  setSendModal((s) => s && { ...s, toEmail: client?.email?.trim() ?? '' })
                }}
                aria-label="Select contact"
              >
                <option value="">— Select a contact —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {(c.email || '').trim() ? ` — ${c.email.trim()}` : ' (no email)'}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.modalField}>
              <label>To (client email)</label>
              <input
                type="email"
                className={styles.modalInput}
                value={sendModal.toEmail}
                onChange={(e) => setSendModal((s) => s && { ...s, toEmail: e.target.value })}
                placeholder="Enter or paste email address"
              />
              {pair?.client && (
                <span className={styles.modalHint}>
                  <Link to={`/clients/${pair.client.id}`} className={styles.modalLink} onClick={closeSendModal}>
                    Edit client contact info →
                  </Link>
                </span>
              )}
              {pair?.client && !sendModal.toEmail.trim() && (
                <p className={styles.modalHint}>
                  No email on file. Add it in{' '}
                  <Link to={`/clients/${pair.client.id}`} className={styles.modalLink} onClick={closeSendModal}>
                    Edit client →
                  </Link>{' '}
                  so it&apos;s here next time.
                </p>
              )}
            </div>
            <div className={styles.modalField}>
              <label>Subject</label>
              <input
                type="text"
                className={styles.modalInput}
                value={sendModal.subject}
                onChange={(e) => setSendModal((s) => s && { ...s, subject: e.target.value })}
              />
            </div>
            <div className={styles.modalField}>
              <label>Message</label>
              <textarea
                className={styles.modalTextarea}
                value={sendModal.body}
                onChange={(e) => setSendModal((s) => s && { ...s, body: e.target.value })}
                rows={8}
              />
              <div className={styles.emailSignatureBlock} aria-label="Signature">
                {EMAIL_SIGNATURE.split('\n').map((line, i) => (
                  <span key={i}>{line || '\u00A0'}</span>
                ))}
              </div>
            </div>
            {/* Invoice section was intentionally removed for a simpler flow:
                proposals go out on their own; invoices are created later from the Invoices page
                or automatically after agreements are signed. */}
            <div className={styles.modalField}>
              <label className={styles.modalCheckLabel}>
                <input
                  type="checkbox"
                  checked={sendModal.markAsSentOnSend}
                  onChange={(e) => setSendModal((s) => s && { ...s, markAsSentOnSend: e.target.checked })}
                />
                {' '}
                Mark proposal as Sent when I click Send email
              </label>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.primaryBtn} onClick={() => doSendProposalEmail()}>
                Send email
              </button>
              <button type="button" className={styles.linkBtn} onClick={closeSendModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {duplicateSource && (
        <div className={styles.modalOverlay} onClick={closeDuplicateModal} role="dialog" aria-modal="true" aria-labelledby="duplicate-proposal-title">
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 id="duplicate-proposal-title" className={styles.modalTitle}>Duplicate proposal</h2>
            <p className={styles.modalDesc}>
              Create a copy of &quot;{duplicateSource.title}&quot; for another booking. Select which project to attach it to.
            </p>
            <div className={styles.modalField}>
              <label>Booking</label>
              <select
                className={styles.modalInput}
                value={duplicateProjectId}
                onChange={(e) => setDuplicateProjectId(e.target.value)}
                aria-label="Select booking"
              >
                <option value="">Select a booking…</option>
                {projectsWithoutProposal.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.title} — {proj.clientName}
                  </option>
                ))}
              </select>
            </div>
            {projectsWithoutProposal.length === 0 && (
              <p className={styles.modalHint}>Every other booking already has a proposal.</p>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={doDuplicate}
                disabled={!duplicateProjectId || projectsWithoutProposal.length === 0 || duplicateCreating}
              >
                {duplicateCreating ? 'Creating…' : 'Create copy'}
              </button>
              <button type="button" className={styles.linkBtn} onClick={closeDuplicateModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  )
}
