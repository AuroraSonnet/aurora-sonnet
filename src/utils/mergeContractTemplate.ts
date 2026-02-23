/**
 * Merge contract template HTML (with {{placeholders}}) with project and optional client data.
 * Used when generating a contract PDF from an editor template.
 */
export type MergeData = {
  clientName: string
  weddingDate: string
  venue?: string
  packageType?: string
  value: number
  title: string
  clientEmail?: string
  clientPhone?: string
}

const PLACEHOLDER_PREFIX = '{{'
const PLACEHOLDER_SUFFIX = '}}'

export function mergeContractTemplate(html: string, data: MergeData): string {
  const replacements: Record<string, string> = {
    client_name: data.clientName,
    client_email: data.clientEmail ?? '',
    client_phone: data.clientPhone ?? '',
    wedding_date: data.weddingDate,
    venue: data.venue ?? '',
    package_type: data.packageType ?? '',
    performance_fee: `$${data.value.toLocaleString()}`,
    project_title: data.title,
    signature_client: 'Signature: _________________________',
    signature_vendor: 'Signature: _________________________',
  }
  let out = html
  for (const [key, value] of Object.entries(replacements)) {
    const placeholder = `${PLACEHOLDER_PREFIX}${key}${PLACEHOLDER_SUFFIX}`
    out = out.split(placeholder).join(value)
  }
  return out
}
