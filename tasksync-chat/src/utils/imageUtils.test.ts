import { describe, expect, it } from "vitest";
import { getImageMimeType } from "../utils/imageUtils";

describe("getImageMimeType", () => {
	it("returns correct MIME type for common image extensions", () => {
		expect(getImageMimeType("photo.png")).toBe("image/png");
		expect(getImageMimeType("photo.jpg")).toBe("image/jpeg");
		expect(getImageMimeType("photo.jpeg")).toBe("image/jpeg");
		expect(getImageMimeType("animation.gif")).toBe("image/gif");
		expect(getImageMimeType("modern.webp")).toBe("image/webp");
		expect(getImageMimeType("bitmap.bmp")).toBe("image/bmp");
		expect(getImageMimeType("vector.svg")).toBe("image/svg+xml");
		expect(getImageMimeType("favicon.ico")).toBe("image/x-icon");
		expect(getImageMimeType("scan.tiff")).toBe("image/tiff");
		expect(getImageMimeType("scan.tif")).toBe("image/tiff");
	});

	it("is case-insensitive for extensions", () => {
		expect(getImageMimeType("FILE.PNG")).toBe("image/png");
		expect(getImageMimeType("photo.JPG")).toBe("image/jpeg");
		expect(getImageMimeType("icon.SVG")).toBe("image/svg+xml");
	});

	it("returns application/octet-stream for unknown extensions", () => {
		expect(getImageMimeType("document.pdf")).toBe("application/octet-stream");
		expect(getImageMimeType("data.json")).toBe("application/octet-stream");
		expect(getImageMimeType("archive.zip")).toBe("application/octet-stream");
	});

	it("returns application/octet-stream for files without extension", () => {
		expect(getImageMimeType("README")).toBe("application/octet-stream");
		expect(getImageMimeType("Makefile")).toBe("application/octet-stream");
	});

	it("handles paths with directories", () => {
		expect(getImageMimeType("/Users/me/photos/img.png")).toBe("image/png");
		expect(getImageMimeType("C:\\Users\\me\\img.jpg")).toBe("image/jpeg");
		expect(getImageMimeType("./relative/path/icon.gif")).toBe("image/gif");
	});

	it("handles dotfiles", () => {
		expect(getImageMimeType(".hidden")).toBe("application/octet-stream");
	});

	it("handles double extensions (uses last)", () => {
		expect(getImageMimeType("file.tar.png")).toBe("image/png");
		expect(getImageMimeType("backup.jpg.bak")).toBe("application/octet-stream");
	});
});
