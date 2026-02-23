import { useState, useRef, useCallback } from 'react'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import {
  apiUploadContractTemplate,
  apiCreateContractTemplateEditor,
  apiUpdateContractTemplateContent,
  getContractTemplateFileUrl,
  apiUpdateContractTemplateName,
  apiDeleteContractTemplate,
  apiReplaceContractTemplateFile,
  apiUploadInvoiceTemplate,
  getInvoiceTemplateFileUrl,
  apiUpdateInvoiceTemplateName,
  apiDeleteInvoiceTemplate,
  apiReplaceInvoiceTemplateFile,
} from '../api/db'
import { pdfToDocx } from '../utils/pdfToDocx'
import { pdfToHtml } from '../utils/pdfToHtml'
import ContractTemplateEditor from './ContractTemplateEditor'
import styles from '../pages/Templates.module.css'

type PdfFormField = { name: string; type: 'text' | 'checkbox'; value: string | boolean }

function bytesToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(new Blob([bytes]))
  })
}

function extractPdfFormFields(pdfDoc: PDFDocument): PdfFormField[] {
  const form = pdfDoc.getForm()
  const fields = form.getFields()
  const seen = new Set<string>()
  const out: PdfFormField[] = []
  for (const field of fields) {
    const name = field.getName()
    if (seen.has(name)) continue
    seen.add(name)
    try {
      const tf = form.getTextField(name)
      out.push({ name, type: 'text', value: tf.getText() ?? '' })
    } catch {
      try {
        const cb = form.getCheckBox(name)
        out.push({ name, type: 'checkbox', value: cb.isChecked() })
      } catch {
        // skip other field types
      }
    }
  }
  return out
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/** Embeddable template management UI: create and manage contract/invoice PDF templates */
export default function TemplatesSection() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const contractTemplates = state.contractTemplates ?? []
  const invoiceTemplates = state.invoiceTemplates ?? []

  const [contractName, setContractName] = useState('')
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [contractUploading, setContractUploading] = useState(false)
  const [contractUploadError, setContractUploadError] = useState('')
  const [invoiceName, setInvoiceName] = useState('')
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)
  const [invoiceUploading, setInvoiceUploading] = useState(false)
  const [invoiceUploadError, setInvoiceUploadError] = useState('')
  const [editingId, setEditingId] = useState<{ type: 'contract' | 'invoice'; id: string } | null>(null)
  const [editingName, setEditingName] = useState('')
  const [viewingTemplate, setViewingTemplate] = useState<{ type: 'contract' | 'invoice'; id: string; name: string } | null>(null)
  const [viewerFileKey, setViewerFileKey] = useState(0)
  const [replacingFile, setReplacingFile] = useState(false)
  const [replaceError, setReplaceError] = useState('')
  const [editFormFields, setEditFormFields] = useState<PdfFormField[] | null>(null)
  const [editAddedTexts, setEditAddedTexts] = useState<string[]>([])
  const [editNewText, setEditNewText] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [downloadingWord, setDownloadingWord] = useState(false)
  const [editingEditorTemplate, setEditingEditorTemplate] = useState<{
    id: string
    name: string
    contentHtml: string
  } | null>(null)
  const [creatingEditorTemplate, setCreatingEditorTemplate] = useState(false)
  const [convertingToEditor, setConvertingToEditor] = useState(false)
  const contractInputRef = useRef<HTMLInputElement>(null)
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const editPdfDocRef = useRef<PDFDocument | null>(null)

  const handleUploadContract = async () => {
    if (!contractName.trim() || !contractFile) return
    setContractUploadError('')
    setContractUploading(true)
    try {
      const base64 = await fileToBase64(contractFile)
      const id = await apiUploadContractTemplate(contractName.trim(), base64)
      if (id) {
        await actions.refreshState()
        const name = contractName.trim()
        setContractName('')
        setContractFile(null)
        if (contractInputRef.current) contractInputRef.current.value = ''

        // Convert PDF to editable format and open in editor
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
        const pdfUrl = baseUrl + getContractTemplateFileUrl(id) + '?t=' + Date.now()
        const contentHtml = await pdfToHtml(pdfUrl)
        await apiUpdateContractTemplateContent(id, contentHtml)
        await actions.refreshState()

        setEditingEditorTemplate({ id, name, contentHtml })
      }
    } catch (err) {
      setContractUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setContractUploading(false)
    }
  }

  const handleUploadInvoice = async () => {
    if (!invoiceName.trim() || !invoiceFile) return
    setInvoiceUploadError('')
    setInvoiceUploading(true)
    try {
      const base64 = await fileToBase64(invoiceFile)
      const id = await apiUploadInvoiceTemplate(invoiceName.trim(), base64)
      if (id) {
        await actions.refreshState()
        const name = invoiceName.trim()
        setInvoiceName('')
        setInvoiceFile(null)
        if (invoiceInputRef.current) invoiceInputRef.current.value = ''
        // Open the new template in edit mode so everything can be edited
        setViewerFileKey((k) => k + 1)
        setViewingTemplate({ type: 'invoice', id, name })
        await loadPdfForEditing('invoice', id, name)
      }
    } catch (err) {
      setInvoiceUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setInvoiceUploading(false)
    }
  }

  const openViewer = (type: 'contract' | 'invoice', id: string, name: string) => {
    setViewingTemplate({ type, id, name })
    setReplaceError('')
  }

  const isEditorContractTemplate = (t: { fileName?: string; contentHtml?: string | null }) =>
    !t.fileName || (t as { contentHtml?: string }).contentHtml != null

  const handleCreateEditorTemplate = async () => {
    setContractUploadError('')
    setCreatingEditorTemplate(true)
    try {
      const id = await apiCreateContractTemplateEditor('Artist Agency Agreement', '')
      if (id) {
        await actions.refreshState()
        const t = state.contractTemplates?.find((x) => x.id === id) ?? { id, name: 'Artist Agency Agreement', contentHtml: '' }
        setEditingEditorTemplate({
          id: t.id,
          name: t.name,
          contentHtml: (t as { contentHtml?: string }).contentHtml ?? '',
        })
      }
    } catch (err) {
      setContractUploadError(err instanceof Error ? err.message : 'Failed to create template')
    } finally {
      setCreatingEditorTemplate(false)
    }
  }

  const openEditorTemplate = (t: { id: string; name: string; contentHtml?: string | null }) => {
    setEditingEditorTemplate({
      id: t.id,
      name: t.name,
      contentHtml: t.contentHtml ?? '',
    })
  }

  const handleConvertPdfToEditor = async () => {
    if (!viewingTemplate || viewingTemplate.type !== 'contract') return
    setConvertingToEditor(true)
    setEditError('')
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const pdfUrl = baseUrl + getContractTemplateFileUrl(viewingTemplate.id) + '?t=' + Date.now()
      const contentHtml = await pdfToHtml(pdfUrl)
      await apiUpdateContractTemplateContent(viewingTemplate.id, contentHtml)
      await actions.refreshState()
      closeViewer()
      setEditingEditorTemplate({
        id: viewingTemplate.id,
        name: viewingTemplate.name,
        contentHtml,
      })
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to convert PDF to editable format')
    } finally {
      setConvertingToEditor(false)
    }
  }

  const handleDownloadAsWord = async () => {
    if (!viewingTemplate) return
    setDownloadingWord(true)
    setEditError('')
    try {
      const url = viewingTemplate.type === 'contract'
        ? getContractTemplateFileUrl(viewingTemplate.id)
        : getInvoiceTemplateFileUrl(viewingTemplate.id)
      const absUrl = (typeof window !== 'undefined' ? window.location.origin : '') + url
      const blob = await pdfToDocx(absUrl, viewingTemplate.name)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${viewingTemplate.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.docx`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to export as Word')
    } finally {
      setDownloadingWord(false)
    }
  }

  /** Load PDF and switch into edit mode (form fields + add text). For contracts with no form fields, auto-convert to editor. */
  const loadPdfForEditing = useCallback(
    async (type: 'contract' | 'invoice', id: string, name: string) => {
      setEditError('')
      setReplaceError('')
      setEditLoading(true)
      const url = type === 'contract' ? getContractTemplateFileUrl(id) : getInvoiceTemplateFileUrl(id)
      try {
        const res = await fetch(`${url}?t=${Date.now()}`)
        if (!res.ok) throw new Error('Failed to load PDF')
        const ab = await res.arrayBuffer()
        const pdfDoc = await PDFDocument.load(ab)
        editPdfDocRef.current = pdfDoc
        const fields = extractPdfFormFields(pdfDoc)

        if (type === 'contract' && fields.length === 0) {
          setEditLoading(false)
          setConvertingToEditor(true)
          try {
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
            const pdfUrl = baseUrl + getContractTemplateFileUrl(id) + '?t=' + Date.now()
            const contentHtml = await pdfToHtml(pdfUrl)
            await apiUpdateContractTemplateContent(id, contentHtml)
            await actions.refreshState()
            setViewingTemplate(null)
            setEditFormFields(null)
            setEditAddedTexts([])
            setEditNewText('')
            setEditError('')
            editPdfDocRef.current = null
            setEditingEditorTemplate({ id, name, contentHtml })
          } catch (err) {
            setEditError(err instanceof Error ? err.message : 'Failed to convert PDF')
          } finally {
            setConvertingToEditor(false)
          }
          return
        }

        setEditFormFields(fields)
        setEditAddedTexts([])
        setEditNewText('')
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'Failed to load PDF for editing')
        editPdfDocRef.current = null
      } finally {
        setEditLoading(false)
      }
    },
    [actions]
  )

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!viewingTemplate || !file) return
    e.target.value = ''
    setReplaceError('')
    setReplacingFile(true)
    try {
      const base64 = await fileToBase64(file)
      if (viewingTemplate.type === 'contract') {
        await apiReplaceContractTemplateFile(viewingTemplate.id, base64)
      } else {
        await apiReplaceInvoiceTemplateFile(viewingTemplate.id, base64)
      }
      await actions.refreshState()
      setViewerFileKey((k) => k + 1)
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : 'Failed to replace file')
    } finally {
      setReplacingFile(false)
    }
  }

  const openEditMode = async () => {
    if (!viewingTemplate) return
    await loadPdfForEditing(viewingTemplate.type, viewingTemplate.id, viewingTemplate.name)
  }

  const closeEditMode = () => {
    setEditFormFields(null)
    setEditAddedTexts([])
    setEditNewText('')
    setEditError('')
    setEditLoading(false)
    editPdfDocRef.current = null
  }

  const closeViewer = () => {
    if (editFormFields !== null && (editAddedTexts.length > 0 || editFormFields.length > 0)) {
      if (!confirm('Discard unsaved edits and close?')) return
    }
    closeEditMode()
    setViewingTemplate(null)
  }

  const setFormFieldValue = (name: string, value: string | boolean) => {
    setEditFormFields((prev) => prev ? prev.map((f) => f.name === name ? { ...f, value } : f) : null)
  }

  const addTextForEdit = () => {
    const t = editNewText.trim()
    if (!t) return
    setEditAddedTexts((prev) => [...prev, t])
    setEditNewText('')
  }

  const removeAddedText = (index: number) => {
    setEditAddedTexts((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSaveEditedPdf = async () => {
    const pdfDoc = editPdfDocRef.current
    if (!viewingTemplate || !pdfDoc) return
    setEditSaving(true)
    setEditError('')
    try {
      const form = pdfDoc.getForm()
      if (editFormFields) {
        for (const f of editFormFields) {
          try {
            if (f.type === 'text') {
              form.getTextField(f.name).setText(String(f.value))
            } else {
              const cb = form.getCheckBox(f.name)
              if (f.value) cb.check()
              else cb.uncheck()
            }
          } catch {
            // skip missing or read-only fields
          }
        }
      }
      try {
        form.updateFieldAppearances()
      } catch {
        // continue
      }
      if (editAddedTexts.length > 0) {
        const font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica)
        const pages = pdfDoc.getPages()
        if (pages.length > 0) {
          const page = pages[0]
          const { height } = page.getSize()
          let y = height - 50
          for (const text of editAddedTexts) {
            page.drawText(text, { x: 50, y, size: 12, font })
            y -= 20
          }
        }
      }
      const bytes = await pdfDoc.save()
      const base64 = await bytesToBase64(bytes)
      if (viewingTemplate.type === 'contract') {
        await apiReplaceContractTemplateFile(viewingTemplate.id, base64)
      } else {
        await apiReplaceInvoiceTemplateFile(viewingTemplate.id, base64)
      }
      await actions.refreshState()
      setViewerFileKey((k) => k + 1)
      closeEditMode()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save PDF')
    } finally {
      setEditSaving(false)
    }
  }

  const startEdit = (type: 'contract' | 'invoice', id: string, currentName: string) => {
    setEditingId({ type, id })
    setEditingName(currentName)
  }

  const saveEdit = async () => {
    if (!editingId) return
    const ok =
      editingId.type === 'contract'
        ? await apiUpdateContractTemplateName(editingId.id, editingName.trim())
        : await apiUpdateInvoiceTemplateName(editingId.id, editingName.trim())
    if (ok) await actions.refreshState()
    setEditingId(null)
  }

  const handleDeleteContract = async (t: { id: string; name: string; fileName?: string }) => {
    if (!confirm('Delete this contract template?')) return
    const isEditor = !t.fileName
    try {
      if (!isEditor) {
        const res = await fetch(getContractTemplateFileUrl(t.id))
        const blob = await res.blob()
        const base64 = await blobToBase64(blob)
        const ok = await apiDeleteContractTemplate(t.id)
        if (ok) {
          await actions.refreshState()
          pushUndo({
            id: `ct-${t.id}`,
            label: `Contract template "${t.name}" deleted`,
            undo: async () => {
              await apiUploadContractTemplate(t.name, base64)
              await actions.refreshState()
            },
          })
        }
      } else {
        const ok = await apiDeleteContractTemplate(t.id)
        if (ok) await actions.refreshState()
        setEditingEditorTemplate((prev) => (prev?.id === t.id ? null : prev))
      }
    } catch {
      const ok = await apiDeleteContractTemplate(t.id)
      if (ok) await actions.refreshState()
    }
  }

  const handleDeleteInvoice = async (t: { id: string; name: string }) => {
    if (!confirm('Delete this invoice template?')) return
    try {
      const res = await fetch(getInvoiceTemplateFileUrl(t.id))
      const blob = await res.blob()
      const base64 = await blobToBase64(blob)
      const ok = await apiDeleteInvoiceTemplate(t.id)
      if (ok) {
        await actions.refreshState()
        pushUndo({
          id: `it-${t.id}`,
          label: `Invoice template "${t.name}" deleted`,
          undo: async () => {
            await apiUploadInvoiceTemplate(t.name, base64)
            await actions.refreshState()
          },
        })
      }
    } catch {
      const ok = await apiDeleteInvoiceTemplate(t.id)
      if (ok) await actions.refreshState()
    }
  }

  return (
    <>
      <section className={styles.section}>
        <h2>Create new template</h2>
        <p className={styles.hint}>
          Use the editor to build contracts with merge fields and signatures (HoneyBook-style). You can also upload a PDF if it has fillable form fields.
        </p>
        <div className={styles.templateGrid}>
          <div>
            <h3 className={styles.subSectionTitle}>Contract templates</h3>
            <p className={styles.hint} data-build="v2-feb23">
              <strong>Recommended:</strong> Create from editor for full editing—add merge fields (client name, date, venue, etc.) and signature blocks. PDFs auto-convert to editor (including scanned).
            </p>
            <div className={styles.uploadRow}>
              <button
                type="button"
                onClick={handleCreateEditorTemplate}
                disabled={creatingEditorTemplate}
                className={styles.primaryEditorBtn}
              >
                {creatingEditorTemplate ? 'Creating…' : 'Create from editor'}
              </button>
              <span className={styles.or}>or upload PDF:</span>
              <input
                ref={contractInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  setContractFile(e.target.files?.[0] ?? null)
                  setContractUploadError('')
                }}
                className={styles.fileInput}
              />
              <input
                type="text"
                placeholder="Template name (PDF must have fillable form fields)"
                value={contractName}
                onChange={(e) => {
                  setContractName(e.target.value)
                  setContractUploadError('')
                }}
                className={styles.nameInput}
              />
              <button
                type="button"
                onClick={handleUploadContract}
                disabled={!contractName.trim() || !contractFile || contractUploading}
                className={styles.uploadBtn}
              >
                {contractUploading ? 'Uploading…' : 'Upload PDF'}
              </button>
            </div>
            {contractUploadError && (
              <p className={styles.uploadError} role="alert">
                {contractUploadError}
              </p>
            )}
            <ul className={styles.list}>
              {contractTemplates.map((t) => (
                <li key={t.id} className={styles.row}>
                  {editingId?.type === 'contract' && editingId.id === t.id ? (
                    <>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className={styles.nameInput}
                        autoFocus
                      />
                      <button type="button" onClick={saveEdit} className={styles.saveBtn}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className={styles.cancelBtn}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={styles.templateName}>{t.name}</span>
                      {isEditorContractTemplate(t) ? (
                        <button
                          type="button"
                          onClick={() => openEditorTemplate(t)}
                          className={styles.viewLink}
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openViewer('contract', t.id, t.name)}
                          className={styles.viewLink}
                        >
                          View
                        </button>
                      )}
                      <button type="button" onClick={() => startEdit('contract', t.id, t.name)} className={styles.editBtn}>
                        Edit name
                      </button>
                      <button type="button" onClick={() => handleDeleteContract(t)} className={styles.deleteBtn}>
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {contractTemplates.length === 0 && (
              <p className={styles.empty}>No contract templates. Upload a PDF or create from editor above.</p>
            )}
          </div>
          <div>
            <h3 className={styles.subSectionTitle}>Invoice templates</h3>
            <div className={styles.uploadRow}>
              <input
                ref={invoiceInputRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  setInvoiceFile(e.target.files?.[0] ?? null)
                  setInvoiceUploadError('')
                }}
                className={styles.fileInput}
              />
              <input
                type="text"
                placeholder="Template name"
                value={invoiceName}
                onChange={(e) => {
                  setInvoiceName(e.target.value)
                  setInvoiceUploadError('')
                }}
                className={styles.nameInput}
              />
              <button
                type="button"
                onClick={handleUploadInvoice}
                disabled={!invoiceName.trim() || !invoiceFile || invoiceUploading}
                className={styles.uploadBtn}
              >
                {invoiceUploading ? 'Uploading…' : 'Upload'}
              </button>
            </div>
            {invoiceUploadError && (
              <p className={styles.uploadError} role="alert">
                {invoiceUploadError}
              </p>
            )}
            <ul className={styles.list}>
              {invoiceTemplates.map((t) => (
                <li key={t.id} className={styles.row}>
                  {editingId?.type === 'invoice' && editingId.id === t.id ? (
                    <>
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className={styles.nameInput}
                        autoFocus
                      />
                      <button type="button" onClick={saveEdit} className={styles.saveBtn}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className={styles.cancelBtn}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={styles.templateName}>{t.name}</span>
                      <button
                        type="button"
                        onClick={() => openViewer('invoice', t.id, t.name)}
                        className={styles.viewLink}
                      >
                        View
                      </button>
                      <button type="button" onClick={() => startEdit('invoice', t.id, t.name)} className={styles.editBtn}>
                        Edit name
                      </button>
                      <button type="button" onClick={() => handleDeleteInvoice(t)} className={styles.deleteBtn}>
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {invoiceTemplates.length === 0 && (
              <p className={styles.empty}>No invoice templates. Upload a PDF above.</p>
            )}
          </div>
        </div>
      </section>

      {editingEditorTemplate && (
        <ContractTemplateEditor
          templateId={editingEditorTemplate.id}
          templateName={editingEditorTemplate.name}
          initialContentHtml={editingEditorTemplate.contentHtml}
          onClose={() => setEditingEditorTemplate(null)}
          onSaved={() => actions.refreshState()}
        />
      )}

      {viewingTemplate && (
        <div
          className={styles.viewerOverlay}
          onClick={closeViewer}
          role="dialog"
          aria-modal="true"
          aria-label="PDF viewer"
        >
          <div className={styles.viewerModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.viewerHeader}>
              <h3 className={styles.viewerTitle}>{viewingTemplate.name}</h3>
              <div className={styles.viewerActions}>
                {editFormFields === null ? (
                  <button
                    type="button"
                    onClick={openEditMode}
                    disabled={editLoading}
                    className={styles.editTemplateBtn}
                  >
                    {editLoading ? 'Loading…' : 'Edit template'}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={closeEditMode} className={styles.replaceBtn}>
                      Cancel edit
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveEditedPdf}
                      disabled={editSaving}
                      className={styles.saveEditBtn}
                    >
                      {editSaving ? 'Saving…' : 'Save'}
                    </button>
                  </>
                )}
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={handleReplaceFile}
                  className={styles.hiddenInput}
                  aria-label="Replace PDF file"
                />
                <button
                  type="button"
                  onClick={() => replaceInputRef.current?.click()}
                  disabled={replacingFile || editFormFields !== null}
                  className={styles.replaceBtn}
                >
                  {replacingFile ? 'Replacing…' : 'Replace PDF'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadAsWord}
                  disabled={downloadingWord || editFormFields !== null}
                  className={styles.replaceBtn}
                >
                  {downloadingWord ? 'Exporting…' : 'Download as Word'}
                </button>
                <button type="button" onClick={closeViewer} className={styles.closeViewerBtn}>
                  Close
                </button>
              </div>
            </div>
            {(replaceError || editError) && (
              <p className={styles.uploadError} role="alert">
                {editError || replaceError}
              </p>
            )}
            {editFormFields !== null && (
              <div className={styles.editPanel}>
                {editFormFields.length === 0 && (
                  <div className={styles.editorBanner}>
                    <p className={styles.editorBannerText}>
                      This PDF has no fillable form fields. <strong>Convert to editor</strong> to make every piece editable—add merge fields, signatures, and edit any text like HoneyBook.
                    </p>
                    <button
                      type="button"
                      onClick={handleConvertPdfToEditor}
                      disabled={convertingToEditor}
                      className={styles.editorBannerBtn}
                    >
                      {convertingToEditor ? 'Converting…' : 'Convert to editor'}
                    </button>
                  </div>
                )}
                <div className={styles.editSection}>
                  <h4 className={styles.editSectionTitle}>Form fields</h4>
                  {editFormFields.length === 0 ? (
                    <p className={styles.editHint}>No fillable form fields in this PDF.</p>
                  ) : (
                    <div className={styles.editFields}>
                      {editFormFields.map((f) => (
                        <label key={f.name} className={styles.editField}>
                          <span className={styles.editFieldName}>{f.name}</span>
                          {f.type === 'text' ? (
                            <input
                              type="text"
                              value={String(f.value)}
                              onChange={(e) => setFormFieldValue(f.name, e.target.value)}
                              className={styles.editFieldInput}
                            />
                          ) : (
                            <input
                              type="checkbox"
                              checked={Boolean(f.value)}
                              onChange={(e) => setFormFieldValue(f.name, e.target.checked)}
                              className={styles.editFieldCheckbox}
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.editSection}>
                  <h4 className={styles.editSectionTitle}>Add text to first page</h4>
                  <div className={styles.addTextRow}>
                    <input
                      type="text"
                      value={editNewText}
                      onChange={(e) => setEditNewText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addTextForEdit()}
                      placeholder="Text to add"
                      className={styles.editFieldInput}
                    />
                    <button type="button" onClick={addTextForEdit} className={styles.addTextBtn}>
                      Add
                    </button>
                  </div>
                  {editAddedTexts.length > 0 && (
                    <ul className={styles.addedTextList}>
                      {editAddedTexts.map((text, i) => (
                        <li key={i} className={styles.addedTextItem}>
                          <span>{text}</span>
                          <button type="button" onClick={() => removeAddedText(i)} className={styles.removeTextBtn} aria-label="Remove">
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
            <iframe
              key={viewerFileKey}
              title={`PDF: ${viewingTemplate.name}`}
              className={styles.viewerIframe}
              src={`${viewingTemplate.type === 'contract' ? getContractTemplateFileUrl(viewingTemplate.id) : getInvoiceTemplateFileUrl(viewingTemplate.id)}?t=${viewerFileKey}`}
            />
          </div>
        </div>
      )}
    </>
  )
}
