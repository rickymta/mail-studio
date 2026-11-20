import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Button, IconButton, Spinner } from '@/components/ui';
import { t } from '@/lib/i18n';

GlobalWorkerOptions.workerSrc = workerUrl;
export default function PdfPreview({ data }: { data: Uint8Array<ArrayBuffer> }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(700);
  const [rendering, setRendering] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const task = getDocument({
      data: data.slice(),
      disableWorkerRendering: true,
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      wasmUrl: '/pdfjs/wasm/',
      useWorkerFetch: false,
    });
    void task.promise
      .then((doc) => {
        if (alive) setPdf(doc);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
      void task.destroy();
    };
  }, [data]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(200, entry.contentRect.width - 32));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf || !canvasHost.current) return;
    let alive = true;
    let task: RenderTask | null = null;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', t('PDF page {n}', { n: page }));
    const host = canvasHost.current;
    host.replaceChildren(canvas);
    void pdf
      .getPage(page)
      .then(async (pdfPage) => {
        if (!alive) return;
        setRendering(true);
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 2) * zoom;
        const viewport = pdfPage.getViewport({ scale });
        // Bound raster allocation even for unusually large pages.
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        task = pdfPage.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await task.promise;
        if (alive) setRendering(false);
      })
      .catch((e: unknown) => {
        if (alive) {
          setRendering(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
      task?.cancel();
      canvas.remove();
    };
  }, [pdf, page, zoom, width]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-border bg-surface p-2">
        <IconButton
          label={t('Previous page')}
          disabled={!pdf || page <= 1}
          onClick={() => setPage((n) => n - 1)}
        >
          <ChevronLeft className="size-4" />
        </IconButton>
        <span className="text-xs tabular-nums">
          {t('Page {n} of {total}', { n: page, total: pdf?.numPages ?? 0 })}
        </span>
        <IconButton
          label={t('Next page')}
          disabled={!pdf || page >= pdf.numPages}
          onClick={() => setPage((n) => n + 1)}
        >
          <ChevronRight className="size-4" />
        </IconButton>
        <span className="mx-1 h-5 border-l border-border" />
        <IconButton
          label={t('Zoom out')}
          disabled={zoom <= 0.5}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          <Minus className="size-4" />
        </IconButton>
        <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </Button>
        <IconButton
          label={t('Zoom in')}
          disabled={zoom >= 2}
          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
        >
          <Plus className="size-4" />
        </IconButton>
      </div>
      <div ref={container} className="relative min-h-0 flex-1 overflow-auto p-4">
        {error ? (
          <p role="alert" className="selectable m-0 break-words text-sm text-danger">
            {t('Could not preview the PDF. Save it to open it in another application.')}
            <span className="mt-2 block text-xs">{error}</span>
          </p>
        ) : (
          <>
            {rendering && (
              <div
                role="status"
                className="absolute top-4 left-4 flex items-center gap-2 rounded bg-surface p-2 text-xs"
              >
                <Spinner />
                {t('Loading preview…')}
              </div>
            )}
            <div ref={canvasHost} className="mx-auto w-fit shadow-sm" />
          </>
        )}
      </div>
    </div>
  );
}
