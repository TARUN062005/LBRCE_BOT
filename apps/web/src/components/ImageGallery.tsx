import { useState } from 'react';
import { isCollegeUrl } from './Citations';

export interface GalleryImage {
  id: string;
  url: string;
  pageUrl?: string;
  title?: string;
  alt?: string;
  caption?: string;
  topic?: string;
}

export function ImageGallery({ title, images }: { title?: string; images: GalleryImage[] }) {
  const [active, setActive] = useState<GalleryImage | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  if (!images.length) {
    return <p className="text-sm text-muted">No official image with matching provenance was found.</p>;
  }
  return (
    <div>
      {title ? <h3 className="mb-3 text-base font-semibold">{title}</h3> : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {images.map((image) => (
          <figure key={image.id} className="overflow-hidden rounded-lg border border-line bg-white">
            {broken[image.id] ? (
              <div className="flex h-36 items-center p-3 text-sm text-muted">
                This image could not be embedded.
                {image.pageUrl && isCollegeUrl(image.pageUrl) ? (
                  <a className="ml-1 text-brand" href={image.pageUrl} target="_blank" rel="noreferrer">
                    Open the official page
                  </a>
                ) : null}
              </div>
            ) : (
              <button type="button" className="block w-full" onClick={() => setActive(image)}>
                <img
                  src={image.url}
                  alt={image.alt || image.title || 'Official college image'}
                  loading="lazy"
                  className="h-48 w-full object-cover"
                  onError={() => setBroken((current) => ({ ...current, [image.id]: true }))}
                />
              </button>
            )}
            <figcaption className="space-y-1 p-2 text-xs text-muted">
              <div className="font-semibold text-ink">{image.title || image.alt || 'Untitled image'}</div>
              {image.caption ? <div>{image.caption}</div> : null}
              {image.topic ? <div className="uppercase tracking-wide">{image.topic}</div> : null}
              {image.pageUrl && isCollegeUrl(image.pageUrl) ? (
                <a href={image.pageUrl} target="_blank" rel="noreferrer" className="text-brand">
                  Official page
                </a>
              ) : null}
            </figcaption>
          </figure>
        ))}
      </div>
      {active ? (
        <dialog open className="fixed inset-0 z-50 m-auto w-[min(960px,92vw)] rounded-xl border border-line bg-white p-4 shadow-card">
          <img src={active.url} alt={active.alt || active.title || 'Preview'} className="max-h-[70vh] w-full object-contain" />
          <div className="mt-3 flex items-center justify-between gap-3 text-sm">
            <p>{active.caption || active.title}</p>
            <button type="button" className="rounded-md bg-brand px-3 py-1.5 text-white" onClick={() => setActive(null)}>
              Close
            </button>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
