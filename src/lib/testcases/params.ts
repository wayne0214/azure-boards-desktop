import { plain, type StepItem } from './steps'

/** Values the steps run with, one row per iteration (Microsoft.VSTS.TCM.Parameters / LocalDataSource). */
export interface TestData { names: string[]; rows: Record<string, string>[] }

// "@rate" but not the "@" in an e-mail address.
const PARAM = /(?<![\w.])@([A-Za-z_]\w*)/g

/** The @parameters the steps use, in order of first appearance. */
export function paramNames(items: StepItem[]): string[] {
  const out: string[] = []
  for (const it of items) {
    if (it.kind !== 'step') continue
    for (const m of `${plain(it.action)} ${plain(it.expected)}`.matchAll(PARAM)) if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

const parse = (xml: string | undefined) => {
  if (!xml?.trim()) return null
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  return doc.getElementsByTagName('parsererror').length ? null : doc
}

export function parseTestData(paramsXml?: string, dataSourceXml?: string): TestData {
  const names = Array.from(parse(paramsXml)?.getElementsByTagName('param') ?? []).map((p) => p.getAttribute('name') ?? '').filter(Boolean)
  const rows = Array.from(parse(dataSourceXml)?.getElementsByTagName('Table1') ?? []).map((t) => {
    const row: Record<string, string> = {}
    for (const n of names) row[n] = t.getElementsByTagName(n)[0]?.textContent ?? ''
    return row
  })
  return { names, rows }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The portal's own shapes, schema included, so the web editor keeps showing the data. */
export function serializeTestData(d: TestData): { params: string; dataSource: string } {
  const params = `<parameters>${d.names.map((n) => `<param name="${n}" bind="default"/>`).join('')}</parameters>`
  const schema = `<xs:schema id="NewDataSet" xmlns="" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:msdata="urn:schemas-microsoft-com:xml-msdata"><xs:element name="NewDataSet" msdata:IsDataSet="true" msdata:Locale=""><xs:complexType><xs:choice minOccurs="0" maxOccurs="unbounded"><xs:element name="Table1"><xs:complexType><xs:sequence>${d.names
    .map((n) => `<xs:element name="${n}" type="xs:string" minOccurs="0" />`)
    .join('')}</xs:sequence></xs:complexType></xs:element></xs:choice></xs:complexType></xs:element></xs:schema>`
  const rows = d.rows.map((r) => `<Table1>${d.names.map((n) => `<${n}>${esc(r[n] ?? '')}</${n}>`).join('')}</Table1>`).join('')
  return { params, dataSource: `<NewDataSet>${schema}${rows}</NewDataSet>` }
}
