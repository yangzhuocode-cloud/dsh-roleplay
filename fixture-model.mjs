// Local-only Anthropic Messages endpoint for manual/E2E verification with DSH.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const [portFile, requestsFile] = process.argv.slice(2);
if (!portFile || !requestsFile) throw new Error('Pass a port file and a request log file');
const send = (res, value) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
};
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') return send(res, { data: [] });
  const body = JSON.parse(await Array.fromAsync(req).then(chunks => Buffer.concat(chunks).toString('utf8')));
  appendFileSync(requestsFile, JSON.stringify({ url: req.url, body }) + '\n');
  const messages = JSON.stringify(body.messages);
  let text = '隔离模型回执：测试回复。';
  if (!messages.includes('Generate the session title')) {
    if (messages.includes('回复格式：只写角色本人说出口的话')) text = '“这锅刚焖好。”';
    if (messages.includes('回复格式：角色说出口的话')) text = '*大肥鱼把碗放下。*\n\n“这锅刚焖好。”';
  }
  const content = [{ type: 'text', text }];
  const usage = { input_tokens: 2, output_tokens: 1 };
  const message = { type: 'message', id: 'msg_fixture', role: 'assistant', model: body.model,
    content, stop_reason: 'end_turn', stop_sequence: null, usage };
  if (!body.stream) return send(res, message);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...data }) + '\n\n');
  event('message_start', { message: { ...message, content: [], stop_reason: null } });
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  event('content_block_stop', { index: 0 });
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
  event('message_stop', {});
  res.end();
});
server.listen(0, '127.0.0.1', () => appendFileSync(portFile, String(server.address().port)));
