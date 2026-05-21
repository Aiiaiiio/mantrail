const I18n = {
  locale: 'hu',
  strings: {},
  ready: false,
  onReady: [],

  async init() {
    this.locale = localStorage.getItem('locale') || 'hu';
    await this.load(this.locale);
  },

  async load(locale) {
    try {
      const res = await fetch(`locales/${locale}.json`);
      this.strings = await res.json();
      this.locale = locale;
      this.ready = true;
      this.onReady.forEach(fn => fn());
      this.onReady = [];
    } catch (e) {
      console.error('Failed to load locale:', locale, e);
      if (locale !== 'hu') {
        await this.load('hu');
      }
    }
  },

  t(key, vars) {
    const parts = key.split('.');
    let val = this.strings;
    for (const p of parts) {
      if (val == null) return key;
      val = val[p];
    }
    if (val == null) return key;
    if (vars) {
      return val.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? vars[k] : `{${k}}`);
    }
    return val;
  },

  applyDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const attr = el.getAttribute('data-i18n-attr');
      const text = this.t(key);
      if (attr) {
        el.setAttribute(attr, text);
      } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.setAttribute('placeholder', text);
      } else {
        el.textContent = text;
      }
    });
  },

  async setLocale(locale) {
    localStorage.setItem('locale', locale);
    await this.load(locale);
    this.applyDOM();
    if (window.App && App.onLocaleChange) {
      App.onLocaleChange();
    }
  },
};
