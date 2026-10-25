export function pythonExample(baseURL, apiKey) {
  return `from openai import OpenAI, DefaultHttpxClient

client = OpenAI(
    base_url=${JSON.stringify(baseURL || 'http://127.0.0.1:17863/v1')},
    api_key=${JSON.stringify(apiKey)},
    http_client=DefaultHttpxClient(trust_env=False, follow_redirects=False),
    max_retries=0,
)
reply = client.chat.completions.create(
    model="gpt-6-luna",
    messages=[{"role": "user", "content": "Hello"}],
    reasoning_effort="low",
)
print(reply.choices[0].message.content)`;
}

export function highlightPython(element, source) {
  const pattern = /("(?:\\.|[^"\\])*"|\b(?:from|import|False|True|None)\b|\b\d+\b)/g;
  const fragments = [];
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    fragments.push(document.createTextNode(source.slice(offset, match.index)));
    const span = document.createElement('span');
    span.className = match[0].startsWith('"') ? 'syntax-string' : /^\d/.test(match[0]) ? 'syntax-number' : 'syntax-keyword';
    span.textContent = match[0];
    fragments.push(span);
    offset = match.index + match[0].length;
  }
  fragments.push(document.createTextNode(source.slice(offset)));
  element.replaceChildren(...fragments);
}
