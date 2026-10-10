// Tiny i18n shared by the main process and the renderer windows (UMD: works in Node and in the browser).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.I18N = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const LANGS = ['pt-BR', 'en'];
  function pick(lang) {
    if (LANGS.includes(lang)) return lang;
    return String(lang || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  }
  function make(dicts, lang) {
    const l = pick(lang);
    return function t(key, vars) {
      let s = (dicts[l] && dicts[l][key]) || (dicts.en && dicts.en[key]) || key;
      if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
      return s;
    };
  }
  return { LANGS, pick, make };
});
