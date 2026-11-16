// Passing an instrument on: as a file, and as a link that carries the
// instrument in its address, so that nothing has to be stored on a server.
// What the text means is the caller's business (each builder validates what
// it reads); this only moves text around.

/** Text as it goes into a link: UTF-8 in URL-safe base64, without padding. */
export function toLink(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The text a link carries, or null if that part of the link is not something toLink wrote. */
export function fromLink(code: string): string | null {
  try {
    const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

/** The part of this page's address after `#name=`, decoded; null if there is none or it cannot be read. */
export function linked(name: string, hash: string): string | null {
  const prefix = `#${name}=`
  return hash.startsWith(prefix) ? fromLink(hash.slice(prefix.length)) : null
}

/** A file name made from an instrument's name. */
export const fileName = (name: string) => `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instrument'}.melofably.json`

/** Hands the user a text file to keep. */
export function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Asks the user for a file and reads it as text; null if they chose none. */
export function pickText(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      file.text().then(resolve, () => resolve(null))
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** Puts text on the clipboard. False if the browser would not allow it. */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** This page's address with `#name=…` carrying `text`. */
export const linkTo = (name: string, text: string) => `${location.origin}${location.pathname}#${name}=${toLink(text)}`

/** Removes what a link carried from the address bar once it has been read, so that reloading does not open it again over later work. */
export const forgetLink = (hash = '') => history.replaceState(null, '', `${location.pathname}${location.search}${hash}`)
