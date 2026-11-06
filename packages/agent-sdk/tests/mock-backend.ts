import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

type Handler = (request: RecordedRequest, response: ServerResponse) => void;

/** A real HTTP server, so tests cover the wire format and dropped connections. */
export class MockBackend {
  readonly requests: RecordedRequest[] = [];
  private routes = new Map<string, Handler>();
  private server!: Server;

  get url() {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async start() {
    this.server = createServer((incoming, response) => void this.handle(incoming, response));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
  }

  async stop() {
    this.server.closeAllConnections();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /** Answers a route with JSON. The key is `METHOD /path`, without the query. */
  respond(route: string, status: number, body: unknown) {
    this.routes.set(route, (_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    });
  }

  /** Drops the connection with no answer, as a crash or network fault would. */
  hangUp(route: string) {
    this.routes.set(route, (_request, response) => response.destroy());
  }

  /** Answers with text that is not JSON, as a proxy error page would. */
  respondText(route: string, status: number, text: string) {
    this.routes.set(route, (_request, response) => {
      response.writeHead(status, { 'content-type': 'text/html' });
      response.end(text);
    });
  }

  countOf(route: string) {
    return this.requests.filter((request) => `${request.method} ${request.path.split('?')[0]}` === route).length;
  }

  private async handle(incoming: IncomingMessage, response: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    const path = incoming.url ?? '/';
    const request: RecordedRequest = {
      method: incoming.method ?? 'GET',
      path,
      authorization: incoming.headers.authorization,
      body: text ? JSON.parse(text) : undefined,
    };
    this.requests.push(request);
    const handler = this.routes.get(`${request.method} ${path.split('?')[0]}`);
    if (handler) return handler(request, response);
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'No such route.' }));
  }
}
