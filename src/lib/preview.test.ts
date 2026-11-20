import { decodeAttachment, decodeText, previewType } from './preview';
describe('attachment previews', () => {
  it('handles supported files and generic MIME fallbacks', () => {
    expect(previewType('PHOTO.JPG', 'application/octet-stream')).toEqual({
      kind: 'image',
      mime: 'image/jpeg',
    });
    expect(previewType('report.pdf', 'application/pdf')).toEqual({
      kind: 'pdf',
      mime: 'application/pdf',
    });
    expect(previewType('song.mp3', 'audio/mpeg')?.kind).toBe('audio');
    expect(previewType('clip.mp4', 'video/mp4')?.kind).toBe('video');
    expect(previewType('book.docx', 'application/octet-stream')).toBeNull();
    expect(previewType('fake.png', 'application/x-msdownload')).toBeNull();
  });
  it('renders active text formats as inert text', () => {
    expect(previewType('index.html', 'text/html; charset=utf-8')).toEqual({
      kind: 'text',
      mime: 'text/plain',
    });
    expect(previewType('code.js', 'application/javascript')?.kind).toBe('text');
  });
  it('preserves bytes and decodes Unicode text', () => {
    expect([...decodeAttachment('AH+A/w==')]).toEqual([0, 127, 128, 255]);
    expect(decodeText(new TextEncoder().encode('Xin chào'))).toBe('Xin chào');
    expect(decodeText(new Uint8Array([255, 254, 65, 0]))).toBe('A');
  });
});
