export const PREVIEW_LIMIT = 20 * 1024 * 1024;
export type PreviewKind = 'image' | 'pdf' | 'text' | 'audio' | 'video';
const extensions: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
};
const images = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
]);
export function previewType(
  name: string,
  mime: string,
): { kind: PreviewKind; mime: string } | null {
  let type = mime.toLowerCase().split(';')[0]!.trim();
  if (!type || type === 'application/octet-stream')
    type = extensions[name.split('.').pop()?.toLowerCase() ?? ''] ?? type;
  if (images.has(type)) return { kind: 'image', mime: type };
  if (type === 'application/pdf') return { kind: 'pdf', mime: type };
  // Active formats such as HTML are displayed as escaped text, never executed.
  if (
    type.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/javascript'].includes(type)
  )
    return { kind: 'text', mime: 'text/plain' };
  if (
    [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/ogg',
      'audio/mp4',
      'audio/flac',
    ].includes(type)
  )
    return { kind: 'audio', mime: type };
  if (['video/mp4', 'video/webm', 'video/ogg'].includes(type)) return { kind: 'video', mime: type };
  return null;
}
export function decodeAttachment(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}
