import '@fontsource/mitr/400.css';
import '@fontsource/mitr/600.css';
import '@fontsource/mitr/700.css';
import './compare.css';

const scenes = ['home', 'play', 'friends', 'settings'];
function select(scene: string) {
  if (!scenes.includes(scene)) scene = 'home';
  for (const art of ['original', 'cartoon']) {
    const url = `./?art=${art}&scene=${scene}`;
    document.querySelector<HTMLIFrameElement>(`#${art}`)!.src = `${url}&embed=1`;
    document.querySelector<HTMLAnchorElement>(`#${art}-link`)!.href = url;
  }
  document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.scene === scene));
  });
  history.replaceState(null, '', `?scene=${scene}`);
}
document.querySelectorAll<HTMLButtonElement>('[data-scene]').forEach(button => {
  button.addEventListener('click', () => select(button.dataset.scene!));
});
// Both panes retain the same desktop viewport instead of comparing different breakpoints.
const observer = new ResizeObserver(entries => {
  for (const entry of entries) {
    const viewport = entry.target as HTMLElement;
    viewport.style.height = `${entry.contentRect.width * 800 / 1280}px`;
    viewport.querySelector('iframe')!.style.transform = `scale(${entry.contentRect.width / 1280})`;
  }
});
document.querySelectorAll('.viewport').forEach(el => observer.observe(el));
select(new URLSearchParams(location.search).get('scene') || 'home');
