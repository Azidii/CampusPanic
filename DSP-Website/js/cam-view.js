document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('camNodeSelector')?.addEventListener('change', event => {
    window.location.href = `/cam-view?nodeId=${encodeURIComponent(event.target.value)}`;
  });
});
