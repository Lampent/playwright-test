self.onmessage = async () => {
  try {
    const res = await fetch('http://localhost:3000/api/snapshot');
    const text = await res.text();
    self.postMessage(text);
  } catch (err) {
    self.postMessage('ERROR: ' + err.message);
  }
};
