export async function load(url, context, nextLoad) {
  if (url.endsWith('.html') || url.endsWith('.css') || url.endsWith('.svg') || url.endsWith('.txt') || url.endsWith('.json') || url.endsWith('.client.js')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default "";'
    };
  }
  if (url.endsWith('.png')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: 'export default new Uint8Array();'
    };
  }
  return nextLoad(url, context);
}
