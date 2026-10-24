// SIWC may send response.completed.output=[] even after complete output_item
// events. Keep the SSE output independently; completion still owns usage/status.
export class ResponseAccumulator {
  #items = new Map();

  observe(event) {
    const index = event.output_index;
    if (!Number.isInteger(index) || index < 0) return;
    if (event.type === 'response.output_item.added' || event.type === 'response.output_item.done') {
      if (event.item) this.#items.set(index, structuredClone(event.item));
      return;
    }
    const existing = this.#items.get(index);
    if (event.type === 'response.function_call_arguments.delta' || event.type === 'response.function_call_arguments.done') {
      if (!existing || existing.type !== 'function_call') return;
      existing.arguments = event.type.endsWith('.delta')
        ? (existing.arguments || '') + event.delta
        : event.arguments ?? existing.arguments;
      return;
    }
    const partIndex = event.content_index;
    if (!Number.isInteger(partIndex) || partIndex < 0) return;
    const item = existing || {type:'message', role:'assistant', content:[]};
    if (item.type !== 'message') return;
    item.content ||= [];
    if (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') {
      if (event.part) item.content[partIndex] = structuredClone(event.part);
    } else if (['response.output_text.delta','response.output_text.done','response.refusal.delta','response.refusal.done'].includes(event.type)) {
      const refusal = event.type.startsWith('response.refusal.');
      const key = refusal ? 'refusal' : 'text';
      const part = item.content[partIndex] || {type:refusal ? 'refusal' : 'output_text', [key]:''};
      part[key] = event.type.endsWith('.delta') ? (part[key] || '') + event.delta : event[key] ?? part[key];
      item.content[partIndex] = part;
    } else return;
    this.#items.set(index, item);
  }

  complete(response) {
    // A populated final output is authoritative. Never concatenate it with
    // accumulated deltas, which would duplicate both text and function calls.
    if (response.output?.length) return response;
    const output = [...this.#items].sort(([a],[b])=>a-b).map(([,item])=>{
      const copy = structuredClone(item);
      if (copy.type === 'message') copy.content = (copy.content || []).filter(Boolean);
      return copy;
    });
    return {...response, output};
  }
}
