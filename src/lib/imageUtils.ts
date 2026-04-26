export interface ImageSize {
  width: number;
  height: number;
}

export async function convertToWebP(
  file: File,
  quality = 0.85,
  target?: ImageSize,
): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let canvasW: number, canvasH: number;
      let sx = 0, sy = 0, sw: number, sh: number;

      if (target) {
        canvasW = target.width;
        canvasH = target.height;
        const srcAspect = img.naturalWidth / img.naturalHeight;
        const tgtAspect = target.width / target.height;
        if (srcAspect > tgtAspect) {
          sh = img.naturalHeight;
          sw = sh * tgtAspect;
          sx = (img.naturalWidth - sw) / 2;
          sy = 0;
        } else {
          sw = img.naturalWidth;
          sh = sw / tgtAspect;
          sx = 0;
          sy = (img.naturalHeight - sh) / 2;
        }
      } else {
        canvasW = img.naturalWidth;
        canvasH = img.naturalHeight;
        sw = img.naturalWidth;
        sh = img.naturalHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasW, canvasH);

      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('WebP conversion failed')); return; }
          const baseName = file.name.replace(/\.[^.]+$/, '');
          resolve(new File([blob], `${baseName}.webp`, { type: 'image/webp' }));
        },
        'image/webp',
        quality,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}
