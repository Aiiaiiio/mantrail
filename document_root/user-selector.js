class UserSelector {
  constructor({ multiSelect = true, labels = {}, onApply, onClose } = {}) {
    this.multiSelect = multiSelect;
    this.labels = Object.assign({
      title: 'Select users',
      search: 'Search...',
      selectedCount: (n) => `${n} selected`,
      apply: 'Apply',
      noResults: 'No users found',
    }, labels);
    this.onApply = onApply || (() => {});
    this.onClose = onClose || (() => {});
    this.selectedIds = new Set();
    this.allUsers = [];
    this._createModal();
  }

  _createModal() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';
    this.overlay.style.display = 'none';
    this.overlay.innerHTML = `
      <div class="modal-content user-selector-modal">
        <div class="modal-header">
          <h3>${this.labels.title}</h3>
          <button class="btn-icon user-selector-close">&times;</button>
        </div>
        <input type="text" class="user-selector-search" placeholder="${this.labels.search}" />
        <div class="user-selector-list"></div>
        <div class="user-selector-footer">
          <span class="user-selector-count">${this.labels.selectedCount(0)}</span>
          <button class="btn btn-sm user-selector-apply">${this.labels.apply}</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.overlay.querySelector('.user-selector-close').addEventListener('click', () => this.close());

    this.overlay.querySelector('.user-selector-search').addEventListener('input', (e) => {
      this._filter(e.target.value);
    });

    this.overlay.querySelector('.user-selector-apply').addEventListener('click', () => {
      this.onApply([...this.selectedIds]);
      this.close();
    });
  }

  open(users) {
    this.allUsers = users;
    this.selectedIds.clear();
    this._filter('');
    this.overlay.style.display = 'flex';
    const input = this.overlay.querySelector('.user-selector-search');
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }

  close() {
    this.overlay.style.display = 'none';
    this.onClose();
  }

  getSelectedIds() {
    return [...this.selectedIds];
  }

  _filter(query) {
    const q = query.toLowerCase();
    this.filteredUsers = this.allUsers.filter(u =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
    this._renderList();
    this._updateCount();
  }

  _renderList() {
    const list = this.overlay.querySelector('.user-selector-list');
    if (this.filteredUsers.length === 0) {
      list.innerHTML = `<div class="user-selector-empty">${this.labels.noResults}</div>`;
      return;
    }

    const inputType = this.multiSelect ? 'checkbox' : 'radio';
    list.innerHTML = this.filteredUsers.map(u => {
      const checked = this.selectedIds.has(u.id) ? 'checked' : '';
      return `
        <label class="user-selector-item" data-id="${u.id}">
          <input type="${inputType}" ${checked} value="${u.id}" />
          <span><strong>${this._esc(u.name)}</strong> <span class="user-selector-email">${this._esc(u.email)}</span></span>
        </label>
      `;
    }).join('');

    list.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', (e) => {
        const id = e.target.value;
        if (this.multiSelect) {
          if (e.target.checked) this.selectedIds.add(id);
          else this.selectedIds.delete(id);
        } else {
          this.selectedIds.clear();
          this.selectedIds.add(id);
          this.onApply([id]);
          this.close();
          return;
        }
        this._updateCount();
      });
    });
  }

  _updateCount() {
    const countEl = this.overlay.querySelector('.user-selector-count');
    const applyEl = this.overlay.querySelector('.user-selector-apply');
    const n = this.selectedIds.size;
    countEl.textContent = this.labels.selectedCount(n);
    if (this.multiSelect) {
      applyEl.style.display = n > 0 ? '' : 'none';
    }
  }

  _esc(s) {
    const div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }
}
