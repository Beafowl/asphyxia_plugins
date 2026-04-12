if (typeof canEdit !== 'undefined' && !canEdit) {
  var form = document.querySelector('form[action="/emit/updateProfile"]');
  if (form) {
    var inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(function(el) { el.disabled = true; });
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.style.display = 'none';
  }
}
