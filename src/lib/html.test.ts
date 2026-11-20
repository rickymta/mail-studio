import { fileKind } from './html';

describe('fileKind', () => {
  it('recognises common files by name', () => {
    expect(fileKind('Ra_soat_Phu_luc_04 - (V1.1).xlsx')).toBe('sheet');
    expect(fileKind('Report.DOCX')).toBe('doc');
    expect(fileKind('deck.pptx')).toBe('slides');
    expect(fileKind('invoice.pdf?download=1')).toBe('pdf');
    expect(fileKind('photos.zip')).toBe('archive');
    expect(fileKind('scan.jpeg')).toBe('image');
  });

  it('recognises online documents by their address', () => {
    expect(fileKind('https://docs.google.com/spreadsheets/d/abc/edit')).toBe('sheet');
    expect(fileKind('https://docs.google.com/document/d/abc')).toBe('doc');
  });

  it('returns null for anything else', () => {
    expect(fileKind('Click here')).toBeNull();
    expect(fileKind('https://example.com/pdfviewer')).toBeNull();
  });
});
