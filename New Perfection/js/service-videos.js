/* ==========================================================================
   AMBIENT PROCESS VIDEOS · plays silent, looping procedure clips only while
   their section is on screen, and never for visitors who ask for reduced
   motion (they keep the static poster instead). Small and dependency-free.
   No-op on pages that do not contain a [data-process-video] section.
   ========================================================================== */
(function () {
  var section = document.querySelector('[data-process-video]');
  if (!section) return;

  var videos = Array.prototype.slice.call(section.querySelectorAll('video'));
  if (!videos.length) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  var play = function () {
    if (reduceMotion && reduceMotion.matches) return;
    videos.forEach(function (video) {
      var attempt = video.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(function () {});
    });
  };
  var pause = function () {
    videos.forEach(function (video) {
      if (!video.paused) video.pause();
    });
  };

  /* Reduced motion: leave the loops paused so the posters stay on screen. */
  if (reduceMotion && reduceMotion.matches) return;
  if (!('IntersectionObserver' in window)) return;

  var inView = false;
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      inView = entry.isIntersecting;
      if (inView) play();
      else pause();
    });
  }, { threshold: 0.15 });

  observer.observe(section);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause();
    else if (inView) play();
  });
})();
