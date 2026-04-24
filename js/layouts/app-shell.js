function safe(value) {
  return String(value ?? '').trim();
}

function ensureElement(id, tagName, className = '') {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement(tagName);
    node.id = id;
  }
  if (className) node.className = className;
  return node;
}

export function mountAppShell(options = {}) {
  const appRoot = options.appRoot
    || (options.appRootId ? document.getElementById(options.appRootId) : null);
  if (!appRoot) return null;

  const layoutId = safe(options.layoutId || 'appShellLayout') || 'appShellLayout';
  const sidebarHostId = safe(options.sidebarHostId || `${layoutId}Sidebar`) || `${layoutId}Sidebar`;
  const topbarHostId = safe(options.topbarHostId || `${layoutId}Topbar`) || `${layoutId}Topbar`;
  const mainId = safe(options.mainId || `${layoutId}Main`) || `${layoutId}Main`;
  const mainClass = safe(options.mainClass || 'shell-main-stage shell-main-offset pt-16 h-screen overflow-y-auto pb-12 relative app-shell-main');

  let layout = document.getElementById(layoutId);
  let sidebarHost = document.getElementById(sidebarHostId);
  let topbarHost = document.getElementById(topbarHostId);
  let mainStage = document.getElementById(mainId);

  if (!layout || !sidebarHost || !topbarHost || !mainStage) {
    layout = ensureElement(layoutId, 'div', 'app-shell-layout w-full min-h-screen relative');
    sidebarHost = ensureElement(sidebarHostId, 'div', 'app-shell-sidebar-host');
    topbarHost = ensureElement(topbarHostId, 'div', 'app-shell-topbar-host');
    mainStage = ensureElement(mainId, 'main', mainClass);

    const parent = appRoot.parentNode;
    if (!parent) return null;

    parent.insertBefore(layout, appRoot);
    layout.appendChild(sidebarHost);
    layout.appendChild(topbarHost);
    layout.appendChild(mainStage);
    mainStage.appendChild(appRoot);
  } else {
    mainStage.className = mainClass;
    if (appRoot.parentNode !== mainStage) {
      mainStage.appendChild(appRoot);
    }
  }

  if (typeof options.sidebarHtml === 'string') sidebarHost.innerHTML = options.sidebarHtml;
  if (typeof options.topbarHtml === 'string') topbarHost.innerHTML = options.topbarHtml;

  layout.dataset.shellMounted = '1';
  appRoot.classList.add('app-shell-content');

  return { layout, sidebarHost, topbarHost, mainStage, appRoot };
}
