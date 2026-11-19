export interface FlyerPresetOption {
  id: string;
  label: string;
  url: string;
}

export const STUDIO_FLYER_PRESETS: FlyerPresetOption[] = [
  {
    id: 'wedding',
    label: 'Wedding',
    url: '/src/assets/images/flyer_wedding_royal_1795075790983.jpg',
  },
  {
    id: 'events',
    label: 'Conference',
    url: '/src/assets/images/flyer_tech_summit_1795075791295.jpg',
  },
  {
    id: 'church',
    label: 'Church',
    url: '/src/assets/images/flyer_church_revival_1795075792994.jpg',
  },
  {
    id: 'musical',
    label: 'Musical',
    url: '/src/assets/images/flyer_musical_live_1795075793134.jpg',
  },
  {
    id: 'corporate',
    label: 'Corporate',
    url: '/src/assets/images/flyer_corporate_gala_1795075792816.jpg',
  },
  {
    id: 'funeral',
    label: 'Memorial',
    url: '/src/assets/images/flyer_funeral_memorial_1795075793453.jpg',
  },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read uploaded image file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Compresses raster flyer uploads (PNG/JPG/WebP) to a compact max-1400px JPEG Data URL
 * so uploaded flyers save quickly to the backend, render crisply on Overview & Home,
 * and stay lightweight inside OG image cards.
 */
export async function compressFlyerImageFile(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (typeof document === 'undefined' || file.type === 'image/svg+xml') {
    return rawDataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1400;
        let { width, height } = img;
        if (!width || !height) {
          resolve(rawDataUrl);
          return;
        }
        if (width > maxDim || height > maxDim) {
          const scale = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.86);
        resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}
