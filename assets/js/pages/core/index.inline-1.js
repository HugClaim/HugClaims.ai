(function enforceRootCanonicalPath() {
  const isProdHost =
    window.location.hostname === "hugclaim.com" ||
    window.location.hostname === "www.hugclaim.com";
  if (!isProdHost) return;
  if (window.location.pathname !== "/index.html") return;
  const target = `${window.location.origin}/${window.location.search}${window.location.hash}`;
  window.location.replace(target);
})();
