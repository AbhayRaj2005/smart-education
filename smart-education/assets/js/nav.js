// Smart Education — landing page nav toggle (index.html only)

document.addEventListener('DOMContentLoaded', () => {
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  if (navToggle && navLinks){
    navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
  }

  /* fade + slide up anything marked .reveal as it scrolls into view */
  const toReveal = document.querySelectorAll('.feature, .role-card, .ledger > div, .section-head, .cta-band');
  toReveal.forEach(el => el.classList.add('reveal'));

  if ('IntersectionObserver' in window){
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting){
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    toReveal.forEach(el => io.observe(el));
  } else {
    toReveal.forEach(el => el.classList.add('in'));
  }
});
