self.onconnect = (event) => {
  const port = event.ports[0];
  port.start();

  port.onmessage = async () => {
    port.postMessage('DEBUG: Starting fetch inside SharedWorker');
    try {
      const res = await fetch('http://localhost:3000/api/snapshot');
      port.postMessage('DEBUG: Fetch completed, status = ' + res.status);
      const text = await res.text();
      port.postMessage(text);
    } catch (err) {
      port.postMessage('ERROR: ' + err.message);
    }
  };
};
