self.onmessage = async () => {
  try {
    const [snapRes, statRes, dataRes] = await Promise.all([
      fetch('http://localhost:3000/api/snapshot'),
      fetch('http://localhost:3000/api/status'),
      fetch('http://localhost:3000/api/data', { method: 'POST', body: 'test' })
    ]);
    const text = [await snapRes.text(), await statRes.text(), await dataRes.text()].join('\n');
    self.postMessage(text);
  } catch (err) {
    self.postMessage('ERROR: ' + err.message);
  }
};
