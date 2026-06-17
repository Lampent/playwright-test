self.onconnect = (event) => {
  const port = event.ports[0];
  port.start();

  port.onmessage = async () => {
    port.postMessage('DEBUG: Starting fetches inside SharedWorker');
    
    let snapText = 'SNAPSHOT ERROR';
    try {
      const snapRes = await fetch('http://localhost:3000/api/snapshot');
      snapText = await snapRes.text();
    } catch (e) { snapText = 'ERR: ' + e.message; }

    let statText = 'STATUS ERROR';
    try {
      const statRes = await fetch('http://localhost:3000/api/status');
      statText = await statRes.text();
    } catch (e) { statText = 'ERR: ' + e.message; }

    let dataText = 'DATA ERROR';
    try {
      const dataRes = await fetch('http://localhost:3000/api/data', { method: 'POST', body: 'test' });
      dataText = await dataRes.text();
    } catch (e) { dataText = 'ERR: ' + e.message; }

    const combined = [snapText, statText, dataText].join('\n');
    port.postMessage(combined);
  };
};
