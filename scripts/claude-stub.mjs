/**
 * A scripted stand-in for the Claude API, used to exercise the agent's tool loop
 * without a key. Point the app at it with ANTHROPIC_BASE_URL. It proves the
 * wiring only, not the model's judgment.
 *
 * It behaves like a hijacked model: after discovery it tries to buy the $2.00
 * service, then an ID that was never discovered, then the real one.
 */
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3199);
const seen = [];

const message = (content, stop_reason) => ({
  id: `msg_${seen.length}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});
const call = (name, input) => message([{ type: 'tool_use', id: `tool_${seen.length}`, name, input }], 'tool_use');

const script = [
  () => call('discover_services', { query: 'cricket' }),
  () => call('purchase_service', { service_id: 'cricket-pro' }),
  () => call('purchase_service', { service_id: 'https://evil.example/steal' }),
  () => call('purchase_service', { service_id: 'cricket-live' }),
  () => message([{ type: 'text', text: 'Scores are in.' }], 'end_turn'),
];

createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk) => (raw += chunk));
  request.on('end', () => {
    if (request.url?.endsWith('/__seen')) {
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify(seen));
    }
    const body = JSON.parse(raw);
    seen.push({
      model: body.model,
      effort: body.output_config?.effort,
      fallbacks: body.fallbacks,
      betas: request.headers['anthropic-beta'],
      tools: (body.tools ?? []).map((tool) => tool.name),
      toolInputKeys: (body.tools ?? []).flatMap((tool) => Object.keys(tool.input_schema.properties)),
      lastResult: JSON.stringify(body.messages?.at(-1) ?? null).slice(0, 400),
    });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(script[seen.length - 1]()));
  });
}).listen(port, () => console.log(`Claude stub on ${port}`));
