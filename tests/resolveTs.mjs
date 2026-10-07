// Node resolve hook for tests: src files import siblings without an extension, as Vite
// allows, so a relative import Node can't find is retried with .ts on the end.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || /\.[a-z]+$/i.test(specifier)) throw err;
    return nextResolve(`${specifier}.ts`, context);
  }
}
