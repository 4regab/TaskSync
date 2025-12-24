import * as path from 'path';

/**
 * Get MIME type for an image file based on its extension
 * @param filePath - Path to the image file
 * @returns MIME type string (e.g., 'image/png') or 'application/octet-stream' if unknown
 */
export function getImageMimeType(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.tiff': 'image/tiff',
        '.tif': 'image/tiff',
    };
    return mimeTypes[extension] || 'application/octet-stream';
}
