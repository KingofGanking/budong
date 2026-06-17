const root = document.documentElement;
const hero = document.querySelector(".hero");
const journey = document.querySelector(".journey");
const relaySection = document.querySelector(".relay-section");
const header = document.querySelector(".site-header");
const longBgImage = document.querySelector(".site-long-bg img");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let bgTravel = 0;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function updateScrollState() {
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  root.style.setProperty("--scroll-progress", progress.toFixed(4));

  if (longBgImage && !reduceMotion.matches) {
    root.style.setProperty("--bg-shift", `${(-bgTravel * progress).toFixed(2)}px`);
  }

  const uiProgress = clamp((window.scrollY - window.innerHeight * 0.58) / (window.innerHeight * 0.36));
  root.style.setProperty("--ui-opacity", uiProgress.toFixed(4));

  if (hero) {
    const rect = hero.getBoundingClientRect();
    const travel = Math.max(rect.height - window.innerHeight, 1);
    const local = clamp(-rect.top / travel);
    hero.style.setProperty("--hero-progress", local.toFixed(4));
  }

  if (journey) {
    const rect = journey.getBoundingClientRect();
    const travel = Math.max(rect.height - window.innerHeight, 1);
    const local = clamp(-rect.top / travel);
    journey.style.setProperty("--journey-progress", local.toFixed(4));
  }

  if (relaySection) {
    const rect = relaySection.getBoundingClientRect();
    const travel = Math.max(rect.height - window.innerHeight, 1);
    const local = clamp(-rect.top / travel);
    relaySection.style.setProperty("--relay-progress", local.toFixed(4));
  }

  if (header) {
    const lightHeader = window.scrollY > window.innerHeight * 3.3 && window.scrollY < window.innerHeight * 5.4;
    header.style.color = lightHeader ? "rgba(232,226,212,.9)" : "";
    header.style.mixBlendMode = lightHeader ? "normal" : "";
  }
}

let raf = null;
function requestScrollUpdate() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    updateScrollState();
    raf = null;
  });
}

function measureBackgroundTravel() {
  if (!longBgImage) return;
  bgTravel = Math.max(longBgImage.getBoundingClientRect().height - window.innerHeight, 0);
  requestScrollUpdate();
}

window.addEventListener("scroll", requestScrollUpdate, { passive: true });
window.addEventListener("resize", measureBackgroundTravel);
if (longBgImage) {
  longBgImage.addEventListener("load", measureBackgroundTravel, { once: true });
}
measureBackgroundTravel();
updateScrollState();

const revealTargets = document.querySelectorAll(".reveal-on-scroll");
if (revealTargets.length) {
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.26 }
    );

    revealTargets.forEach((target) => revealObserver.observe(target));
  } else {
    revealTargets.forEach((target) => target.classList.add("is-visible"));
  }
}
