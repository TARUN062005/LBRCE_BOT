import { useState } from 'react';
import { Download, X } from 'lucide-react';
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

export function ImageGallery({ images }: { title?: string; images: GalleryImage[] }) {
  const [active, setActive] = useState<GalleryImage | null>(null);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const visible = images.filter((image) => image.url && !broken[image.id]);
  if (!visible.length) return null;
  return (
    <div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {visible.map((image) => {
          const caption = readableCaption(image);
          return (
            <figure key={image.id} className="group relative w-56 shrink-0">
              <button type="button" className="block w-full overflow-hidden rounded-2xl" onClick={() => setActive(image)}>
                <img
                  src={image.url}
                  alt={caption || 'College photograph'}
                  loading="lazy"
                  className="h-56 w-56 object-cover"
                  onError={() => setBroken((current) => ({ ...current, [image.id]: true }))}
                />
              </button>
              {caption ? <figcaption className="mt-1 line-clamp-2 text-xs text-muted">{caption}</figcaption> : null}
              {isCollegeUrl(image.url) && /\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(image.url) ? (
                <a
                  href={`/api/media?url=${encodeURIComponent(image.url)}`}
                  download
                  aria-label="Download image"
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                >
                  <Download size={14} />
                </a>
              ) : null}
            </figure>
          );
        })}
      </div>
      {active ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setActive(null)}>
          <button type="button" aria-label="Close preview" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" onClick={() => setActive(null)}>
            <X size={18} />
          </button>
          <img src={active.url} alt={readableCaption(active) || 'Preview'} className="max-h-[86vh] max-w-[92vw] rounded-2xl object-contain" onClick={(event) => event.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}

function readableCaption(image: GalleryImage): string {
  const caption = (image.caption || image.alt || '').replace(/\s+/g, ' ').trim();
  if (!caption || caption.length > 90) return '';
  if (/https?:|www\.|lbrce|best engineering|autonomous|naac|official college/i.test(caption)) return '';
  return caption;
}
