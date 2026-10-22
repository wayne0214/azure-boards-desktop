import { describe, expect, it } from 'vitest'
import { isAdoAttachment, restoreImageSources } from './attachments'
import { htmlToText } from './format'

describe('isAdoAttachment', () => {
  it('accepts Azure DevOps attachment hosts', () => {
    expect(isAdoAttachment('https://dev.azure.com/org/_apis/wit/attachments/1')).toBe(true)
    expect(isAdoAttachment('https://org.visualstudio.com/_apis/wit/attachments/1')).toBe(true)
  })

  it('refuses look-alike hosts that would receive the token', () => {
    expect(isAdoAttachment('https://evil.com?.visualstudio.com/x')).toBe(false)
    expect(isAdoAttachment('https://evil.com/x.visualstudio.com/')).toBe(false)
    expect(isAdoAttachment('https://dev.azure.com.evil.com/x')).toBe(false)
    expect(isAdoAttachment('http://dev.azure.com/x')).toBe(false)
    expect(isAdoAttachment('data:image/png;base64,AAAA')).toBe(false)
    expect(isAdoAttachment('not a url')).toBe(false)
  })
})

describe('htmlToText', () => {
  it('reads text without attaching the markup to the page', () => {
    expect(htmlToText('<p>Fix <b>upload</b></p><img src=x onerror="window.__pwned=1">')).toBe('Fix upload')
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
  })
})

describe('restoreImageSources', () => {
  it('puts the Azure DevOps URL back in place of the local copy', () => {
    const html = '<p><img src="data:image/png;base64,AA" data-original-src="https://dev.azure.com/o/a.png" class="loading"></p>'
    expect(restoreImageSources(html)).toBe('<p><img src="https://dev.azure.com/o/a.png"></p>')
  })
})
