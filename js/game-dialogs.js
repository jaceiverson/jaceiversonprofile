/* Consistent dismissal for optional game dialogs; required reviews can opt out. */
(function(root) {
  'use strict';
  function bind(dialog, { requiresConfirmation = () => false } = {}) {
    let pressedOutside = false;
    const controls = [...dialog.querySelectorAll('[data-dialog-close]')];
    const outside = event => {
      if (event.target !== dialog) return false;
      const r = dialog.getBoundingClientRect();
      return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
    };
    const close = () => { if (!requiresConfirmation()) dialog.close(); };
    controls.forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('pointerdown', event => { pressedOutside = outside(event); });
    dialog.addEventListener('pointercancel', () => { pressedOutside = false; });
    dialog.addEventListener('click', event => {
      if (pressedOutside && outside(event)) close();
      pressedOutside = false;
    });
    dialog.addEventListener('cancel', event => { if (requiresConfirmation()) event.preventDefault(); });
    const update = () => controls.forEach(button => { button.hidden = requiresConfirmation(); });
    update();
    return { update };
  }
  const api = { bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameDialogs = api;
})(typeof window !== 'undefined' ? window : globalThis);
