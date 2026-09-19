import WebSocket from 'ws';

/** Loads an unpacked extension over CDP. Chrome stable ignores --load-extension, so this
 *  uses the Extensions domain, which needs --enable-unsafe-extension-debugging. */
export async function loadUnpacked(cdpBase, path) {
  const version = await (await fetch(`${cdpBase}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const id = 1;
  const result = await new Promise((resolve, reject) => {
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id !== id) return;
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method: 'Extensions.loadUnpacked', params: { path } }));
  });

  ws.close();
  return result.id;
}
