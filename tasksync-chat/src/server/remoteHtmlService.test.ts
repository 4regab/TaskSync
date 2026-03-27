import * as http from "http";
import { describe, expect, it, vi } from "vitest";
import "../__mocks__/vscode";
import { RemoteHtmlService } from "./remoteHtmlService";

function createResponse() {
	let statusCode = 200;
	let body = "";
	const res = {
		writeHead: vi.fn((status: number) => {
			statusCode = status;
			return res;
		}),
		end: vi.fn((chunk?: string) => {
			body = chunk ?? "";
			return res;
		}),
	} as unknown as http.ServerResponse;
	return {
		res,
		getStatus: () => statusCode,
		getBody: () => body,
	};
}

function createRequest(url: string): http.IncomingMessage {
	return {
		url,
		headers: { host: "localhost:3580" },
	} as http.IncomingMessage;
}

describe("RemoteHtmlService.handleHttp", () => {
	it("returns 400 for malformed percent-encoding in /media paths", () => {
		const service = new RemoteHtmlService("/tmp/web", "/tmp/media");
		const serveFileSpy = vi.spyOn(service, "serveFile");
		const { res, getStatus, getBody } = createResponse();

		service.handleHttp(
			createRequest("/media/%E0%A4%A"),
			res,
			{} as never,
			{} as never,
			false,
			{ searchFilesForRemote: vi.fn() },
		);

		expect(getStatus()).toBe(400);
		expect(getBody()).toBe("Bad Request");
		expect(serveFileSpy).not.toHaveBeenCalled();
	});

	it("returns 400 for malformed percent-encoding in default static-file paths", () => {
		const service = new RemoteHtmlService("/tmp/web", "/tmp/media");
		const serveFileSpy = vi.spyOn(service, "serveFile");
		const { res, getStatus, getBody } = createResponse();

		service.handleHttp(
			createRequest("/%E0%A4%A"),
			res,
			{} as never,
			{} as never,
			false,
			{ searchFilesForRemote: vi.fn() },
		);

		expect(getStatus()).toBe(400);
		expect(getBody()).toBe("Bad Request");
		expect(serveFileSpy).not.toHaveBeenCalled();
	});

	it("includes a dedicated reset-session button in the remote header", () => {
		const service = new RemoteHtmlService("/tmp/web", "/tmp/media");
		(service as any)._cachedBodyTemplate = "<main>Remote body</main>";

		const html = (service as any).generateRemoteAppHtml("localhost:3580");

		expect(html).toContain('id="remote-new-session-btn"');
		expect(html).toContain('id="remote-reset-session-btn"');
		expect(html).toContain('title="Reset Session"');
	});
});
